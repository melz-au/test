"""Site health (per site per hour) and the latest compliance status per control."""

from __future__ import annotations

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

from quandong.transforms import TIMEZONE, local_ts


def _local_hour(col: str) -> F.Column:
    return F.date_trunc("hour", local_ts(col)).cast("timestamp_ntz")


def site_health(telemetry: DataFrame, security_alerts: DataFrame, findings: DataFrame) -> DataFrame:
    """Uptime, data completeness and alert counts per site per local hour.

    Hours are Australia/Adelaide clock hours: the UTC offset is +9:30 or +10:30, so UTC hour buckets
    would split every local hour in two. ``hour_ts`` is the UTC instant the local hour starts.

    - expected rows = number of distinct tags the site reports times 60 minutes
    - completeness_pct = rows received / expected rows
    - good_data_pct = good-quality rows / expected rows
    - uptime_pct = minutes with any telemetry / 60
    """
    tags = telemetry.groupBy("site_id").agg(F.countDistinct("tag").alias("tag_count"))
    hourly = (
        telemetry.withColumn("hour_local", _local_hour("event_ts"))
        .groupBy("site_id", "hour_local")
        .agg(
            F.count("*").alias("telemetry_rows"),
            F.sum(F.when(F.col("quality") == "good", 1).otherwise(0)).alias("good_rows"),
            F.sum(F.when(F.col("quality") == "bad", 1).otherwise(0)).alias("bad_rows"),
            F.countDistinct(F.date_trunc("minute", "event_ts")).alias("minutes_with_data"),
        )
        .join(tags, "site_id")
    )
    alerts = (
        security_alerts.withColumn("hour_local", _local_hour("event_ts"))
        .groupBy("site_id", "hour_local")
        .agg(
            F.count("*").alias("sensor_alerts"),
            *[
                F.sum(F.when(F.col("severity") == s, 1).otherwise(0)).alias(f"sensor_alerts_{s}")
                for s in ("low", "medium", "high", "critical")
            ],
        )
    )
    dets = (
        findings.withColumn("hour_local", _local_hour("detected_at"))
        .groupBy("site_id", "hour_local")
        .agg(F.count("*").alias("detections"))
    )
    out = hourly.join(alerts, ["site_id", "hour_local"], "left").join(dets, ["site_id", "hour_local"], "left").fillna(0)
    expected = F.col("tag_count") * 60
    return out.select(
        "site_id",
        F.to_utc_timestamp(F.col("hour_local").cast("timestamp"), TIMEZONE).alias("hour_ts"),
        "hour_local",
        F.round(F.col("minutes_with_data") / 60 * 100, 1).alias("uptime_pct"),
        F.round(F.col("telemetry_rows") / expected * 100, 1).alias("completeness_pct"),
        F.round(F.col("good_rows") / expected * 100, 1).alias("good_data_pct"),
        "telemetry_rows",
        "bad_rows",
        "tag_count",
        "sensor_alerts",
        "sensor_alerts_low",
        "sensor_alerts_medium",
        "sensor_alerts_high",
        "sensor_alerts_critical",
        "detections",
    )


ATTESTATION = {
    "compliant": "Attest",
    "partially_compliant": "Attest with exceptions",
    "non_compliant": "Cannot attest",
    "not_assessed": "Evidence missing",
}


def compliance_status(evidence: DataFrame) -> DataFrame:
    """Latest status per control, with the previous status, ready for a board attestation view."""
    w = Window.partitionBy("framework", "control_id").orderBy(F.col("assessment_date").desc(), F.col("event_ts").desc())
    ranked = evidence.withColumn("_rn", F.row_number().over(w)).withColumn("previous_status", F.lead("status").over(w))
    latest = ranked.filter(F.col("_rn") == 1)
    attestation = F.lit(None).cast("string")
    for status, text in ATTESTATION.items():
        attestation = F.when(F.col("status") == status, F.lit(text)).otherwise(attestation)
    return latest.select(
        "framework",
        "control_id",
        "control_name",
        "status",
        "previous_status",
        (F.col("previous_status").isNotNull() & (F.col("previous_status") != F.col("status"))).alias("status_changed"),
        "maturity_level",
        "assessment_date",
        "evidence_ref",
        "notes",
        attestation.alias("attestation"),
    )
