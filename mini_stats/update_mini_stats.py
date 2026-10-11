"""Fetch the full NYT Mini history, then rebuild the summary PNG.

Runs fetch_puzzle_stats.py from the repo root (so it picks up the NYT_COOKIE
in the root .env), writing mini_all.csv there, then calls
mini_stats_summary.py on the result.

    .venv/bin/python mini_stats/update_mini_stats.py
"""

import subprocess
import sys
from pathlib import Path

import mini_stats_summary

FORK_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = FORK_DIR / "mini_all.csv"

# The Mini launched in August 2014; earlier dates only return empty batches.
START_DATE = "2014-08-01"


def fetch():
    if not (FORK_DIR / ".env").exists():
        sys.exit(f"No .env in {FORK_DIR} - add NYT_COOKIE=<your NYT-S cookie> there first.")
    subprocess.run(
        [sys.executable, "fetch_puzzle_stats.py", "--type", "mini",
         "--start-date", START_DATE, "--output-csv", CSV_PATH.name],
        cwd=FORK_DIR,
        check=True,
    )


if __name__ == "__main__":
    fetch()
    mini_stats_summary.build(
        mini_stats_summary.load_solves(CSV_PATH),
        Path(__file__).with_name("mini_stats_summary.png"),
    )
