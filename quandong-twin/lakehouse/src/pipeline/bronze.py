"""Bronze: Auto Loader (cloudFiles, JSON) over the landing volume, one streaming table per stream.

Schema hints come from the ODCS contracts (timestamps stay as raw strings until silver). The schema
does not evolve: anything not in the contract lands in `_rescued_data`. Each row records when it was
ingested and which file it came from.

Uses the current Python API for Lakeflow Spark Declarative Pipelines: `from pyspark import pipelines as dp`.
"""

from pyspark import pipelines as dp
from pyspark.sql import functions as F

from quandong.contracts_generated import BRONZE_SCHEMA_HINTS, FEEDS, LANDING_FOLDER, RESTRICTED_STREAMS

LANDING_ROOT = spark.conf.get("quandong.landing_root")


def define_bronze(stream: str) -> None:
    restricted = stream in RESTRICTED_STREAMS

    @dp.table(
        name=f"bronze_{stream}",
        comment=f"Raw {stream} events from {LANDING_ROOT}/{LANDING_FOLDER[stream]}"
        + (" — RESTRICTED ground truth, for scoring only." if restricted else "."),
        table_properties={"quality": "bronze", "quandong.restricted": str(restricted).lower()},
    )
    def bronze():
        return (
            spark.readStream.format("cloudFiles")
            .option("cloudFiles.format", "json")
            .option("cloudFiles.schemaHints", BRONZE_SCHEMA_HINTS[stream])
            .option("cloudFiles.inferColumnTypes", "false")
            .option("cloudFiles.schemaEvolutionMode", "rescue")
            .option("rescuedDataColumn", "_rescued_data")
            .load(f"{LANDING_ROOT}/{LANDING_FOLDER[stream]}/")
            .withColumn("_ingested_at", F.current_timestamp())
            .withColumn("_source_file", F.col("_metadata.file_path"))
        )


for _stream in (*FEEDS, *RESTRICTED_STREAMS):
    define_bronze(_stream)
