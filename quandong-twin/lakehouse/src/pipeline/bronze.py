"""Bronze: Auto Loader (cloudFiles, JSON) over the landing volume, one streaming table per stream.

The schema comes from the ODCS contracts and is passed explicitly, so nothing is inferred: a stream
whose folder is still empty (for example scenario_log before any incident, or compliance_evidence
before 06:00) simply produces no rows instead of failing. Timestamps stay as raw strings until
silver. Anything that does not fit the contract lands in `_rescued_data`. Each row records when it
was ingested and which file it came from.

Uses the current Python API for Lakeflow Spark Declarative Pipelines: `from pyspark import pipelines as dp`.
"""

import os

from pyspark import pipelines as dp
from pyspark.sql import functions as F

from quandong.contracts_generated import BRONZE_SCHEMA_HINTS, FEEDS, LANDING_FOLDER, RESTRICTED_STREAMS

LANDING_ROOT = spark.conf.get("quandong.landing_root")


def ensure_folder(path: str) -> None:
    """Create a landing folder before the generator's first file arrives (Auto Loader needs the path).

    Unity Catalog volumes are mounted under /Volumes on serverless compute. Skipped where the volume
    is not mounted (for example in local tests).
    """
    if os.path.isdir(LANDING_ROOT):
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as err:
            print(f"could not create {path}: {err}")


def define_bronze(stream: str) -> None:
    restricted = stream in RESTRICTED_STREAMS
    path = f"{LANDING_ROOT}/{LANDING_FOLDER[stream]}/"
    ensure_folder(path)

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
            .option("rescuedDataColumn", "_rescued_data")
            .schema(BRONZE_SCHEMA_HINTS[stream])
            .load(path)
            .withColumn("_ingested_at", F.current_timestamp())
            .withColumn("_source_file", F.col("_metadata.file_path"))
        )


for _stream in (*FEEDS, *RESTRICTED_STREAMS):
    define_bronze(_stream)
