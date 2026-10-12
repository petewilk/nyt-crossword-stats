import argparse
import logging
import os
from csv import DictWriter
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from tqdm import tqdm

API_ROOT = "https://www.nytimes.com/svc/crosswords"
PUZZLE_INFO = API_ROOT + "/v3/puzzles.json"
PUZZLE_STATES = "https://www.nytimes.com/svc/games/state/{game}/latests"
# The states endpoint is keyed by game, and each puzzle type has its own.
# Bonus puzzles aren't supported: their game name is unconfirmed.
STATE_GAMES = {"daily": "crossword_daily", "mini": "crossword_mini"}

DATE_FORMAT = "%Y-%m-%d"
ENV_FILE = Path(__file__).resolve().with_name(".env")

# The puzzle overview API maxes out at 100 results for most dates,
# but for some dates in 1996 and 1999 it maxes at 97 or 98.  So tweak
# the batch size below that
BATCH_SIZE = 95
STATE_CHUNK = 30

# State fields that are lists of cells; the CSV keeps just their length
COUNTED_FIELDS = ["checked", "confirmed", "modified", "penciled", "revealed"]

CSV_FIELDS = [
    "print_date",
    "author",
    "editor",
    "format_type",
    "day_of_week_name",
    "day_of_week_integer",
    "publish_type",
    "puzzle_id",
    "title",
    "version",
    "percent_filled",
    "solved",
    "gold_star",
    "checked",
    "completionFraction",
    "confirmed",
    "firstSolve",
    "firstSolveDate",
    "firstSolveRevealedOrReset",
    "firstSolveUsedAid",
    "isAutocheckEnabled",
    "isTimerReset",
    "modified",
    "penciled",
    "playTimeSeconds",
    "puzzleInfoSeen",
    "revealed",
    "state_star",
]

parser = argparse.ArgumentParser(description="Fetch NYT Crossword stats")
parser.add_argument("-u", "--username", help="NYT Account Email Address")
parser.add_argument("-p", "--password", help="NYT Account Password")
parser.add_argument(
    "-s",
    "--start-date",
    help="The first date to pull from, inclusive (defaults to 30 days ago)",
    default=datetime.strftime(datetime.now() - timedelta(days=30), DATE_FORMAT),
)
parser.add_argument(
    "-e",
    "--end-date",
    help="The last date to pull from, inclusive (defaults to today)",
    default=datetime.strftime(datetime.now(), DATE_FORMAT),
)
parser.add_argument(
    "-o", "--output-csv", help="The CSV file to write to", default="data.csv"
)
parser.add_argument(
    "-t",
    "--type",
    help='The type of puzzle data to fetch: "daily" or "mini" (defaults to daily)',
    choices=sorted(STATE_GAMES),
    default="daily",
)


def login(username, password):
    """Return the NYT-S cookie after logging in"""
    login_resp = requests.post(
        "https://myaccount.nytimes.com/svc/ios/v2/login",
        data={
            "login": username,
            "password": password,
        },
        headers={
            "User-Agent": "Crosswords/20191213190708 CFNetwork/1128.0.1 Darwin/19.6.0",
            "client_id": "ios.crosswords",
        },
    )
    login_resp.raise_for_status()
    for cookie in login_resp.json()["data"]["cookies"]:
        if cookie["name"] == "NYT-S":
            return cookie["cipheredValue"]
    raise ValueError("NYT-S cookie not found")


def resolve_cookie(username=None, password=None):
    """Return the NYT-S cookie from NYT_COOKIE (environment or .env), else log in"""
    load_dotenv(ENV_FILE)
    cookie = os.getenv("NYT_COOKIE")
    if cookie:
        return cookie
    if not (username and password):
        raise SystemExit(
            "Set NYT_COOKIE (in the environment or .env) or pass --username and --password"
        )
    return login(username, password)


def get_v3_puzzle_overview(puzzle_type, start_date, end_date, cookie):
    """Return the puzzles published between two dates, inclusive"""
    payload = {
        "publish_type": puzzle_type,
        "sort_order": "asc",
        "sort_by": "print_date",
        "date_start": start_date.strftime(DATE_FORMAT),
        "date_end": end_date.strftime(DATE_FORMAT),
    }

    overview_resp = requests.get(PUZZLE_INFO, params=payload, cookies={"NYT-S": cookie})

    overview_resp.raise_for_status()
    # results is null for a range with no puzzles
    return overview_resp.json().get("results") or []


def get_puzzle_states(puzzle_id_list, puzzle_type, cookie):
    """Return a list of "game_data" states, one per puzzle the user has opened"""
    payload = {
        "puzzle_ids": ",".join(str(i) for i in puzzle_id_list)
    }

    puzzle_resp = requests.get(
        PUZZLE_STATES.format(game=STATE_GAMES[puzzle_type]),
        params=payload, cookies={"NYT-S": cookie}
    )

    puzzle_resp.raise_for_status()
    return puzzle_resp.json().get("states") or []


def date_batches(start_date, end_date):
    """Split an inclusive date range into (start, end) pairs of at most BATCH_SIZE days"""
    batches = []
    batch_start = start_date
    while batch_start <= end_date:
        batch_end = min(batch_start + timedelta(days=BATCH_SIZE - 1), end_date)
        batches.append((batch_start, batch_end))
        batch_start = batch_end + timedelta(days=1)
    return batches


def shape_overview(puzzle):
    """Add day-of-week columns and rename 'star', which is only true for gold stars"""
    printed = datetime.strptime(puzzle["print_date"], DATE_FORMAT)
    puzzle["day_of_week_name"] = printed.strftime("%A")
    puzzle["day_of_week_integer"] = printed.strftime("%w")
    if "star" in puzzle:
        puzzle["gold_star"] = puzzle.pop("star")
    return puzzle


def shape_state(game_data):
    """Drop "cells", rename "star", and replace the cell lists with their lengths"""
    game_data = dict(game_data)
    game_data.pop("cells", None)
    if "star" in game_data:
        game_data["state_star"] = game_data.pop("star")
    for key in COUNTED_FIELDS:
        if key in game_data:
            game_data[key] = len(game_data[key])
    return game_data


def fetch_stats(puzzle_type, start_date, end_date, cookie):
    """Return {puzzle_id: row} for every puzzle in the range, merged with its solve state"""
    batches = date_batches(start_date, end_date)
    print(
        f"Getting stats from {start_date:{DATE_FORMAT}} until {end_date:{DATE_FORMAT}} "
        f"in {len(batches)} batches"
    )

    # A dictionary, so states can be matched on puzzle_id
    puzzles = {}
    for batch_start, batch_end in (pbar := tqdm(batches)):
        pbar.set_description(f"Start date: {batch_start:{DATE_FORMAT}}")
        for puzzle in get_v3_puzzle_overview(puzzle_type, batch_start, batch_end, cookie):
            puzzles[str(puzzle["puzzle_id"])] = shape_overview(puzzle)

    print("\nGetting puzzle states\n")

    puzzle_ids = list(puzzles)
    for i in tqdm(range(0, len(puzzle_ids), STATE_CHUNK), desc="Fetching puzzle states"):
        id_chunk = puzzle_ids[i : i + STATE_CHUNK]
        requested_ids = set(id_chunk)
        for state in get_puzzle_states(id_chunk, puzzle_type, cookie):
            pid = str(state["puzzle_id"])
            if pid not in requested_ids:
                logging.warning(f"Received unrequested puzzle_id: {pid}")
            if pid in puzzles:
                puzzles[pid].update(shape_state(state["game_data"]))

    return puzzles


def write_csv(puzzles, output_csv):
    """Write the rows from fetch_stats to a CSV, ignoring fields outside CSV_FIELDS"""
    print(f"Writing stats to {output_csv}")
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(puzzles.values())
    print(f"{len(puzzles)} rows written to {output_csv}")


def main(argv=None):
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    cookie = resolve_cookie(args.username, args.password)
    puzzles = fetch_stats(
        args.type,
        datetime.strptime(args.start_date, DATE_FORMAT),
        datetime.strptime(args.end_date, DATE_FORMAT),
        cookie,
    )
    write_csv(puzzles, args.output_csv)


if __name__ == "__main__":
    main()
