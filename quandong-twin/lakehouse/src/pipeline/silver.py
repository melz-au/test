"""Silver: typed, deduplicated, quality-checked streaming tables.

- Columns are cast to the contract's physical types; event_ts is UTC and event_ts_local is
  Australia/Adelaide wall-clock time.
- Duplicates (same event_id) are dropped within a 2-day watermark on ingestion time, so late
  backfills are still accepted.
- Expectations are generated from the contract quality rules: structural failures are dropped
  (expect_or_drop); physical-range breaches are only counted (expect), because they can be attacks.
"""

from pyspark import pipelines as dp
from pyspark.sql import functions as F

from quandong.contracts_generated import EXPECT_OR_DROP, EXPECT_WARN, FEEDS, RESTRICTED_STREAMS
from quandong.transforms import typed


def define_silver(stream: str) -> None:
    warn = {**EXPECT_WARN[stream], "no_rescued_data": "_rescued_data IS NULL"}

    @dp.table(
        name=f"silver_{stream}",
        comment=f"Typed and deduplicated {stream} events (contract-validated).",
        table_properties={"quality": "silver", "quandong.restricted": str(stream in RESTRICTED_STREAMS).lower()},
    )
    @dp.expect_all_or_drop(EXPECT_OR_DROP[stream])
    @dp.expect_all(warn)
    def silver():
        return (
            typed(spark.readStream.table(f"bronze_{stream}"), stream)
            .withWatermark("_ingested_at", "2 days")
            .dropDuplicatesWithinWatermark(["event_id"])
        )


for _stream in (*FEEDS, *RESTRICTED_STREAMS):
    define_silver(_stream)


@dp.materialized_view(name="silver_remote_sessions", comment="One row per remote access session (or rejected attempt).")
def silver_remote_sessions():
    ra = spark.read.table("silver_remote_access")
    return ra.groupBy("session_id").agg(
        F.first("site_id").alias("site_id"),
        F.first("username").alias("username"),
        F.first("user_type").alias("user_type"),
        F.first("source_ip").alias("source_ip"),
        F.first("source_country").alias("source_country"),
        F.first("target_asset_id").alias("target_asset_id"),
        F.first("protocol").alias("protocol"),
        F.max_by("mfa_result", "event_ts").alias("mfa_result"),
        F.max_by("session_state", "event_ts").alias("last_state"),
        F.min("start_ts").alias("start_ts"),
        F.max("end_ts").alias("end_ts"),
    )
