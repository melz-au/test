"""End to end: generator output (via the Node backfill script) → silver typing and expectations →
detections → incidents → scorecard. Checks every planted scenario is detected and clean data is quiet.

Needs Node.js 22.18+ and the repository's npm dependencies; skipped otherwise.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from functools import reduce
from pathlib import Path

import pytest
from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from quandong import detections, incidents, scorecard
from quandong.contracts_generated import BRONZE_SCHEMA_HINTS, EXPECT_OR_DROP, EXPECT_WARN, FEEDS, LANDING_FOLDER
from quandong.transforms import typed

REPO = Path(__file__).resolve().parents[2]
END = "2026-11-14T00:00:00Z"  # Saturday; three days back covers Wed-Fri
RUNS = [
    ("PS04", None),  # clean baseline: must produce no findings
    ("PS03", "rogue_setpoint@2"),
    ("PS02", "rogue_device@2"),
    ("PS01", "unauthorised_logic_change@1"),
]

pytestmark = pytest.mark.skipif(shutil.which("node") is None or not (REPO / "node_modules").exists(), reason="needs node and npm install")


@pytest.fixture(scope="module")
def landing(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("landing")
    env = {**os.environ, "RANDOM_SCENARIOS_PER_SITE_DAY": "0"}
    for site, scenario in RUNS:
        cmd = ["node", "scripts/backfill.ts", "--site", site, "--days", "3", "--end", END, "--out", str(out)]
        if scenario:
            cmd += ["--scenario", scenario]
        subprocess.run(cmd, cwd=REPO, env=env, check=True, capture_output=True)
    return out / "Volumes" / "workspace" / "quandong_twin" / "landing"


@pytest.fixture(scope="module")
def silver(spark, landing) -> dict[str, DataFrame]:
    out = {}
    for stream in (*FEEDS, "scenario_log"):
        path = landing / LANDING_FOLDER[stream]
        raw = spark.read.schema(BRONZE_SCHEMA_HINTS[stream].replace("`", "")).json(str(path)) if path.exists() else None
        out[stream] = typed(raw, stream).cache() if raw is not None else None
    return out


def test_every_event_passes_the_structural_expectations(silver):
    for stream, df in silver.items():
        if df is None:
            continue
        failing = reduce(lambda a, b: a | b, [~F.expr(e) for e in EXPECT_OR_DROP[stream].values()])
        assert df.filter(F.coalesce(failing, F.lit(True))).count() == 0, stream


def test_physical_range_warnings_only_fire_during_attacks(silver):
    tele = silver["process_telemetry"]
    band = EXPECT_WARN["process_telemetry"]["cl2_dose_operating_band"]
    breaches = tele.filter(~F.expr(band)).groupBy("site_id").count().collect()
    assert {r.site_id for r in breaches} == {"PS03"}


@pytest.fixture(scope="module")
def findings(silver) -> DataFrame:
    f = detections.all_detections(
        remote_access=silver["remote_access"],
        protocol_events=silver["protocol_events"],
        process_telemetry=silver["process_telemetry"],
        asset_inventory=silver["asset_inventory"],
        network_flows=silver["network_flows"],
    )
    return incidents.assign_correlation(f).cache()


def test_clean_site_has_no_findings(findings):
    assert findings.filter(F.col("site_id") == "PS04").count() == 0


def test_each_scenario_fires_its_rules_as_one_incident(findings):
    by_site = {r.site_id: r for r in findings.groupBy("site_id").agg(F.array_sort(F.collect_set("rule_id")).alias("rules"), F.countDistinct("correlation_id").alias("incidents")).collect()}
    assert by_site["PS03"].rules == ["QD-001", "QD-002", "QD-003", "QD-004"]
    assert by_site["PS03"].incidents == 1
    assert by_site["PS02"].rules == ["QD-005", "QD-006"]
    assert by_site["PS02"].incidents == 1
    assert by_site["PS01"].rules == ["QD-007"]


def test_scorecard_detects_every_planted_scenario(silver, findings):
    card = {r.scenario_name: r for r in scorecard.detection_scorecard(silver["scenario_log"], findings).collect()}
    assert set(card) == {"rogue_setpoint", "rogue_device", "unauthorised_logic_change"}
    for name, row in card.items():
        assert row.detected, name
        assert row.missed_rule_ids == [], name
        assert row.rule_detection_rate == 1.0, name
    # MFA fatigue is visible ~3 minutes in; the scan within ~4 minutes; the download immediately.
    assert card["rogue_setpoint"].time_to_detect_minutes <= 5
    assert card["rogue_device"].time_to_detect_minutes <= 5
    assert card["unauthorised_logic_change"].time_to_detect_minutes <= 1


def test_incident_summary_shows_the_sensor_under_rated_it(silver, findings):
    inc = incidents.incidents(findings, silver["security_alerts"]).filter(F.col("site_id") == "PS03").first()
    assert inc.max_severity == "critical"
    assert inc.sensor_max_severity == "medium"
    assert "PS03-EWS-01" in inc.affected_assets and "PS03-PLC-02" in inc.affected_assets
