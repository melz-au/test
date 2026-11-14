"""Detections must never be able to see the answer: only the scorecard may read scenario_log."""

import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"


def test_detection_modules_do_not_reference_ground_truth():
    for name in ("detections.py", "incidents.py", "health.py", "transforms.py"):
        text = (SRC / "quandong" / name).read_text()
        assert "scenario_log" not in text, name
        assert "ground_truth" not in text, name


def test_only_the_scorecard_view_reads_silver_scenario_log():
    gold = (SRC / "pipeline" / "gold.py").read_text()
    functions = re.split(r"\n@dp\.", gold)
    readers = [f for f in functions if "silver_scenario_log" in f]
    assert len(readers) == 1
    assert 'name="gold_detection_scorecard"' in readers[0]
