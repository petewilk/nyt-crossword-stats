// Constants, number and date helpers, and the stats behind each chart.
// Each one mirrors a function in mini_stats/mini_stats_summary.py or
// fetch_puzzle_stats.py; tests/test_bookmarklet.py checks they agree.

var VERSION = "1.1";
var PALETTE = CONFIG.palette;
var SURFACE = PALETTE.surface;
var TEXT = PALETTE.text;
var TEXT_2 = PALETTE.text_2;
var GRID = PALETTE.grid;
var NO_HINT = PALETTE.no_hint;
var HINT = PALETTE.hint;
var FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
var DAYS = CONFIG.days;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Each line or bar series, no-hint first, as SERIES in mini_stats_summary.py.
var SERIES = [
  { hints: false, color: NO_HINT, label: "No hints" },
  { hints: true, color: HINT, label: "With hints" }
];
var NO_VALUE = "–";

var PUZZLE_INFO = CONFIG.fetch.puzzle_info;
var PUZZLE_STATES = CONFIG.fetch.puzzle_states;
var BATCH_DAYS = CONFIG.fetch.batch_days;
var STATE_CHUNK = CONFIG.fetch.state_chunk;
var COUNTED_FIELDS = CONFIG.fetch.counted_fields;
var CSV_FIELDS = CONFIG.fetch.csv_fields;
var CONCURRENCY = 4;

var TYPES = {};
Object.keys(CONFIG.types).forEach(function (key) {
  TYPES[key] = CONFIG.types[key];
  TYPES[key].key = key;
});

// ---------------------------------------------------------------- numbers

// Python's round() rounds halves to even; match it so times agree with the PNG.
function roundHalfEven(x) {
  var f = Math.floor(x);
  var d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) { return f % 2 === 0 ? f : f + 1; }
  return Math.round(x);
}

function fmtTime(seconds) {
  if (!isFinite(seconds)) { return NO_VALUE; }
  var s = roundHalfEven(seconds);
  var r = s % 60;
  return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
}

function fmtPct(x) { return roundHalfEven(x * 100) + "%"; }

function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

function median(values) {
  var v = values.filter(isFinite).sort(function (a, b) { return a - b; });
  if (!v.length) { return NaN; }
  var m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function mean(values) {
  var v = values.filter(isFinite);
  if (!v.length) { return NaN; }
  return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
}

function minOf(values) {
  var v = values.filter(isFinite);
  return v.length ? Math.min.apply(null, v) : NaN;
}

function isBlank(v) { return v === null || v === undefined || v === ""; }

// ---------------------------------------------------------------- dates

function parseDay(s) {
  var p = s.split("-");
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function fmtDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

function todayLocal() {
  var d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateBatches(start, end) {
  var batches = [];
  var day = 86400000;
  for (var s = parseDay(start); s <= end; s += BATCH_DAYS * day) {
    batches.push([fmtDay(s), fmtDay(Math.min(s + (BATCH_DAYS - 1) * day, end))]);
  }
  return batches;
}

// ---------------------------------------------------------------- API rows

// Mirror shape_overview() so the CSV is interchangeable.
function shapeOverview(puzzle) {
  var dow = new Date(parseDay(puzzle.print_date)).getUTCDay();
  puzzle.day_of_week_name = DAYS[dow];
  puzzle.day_of_week_integer = String(dow);
  if ("star" in puzzle) {
    puzzle.gold_star = puzzle.star;
    delete puzzle.star;
  }
  return puzzle;
}

// Mirror shape_state(), then copy the state onto the puzzle row.
function mergeState(puzzle, gameData) {
  delete gameData.cells;
  if ("star" in gameData) {
    gameData.state_star = gameData.star;
    delete gameData.star;
  }
  COUNTED_FIELDS.forEach(function (k) {
    if (Array.isArray(gameData[k])) { gameData[k] = gameData[k].length; }
  });
  Object.keys(gameData).forEach(function (k) { puzzle[k] = gameData[k]; });
}

function toCsv(rows) {
  function cell(v) {
    if (v === null || v === undefined) { return ""; }
    if (v === true) { return "True"; }
    if (v === false) { return "False"; }
    var s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var lines = [CSV_FIELDS.join(",")];
  rows.forEach(function (r) {
    lines.push(CSV_FIELDS.map(function (f) { return cell(r[f]); }).join(","));
  });
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- stats

// Same rules as load_solves(): first-solve time, hints = any aid before it.
function solvesFrom(rows) {
  return rows.filter(function (r) { return r.solved === true; }).map(function (r) {
    var t = isBlank(r.firstSolve) ? r.playTimeSeconds : r.firstSolve;
    return {
      date: r.print_date,
      dow: new Date(parseDay(r.print_date)).getUTCDay(),
      seconds: isBlank(t) ? NaN : +t,
      hints: r.firstSolveUsedAid === true
    };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

function byHints(solves, hints) { return solves.filter(function (s) { return s.hints === hints; }); }

function secondsOf(solves) { return solves.map(function (s) { return s.seconds; }); }

function summaryRows(solves, cfg) {
  var groups = [
    ["All solves", solves],
    ["No hints", byHints(solves, false)],
    ["With hints", byHints(solves, true)]
  ];
  return groups.map(function (g) {
    var secs = secondsOf(g[1]);
    if (!secs.length) { return [g[0], "0", "0%", NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE]; }
    var under = secs.filter(function (x) { return x < cfg.under_seconds; }).length / secs.length;
    return [
      g[0], fmtInt(secs.length), fmtPct(secs.length / solves.length),
      fmtTime(median(secs)), fmtTime(mean(secs)), fmtTime(minOf(secs)), fmtPct(under)
    ];
  });
}

function monthIndex(date) { return +date.slice(0, 4) * 12 + (+date.slice(5, 7) - 1); }

// [monthIndex, median] per month, with an empty month NaN like pandas resample.
function monthlyMedians(solves, hints) {
  var group = byHints(solves, hints);
  if (!group.length) { return []; }
  var months = {};
  group.forEach(function (s) { (months[monthIndex(s.date)] = months[monthIndex(s.date)] || []).push(s.seconds); });
  var first = monthIndex(group[0].date);
  var last = monthIndex(group[group.length - 1].date);
  var out = [];
  for (var m = first; m <= last; m++) { out.push([m, months[m] ? median(months[m]) : NaN]); }
  return out;
}

function weekdayMedians(solves, hints) {
  var group = byHints(solves, hints);
  return DAYS.map(function (_, d) {
    return median(secondsOf(group.filter(function (s) { return s.dow === d; })));
  });
}

// Counts per bin, with everything at or over the cap in the last bin.
function histogramCounts(solves, hints, cfg) {
  var nBins = cfg.hist_cap_seconds / cfg.hist_bin_seconds;
  var counts = new Array(nBins).fill(0);
  byHints(solves, hints).forEach(function (s) {
    if (!isFinite(s.seconds)) { return; }
    counts[Math.min(nBins - 1, Math.floor(s.seconds / cfg.hist_bin_seconds))]++;
  });
  return counts;
}

// { "2024": [noHintCount, withHintCount], ... }
function yearCounts(solves) {
  var counts = {};
  solves.forEach(function (s) {
    var yr = s.date.slice(0, 4);
    counts[yr] = counts[yr] || [0, 0];
    counts[yr][s.hints ? 1 : 0]++;
  });
  return counts;
}
