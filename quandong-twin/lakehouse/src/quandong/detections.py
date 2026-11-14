"""Rule-based detections. Each rule takes silver DataFrames and returns findings with FINDING_SCHEMA.

These functions must never read the planted-incident answers (enforced by the isolation test in tests/).

Rules (IDs, names, severities and MITRE ATT&CK for ICS techniques come from the shared reference file):
  QD-001 out-of-hours vendor remote session
  QD-002 MFA fatigue: >= N denials then an approval, same user, within M minutes
  QD-003 setpoint write outside the safe band
  QD-004 process value outside its operating band for more than N minutes
  QD-005 new asset not in the baseline (first seen after the learning period)
  QD-006 port scan: one source to >= N destination/port pairs within M minutes
  QD-007 program download or firmware update outside the change window or from a non-engineering host
"""

from __future__ import annotations

from functools import reduce

from pyspark.sql import Column, DataFrame, Window
from pyspark.sql import functions as F

from quandong.contracts_generated import REFERENCE
from quandong.transforms import bands, in_business_hours, in_change_window, point_class, tag_class

RULES = REFERENCE["detection_rules"]
DET = REFERENCE["detection"]

FINDING_COLUMNS = (
    "finding_id",
    "rule_id",
    "rule_name",
    "severity",
    "mitre_attack_ics_technique",
    "attack_enterprise_technique",
    "site_id",
    "asset_id",
    "first_seen_ts",
    "last_seen_ts",
    "detected_at",
    "evidence_event_ids",
    "description",
)


def _finding(
    df: DataFrame,
    rule_id: str,
    *,
    asset: Column,
    first: Column,
    last: Column,
    detected: Column,
    evidence: Column,
    description: Column,
    severity: Column | None = None,
    site: Column | None = None,
) -> DataFrame:
    rule = RULES[rule_id]
    site_col = site if site is not None else F.col("site_id")
    out = df.select(
        F.lit(rule_id).alias("rule_id"),
        F.lit(rule["name"]).alias("rule_name"),
        (severity if severity is not None else F.lit(rule["severity"])).alias("severity"),
        F.lit(rule["technique"]).alias("mitre_attack_ics_technique"),
        F.lit(rule["enterprise_technique"]).cast("string").alias("attack_enterprise_technique"),
        site_col.alias("site_id"),
        asset.alias("asset_id"),
        first.cast("timestamp").alias("first_seen_ts"),
        last.cast("timestamp").alias("last_seen_ts"),
        detected.cast("timestamp").alias("detected_at"),
        evidence.cast("array<string>").alias("evidence_event_ids"),
        description.alias("description"),
    )
    fid = F.sha2(
        F.concat_ws(
            "|", "rule_id", "site_id", F.coalesce("asset_id", F.lit("")), F.col("first_seen_ts").cast("string")
        ),
        256,
    )
    return out.withColumn("finding_id", F.concat(F.lit("F-"), F.substring(fid, 1, 16))).select(*FINDING_COLUMNS)


def _local_hhmm(col: str) -> Column:
    return F.date_format(F.col(col), "EEE d MMM HH:mm")


# ------------------------------------------------------------------------------------------------
# QD-001 Out-of-hours vendor session
# ------------------------------------------------------------------------------------------------
def out_of_hours_vendor_sessions(remote_access: DataFrame) -> DataFrame:
    started = remote_access.filter(
        (F.col("session_state") == "started")
        & (F.col("user_type") == "vendor")
        & ~in_business_hours(F.col("event_ts_local"))
    )
    return _finding(
        started,
        "QD-001",
        asset=F.col("target_asset_id"),
        first=F.col("event_ts"),
        last=F.col("event_ts"),
        detected=F.col("event_ts"),
        evidence=F.array("event_id"),
        description=F.format_string(
            "Vendor account %s started a %s session to %s at %s local time from %s (%s), outside business hours.",
            "username",
            "protocol",
            "target_asset_id",
            _local_hhmm("event_ts_local"),
            "source_ip",
            "source_country",
        ),
    )


# ------------------------------------------------------------------------------------------------
# QD-002 MFA fatigue
# ------------------------------------------------------------------------------------------------
def mfa_fatigue(remote_access: DataFrame) -> DataFrame:
    window_s = DET["mfa_fatigue_window_minutes"] * 60
    denials = remote_access.filter(F.col("mfa_result") == "denied").select(
        F.col("username").alias("d_user"), F.col("event_ts").alias("d_ts"), F.col("event_id").alias("d_id")
    )
    accepts = remote_access.filter((F.col("session_state") == "started") & (F.col("mfa_result") == "accepted"))
    joined = accepts.join(
        denials,
        (accepts.username == denials.d_user)
        & (denials.d_ts < accepts.event_ts)
        & (F.unix_timestamp(accepts.event_ts) - F.unix_timestamp(denials.d_ts) <= window_s),
    )
    grouped = joined.groupBy(
        "event_id", "event_ts", "site_id", "username", "target_asset_id", "source_ip", "source_country"
    ).agg(
        F.count("d_id").alias("denials"),
        F.min("d_ts").alias("first_denial"),
        F.array_sort(F.collect_list(F.struct("d_ts", "d_id"))).alias("ordered"),
    )
    hits = grouped.filter(F.col("denials") >= DET["mfa_fatigue_min_denials"])
    return _finding(
        hits,
        "QD-002",
        asset=F.col("target_asset_id"),
        first=F.col("first_denial"),
        last=F.col("event_ts"),
        detected=F.col("event_ts"),
        evidence=F.concat(F.transform("ordered", lambda x: x["d_id"]), F.array("event_id")),
        description=F.format_string(
            "%d MFA denials for %s followed by an approval within %d minutes (source %s, %s).",
            "denials",
            "username",
            F.lit(DET["mfa_fatigue_window_minutes"]),
            "source_ip",
            "source_country",
        ),
    )


# ------------------------------------------------------------------------------------------------
# QD-003 Setpoint write outside the safe band
# ------------------------------------------------------------------------------------------------
def setpoint_write_out_of_band(protocol_events: DataFrame) -> DataFrame:
    spark = protocol_events.sparkSession
    writes = protocol_events.filter(
        (F.col("operation") == "write")
        & F.col("register_or_point").contains("SETPOINT")
        & F.col("new_value").isNotNull()
    ).withColumn("tag_class", point_class(F.col("register_or_point")))
    hits = writes.join(F.broadcast(bands(spark)), "tag_class").filter(
        (F.col("new_value") < F.col("band_min")) | (F.col("new_value") > F.col("band_max"))
    )
    return _finding(
        hits,
        "QD-003",
        asset=F.col("asset_id"),
        first=F.col("event_ts"),
        last=F.col("event_ts"),
        detected=F.col("event_ts"),
        evidence=F.array("event_id"),
        description=F.format_string(
            "%s wrote %.2f %s to %s on %s (safe band %.1f-%.1f, previous %s).",
            F.coalesce("initiator_asset_id", "initiator_ip"),
            "new_value",
            "band_unit",
            "register_or_point",
            "asset_id",
            "band_min",
            "band_max",
            F.coalesce(F.format_number("old_value", 2), F.lit("unknown")),
        ),
    )


# ------------------------------------------------------------------------------------------------
# QD-004 Process value out of band for more than N minutes
# ------------------------------------------------------------------------------------------------
def process_out_of_band(telemetry: DataFrame) -> DataFrame:
    spark = telemetry.sparkSession
    n = DET["out_of_band_minutes"]
    t = (
        telemetry.filter((F.col("quality") != "bad") & F.col("value").isNotNull())
        .withColumn("tag_class", tag_class(F.col("tag")))
        .filter(~F.col("tag_class").contains("SETPOINT"))
        .join(F.broadcast(bands(spark)), "tag_class")
        .withColumn("out", (F.col("value") < F.col("band_min")) | (F.col("value") > F.col("band_max")))
    )
    w = Window.partitionBy("site_id", "tag").orderBy("event_ts")
    t = t.withColumn("changed", F.coalesce((F.col("out") != F.lag("out").over(w)).cast("int"), F.lit(1)))
    t = t.withColumn("island", F.sum("changed").over(w.rowsBetween(Window.unboundedPreceding, 0)))
    islands = (
        t.filter("out")
        .groupBy("site_id", "tag", "island")
        .agg(
            F.first("asset_id").alias("asset_id"),
            F.min("event_ts").alias("start_ts"),
            F.max("event_ts").alias("end_ts"),
            F.max("value").alias("max_value"),
            F.min("value").alias("min_value"),
            F.first("band_min").alias("band_min"),
            F.first("band_max").alias("band_max"),
            F.first("band_unit").alias("band_unit"),
            F.array_sort(F.collect_list(F.struct("event_ts", "event_id"))).alias("ordered"),
        )
        .filter(F.unix_timestamp("end_ts") - F.unix_timestamp("start_ts") >= n * 60)
    )
    return _finding(
        islands,
        "QD-004",
        asset=F.col("asset_id"),
        first=F.col("start_ts"),
        last=F.col("end_ts"),
        detected=F.col("start_ts") + F.expr(f"INTERVAL {n} MINUTES"),
        evidence=F.transform(F.slice("ordered", 1, n + 1), lambda x: x["event_id"]),
        description=F.format_string(
            "%s outside its %.1f-%.1f %s band for %d minutes (range %.2f to %.2f).",
            "tag",
            "band_min",
            "band_max",
            "band_unit",
            ((F.unix_timestamp("end_ts") - F.unix_timestamp("start_ts")) / 60 + 1).cast("int"),
            "min_value",
            "max_value",
        ),
    )


# ------------------------------------------------------------------------------------------------
# QD-005 New asset not in the baseline
# ------------------------------------------------------------------------------------------------
def new_assets(asset_inventory: DataFrame) -> DataFrame:
    learning_s = DET["baseline_learning_hours"] * 3600
    site_start = asset_inventory.groupBy("site_id").agg(F.min("event_ts").alias("site_start"))
    first = asset_inventory.groupBy("site_id", "asset_id").agg(
        F.min("event_ts").alias("first_obs"),
        F.min_by("event_id", "event_ts").alias("first_event_id"),
        F.min_by("vendor", "event_ts").alias("vendor"),
        F.min_by("asset_type", "event_ts").alias("asset_type"),
        F.min_by("ip_address", "event_ts").alias("ip_address"),
    )
    new = first.join(site_start, "site_id").filter(
        F.unix_timestamp("first_obs") - F.unix_timestamp("site_start") >= learning_s
    )
    known = list(REFERENCE["known_vendors"])
    unknown_vendor = ~F.col("vendor").isin(known)
    return _finding(
        new,
        "QD-005",
        asset=F.col("asset_id"),
        first=F.col("first_obs"),
        last=F.col("first_obs"),
        detected=F.col("first_obs"),
        evidence=F.array("first_event_id"),
        severity=F.when(unknown_vendor, F.lit("high")).otherwise(F.lit(RULES["QD-005"]["severity"])),
        description=F.format_string(
            "New %s %s at %s first seen after the baseline period; vendor %s%s.",
            "asset_type",
            "asset_id",
            "ip_address",
            "vendor",
            F.when(unknown_vendor, F.lit(" is not an approved vendor")).otherwise(F.lit("")),
        ),
    )


# ------------------------------------------------------------------------------------------------
# QD-006 Port scan
# ------------------------------------------------------------------------------------------------
def port_scans(network_flows: DataFrame) -> DataFrame:
    span = DET["port_scan_window_minutes"]
    per_minute = (
        network_flows.filter(F.col("direction") == "internal")
        .groupBy("site_id", "src_ip", "window_start")
        .agg(
            F.collect_set(F.concat_ws(":", "dst_ip", F.col("dst_port").cast("string"))).alias("targets"),
            F.collect_list("event_id").alias("ids"),
            F.first("src_asset_id", ignorenulls=True).alias("src_asset_id"),
        )
    )
    w = (
        Window.partitionBy("site_id", "src_ip")
        .orderBy(F.unix_timestamp("window_start"))
        .rangeBetween(-(span - 1) * 60, 0)
    )
    m = per_minute.withColumn("targets_in_span", F.size(F.array_distinct(F.flatten(F.collect_list("targets").over(w)))))
    flagged = m.filter(F.col("targets_in_span") >= DET["port_scan_min_targets"])
    wf = Window.partitionBy("site_id", "src_ip").orderBy("window_start")
    gap = F.unix_timestamp("window_start") - F.unix_timestamp(F.lag("window_start").over(wf))
    flagged = flagged.withColumn("new_island", F.when(gap.isNull() | (gap > span * 60), 1).otherwise(0))
    flagged = flagged.withColumn("island", F.sum("new_island").over(wf.rowsBetween(Window.unboundedPreceding, 0)))
    scans = flagged.groupBy("site_id", "src_ip", "island").agg(
        F.first("src_asset_id", ignorenulls=True).alias("src_asset_id"),
        F.min("window_start").alias("first_flagged"),
        F.max("window_start").alias("last_flagged"),
        F.max("targets_in_span").alias("targets"),
        F.flatten(F.collect_list("ids")).alias("ids"),
    )
    return _finding(
        scans,
        "QD-006",
        asset=F.col("src_asset_id"),
        first=F.col("first_flagged") - F.expr(f"INTERVAL {span - 1} MINUTES"),
        last=F.col("last_flagged") + F.expr("INTERVAL 1 MINUTE"),
        detected=F.col("first_flagged") + F.expr("INTERVAL 1 MINUTE"),
        evidence=F.slice(F.array_sort("ids"), 1, 25),
        description=F.format_string(
            "%s (%s) contacted %d distinct address/port pairs within %d minutes.",
            "src_ip",
            F.coalesce("src_asset_id", F.lit("not in inventory")),
            "targets",
            F.lit(span),
        ),
    )


# ------------------------------------------------------------------------------------------------
# QD-007 Program download outside policy
# ------------------------------------------------------------------------------------------------
def program_download_policy(protocol_events: DataFrame, asset_inventory: DataFrame) -> DataFrame:
    eng_types = list(REFERENCE["engineering_asset_types"])
    types = asset_inventory.groupBy("asset_id").agg(F.max_by("asset_type", "event_ts").alias("initiator_type"))
    types = types.withColumnRenamed("asset_id", "init_id")
    dl = protocol_events.filter(F.col("operation").isin("program_download", "firmware_update"))
    dl = dl.join(types, dl.initiator_asset_id == types.init_id, "left")
    outside = ~in_change_window(F.col("event_ts_local"))
    not_eng = ~F.coalesce(F.col("initiator_type"), F.lit("unknown")).isin(eng_types)
    hits = dl.filter(outside | not_eng)
    reasons = F.concat_ws(
        " and ",
        F.when(outside, F.lit("outside the change window")),
        F.when(
            not_eng, F.format_string("from a non-engineering host (%s)", F.coalesce("initiator_type", F.lit("unknown")))
        ),
    )
    return _finding(
        hits,
        "QD-007",
        asset=F.col("asset_id"),
        first=F.col("event_ts"),
        last=F.col("event_ts"),
        detected=F.col("event_ts"),
        evidence=F.array("event_id"),
        description=F.format_string(
            "%s to %s by %s at %s local time, %s (logic checksum %s -> %s).",
            F.regexp_replace("operation", "_", " "),
            "asset_id",
            F.coalesce("initiator_asset_id", "initiator_ip"),
            _local_hhmm("event_ts_local"),
            reasons,
            F.coalesce("logic_checksum_before", F.lit("?")),
            F.coalesce("logic_checksum_after", F.lit("?")),
        ),
    )


def all_detections(
    *,
    remote_access: DataFrame,
    protocol_events: DataFrame,
    process_telemetry: DataFrame,
    asset_inventory: DataFrame,
    network_flows: DataFrame,
) -> DataFrame:
    parts = [
        out_of_hours_vendor_sessions(remote_access),
        mfa_fatigue(remote_access),
        setpoint_write_out_of_band(protocol_events),
        process_out_of_band(process_telemetry),
        new_assets(asset_inventory),
        port_scans(network_flows),
        program_download_policy(protocol_events, asset_inventory),
    ]
    return reduce(DataFrame.unionByName, parts)
