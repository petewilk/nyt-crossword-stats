import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mini_stats"))
import mini_stats_summary as summary  # noqa: E402

FIXTURE = Path(__file__).with_name("fixtures") / "solves.csv"
MINI = summary.TYPES["mini"]


@pytest.fixture
def solves():
    return summary.load_solves(FIXTURE)


def no_hint_solves(df):
    return df[~df.hints]


def test_load_solves_keeps_solved_and_prefers_first_solve(solves):
    assert len(solves) == 6
    # One row has no firstSolve, so it falls back to playTimeSeconds
    assert 95 in solves.seconds.tolist()
    assert solves.hints.sum() == 2


def test_load_solves_rejects_a_csv_with_no_solves(tmp_path):
    empty = tmp_path / "empty.csv"
    pd.read_csv(FIXTURE).head(0).to_csv(empty, index=False)
    with pytest.raises(SystemExit):
        summary.load_solves(empty)


def test_fmt_time():
    assert summary.fmt_time(65) == "1:05"
    assert summary.fmt_time(float("nan")) == summary.NO_VALUE


def test_summary_rows(solves):
    rows = summary.summary_rows(solves, MINI)
    assert [r[0] for r in rows] == ["All solves", "No hints", "With hints"]
    assert rows[0][1:3] == ["6", "100%"]
    assert rows[2][1:3] == ["2", "33%"]


def test_summary_rows_with_an_empty_group(solves):
    rows = summary.summary_rows(no_hint_solves(solves), MINI)
    assert rows[2] == ["With hints", "0", "0%"] + [summary.NO_VALUE] * 4


def test_histogram_puts_overflow_in_the_last_bin(solves):
    counts = summary.histogram_counts(solves, False, MINI)
    assert len(counts) == MINI["hist_cap_seconds"] // MINI["hist_bin_seconds"]
    assert sum(counts) == 4
    assert counts[-1] == 1


def test_png_renders_with_an_empty_hint_group(solves, tmp_path):
    out = tmp_path / "summary.png"
    summary.render_png(no_hint_solves(solves), out, MINI)
    assert out.stat().st_size > 0


def test_png_renders_for_daily(solves, tmp_path):
    out = tmp_path / "daily.png"
    summary.render_png(solves, out, summary.TYPES["daily"])
    assert out.stat().st_size > 0
