"""Build a shareable one-page PNG summary of NYT Mini solve times.

Reads the CSV written by fetch_puzzle_stats.py (--type mini) and splits solves
into those finished with no hints and those where NYT flagged an aid
(check, reveal or autocheck) before the first solve.

    python mini_stats_summary.py [path/to/mini_all.csv] [-o summary.png]
"""

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd

DEFAULT_CSV = Path(__file__).resolve().parent.parent / "mini_all.csv"

SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT_2 = "#52514e"
GRID = "#e4e3df"
NO_HINT = "#2a78d6"
HINT = "#eb6834"

DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def load_solves(csv_path):
    df = pd.read_csv(csv_path, parse_dates=["print_date"])
    df = df[df["solved"] == True].copy()  # noqa: E712 - column holds bools
    # firstSolve is the timer at the moment of the first solve; playTimeSeconds
    # can differ if the puzzle was reset and replayed later.
    df["seconds"] = df["firstSolve"].fillna(df["playTimeSeconds"])
    df["hints"] = df["firstSolveUsedAid"] == True  # noqa: E712
    return df.sort_values("print_date")


def fmt_time(seconds):
    seconds = int(round(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def summary_rows(df):
    groups = [("All solves", df), ("No hints", df[~df.hints]), ("With hints", df[df.hints])]
    rows = []
    for name, g in groups:
        rows.append([
            name,
            f"{len(g):,}",
            f"{len(g) / len(df):.0%}",
            fmt_time(g.seconds.median()),
            fmt_time(g.seconds.mean()),
            fmt_time(g.seconds.min()),
            f"{(g.seconds < 60).mean():.0%}",
        ])
    return rows


def style_axis(ax, title):
    ax.set_facecolor(SURFACE)
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color=TEXT, pad=10)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=TEXT_2, labelsize=9, length=0)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def time_axis(ax):
    ax.yaxis.set_major_locator(mticker.MultipleLocator(60))
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: fmt_time(v)))


def plot_trend(ax, df):
    style_axis(ax, "Monthly median solve time")
    for flag, color, label in ((False, NO_HINT, "No hints"), (True, HINT, "With hints")):
        monthly = df[df.hints == flag].set_index("print_date").seconds.resample("MS").median()
        ax.plot(monthly.index, monthly.values, color=color, linewidth=2, label=label)
        ax.annotate(label, (monthly.index[-1], monthly.values[-1]), xytext=(6, 0),
                    textcoords="offset points", va="center", fontsize=9, color=TEXT_2)
    time_axis(ax)
    ax.set_ylim(bottom=0)
    ax.set_xlim(right=ax.get_xlim()[1] + 200)  # room for the end-of-line labels


def plot_weekday(ax, df):
    style_axis(ax, "Median by day of week")
    width = 0.38
    for i, (flag, color, label) in enumerate(((False, NO_HINT, "No hints"), (True, HINT, "With hints"))):
        med = df[df.hints == flag].groupby("day_of_week_name").seconds.median().reindex(DAYS)
        x = [d + (i - 0.5) * (width + 0.02) for d in range(len(DAYS))]
        ax.bar(x, med.values, width=width, color=color, label=label)
    ax.set_xticks(range(len(DAYS)), [d[:3] for d in DAYS])
    time_axis(ax)
    ax.legend(frameon=False, fontsize=9, labelcolor=TEXT_2, loc="upper left")


def plot_distribution(ax, df):
    style_axis(ax, "How long solves take")
    cap = 300  # bucket everything over 5 minutes together
    bins = list(range(0, cap + 15, 15))
    for flag, color, label in ((False, NO_HINT, "No hints"), (True, HINT, "With hints")):
        secs = df[df.hints == flag].seconds.clip(upper=cap)
        ax.hist(secs, bins=bins, histtype="step", linewidth=2, color=color, label=label)
    ax.set_xticks(range(0, cap + 1, 60), [fmt_time(s) for s in range(0, cap, 60)] + ["5:00+"])
    ax.set_xlabel("Solve time", fontsize=9, color=TEXT_2)
    ax.set_ylabel("Puzzles", fontsize=9, color=TEXT_2)
    ax.legend(frameon=False, fontsize=9, labelcolor=TEXT_2)


def plot_years(ax, df):
    style_axis(ax, "Solves per year")
    counts = df.groupby([df.print_date.dt.year, "hints"]).size().unstack(fill_value=0)
    counts = counts.reindex(columns=[False, True], fill_value=0)
    years = counts.index.astype(str)
    ax.bar(years, counts[False], color=NO_HINT, label="No hints", edgecolor=SURFACE, linewidth=1)
    ax.bar(years, counts[True], bottom=counts[False], color=HINT, label="With hints",
           edgecolor=SURFACE, linewidth=1)
    for x, total, no_hint in zip(years, counts.sum(axis=1), counts[False]):
        ax.annotate(f"{no_hint / total:.0%}", (x, total), xytext=(0, 3), textcoords="offset points",
                    ha="center", fontsize=8, color=TEXT_2)
    ax.legend(frameon=False, fontsize=9, labelcolor=TEXT_2, loc="upper left")
    ax.text(1, -0.16, "Label = share solved with no hints", transform=ax.transAxes,
            ha="right", fontsize=8, color=TEXT_2)


def build(df, out_path):
    fig = plt.figure(figsize=(12, 13), facecolor=SURFACE)
    grid = fig.add_gridspec(3, 2, height_ratios=[0.5, 1, 1], hspace=0.38, wspace=0.18,
                            left=0.07, right=0.95, top=0.9, bottom=0.05)

    first, last = df.print_date.min(), df.print_date.max()
    fig.text(0.07, 0.955, "NYT Mini Crossword stats", fontsize=22, fontweight="bold", color=TEXT)
    fig.text(0.07, 0.93, f"{len(df):,} puzzles solved · {first:%b %Y} – {last:%b %Y} · "
             "“hints” = check, reveal or autocheck used", fontsize=11, color=TEXT_2)

    table_ax = fig.add_subplot(grid[0, :])
    table_ax.axis("off")
    headers = ["", "Solves", "Share", "Median", "Average", "Best", "Under 1:00"]
    table = table_ax.table(cellText=summary_rows(df), colLabels=headers, loc="center",
                           cellLoc="center", bbox=[0, 0, 1, 1])
    table.auto_set_font_size(False)
    for (row, col), cell in table.get_celld().items():
        cell.set_edgecolor(GRID)
        cell.set_facecolor(SURFACE)
        cell.set_linewidth(0.8)
        cell.get_text().set_color(TEXT if row else TEXT_2)
        cell.get_text().set_fontsize(13 if row else 10)
        if col == 0 and row:
            cell.get_text().set_fontweight("bold")
            cell.get_text().set_ha("left")
            cell.PAD = 0.04
        if row == 2 and col == 0:
            cell.get_text().set_color(NO_HINT)
        if row == 3 and col == 0:
            cell.get_text().set_color(HINT)

    plot_trend(fig.add_subplot(grid[1, 0]), df)
    plot_weekday(fig.add_subplot(grid[1, 1]), df)
    plot_distribution(fig.add_subplot(grid[2, 0]), df)
    plot_years(fig.add_subplot(grid[2, 1]), df)

    fig.savefig(out_path, dpi=150, facecolor=SURFACE)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("csv", nargs="?", default=DEFAULT_CSV, type=Path)
    parser.add_argument("-o", "--output", default=Path(__file__).with_name("mini_stats_summary.png"),
                        type=Path)
    args = parser.parse_args()
    build(load_solves(args.csv), args.output)
