"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBookmarklet } = require("./load");

const xw = loadBookmarklet();
const MINI = xw.TYPES.mini;

function solve(date, seconds, hints) {
  return { solved: true, print_date: date, firstSolve: seconds, firstSolveUsedAid: hints };
}

test("fmtTime rounds halves to even and shows a dash for no value", () => {
  assert.equal(xw.fmtTime(65), "1:05");
  assert.equal(xw.fmtTime(60.5), "1:00");
  assert.equal(xw.fmtTime(61.5), "1:02");
  assert.equal(xw.fmtTime(NaN), xw.NO_VALUE);
});

test("solvesFrom keeps solved rows and falls back to playTimeSeconds", () => {
  const rows = [
    { solved: true, print_date: "2024-01-02", firstSolve: null, playTimeSeconds: 95, firstSolveUsedAid: false },
    { solved: false, print_date: "2024-01-01" },
    solve("2024-01-01", 40, true)
  ];
  const solves = xw.solvesFrom(rows);
  assert.deepEqual(solves.map((s) => s.seconds), [40, 95]);
  assert.deepEqual(solves.map((s) => s.hints), [true, false]);
});

test("summaryRows shows dashes for an empty group", () => {
  const rows = xw.summaryRows(xw.solvesFrom([solve("2024-01-01", 40, false)]), MINI);
  assert.deepEqual(rows[2], ["With hints", "0", "0%", "–", "–", "–", "–"]);
  assert.deepEqual(rows[1].slice(1), ["1", "100%", "0:40", "0:40", "0:40", "100%"]);
});

test("dateBatches covers the range in BATCH_DAYS pieces", () => {
  const batches = xw.dateBatches("2020-01-01", xw.parseDay("2020-12-31"));
  assert.equal(batches[0][0], "2020-01-01");
  assert.equal(batches[batches.length - 1][1], "2020-12-31");
  assert.ok(batches.length === Math.ceil(366 / xw.BATCH_DAYS));
});

test("shapeOverview and mergeState match the Python reshaping", () => {
  const p = xw.shapeOverview({ print_date: "2023-12-24", star: "Gold" });
  assert.equal(p.day_of_week_name, "Sunday");
  assert.equal(p.day_of_week_integer, "0");
  assert.equal(p.gold_star, "Gold");
  xw.mergeState(p, { cells: [1], star: "blue", checked: [1, 2] });
  assert.equal(p.state_star, "blue");
  assert.equal(p.checked, 2);
  assert.ok(!("cells" in p) && !("star" in p));
});

test("toCsv writes the shared columns and Python-style booleans", () => {
  const csv = xw.toCsv([{ print_date: "2024-01-01", solved: true, title: 'A "B", C' }]);
  const [header, row] = csv.trim().split("\r\n");
  assert.equal(header, xw.CSV_FIELDS.join(","));
  assert.ok(row.includes("True"));
  assert.ok(row.includes('"A ""B"", C"'));
});

test("histogramCounts puts the cap and above in the last bin", () => {
  const solves = xw.solvesFrom([solve("2024-01-01", 300, false), solve("2024-01-02", 999, false)]);
  const counts = xw.histogramCounts(solves, false, MINI);
  assert.equal(counts.length, MINI.hist_cap_seconds / MINI.hist_bin_seconds);
  assert.equal(counts[counts.length - 1], 2);
});

test("dashboardSvg renders with an empty hint group", () => {
  const svg = xw.dashboardSvg(xw.solvesFrom([solve("2024-01-01", 40, false)]), MINI);
  assert.ok(svg.startsWith("<svg") && svg.includes(xw.CONFIG.hint_note));
  assert.ok(!svg.includes("NaN"));
});
