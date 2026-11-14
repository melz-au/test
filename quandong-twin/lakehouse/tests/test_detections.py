"""Unit tests for each detection rule, using small handcrafted DataFrames."""

from conftest import adl, plus
from quandong import detections as d

WED = (2026, 11, 11)
TUE = (2026, 11, 10)


def session(ts, state="started", user_type="vendor", mfa="accepted", user="svc.wattlecontrols", **kw):
    return {
        "session_id": kw.pop("session_id", f"RA-{ts}-{state}"),
        "session_state": state,
        "username": user,
        "user_type": user_type,
        "source_ip": "198.51.100.20",
        "source_country": "AU",
        "mfa_method": "push",
        "mfa_result": mfa,
        "start_ts": ts,
        "end_ts": None,
        "target_asset_id": "PS03-EWS-01",
        "protocol": "RDP",
        "event_ts": ts,
        **kw,
    }


def test_out_of_hours_vendor_session(mk):
    df = mk(
        "remote_access",
        [
            session(adl(*WED, 2, 3)),  # 02:03 Wednesday: out of hours
            session(adl(*WED, 10, 30)),  # business hours
            session(adl(*WED, 2, 30), user_type="employee", user="j.mcallister"),  # employee, not vendor
            session(adl(2026, 11, 14, 11, 0)),  # Saturday daytime: out of hours
            session(adl(*WED, 3, 0), state="ended"),  # only session starts count
        ],
    )
    out = d.out_of_hours_vendor_sessions(df).collect()
    assert len(out) == 2
    assert {r.rule_id for r in out} == {"QD-001"}
    assert {r.mitre_attack_ics_technique for r in out} == {"T0822"}
    assert all(len(r.evidence_event_ids) == 1 for r in out)
    assert "outside business hours" in out[0].description


def test_mfa_fatigue(mk):
    t = adl(*WED, 2, 0)
    df = mk(
        "remote_access",
        [
            session(plus(t, 0), state="rejected", mfa="denied", session_id="a1"),
            session(plus(t, 1), state="rejected", mfa="denied", session_id="a2"),
            session(plus(t, 2), state="rejected", mfa="denied", session_id="a3"),
            session(plus(t, 3), session_id="a4"),
            # Another user: two denials only, then an accept.
            session(plus(t, 0), state="rejected", mfa="denied", user="r.kaur", session_id="b1"),
            session(plus(t, 1), state="rejected", mfa="denied", user="r.kaur", session_id="b2"),
            session(plus(t, 2), user="r.kaur", session_id="b3"),
            # A third user: three denials, but more than 15 minutes before the accept.
            *[
                session(plus(t, i), state="rejected", mfa="denied", user="p.nguyen", session_id=f"c{i}")
                for i in range(3)
            ],
            session(plus(t, 30), user="p.nguyen", session_id="c9"),
        ],
    )
    out = d.mfa_fatigue(df).collect()
    assert len(out) == 1
    f = out[0]
    assert f.rule_id == "QD-002"
    assert f.attack_enterprise_technique == "T1621"
    assert len(f.evidence_event_ids) == 4
    assert f.first_seen_ts < f.last_seen_ts
    assert f.description.startswith("3 MFA denials")


def write(value, point="40021 (PS03.CL2.SETPOINT_MGL)", initiator="PS03-EWS-01", ts=None, operation="write"):
    return {
        "asset_id": "PS03-PLC-02",
        "initiator_asset_id": initiator,
        "initiator_ip": "10.20.3.41",
        "protocol": "Modbus/TCP",
        "function_code": 6,
        "operation": operation,
        "register_or_point": point,
        "old_value": 1.0,
        "new_value": value,
        "command_count": 1,
        "result": "success",
        "event_ts": ts or adl(*WED, 2, 5),
    }


def test_setpoint_write_out_of_band(mk):
    df = mk(
        "protocol_events",
        [
            write(3.8),
            write(1.1),
            write(0.2),
            write(3.8, point="40001 (PS03.RES.LEVEL_PCT)"),
            write(None, operation="read"),
        ],
    )
    out = d.setpoint_write_out_of_band(df).collect()
    assert sorted(r.description.split(" wrote ")[1].split(" ")[0] for r in out) == ["0.20", "3.80"]
    assert {r.severity for r in out} == {"critical"}
    assert {r.mitre_attack_ics_technique for r in out} == {"T0836"}


def telemetry(tag, start, values, quality="good"):
    return [
        {
            "tag": tag,
            "asset_id": "PS03-PLC-02",
            "value": v,
            "unit": "mg/L",
            "quality": quality if v is not None else "bad",
            "event_ts": plus(start, i),
        }
        for i, v in enumerate(values)
    ]


def test_process_out_of_band_for_more_than_ten_minutes(mk):
    t = adl(*WED, 2, 0)
    long_breach = [1.0] * 5 + [1.6 + 0.05 * i for i in range(15)] + [1.0] * 3
    short_breach = [1.0] * 5 + [1.8] * 8 + [1.0] * 5
    df = mk(
        "process_telemetry",
        telemetry("PS03.CL2.DOSE_MGL", t, long_breach)
        + telemetry("PS04.CL2.DOSE_MGL", t, short_breach)
        + telemetry("PS03.CL2.SETPOINT_MGL", t, [3.8] * 20)  # setpoints are not process values
        + telemetry("PS05.CL2.DOSE_MGL", t, [1.0] * 3 + [None] * 2 + [2.0] * 12),  # dropouts ignored
    )
    df = df.withColumn("site_id", df.tag.substr(1, 4))
    out = sorted(d.process_out_of_band(df).collect(), key=lambda r: r.site_id)
    assert [r.site_id for r in out] == ["PS03", "PS05"]
    f = out[0]
    assert f.rule_id == "QD-004"
    assert (f.detected_at - f.first_seen_ts).total_seconds() == 600
    assert len(f.evidence_event_ids) == 11
    assert "PS03.CL2.DOSE_MGL outside its 0.5-1.5 mg/L band for 15 minutes" in f.description


def asset(asset_id, ts, vendor="Wattle Controls", asset_type="plc", ip="10.20.3.11", change="snapshot"):
    return {
        "asset_id": asset_id,
        "asset_type": asset_type,
        "vendor": vendor,
        "model": "m",
        "ip_address": ip,
        "mac_address": "02:00:00:00:00:01",
        "purdue_level": 1,
        "criticality": "high",
        "first_seen": ts,
        "last_seen": ts,
        "change_type": change,
        "event_ts": ts,
    }


def test_new_asset_not_in_baseline(mk):
    t0 = adl(*WED, 0, 0)
    df = mk(
        "asset_inventory",
        [
            asset("PS03-PLC-01", t0),
            asset("PS03-HMI-01", plus(t0, 60), vendor="Bunyip Automation", asset_type="hmi"),  # within learning period
            asset("PS03-PLC-01", plus(t0, 2 * 1440)),  # daily snapshot of a baseline asset
            asset(
                "PS03-UNK-01",
                plus(t0, 2 * 1440 + 5),
                vendor="Unknown",
                asset_type="unknown",
                ip="10.20.3.200",
                change="added",
            ),
            asset("PS03-RTU-02", plus(t0, 3 * 1440), vendor="Mallee Instruments", asset_type="rtu", change="added"),
        ],
    )
    out = {r.asset_id: r for r in d.new_assets(df).collect()}
    assert set(out) == {"PS03-UNK-01", "PS03-RTU-02"}
    assert out["PS03-UNK-01"].severity == "high"
    assert "not an approved vendor" in out["PS03-UNK-01"].description
    assert out["PS03-RTU-02"].severity == "medium"


def flow(src, dst, port, minute, src_id=None, state="established"):
    t = plus(adl(*WED, 12, 0), minute)
    return {
        "window_start": t,
        "window_end": plus(t, 1),
        "src_asset_id": src_id,
        "dst_asset_id": None,
        "src_ip": src,
        "dst_ip": dst,
        "dst_port": port,
        "transport": "tcp",
        "protocol": "OTHER",
        "bytes": 60,
        "packets": 1,
        "direction": "internal",
        "connection_state": state,
        "event_ts": t,
    }


def test_port_scan(mk):
    scan = [
        flow("10.20.3.200", f"10.20.3.{h}", p, minute=h % 3, src_id="PS03-UNK-01", state="syn_only")
        for h in range(1, 6)
        for p in (502, 20000, 4840)
    ]
    # The HMI polls the same 4 controllers every minute: never a scan, however long it runs.
    polling = [flow("10.20.3.31", f"10.20.3.{h}", 502, minute=m) for h in (11, 12, 13, 21) for m in range(30)]
    out = d.port_scans(mk("network_flows", scan + polling)).collect()
    assert len(out) == 1
    f = out[0]
    assert f.rule_id == "QD-006"
    assert f.asset_id == "PS03-UNK-01"
    assert "15 distinct address/port pairs" in f.description


def test_program_download_policy(mk):
    inv = mk(
        "asset_inventory",
        [
            asset("PS03-HMI-01", adl(*TUE, 0, 0), asset_type="hmi", vendor="Bunyip Automation"),
            asset("PS03-EWS-01", adl(*TUE, 0, 0), asset_type="engineering_workstation", vendor="Saltbush Systems"),
        ],
    )
    pe = mk(
        "protocol_events",
        [
            {
                **write(None, point=None, initiator="PS03-HMI-01", ts=adl(*WED, 14, 0), operation="program_download"),
                "function_code": 90,
            },
            {
                **write(None, point=None, initiator="PS03-EWS-01", ts=adl(*TUE, 11, 0), operation="program_download"),
                "function_code": 90,
            },
            {
                **write(None, point=None, initiator="PS03-EWS-01", ts=adl(*WED, 11, 0), operation="program_download"),
                "function_code": 90,
            },
            {
                **write(None, point=None, initiator="PS03-HMI-01", ts=adl(*TUE, 11, 30), operation="firmware_update"),
                "function_code": 90,
            },
        ],
    )
    out = sorted(d.program_download_policy(pe, inv).collect(), key=lambda r: r.first_seen_ts)
    assert len(out) == 3
    descriptions = [r.description for r in out]
    assert (
        "from a non-engineering host (hmi)" in descriptions[0] and "outside" not in descriptions[0]
    )  # Tue 11:30 firmware from HMI
    assert "outside the change window and from a non-engineering host (hmi)" in descriptions[2]  # Wed 14:00 from HMI
    assert (
        "outside the change window" in descriptions[1] and "non-engineering" not in descriptions[1]
    )  # Wed 11:00 from EWS


def test_all_detections_share_one_schema(mk, spark):
    empty = {
        s: mk(s, [])
        for s in ("remote_access", "protocol_events", "process_telemetry", "asset_inventory", "network_flows")
    }
    df = d.all_detections(**empty)
    assert tuple(df.columns) == d.FINDING_COLUMNS
    assert df.count() == 0
