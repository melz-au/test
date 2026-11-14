"""Group related findings into incidents.

Findings at the same site belong to the same incident when each one starts no more than
``incident_gap_minutes`` after the latest end of the findings before it (gaps-and-islands).
``correlation_id`` is deterministic: INC-{site}-{yyyyMMdd-HHmm of the incident start, UTC}.
"""

from __future__ import annotations

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

from quandong.contracts_generated import REFERENCE
from quandong.transforms import local_ts

SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def _rank(col: str) -> F.Column:
    expr = F.lit(0)
    for name, rank in SEVERITY_RANK.items():
        expr = F.when(F.col(col) == name, F.lit(rank)).otherwise(expr)
    return expr


def _name(rank_col: F.Column) -> F.Column:
    expr = F.lit(None).cast("string")
    for name, rank in SEVERITY_RANK.items():
        expr = F.when(rank_col == rank, F.lit(name)).otherwise(expr)
    return expr


def assign_correlation(findings: DataFrame, gap_minutes: int | None = None) -> DataFrame:
    gap = (gap_minutes if gap_minutes is not None else REFERENCE["detection"]["incident_gap_minutes"]) * 60
    w = Window.partitionBy("site_id").orderBy("first_seen_ts", "rule_id", "finding_id")
    prev_last = F.max(F.unix_timestamp("last_seen_ts")).over(w.rowsBetween(Window.unboundedPreceding, -1))
    starts = F.when(prev_last.isNull() | (F.unix_timestamp("first_seen_ts") > prev_last + gap), 1).otherwise(0)
    f = findings.withColumn("_new", starts)
    f = f.withColumn("_inc", F.sum("_new").over(w.rowsBetween(Window.unboundedPreceding, 0)))
    f = f.withColumn("_inc_start", F.min("first_seen_ts").over(Window.partitionBy("site_id", "_inc")))
    f = f.withColumn(
        "correlation_id",
        F.concat(F.lit("INC-"), F.col("site_id"), F.lit("-"), F.date_format("_inc_start", "yyyyMMdd-HHmm")),
    )
    return f.drop("_new", "_inc", "_inc_start")


def incidents(findings: DataFrame, security_alerts: DataFrame, alert_margin_minutes: int = 30) -> DataFrame:
    """One row per correlation_id with a plain-English summary."""
    f = findings.withColumn("_rank", _rank("severity"))
    g = f.groupBy("correlation_id", "site_id").agg(
        F.min("first_seen_ts").alias("first_seen_ts"),
        F.max("last_seen_ts").alias("last_seen_ts"),
        F.min("detected_at").alias("first_detected_at"),
        F.count("*").alias("finding_count"),
        F.array_sort(F.array_distinct(F.collect_list("asset_id"))).alias("affected_assets"),
        F.array_sort(F.array_distinct(F.collect_list("rule_id"))).alias("rule_ids"),
        F.array_sort(F.array_distinct(F.collect_list("mitre_attack_ics_technique"))).alias(
            "mitre_attack_ics_techniques"
        ),
        F.max("_rank").alias("_max_rank"),
        F.array_sort(F.collect_list(F.struct("first_seen_ts", "rule_name"))).alias("_ordered"),
        F.flatten(F.collect_list("evidence_event_ids")).alias("evidence_event_ids"),
    )
    g = g.withColumn("max_severity", _name(F.col("_max_rank")))

    # What did the OT sensor itself say during the incident? (Shows under-rating.)
    margin = alert_margin_minutes * 60
    a = security_alerts.select(
        F.col("site_id").alias("a_site"), F.col("event_ts").alias("a_ts"), _rank("severity").alias("a_rank")
    )
    joined = g.join(
        a,
        (g.site_id == a.a_site)
        & (F.unix_timestamp(a.a_ts) >= F.unix_timestamp(g.first_seen_ts) - margin)
        & (F.unix_timestamp(a.a_ts) <= F.unix_timestamp(g.last_seen_ts) + margin),
        "left",
    )
    keys = [c for c in g.columns]
    s = joined.groupBy(*keys).agg(F.count("a_ts").alias("sensor_alert_count"), F.max("a_rank").alias("_sensor_rank"))
    s = s.withColumn("sensor_max_severity", _name(F.col("_sensor_rank")))

    local_start = F.date_format(local_ts("first_seen_ts"), "EEE d MMM HH:mm")
    local_end = F.date_format(local_ts("last_seen_ts"), "HH:mm")
    names = F.array_join(F.array_distinct(F.transform("_ordered", lambda x: x["rule_name"])), "; ")
    sensor = F.when(
        F.col("sensor_alert_count") > 0,
        F.format_string(
            " The OT sensor raised %d alert(s) in this period, the highest rated %s.",
            "sensor_alert_count",
            "sensor_max_severity",
        ),
    ).otherwise(F.lit(" The OT sensor raised no alerts in this period."))
    summary = F.concat(
        F.format_string(
            "%s: %d related finding(s) from %s to %s local time: %s. Highest severity %s. Assets involved: %s.",
            "site_id",
            "finding_count",
            local_start,
            local_end,
            names,
            "max_severity",
            F.array_join("affected_assets", ", "),
        ),
        sensor,
    )
    return s.withColumn("summary", summary).select(
        "correlation_id",
        "site_id",
        "first_seen_ts",
        "last_seen_ts",
        "first_detected_at",
        "finding_count",
        "max_severity",
        "affected_assets",
        "rule_ids",
        "mitre_attack_ics_techniques",
        "sensor_alert_count",
        "sensor_max_severity",
        "evidence_event_ids",
        "summary",
    )
