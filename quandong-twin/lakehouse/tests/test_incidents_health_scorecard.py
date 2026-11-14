"""Tests for incident grouping, site health, compliance status and the detection scorecard."""

from datetime import datetime

from pyspark.sql import functions as F

from conftest import adl, plus
from quandong import health, incidents, scorecard
from quandong.detections import FINDING_COLUMNS

WED = (2026, 11, 11)


def findings(spark, specs):
    """specs: (rule_id, site, asset, first_iso, last_iso, severity)."""
    rows = []
    for i, (rule, site, asset, first, last, sev) in enumerate(specs):
        t1 = datetime.strptime(first, "%Y-%m-%dT%H:%M:%S.000Z")
        t2 = datetime.strptime(last, "%Y-%m-%dT%H:%M:%S.000Z")
        rows.append((f"F-{i}", rule, f"rule {rule}", sev, "T0000", None, site, asset, t1, t2, t2, [f"e{i}"], "d"))
    schema = (
        "finding_id string, rule_id string, rule_name string, severity string, mitre_attack_ics_technique string, "
        "attack_enterprise_technique string, site_id string, asset_id string, first_seen_ts timestamp, "
        "last_seen_ts timestamp, detected_at timestamp, evidence_event_ids array<string>, description string"
    )
    df = spark.createDataFrame(rows, schema)
    assert tuple(df.columns) == FINDING_COLUMNS
    return df


def test_correlation_groups_nearby_findings_per_site(spark):
    t = adl(*WED, 2, 0)
    f = findings(
        spark,
        [
            ("QD-002", "PS03", "PS03-EWS-01", t, plus(t, 3), "high"),
            ("QD-001", "PS03", "PS03-EWS-01", plus(t, 3), plus(t, 3), "high"),
            ("QD-003", "PS03", "PS03-PLC-02", plus(t, 5), plus(t, 5), "critical"),
            ("QD-004", "PS03", "PS03-PLC-02", plus(t, 20), plus(t, 100), "high"),
            ("QD-005", "PS03", "PS03-UNK-01", plus(t, 300), plus(t, 300), "high"),  # > 2 h after: new incident
            ("QD-005", "PS04", "PS04-UNK-01", plus(t, 5), plus(t, 5), "medium"),  # other site
        ],
    )
    out = incidents.assign_correlation(f).select("finding_id", "correlation_id").collect()
    by = {r.finding_id: r.correlation_id for r in out}
    assert by["F-0"] == by["F-1"] == by["F-2"] == by["F-3"] == "INC-PS03-20261110-1530"
    assert by["F-4"] != by["F-0"]
    assert by["F-5"].startswith("INC-PS04-")


def test_incident_summary_mentions_rules_severity_and_the_sensor(spark, mk):
    t = adl(*WED, 2, 0)
    f = incidents.assign_correlation(
        findings(
            spark,
            [
                ("QD-002", "PS03", "PS03-EWS-01", t, plus(t, 3), "high"),
                ("QD-003", "PS03", "PS03-PLC-02", plus(t, 5), plus(t, 5), "critical"),
            ],
        )
    )
    alerts = mk(
        "security_alerts",
        [
            {
                "alert_id": "A",
                "rule_id": "QS-2040",
                "rule_name": "x",
                "severity": "medium",
                "mitre_attack_ics_technique": "T0836",
                "asset_id": "PS03-PLC-02",
                "description": "x",
                "status": "new",
                "event_ts": plus(t, 6),
            }
        ],
    )
    out = incidents.incidents(f, alerts).collect()
    assert len(out) == 1
    inc = out[0]
    assert inc.max_severity == "critical"
    assert inc.finding_count == 2
    assert inc.affected_assets == ["PS03-EWS-01", "PS03-PLC-02"]
    assert inc.sensor_max_severity == "medium"
    assert "rule QD-002; rule QD-003" in inc.summary
    assert "Highest severity critical" in inc.summary
    assert "the highest rated medium" in inc.summary
    assert "02:00" in inc.summary  # local time in the summary


def test_site_health_completeness_and_uptime(spark, mk):
    t = adl(*WED, 10, 0)
    tele = [
        {"tag": tag, "asset_id": "PS03-RTU-01", "value": 1.0, "unit": "%", "quality": "good", "event_ts": plus(t, m)}
        for tag in ("PS03.RES.LEVEL_PCT", "PS03.MAIN.PRESSURE_KPA")
        for m in range(60)
    ]
    # Next hour: the RTU drops out for 30 minutes (both tags missing), and 6 samples are bad.
    tele += [
        {
            "tag": tag,
            "asset_id": "PS03-RTU-01",
            "value": 1.0,
            "unit": "%",
            "quality": "good",
            "event_ts": plus(t, 60 + m),
        }
        for tag in ("PS03.RES.LEVEL_PCT", "PS03.MAIN.PRESSURE_KPA")
        for m in range(30)
    ]
    tele += [
        {
            "tag": "PS03.RES.LEVEL_PCT",
            "asset_id": "PS03-RTU-01",
            "value": None,
            "unit": "%",
            "quality": "bad",
            "event_ts": plus(t, 100 + m),
        }
        for m in range(6)
    ]
    alerts = mk(
        "security_alerts",
        [
            {
                "alert_id": "A",
                "rule_id": "QS-1001",
                "rule_name": "x",
                "severity": "low",
                "mitre_attack_ics_technique": "T0855",
                "asset_id": "PS03-PLC-01",
                "description": "x",
                "status": "closed",
                "event_ts": plus(t, 70),
            }
        ],
    )
    empty = findings(spark, [])
    out = health.site_health(mk("process_telemetry", tele), alerts, empty).orderBy("hour_ts").collect()
    assert [r.uptime_pct for r in out] == [100.0, 60.0]
    assert [r.completeness_pct for r in out] == [100.0, 55.0]
    assert out[1].good_data_pct == 50.0
    assert out[1].sensor_alerts_low == 1 and out[0].sensor_alerts == 0
    assert str(out[0].hour_local).startswith("2026-11-11 10:00")


def test_compliance_status_latest_per_control(mk):
    def ev(control, status, date, maturity=2):
        return {
            "framework": "Essential Eight",
            "control_id": control,
            "control_name": control,
            "maturity_level": maturity,
            "status": status,
            "evidence_ref": "e",
            "assessment_date": date,
            "event_ts": f"{date}T00:00:00.000Z",
        }

    df = mk(
        "compliance_evidence",
        [
            ev("E8-MFA", "compliant", "2026-11-10"),
            ev("E8-MFA", "partially_compliant", "2026-11-11", 1),
            ev("E8-BACKUP", "compliant", "2026-11-11", 3),
        ],
    )
    out = {r.control_id: r for r in health.compliance_status(df).collect()}
    assert out["E8-MFA"].status == "partially_compliant"
    assert out["E8-MFA"].previous_status == "compliant"
    assert out["E8-MFA"].status_changed is True
    assert out["E8-MFA"].attestation == "Attest with exceptions"
    assert out["E8-BACKUP"].attestation == "Attest"


def test_scorecard_detection_rate_and_time_to_detect(spark, mk):
    t = adl(*WED, 2, 0)
    log = mk(
        "scenario_log",
        [
            {
                "scenario_id": "GT-1",
                "scenario_name": "rogue_setpoint",
                "step": 1,
                "step_name": "mfa",
                "scenario_start_ts": t,
                "expected_rule_ids": ["QD-002"],
                "evidence_event_ids": [],
                "description": "x",
                "event_ts": plus(t, 2),
            },
            {
                "scenario_id": "GT-1",
                "scenario_name": "rogue_setpoint",
                "step": 2,
                "step_name": "write",
                "scenario_start_ts": t,
                "expected_rule_ids": ["QD-003", "QD-004"],
                "evidence_event_ids": [],
                "description": "x",
                "event_ts": plus(t, 5),
            },
            {
                "scenario_id": "GT-2",
                "scenario_name": "rogue_device",
                "step": 1,
                "step_name": "new",
                "site_id": "PS04",
                "scenario_start_ts": t,
                "expected_rule_ids": ["QD-005"],
                "evidence_event_ids": [],
                "description": "x",
                "event_ts": t,
            },
        ],
    )
    f = incidents.assign_correlation(
        findings(
            spark,
            [
                ("QD-002", "PS03", "PS03-EWS-01", t, plus(t, 3), "high"),
                ("QD-003", "PS03", "PS03-PLC-02", plus(t, 5), plus(t, 5), "critical"),
                ("QD-005", "PS05", "PS05-UNK-01", t, t, "high"),  # wrong site for GT-2
                ("QD-001", "PS03", "PS03-EWS-01", plus(t, 3), plus(t, 3), "high"),  # not expected by GT-1
            ],
        )
    )
    out = {r.scenario_id: r for r in scorecard.detection_scorecard(log, f).collect()}
    gt1 = out["GT-1"]
    assert gt1.expected_rule_ids == ["QD-002", "QD-003", "QD-004"]
    assert gt1.detected_rule_ids == ["QD-002", "QD-003"]
    assert gt1.missed_rule_ids == ["QD-004"]
    assert gt1.detected is True
    assert gt1.rule_detection_rate == round(2 / 3, 3)
    assert gt1.time_to_detect_minutes == 3.0
    assert out["GT-2"].detected is False
    assert out["GT-2"].time_to_detect_minutes is None


def test_typed_adds_local_time(mk):
    df = mk(
        "security_alerts",
        [
            {
                "alert_id": "A",
                "rule_id": "r",
                "rule_name": "r",
                "severity": "low",
                "mitre_attack_ics_technique": "T0855",
                "asset_id": "PS03-PLC-01",
                "description": "x",
                "status": "new",
                "event_ts": "2026-11-10T15:30:00.000Z",
            }
        ],
    )
    r = df.select(F.col("event_ts").cast("string"), F.col("event_ts_local").cast("string")).first()
    assert r[0].startswith("2026-11-10 15:30:00")
    assert r[1].startswith("2026-11-11 02:00:00")
