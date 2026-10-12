// Read solve rows as JSON on stdin and print the bookmarklet's stats for
// every puzzle type, for tests/test_bookmarklet.py to compare with Python.
"use strict";
const { loadBookmarklet } = require("./load");

const xw = loadBookmarklet();
const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
const solves = xw.solvesFrom(rows);
const out = {};
Object.keys(xw.TYPES).forEach((key) => {
  const cfg = xw.TYPES[key];
  out[key] = {
    summary: xw.summaryRows(solves, cfg),
    histogram: xw.SERIES.map((s) => xw.histogramCounts(solves, s.hints, cfg))
  };
});
out.monthly = xw.SERIES.map((s) => xw.monthlyMedians(solves, s.hints));
out.weekday = xw.SERIES.map((s) => xw.weekdayMedians(solves, s.hints));
out.years = xw.yearCounts(solves);
process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === "number" && !isFinite(v) ? null : v)));
