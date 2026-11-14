"""Score detections against the planted scenarios (ground truth). The only module that reads scenario_log."""

from __future__ import annotations

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from quandong.contracts_generated import REFERENCE


def detection_scorecard(scenario_log: DataFrame, findings: DataFrame, grace_minutes: int | None = None) -> DataFrame:
    """One row per planted scenario instance.

    A finding counts for a scenario when it is at the same site, its rule is one the scenario
    expects, and it was detectable between the scenario start and the last step + grace period.
    time_to_detect_minutes uses event time (when the rule could first fire), not pipeline latency.
    """
    grace = (grace_minutes if grace_minutes is not None else REFERENCE["detection"]["scorecard_grace_minutes"]) * 60
    s = scenario_log.groupBy("scenario_id", "scenario_name", "site_id").agg(
        F.min("scenario_start_ts").alias("scenario_start_ts"),
        F.max("event_ts").alias("last_step_ts"),
        F.count("*").alias("steps"),
        F.array_sort(F.array_distinct(F.flatten(F.collect_list("expected_rule_ids")))).alias("expected_rule_ids"),
    )
    f = findings.select(F.col("site_id").alias("f_site"), "rule_id", "detected_at", "correlation_id", "finding_id")
    j = s.join(
        f,
        (s.site_id == f.f_site)
        & F.array_contains(s.expected_rule_ids, f.rule_id)
        & (f.detected_at >= s.scenario_start_ts)
        & (F.unix_timestamp(f.detected_at) <= F.unix_timestamp(s.last_step_ts) + grace),
        "left",
    )
    agg = j.groupBy(*s.columns).agg(
        F.array_sort(F.array_distinct(F.collect_list("rule_id"))).alias("detected_rule_ids"),
        F.min("detected_at").alias("first_detected_at"),
        F.array_sort(F.array_distinct(F.collect_list("correlation_id"))).alias("correlation_ids"),
        F.count("finding_id").alias("matched_findings"),
    )
    expected_n = F.size("expected_rule_ids")
    return agg.select(
        "scenario_id",
        "scenario_name",
        "site_id",
        "scenario_start_ts",
        "last_step_ts",
        "steps",
        "expected_rule_ids",
        "detected_rule_ids",
        F.array_except("expected_rule_ids", "detected_rule_ids").alias("missed_rule_ids"),
        (F.size("detected_rule_ids") > 0).alias("detected"),
        F.when(expected_n > 0, F.round(F.size("detected_rule_ids") / expected_n, 3)).alias("rule_detection_rate"),
        "first_detected_at",
        F.round((F.unix_timestamp("first_detected_at") - F.unix_timestamp("scenario_start_ts")) / 60, 1).alias(
            "time_to_detect_minutes"
        ),
        "matched_findings",
        "correlation_ids",
    )
