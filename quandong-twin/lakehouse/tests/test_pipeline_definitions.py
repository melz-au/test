"""Load the pipeline sources with a stand-in for `pyspark.pipelines` and check what they define.

`pyspark.pipelines` only works inside a Lakeflow pipeline, so this records the decorators instead.
"""

import runpy
import sys
import types
from pathlib import Path

from quandong.contracts_generated import EXPECT_OR_DROP, FEEDS, RESTRICTED_STREAMS

PIPELINE = Path(__file__).resolve().parents[1] / "src" / "pipeline"


class FakeDp(types.ModuleType):
    def __init__(self):
        super().__init__("pyspark.pipelines")
        self.datasets = {}

    def _register(self, kind, name=None, **kw):
        def deco(fn):
            meta = getattr(fn, "_expect", {"drop": {}, "warn": {}})
            self.datasets[name or fn.__name__] = {"kind": kind, **kw, **meta}
            return fn

        return deco

    def table(self, name=None, **kw):
        return self._register("streaming_table", name, **kw)

    def materialized_view(self, name=None, **kw):
        return self._register("materialized_view", name, **kw)

    def expect_all_or_drop(self, rules):
        def deco(fn):
            fn._expect = {**getattr(fn, "_expect", {"drop": {}, "warn": {}}), "drop": rules}
            return fn

        return deco

    def expect_all(self, rules):
        def deco(fn):
            fn._expect = {**getattr(fn, "_expect", {"drop": {}, "warn": {}}), "warn": rules}
            return fn

        return deco


class FakeSpark:
    class conf:
        @staticmethod
        def get(key):
            return {"quandong.landing_root": "/Volumes/workspace/quandong_twin/landing"}[key]


def load_all():
    dp = FakeDp()
    sys.modules["pyspark.pipelines"] = dp
    import pyspark

    pyspark.pipelines = dp
    for f in ("bronze.py", "silver.py", "gold.py"):
        runpy.run_path(str(PIPELINE / f), init_globals={"spark": FakeSpark()})
    return dp.datasets


def test_pipeline_defines_bronze_silver_gold():
    ds = load_all()
    streams = (*FEEDS, *RESTRICTED_STREAMS)
    expected = {f"bronze_{s}" for s in streams} | {f"silver_{s}" for s in streams} | {"silver_remote_sessions"}
    expected |= {
        "gold_detections",
        "gold_incidents",
        "gold_site_health",
        "gold_compliance_status",
        "gold_detection_scorecard",
    }
    assert set(ds) == expected
    assert all(ds[f"bronze_{s}"]["kind"] == "streaming_table" for s in streams)
    assert all(ds[n]["kind"] == "materialized_view" for n in expected if n.startswith("gold_"))


def test_silver_expectations_come_from_the_contracts():
    ds = load_all()
    for s in FEEDS:
        assert ds[f"silver_{s}"]["drop"] == EXPECT_OR_DROP[s]
        assert "no_rescued_data" in ds[f"silver_{s}"]["warn"]
    assert "cl2_dose_operating_band" in ds["silver_process_telemetry"]["warn"]
    assert "cl2_dose_operating_band" not in ds["silver_process_telemetry"]["drop"]
