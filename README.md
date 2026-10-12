# NYT Crossword Stats

Fetch your NYT Crossword Puzzle solve stats and export them as CSV.

The NYT app shows minimal information around your streaks and average solve times. This gets you the raw data so you can do your own analysis.


## What's a GitHub?
Not well-versed in Python or the command-line? Consider signing up for [XW Stats](https://xwstats.com). It's a free site that automatically fetches your solves and allows you to download them as a CSV.

## Requirements

1. Python
2. A NYT Crossword subscription

## Installation

1. Clone this repository
2. `pip install -r requirements.txt`

## Usage

Fetch all solve stats since January 1, 2019. Use your NYT email and passwords as arguments here
```bash
python fetch_puzzle_stats.py -u your@email.com -p yourpass -s 2019-01-01
```
## Options

Follow the command `python fetch_puzzle_stats.py` with these options if you want to:
* `-u` or `--username` The email address for your NYT account
* `-p` or `--password` The password for your NYT account
* `-s` or `--start-date` The date to start fetching stats from, as YYYY-MM-DD (default: 30 days ago)
* `-e` or `--end-date` The date to stop fetching stats from, as YYYY-MM-DD (default: today)
* `-o` or `--output-csv` The name of the CSV file to output (default: data.csv)
* `-t` or `--type` The type of puzzle to fetch. One of "daily" or "mini" (default: daily). Bonus puzzles aren't supported.

### Login Issues
If you are experiencing 403 errors and you are _sure_ your username and password are correct, you may need to provide your login cookie manually. It's a two-step process: 

1) Follow the [instruction steps here](https://xwstats.com/link) to get your cookie.
2) Rename the file `.env.template` to `.env` and paste your cookie into it like this:
```
NYT_COOKIE=1ELEHES...yDo40
```
* If your e-mail or password have some unusual characters, be sure to escape them properly, or wrap the password in quotes (`'` or `"`).

The resulting CSV file (`data.csv` by default, override with `-o`/`--output-csv`) has your solve stats.

## Data Format

One row per puzzle in the date range. The first columns describe the puzzle; the rest are your solve state, and are blank for puzzles you never opened.

### Fields in CSV:
* **print_date** - Date the puzzle was published
* **author** - The author(s) of the puzzle
* **editor** - The puzzle's editor
* **format_type** - Almost always "Normal"
* **day_of_week_name** - Pretty name of the puzzle's day
* **day_of_week_integer** - Integer value, Sunday = `0`, Monday = `1` ...
* **publish_type** - `Daily` or `Mini`
* **puzzle_id** - NYT's reference ID for the puzzle
* **title** - The puzzle's title (for Sundays)
* **version** - NYT's version of the puzzle
* **percent_filled** - How much of the grid you filled
* **solved** - Whether the puzzle was solved
* **gold_star** - Gold if solved before midnight Pacific of its date (available starting 2018-12-12)
* **checked**, **confirmed**, **modified**, **penciled**, **revealed** - Number of cells in each of these states
* **completionFraction** - Fraction of the grid filled, from 0 to 1
* **firstSolve** - Timer reading, in seconds, when you first solved the puzzle
* **firstSolveDate** - When you first solved it, as an ISO 8601 timestamp
* **firstSolveRevealedOrReset** - Whether a reveal or timer reset happened before the first solve
* **firstSolveUsedAid** - Whether you used check or reveal before the first solve
* **isAutocheckEnabled** - Whether autocheck is on for this puzzle
* **isTimerReset** - Whether the timer was reset
* **playTimeSeconds** - Total time on the timer, which can exceed **firstSolve** if you replayed the puzzle
* **puzzleInfoSeen** - Whether you opened the puzzle's info
* **state_star** - The star NYT recorded in your solve state (for example `blue` on the Mini)

## Summary image

`mini_stats/` turns a fetched CSV into a one-page PNG: a summary table plus monthly, weekday, distribution and per-year charts. Solves are split into those with no hints and those where you used check or reveal before the first solve (`firstSolveUsedAid`). Per-type thresholds, such as "Under 1:00" for the Mini and "Under 10:00" for the Daily, live in `stats_config.json`.

Fetch the full history and rebuild the image in one step. It uses `NYT_COOKIE` from the environment or `.env`, or `-u`/`-p`:
```bash
python mini_stats/update_mini_stats.py --type mini
```
This writes `mini_all.csv` in the repo root and `mini_stats/mini_stats_summary.png`. Use `--type daily` for the Daily.

To rebuild the image from a CSV you already have:
```bash
python mini_stats/mini_stats_summary.py mini_all.csv --type mini -o summary.png
```

## Bookmarklet

`bookmarklet/` is a browser bookmark that shows the same summary without Python. Click it on a logged-in www.nytimes.com tab and it reads your solve history straight from the NYT, then opens an overlay with a Mini tab and a Daily tab. Each tab has **Save image** (PNG) and **Download CSV** (the same columns as `fetch_puzzle_stats.py`). The Daily tab uses the Daily thresholds from `stats_config.json`: "Under 10:00", and a histogram in 2-minute bins up to 60:00.

Behind the scenes it retries NYT requests that fail with 429 or 5xx, fetches four batches at a time, and on failure offers **Copy error details**. The copied report includes the step, the HTTP status, the request path and your browser's user agent, never cookies.

The source is in `bookmarklet/src/`. `bookmarklet/build.py` bundles it with `stats_config.json` into the drag-to-install link on `docs/index.html`:
```bash
python bookmarklet/build.py
```
Rerun it after changing `bookmarklet/src/`, `bookmarklet/install_template.html` or `stats_config.json`; a test fails while `docs/index.html` is out of date. To publish the install page, turn on GitHub Pages for the repo with **Deploy from a branch**, branch `master`, folder `/docs`.

## Example

For an example of how to use this data, I plotted my solve times over the last ~8 months, grouped by day:
![example chart](example_chart.png)

## Development

Install the test dependencies and run the tests. The bookmarklet tests also need Node 18 or later, and are skipped without it:
```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest
```
`tests/test_bookmarklet.py` runs the bookmarklet's stats on the same CSVs as `mini_stats_summary.py` and fails if any number differs.
