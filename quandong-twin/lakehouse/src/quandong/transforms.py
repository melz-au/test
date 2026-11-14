"""Typing and time helpers used by silver and gold."""

from __future__ import annotations

from pyspark.sql import Column, DataFrame
from pyspark.sql import functions as F

from quandong.contracts_generated import COLUMNS, REFERENCE

TIMEZONE = REFERENCE["timezone"]
METADATA_COLUMNS = ("_rescued_data", "_ingested_at", "_source_file")


def typed(df: DataFrame, stream: str) -> DataFrame:
    """Cast every contract column to its physical type, in contract order, and add local time.

    Bronze keeps timestamps and dates as raw strings; here they are parsed (ISO 8601, UTC). Columns
    missing from bronze (for example a field added in a later contract version) become nulls.
    """
    exprs: list[Column] = []
    for name, physical, logical, _required in COLUMNS[stream]:
        col = F.col(f"`{name}`") if name in df.columns else F.lit(None)
        if logical == "timestamp":
            exprs.append(F.to_timestamp(col).alias(name))
        elif logical == "date":
            exprs.append(F.to_date(col).alias(name))
        else:
            exprs.append(col.cast(physical).alias(name))
    for meta in METADATA_COLUMNS:
        if meta in df.columns:
            exprs.append(F.col(meta))
    out = df.select(*exprs)
    return out.withColumn("event_ts_local", local_ts("event_ts"))


def local_ts(col: str | Column) -> Column:
    """Australia/Adelaide wall-clock time as TIMESTAMP_NTZ (daylight saving aware)."""
    c = F.col(col) if isinstance(col, str) else col
    return F.from_utc_timestamp(c, TIMEZONE).cast("timestamp_ntz")


def iso_weekday(local: Column) -> Column:
    """ISO weekday (1 = Monday ... 7 = Sunday) of a local timestamp."""
    return ((F.dayofweek(local) + 5) % 7) + 1


def in_business_hours(local: Column) -> Column:
    bh = REFERENCE["business_hours"]
    return (
        iso_weekday(local).isin(list(bh["weekdays"]))
        & (F.hour(local) >= bh["start_hour"])
        & (F.hour(local) < bh["end_hour"])
    )


def in_change_window(local: Column) -> Column:
    cw = REFERENCE["change_window"]
    return (
        (iso_weekday(local) == cw["weekday"]) & (F.hour(local) >= cw["start_hour"]) & (F.hour(local) < cw["end_hour"])
    )


def tag_class(tag: Column) -> Column:
    """`PS03.PUMP2.FLOW_LPS` → `PUMP.FLOW_LPS`; `PS03.CL2.DOSE_MGL` → `CL2.DOSE_MGL`."""
    no_site = F.regexp_replace(tag, r"^[A-Z0-9]+\.", "")
    return F.regexp_replace(no_site, r"^PUMP[0-9]+\.", "PUMP.")


def point_class(register_or_point: Column) -> Column:
    """`40021 (PS03.CL2.SETPOINT_MGL)` → `CL2.SETPOINT_MGL` (null when no tag is embedded)."""
    inner = F.regexp_extract(register_or_point, r"\(([^)]+)\)", 1)
    return F.when(inner == "", F.lit(None)).otherwise(tag_class(inner))


def bands(spark) -> DataFrame:
    """Operating bands from the shared reference file, as a small DataFrame."""
    rows = [(k, float(v["min"]), float(v["max"]), v["unit"]) for k, v in REFERENCE["process_bands"].items()]
    return spark.createDataFrame(rows, "tag_class STRING, band_min DOUBLE, band_max DOUBLE, band_unit STRING")
