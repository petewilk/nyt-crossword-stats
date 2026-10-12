"""Fetch the full solve history for a puzzle type, then rebuild its summary PNG.

Uses NYT_COOKIE from the environment or the repo-root .env, or logs in with
--username and --password. Writes <type>_all.csv to the repo root, then
<type>_stats_summary.png next to this script.

    .venv/bin/python mini_stats/update_mini_stats.py [-t mini|daily] [-u EMAIL -p PASSWORD]
"""

import argparse
import sys
from datetime import datetime

import mini_stats_summary as summary

sys.path.insert(0, str(summary.REPO_ROOT))
import fetch_puzzle_stats as fetch  # noqa: E402 - needs the repo root on sys.path


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-t", "--type", choices=sorted(summary.TYPES), default="mini")
    parser.add_argument("-u", "--username", help="NYT account email, if NYT_COOKIE isn't set")
    parser.add_argument("-p", "--password", help="NYT account password, if NYT_COOKIE isn't set")
    args = parser.parse_args()

    cfg = summary.TYPES[args.type]
    csv_path = summary.default_csv(args.type)
    cookie = fetch.resolve_cookie(args.username, args.password)
    # Start at the type's launch; earlier dates only return empty batches.
    puzzles = fetch.fetch_stats(
        args.type,
        datetime.strptime(cfg["start"], fetch.DATE_FORMAT),
        datetime.now(),
        cookie,
    )
    fetch.write_csv(puzzles, csv_path)
    summary.render_png(summary.load_solves(csv_path), summary.default_png(args.type), cfg)


if __name__ == "__main__":
    main()
