"""Shared fixtures: a local Spark session and helpers to build small silver-shaped DataFrames."""

from __future__ import annotations

import itertools
import os
from datetime import UTC, datetime, timedelta, timezone

import pytest
from pyspark.sql import DataFrame, SparkSession

from quandong.contracts_generated import BRONZE_SCHEMA_HINTS, COLUMNS
from quandong.transforms import typed

ADL_DST = timezone(timedelta(hours=10, minutes=30))  # Australia/Adelaide in November (daylight saving)
_ids = itertools.count(1)


@pytest.fixture(scope="session")
def spark() -> SparkSession:
    os.environ.setdefault("PYSPARK_PYTHON", os.sys.executable)
    s = (
        SparkSession.builder.master("local[2]")
        .appName("quandong-tests")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.shuffle.partitions", "2")
        .config("spark.driver.extraJavaOptions", "-Dlog4j2.level=ERROR")
        .getOrCreate()
    )
    s.sparkContext.setLogLevel("ERROR")
    yield s
    s.stop()


def adl(y: int, mo: int, d: int, h: int, mi: int = 0, s: int = 0) -> str:
    """ISO 8601 UTC string for an Adelaide wall-clock time in November 2026 (UTC+10:30)."""
    return datetime(y, mo, d, h, mi, s, tzinfo=ADL_DST).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def plus(iso: str, minutes: float) -> str:
    t = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%S.000Z") + timedelta(minutes=minutes)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def rows(spark: SparkSession, stream: str, records: list[dict]) -> DataFrame:
    """Silver-shaped DataFrame from partial records; envelope fields are filled in."""
    full = []
    for r in records:
        base = {c[0]: None for c in COLUMNS[stream]}
        base.update(
            event_id=f"00000000-0000-8000-8000-{next(_ids):012d}",
            customer_id="MFW",
            site_id="PS03",
            feed=stream,
            schema_version="1.0.0",
            generator_run_id="test",
        )
        base.update(r)
        full.append(base)
    df = spark.createDataFrame(full, BRONZE_SCHEMA_HINTS[stream].replace("`", ""))
    return typed(df, stream)


@pytest.fixture
def mk(spark):
    return lambda stream, records: rows(spark, stream, records)
