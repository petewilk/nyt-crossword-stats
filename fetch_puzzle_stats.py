import argparse
import os
from csv import DictWriter
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv
from tqdm import tqdm
import logging

load_dotenv()

API_ROOT = "https://www.nytimes.com/svc/crosswords"
PUZZLE_INFO = API_ROOT + "/v3/puzzles.json"
PUZZLE_DETAIL = API_ROOT + "/v6/game/"
PUZZLE_STATES = "https://www.nytimes.com/svc/games/state/crossword_daily/latests"

DATE_FORMAT = "%Y-%m-%d"

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
    help='The type of puzzle data to fetch. Valid values are "daily", "bonus", and "mini" (defaults to daily)',
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


def get_v3_puzzle_overview(puzzle_type, start_date, end_date, cookie):
    payload = {
        "publish_type": puzzle_type,
        "sort_order": "asc",
        "sort_by": "print_date",
        "date_start": start_date.strftime("%Y-%m-%d"),
        "date_end": end_date.strftime("%Y-%m-%d"),
    }

    overview_resp = requests.get(PUZZLE_INFO, params=payload, cookies={"NYT-S": cookie})

    overview_resp.raise_for_status()
    puzzle_info = overview_resp.json().get("results")
    return puzzle_info


def get_v3_puzzle_detail(puzzle_id, cookie):
    puzzle_resp = requests.get(
        f"{PUZZLE_DETAIL}/{puzzle_id}.json", cookies={"NYT-S": cookie}
    )

    puzzle_resp.raise_for_status()
    puzzle_detail = puzzle_resp.json()["calcs"]

    return puzzle_detail


## Returns a list of "game_data", each of which is a dict of a puzzle state.
def get_puzzle_states(puzzle_id_list, cookie):
    payload = {
        "puzzle_ids": ",".join(str(i) for i in puzzle_id_list)
    }

    puzzle_resp = requests.get(
        f"{PUZZLE_STATES}", params=payload, cookies={"NYT-S": cookie}
    )

    puzzle_resp.raise_for_status()
    puzzle_states = puzzle_resp.json()["states"]

    return puzzle_states


if __name__ == "__main__":
    args = parser.parse_args()
    cookie = os.getenv("NYT_COOKIE")
    if not cookie:
        cookie = login(args.username, args.password)

    start_date = datetime.strptime(args.start_date, DATE_FORMAT)
    end_date = datetime.strptime(args.end_date, DATE_FORMAT)

    days_between = (end_date - start_date).days
    # The puzzle overview API maxes out at 100 results for most dates,
    # but for some dates in 1996 and 1999 it maxes at 97 or 98.  So tweak
    # the batch size below that
    BATCH_SIZE = 95
    batches = (days_between // BATCH_SIZE) + 1

    print(
        f"Getting stats from {args.start_date} until {args.end_date} in {batches} batches"
    )

    batch_start = start_date

    # Set up basic logging to print warnings cleanly.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # Make this a dictionary, so we can index on puzzle_id
    puzzle_overview = {}

    for batch in (pbar := tqdm(range(batches))):
        batch_end = min(batch_start + timedelta(days=BATCH_SIZE-1), end_date)
        pbar.set_description(f"Start date: {batch_start}")
        batch_overview = get_v3_puzzle_overview(
            puzzle_type=args.type,
            start_date=batch_start,
            end_date=batch_end,
            cookie=cookie,
        )

        for puzzle in batch_overview:
            puzzle["day_of_week_name"] = datetime.strptime(puzzle["print_date"], DATE_FORMAT).strftime('%A')
            puzzle["day_of_week_integer"] = datetime.strptime(puzzle["print_date"], DATE_FORMAT).strftime('%w')
            # Rename the 'star' since it's only true for gold stars
            if "star" in puzzle:
                puzzle["gold_star"] = puzzle.pop("star")
    
        # Convert the list of dicts into a key-value dictionary and merge it
        batch_dict = {str(puzzle["puzzle_id"]): puzzle for puzzle in batch_overview}
        puzzle_overview.update(batch_dict)
        
        batch_start = batch_end + timedelta(days=1)

    print("\nGetting puzzle states\n")

    puzzle_ids = list(puzzle_overview.keys())

    for i in tqdm(range(0, len(puzzle_ids), 30), desc="Fetching puzzle states"):
        id_chunk = puzzle_ids[i : i + 30]
        requested_ids = set(id_chunk)
        chunk_states = get_puzzle_states(id_chunk, cookie)
    
        for state in chunk_states:
            pid = str(state["puzzle_id"])
        
            # Check if the API returned an ID that was not in the request batch
            if pid not in requested_ids:
                logging.warning(f"Received unrequested puzzle_id: {pid}")
      
            if pid in puzzle_overview:
                # We save all the fields of each game_data except "cells".  
                # Also, "star" needs to be renamed, and checked, confirmed,
                # modified, penciled, and revealed are arrays where we
                # just save the len
                game_data = state["game_data"]

                if "cells" in game_data:
                    del game_data["cells"]
    
                if "star" in game_data:
                    game_data["state_star"] = game_data.pop("star")

                # Replace list values with their lengths
                for key in ["checked", "confirmed", "modified",
                            "penciled", "revealed" ]:
                    if key in game_data:
                        game_data[key] = len(game_data[key])
                
                puzzle_overview[pid].update(game_data)

    fields = [
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
        "state_star"
    ]

    print("Writing stats to {}".format(args.output_csv))

    with open(args.output_csv, "w", newline="", encoding="utf-8") as f:
        writer = DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(puzzle_overview.values())

    print("{} rows written to {}".format(len(puzzle_overview), args.output_csv))
