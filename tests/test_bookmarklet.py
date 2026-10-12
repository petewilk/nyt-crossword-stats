"""Checks that the bookmarklet builds, and computes the same stats as Python."""

import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "bookmarklet"))
sys.path.insert(0, str(REPO_ROOT / "mini_stats"))
import build  # noqa: E402
import mini_stats_summary as summary  # noqa: E402

FIXTURE = Path(__file__).with_name("fixtures") / "solves.csv"
REAL_MINI = REPO_ROOT / "mini_all.csv"
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="Node isn't installed")


def test_docs_page_is_up_to_date():
    current = (REPO_ROOT / "docs" / "index.html").read_text(encoding="utf-8")
    assert current == build.render_page(), "run: python bookmarklet/build.py"


def test_bundle_has_no_test_hooks():
    bundle = build.bundle()
    assert "module.exports" not in bundle
    assert "XW_STATS_TEST" not in bundle


@needs_node
def test_packed_bookmarklet_is_valid_javascript(tmp_path):
    href = build.pack(build.bundle())
    script = tmp_path / "bookmarklet.js"
    script.write_text(unquote(href.removeprefix("javascript:")), encoding="utf-8")
    subprocess.run([NODE, "--check", str(script)], check=True)


@needs_node
def test_node_unit_tests_pass():
    result = subprocess.run(
        [NODE, "--test", "tests/js/*.test.js"], cwd=REPO_ROOT, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


def js_stats(csv_path):
    rows = pd.read_csv(csv_path, dtype={"print_date": str}).to_json(orient="records")
    result = subprocess.run(
        [NODE, str(REPO_ROOT / "tests" / "js" / "parity.js")],
        input=rows, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def nullable(values):
    return [None if pd.isna(v) else float(v) for v in values]


def python_stats(csv_path):
    df = summary.load_solves(csv_path)
    stats = {
        key: {
            "summary": summary.summary_rows(df, cfg),
            "histogram": [summary.histogram_counts(df, hints, cfg) for hints, _, _ in summary.SERIES],
        }
        for key, cfg in summary.TYPES.items()
    }
    stats["monthly"] = [
        [[m.year * 12 + m.month - 1, v] for m, v in zip(series.index, nullable(series.values))]
        for series in (summary.monthly_medians(df, hints) for hints, _, _ in summary.SERIES)
    ]
    stats["weekday"] = [nullable(summary.weekday_medians(df, hints)) for hints, _, _ in summary.SERIES]
    counts = summary.year_counts(df)
    stats["years"] = {str(year): [int(row[False]), int(row[True])] for year, row in counts.iterrows()}
    return stats


@needs_node
@pytest.mark.parametrize("csv_path", [
    FIXTURE,
    pytest.param(REAL_MINI, marks=pytest.mark.skipif(not REAL_MINI.exists(), reason="no mini_all.csv")),
])
def test_python_and_bookmarklet_stats_match(csv_path):
    js, py = js_stats(csv_path), python_stats(csv_path)
    assert js.keys() == py.keys()
    for section in py:
        assert js[section] == py[section], section
