"""Build a shareable one-page PNG summary of NYT crossword solve times.

Reads the CSV written by fetch_puzzle_stats.py and splits solves into those
finished with no hints and those where NYT flagged an aid (check or reveal)
before the first solve. Thresholds for each puzzle type live in
stats_config.json, shared with the bookmarklet.

    python mini_stats_summary.py [path/to/mini_all.csv] [-t mini|daily] [-o summary.png]
"""

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((REPO_ROOT / "stats_config.json").read_text(encoding="utf-8"))
TYPES = CONFIG["types"]

PALETTE = CONFIG["palette"]
SURFACE = PALETTE["surface"]
TEXT = PALETTE["text"]
TEXT_2 = PALETTE["text_2"]
GRID = PALETTE["grid"]
NO_HINT = PALETTE["no_hint"]
HINT = PALETTE["hint"]

DAYS = CONFIG["days"]
# (uses hints, colour, label) for each line or bar series, no-hint first
SERIES = ((False, NO_HINT, "No hints"), (True, HINT, "With hints"))
NO_VALUE = "–"


def default_csv(puzzle_type):
    return REPO_ROOT / f"{puzzle_type}_all.csv"


def default_png(puzzle_type):
    return Path(__file__).with_name(f"{puzzle_type}_stats_summary.png")


def load_solves(csv_path):
    df = pd.read_csv(csv_path, parse_dates=["print_date"])
    df = df[df["solved"] == True].copy()  # noqa: E712 - column holds bools
    if df.empty:
        raise SystemExit(f"No solved puzzles in {csv_path}")
    # firstSolve is the timer at the moment of the first solve; playTimeSeconds
    # can differ if the puzzle was reset and replayed later.
    df["seconds"] = df["firstSolve"].fillna(df["playTimeSeconds"])
    df["hints"] = df["firstSolveUsedAid"] == True  # noqa: E712
    return df.sort_values("print_date")


def fmt_time(seconds):
    if pd.isna(seconds):
        return NO_VALUE
    seconds = int(round(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def summary_rows(df, cfg):
    groups = [("All solves", df), ("No hints", df[~df.hints]), ("With hints", df[df.hints])]
    rows = []
    for name, group in groups:
        if group.empty:
            rows.append([name, "0", "0%", NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE])
            continue
        rows.append([
            name,
            f"{len(group):,}",
            f"{len(group) / len(df):.0%}",
            fmt_time(group.seconds.median()),
            fmt_time(group.seconds.mean()),
            fmt_time(group.seconds.min()),
            f"{(group.seconds < cfg['under_seconds']).mean():.0%}",
        ])
    return rows


def monthly_medians(df, hints):
    """Median seconds per calendar month; months with no solves are NaN"""
    return df[df.hints == hints].set_index("print_date").seconds.resample("MS").median()


def weekday_medians(df, hints):
    """Median seconds for each of DAYS, NaN where a day has no solves"""
    return df[df.hints == hints].groupby("day_of_week_name").seconds.median().reindex(DAYS)


def histogram_counts(df, hints, cfg):
    """Solve counts per bin, with everything at or over the cap in the last bin"""
    cap, width = cfg["hist_cap_seconds"], cfg["hist_bin_seconds"]
    secs = df[df.hints == hints].seconds.dropna().clip(upper=cap)
    bins = (secs // width).clip(upper=cap // width - 1).astype(int)
    return bins.value_counts().reindex(range(cap // width), fill_value=0).tolist()


def year_counts(df):
    """Solves per year as columns False (no hints) and True (with hints)"""
    counts = df.groupby([df.print_date.dt.year, "hints"]).size().unstack(fill_value=0)
    return counts.reindex(columns=[False, True], fill_value=0)


def style_axis(ax, title):
    ax.set_facecolor(SURFACE)
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color=TEXT, pad=10)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=TEXT_2, labelsize=9, length=0)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def format_time_axis(ax, cfg):
    ax.yaxis.set_major_locator(mticker.MultipleLocator(cfg["tick_seconds"]))
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_time(v)))


def plot_trend(ax, df, cfg):
    style_axis(ax, "Monthly median solve time")
    for hints, color, label in SERIES:
        # Empty months stay NaN so the line breaks there
        monthly = monthly_medians(df, hints)
        solved_months = monthly.dropna()
        if solved_months.empty:
            continue
        ax.plot(monthly.index, monthly.values, color=color, linewidth=2, label=label)
        ax.annotate(label, (solved_months.index[-1], solved_months.values[-1]), xytext=(6, 0),
                    textcoords="offset points", va="center", fontsize=9, color=TEXT_2)
    format_time_axis(ax, cfg)
    ax.set_ylim(bottom=0)
    ax.set_xlim(right=ax.get_xlim()[1] + 200)  # room for the end-of-line labels


def plot_weekday(ax, df, cfg):
    style_axis(ax, "Median by day of week")
    width = 0.38
    for i, (hints, color, label) in enumerate(SERIES):
        x = [d + (i - 0.5) * (width + 0.02) for d in range(len(DAYS))]
        ax.bar(x, weekday_medians(df, hints).values, width=width, color=color, label=label)
    ax.set_xticks(range(len(DAYS)), [d[:3] for d in DAYS])
    format_time_axis(ax, cfg)
    ax.legend(frameon=False, fontsize=9, labelcolor=TEXT_2, loc="upper left")


def plot_distribution(ax, df, cfg):
    style_axis(ax, "How long solves take")
    cap, width, tick = cfg["hist_cap_seconds"], cfg["hist_bin_seconds"], cfg["tick_seconds"]
    edges = list(range(0, cap + width, width))
    for hints, color, label in SERIES:
        ax.stairs(histogram_counts(df, hints, cfg), edges, linewidth=2, color=color, label=label)
    ticks = list(range(0, cap + 1, tick))
    ax.set_xticks(ticks, [fmt_time(s) for s in ticks[:-1]] + [fmt_time(cap) + "+"])
    ax.set_xlabel("Solve time", fontsize=9, color=TEXT_2)
    ax.set_ylabel("Puzzles", fontsize=9, color=TEXT_2)
    ax.legend(frameon=False, fontsize=9, labelcolor=TEXT_2)


def plot_years(ax, df):
    style_axis(ax, "Solves per year")
    counts = year_counts(df)
    years = counts.index.astype(str)
    for hints, color, label in SERIES:
        bottom = counts[False] if hints else None
        ax.bar(years, counts[hints], bottom=bottom, color=color, label=label,
               edgecolor=SURFACE, linewidth=1)
    for x, total, no_hint in zip(years, counts.sum(axis=1), counts[False]):
        ax.annotate(f"{no_hint / total:.0%}", (x, total), xytext=(0, 3), textcoords="offset points",
                    ha="center", fontsize=8, color=TEXT_2)
    ax.legend(frameon=False, fontsize=9, labelcolor=TEXT_2, loc="upper left")
    ax.text(1, -0.16, "Label = share solved with no hints", transform=ax.transAxes,
            ha="right", fontsize=8, color=TEXT_2)


def render_png(df, out_path, cfg):
    fig = plt.figure(figsize=(12, 13), facecolor=SURFACE)
    grid = fig.add_gridspec(3, 2, height_ratios=[0.5, 1, 1], hspace=0.38, wspace=0.18,
                            left=0.07, right=0.95, top=0.9, bottom=0.05)

    first, last = df.print_date.min(), df.print_date.max()
    fig.text(0.07, 0.955, cfg["title"], fontsize=22, fontweight="bold", color=TEXT)
    fig.text(0.07, 0.93, f"{len(df):,} puzzles solved · {first:%b %Y} – {last:%b %Y} · "
             + CONFIG["hint_note"], fontsize=11, color=TEXT_2)

    table_ax = fig.add_subplot(grid[0, :])
    table_ax.axis("off")
    headers = ["", "Solves", "Share", "Median", "Average", "Best",
               f"Under {fmt_time(cfg['under_seconds'])}"]
    table = table_ax.table(cellText=summary_rows(df, cfg), colLabels=headers, loc="center",
                           cellLoc="center", bbox=[0, 0, 1, 1])
    table.auto_set_font_size(False)
    # Table rows: 0 is the header, then All solves, then one row per SERIES entry
    series_colors = {row: color for row, (_, color, _) in enumerate(SERIES, start=2)}
    for (row, col), cell in table.get_celld().items():
        cell.set_edgecolor(GRID)
        cell.set_facecolor(SURFACE)
        cell.set_linewidth(0.8)
        cell.get_text().set_color(TEXT if row else TEXT_2)
        cell.get_text().set_fontsize(13 if row else 10)
        if col == 0 and row:
            cell.get_text().set_fontweight("bold")
            cell.get_text().set_ha("left")
            cell.get_text().set_color(series_colors.get(row, TEXT))
            cell.PAD = 0.04

    plot_trend(fig.add_subplot(grid[1, 0]), df, cfg)
    plot_weekday(fig.add_subplot(grid[1, 1]), df, cfg)
    plot_distribution(fig.add_subplot(grid[2, 0]), df, cfg)
    plot_years(fig.add_subplot(grid[2, 1]), df)

    fig.savefig(out_path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("csv", nargs="?", type=Path, help="defaults to <type>_all.csv in the repo root")
    parser.add_argument("-t", "--type", choices=sorted(TYPES), default="mini")
    parser.add_argument("-o", "--output", type=Path, help="defaults to <type>_stats_summary.png here")
    args = parser.parse_args()
    render_png(
        load_solves(args.csv or default_csv(args.type)),
        args.output or default_png(args.type),
        TYPES[args.type],
    )
