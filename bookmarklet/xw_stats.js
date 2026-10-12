// NYT crossword stats bookmarklet.
//
// Run from a logged-in www.nytimes.com tab. It reads the same two unofficial
// endpoints as fetch_puzzle_stats.py, so the browser sends the NYT login itself
// and no cookie is ever handled here. Results open in an overlay with a Mini
// and a Daily tab, each mirroring mini_stats/mini_stats_summary.py.
//
// build.py packs this file into the install page. Keep to full-line comments
// and end every statement with a semicolon, so the packed one-liner stays valid.
(function () {
  "use strict";

  var VERSION = "1.0";
  var SURFACE = "#fcfcfb";
  var TEXT = "#0b0b0b";
  var TEXT_2 = "#52514e";
  var GRID = "#e4e3df";
  var NO_HINT = "#2a78d6";
  var HINT = "#eb6834";
  var FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var PUZZLE_INFO = "https://www.nytimes.com/svc/crosswords/v3/puzzles.json";
  var PUZZLE_STATES = "https://www.nytimes.com/svc/games/state/{game}/latests";
  // The overview API caps results near 100, and lower for some 1990s dates.
  var BATCH_DAYS = 95;
  var STATE_CHUNK = 30;
  var CONCURRENCY = 4;

  var TYPES = {
    mini: {
      key: "mini", label: "Mini", title: "NYT Mini Crossword stats",
      game: "crossword_mini", start: "2014-08-01",
      under: 60, histCap: 300, histBin: 15, tick: 60
    },
    daily: {
      key: "daily", label: "Daily", title: "NYT Daily Crossword stats",
      game: "crossword_daily", start: "1993-11-21",
      under: 600, histCap: 3600, histBin: 120, tick: 600
    }
  };

  // Same columns, in the same order, as fetch_puzzle_stats.py.
  var CSV_FIELDS = [
    "print_date", "author", "editor", "format_type", "day_of_week_name",
    "day_of_week_integer", "publish_type", "puzzle_id", "title", "version",
    "percent_filled", "solved", "gold_star", "checked", "completionFraction",
    "confirmed", "firstSolve", "firstSolveDate", "firstSolveRevealedOrReset",
    "firstSolveUsedAid", "isAutocheckEnabled", "isTimerReset", "modified",
    "penciled", "playTimeSeconds", "puzzleInfoSeen", "revealed", "state_star"
  ];

  // ---------------------------------------------------------------- numbers

  // Python's round() rounds halves to even; match it so times agree with the PNG.
  function roundHalfEven(x) {
    var f = Math.floor(x);
    var d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) { return f % 2 === 0 ? f : f + 1; }
    return Math.round(x);
  }

  function fmtTime(seconds) {
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

  // ---------------------------------------------------------------- data

  // Mirror the reshaping in fetch_puzzle_stats.py so the CSV is interchangeable.
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

  function mergeState(puzzle, gameData) {
    delete gameData.cells;
    if ("star" in gameData) {
      gameData.state_star = gameData.star;
      delete gameData.star;
    }
    ["checked", "confirmed", "modified", "penciled", "revealed"].forEach(function (k) {
      if (Array.isArray(gameData[k])) { gameData[k] = gameData[k].length; }
    });
    Object.keys(gameData).forEach(function (k) { puzzle[k] = gameData[k]; });
  }

  // Same rules as load_solves(): first-solve time, hints = any aid before it.
  function solvesFrom(rows) {
    return rows.filter(function (r) { return r.solved === true; }).map(function (r) {
      var t = r.firstSolve;
      if (t === null || t === undefined || t === "") { t = r.playTimeSeconds; }
      return {
        date: r.print_date,
        dow: new Date(parseDay(r.print_date)).getUTCDay(),
        seconds: t === null || t === undefined || t === "" ? NaN : +t,
        hints: r.firstSolveUsedAid === true
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function summaryRows(solves, cfg) {
    var groups = [
      ["All solves", solves],
      ["No hints", solves.filter(function (s) { return !s.hints; })],
      ["With hints", solves.filter(function (s) { return s.hints; })]
    ];
    return groups.map(function (g) {
      var secs = g[1].map(function (s) { return s.seconds; });
      if (!secs.length) { return [g[0], "0", "0%", "–", "–", "–", "–"]; }
      var under = secs.filter(function (x) { return x < cfg.under; }).length / secs.length;
      return [
        g[0], fmtInt(secs.length), fmtPct(secs.length / solves.length),
        fmtTime(median(secs)), fmtTime(mean(secs)), fmtTime(minOf(secs)), fmtPct(under)
      ];
    });
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

  // ---------------------------------------------------------------- fetching

  function XwError(kind, step, url, status, detail) {
    this.kind = kind;
    this.step = step;
    this.path = url ? url.split("?")[0].replace("https://www.nytimes.com", "") : "";
    this.status = status || 0;
    this.detail = detail || "";
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function getJson(url, step, signal, attempt) {
    attempt = attempt || 0;
    return fetch(url, { credentials: "include", signal: signal }).then(function (resp) {
      if (resp.status === 401 || resp.status === 403) { throw new XwError("auth", step, url, resp.status); }
      if ((resp.status === 429 || resp.status >= 500) && attempt < 2) {
        return wait(1000 * (attempt + 1)).then(function () { return getJson(url, step, signal, attempt + 1); });
      }
      if (!resp.ok) { throw new XwError("http", step, url, resp.status); }
      return resp.json().catch(function (e) { throw new XwError("parse", step, url, resp.status, e.message); });
    }, function (e) {
      if (e && e.name === "AbortError") { throw e; }
      throw new XwError("network", step, url, 0, e && e.message);
    });
  }

  // Run worker over items a few at a time, keeping results in input order.
  function pool(items, worker, onDone) {
    var results = new Array(items.length);
    var next = 0;
    function run() {
      if (next >= items.length) { return Promise.resolve(); }
      var i = next++;
      return worker(items[i]).then(function (r) {
        results[i] = r;
        onDone();
        return run();
      });
    }
    var runners = [];
    for (var k = 0; k < Math.min(CONCURRENCY, items.length); k++) { runners.push(run()); }
    return Promise.all(runners).then(function () { return results; });
  }

  function fetchType(cfg, signal, progress) {
    var batches = dateBatches(cfg.start, todayLocal());
    var done = 0;
    progress(0, "Finding puzzles");
    return pool(batches, function (b) {
      var url = PUZZLE_INFO + "?publish_type=" + cfg.key + "&sort_order=asc&sort_by=print_date" +
        "&date_start=" + b[0] + "&date_end=" + b[1];
      return getJson(url, "puzzle list", signal).then(function (j) { return (j && j.results) || []; });
    }, function () {
      done++;
      progress(0.3 * done / batches.length, "Finding puzzles");
    }).then(function (lists) {
      var byId = {};
      var order = [];
      lists.forEach(function (list) {
        list.forEach(function (p) {
          var id = String(p.puzzle_id);
          if (!(id in byId)) { order.push(id); }
          byId[id] = shapeOverview(p);
        });
      });
      var chunks = [];
      for (var i = 0; i < order.length; i += STATE_CHUNK) { chunks.push(order.slice(i, i + STATE_CHUNK)); }
      var got = 0;
      var stateUrl = PUZZLE_STATES.replace("{game}", cfg.game);
      return pool(chunks, function (ids) {
        return getJson(stateUrl + "?puzzle_ids=" + ids.join(","), "puzzle states", signal).then(function (j) {
          ((j && j.states) || []).forEach(function (st) {
            var p = byId[String(st.puzzle_id)];
            if (p && st.game_data) { mergeState(p, st.game_data); }
          });
        });
      }, function () {
        got++;
        progress(0.3 + 0.7 * got / chunks.length,
          "Reading solves (" + fmtInt(Math.min(got * STATE_CHUNK, order.length)) + " of " + fmtInt(order.length) + " puzzles)");
      }).then(function () {
        return order.map(function (id) { return byId[id]; });
      });
    });
  }

  // ---------------------------------------------------------------- SVG charts

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function text(x, y, s, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + (o.size || 12) + '" fill="' + (o.fill || TEXT_2) + '"' +
      (o.anchor ? ' text-anchor="' + o.anchor + '"' : "") +
      (o.weight ? ' font-weight="' + o.weight + '"' : "") +
      (o.baseline ? ' dominant-baseline="' + o.baseline + '"' : "") +
      (o.transform ? ' transform="' + o.transform + '"' : "") + ">" + esc(s) + "</text>";
  }

  function line(x1, y1, x2, y2, color, width) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + color +
      '" stroke-width="' + (width || 1) + '"/>';
  }

  // A bar whose top corners are rounded and whose base sits flat on the axis.
  function bar(x, y, w, h, color) {
    if (h <= 0) { return ""; }
    var r = Math.min(3, w / 2, h);
    return '<path d="M' + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + 'Z" fill="' + color + '"/>';
  }

  // Step size from base * {1, 2, 5, 10, ...} that keeps about six gridlines.
  function niceStep(max, base) {
    var mults = [1, 2, 5];
    for (var p = 1; ; p *= 10) {
      for (var i = 0; i < mults.length; i++) {
        var step = base * mults[i] * p;
        if (max / step <= 6) { return step; }
      }
    }
  }

  function panel(x, y, w, h, title, legend) {
    var area = { x: x + 52, y: y + 40, w: w - 62, h: h - 84 };
    var out = text(x, y + 14, title, { size: 16, weight: "bold", fill: TEXT });
    if (legend) {
      var lx = x + w;
      [["With hints", HINT], ["No hints", NO_HINT]].forEach(function (item) {
        lx -= item[0].length * 6.6 + 30;
        out += '<rect x="' + lx + '" y="' + (y + 5) + '" width="12" height="12" rx="2" fill="' + item[1] + '"/>' +
          text(lx + 18, y + 15, item[0], { size: 12 });
      });
    }
    return { area: area, svg: out };
  }

  function yAxis(area, max, base, fmt) {
    var step = niceStep(max || 1, base);
    var top = Math.max(step, Math.ceil(max / step) * step);
    var out = "";
    for (var v = 0; v <= top + 1e-9; v += step) {
      var yy = area.y + area.h - v / top * area.h;
      out += line(area.x, yy, area.x + area.w, yy, GRID, v === 0 ? 1.2 : 0.8);
      out += text(area.x - 8, yy + 4, fmt(v), { size: 11, anchor: "end" });
    }
    return { svg: out, y: function (val) { return area.y + area.h - val / top * area.h; } };
  }

  function byFlag(solves, flag) { return solves.filter(function (s) { return s.hints === flag; }); }

  function monthIndex(date) { return +date.slice(0, 4) * 12 + (+date.slice(5, 7) - 1); }

  // Monthly median, with an empty month leaving a gap like pandas resample does.
  function monthlyMedians(solves) {
    if (!solves.length) { return []; }
    var groups = {};
    solves.forEach(function (s) { (groups[monthIndex(s.date)] = groups[monthIndex(s.date)] || []).push(s.seconds); });
    var first = monthIndex(solves[0].date);
    var last = monthIndex(solves[solves.length - 1].date);
    var out = [];
    for (var m = first; m <= last; m++) { out.push([m, groups[m] ? median(groups[m]) : NaN]); }
    return out;
  }

  function plotTrend(x, y, w, h, solves, cfg) {
    var p = panel(x, y, w, h, "Monthly median solve time");
    var a = p.area;
    var series = [[false, NO_HINT, "No hints"], [true, HINT, "With hints"]].map(function (s) {
      return { color: s[1], label: s[2], pts: monthlyMedians(byFlag(solves, s[0])) };
    }).filter(function (s) { return s.pts.length; });
    var all = [].concat.apply([], series.map(function (s) { return s.pts; }));
    var lo = Math.min.apply(null, all.map(function (q) { return q[0]; }));
    var hi = Math.max.apply(null, all.map(function (q) { return q[0]; }));
    var maxY = Math.max.apply(null, all.map(function (q) { return isFinite(q[1]) ? q[1] : 0; }));
    var ax = yAxis(a, maxY, cfg.tick, fmtTime);
    // Leave room on the right for the end-of-line labels.
    var plotW = a.w - 78;
    function px(m) { return a.x + (hi === lo ? plotW / 2 : (m - lo) / (hi - lo) * plotW); }
    var out = p.svg + ax.svg;
    var firstYear = Math.ceil(lo / 12);
    var lastYear = Math.floor(hi / 12);
    var yearStep = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 7));
    for (var yr = firstYear; yr <= lastYear; yr += yearStep) {
      out += text(px(yr * 12), a.y + a.h + 18, String(yr), { size: 11, anchor: "middle" });
    }
    var ends = [];
    series.forEach(function (s) {
      var d = "";
      var pen = false;
      s.pts.forEach(function (q) {
        if (!isFinite(q[1])) { pen = false; return; }
        d += (pen ? "L" : "M") + px(q[0]).toFixed(1) + "," + ax.y(q[1]).toFixed(1);
        pen = true;
      });
      out += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round"/>';
      var lastPt = s.pts.filter(function (q) { return isFinite(q[1]); }).pop();
      if (lastPt) { ends.push({ x: px(lastPt[0]) + 6, y: ax.y(lastPt[1]) + 4, label: s.label }); }
    });
    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
      var mid = (ends[0].y + ends[1].y) / 2;
      var up = ends[0].y <= ends[1].y ? 0 : 1;
      ends[up].y = mid - 7;
      ends[1 - up].y = mid + 7;
    }
    ends.forEach(function (e) { out += text(e.x, e.y, e.label, { size: 12 }); });
    return out;
  }

  function plotWeekday(x, y, w, h, solves, cfg) {
    var p = panel(x, y, w, h, "Median by day of week", true);
    var a = p.area;
    var meds = [false, true].map(function (flag) {
      var group = byFlag(solves, flag);
      return DAYS.map(function (_, d) {
        return median(group.filter(function (s) { return s.dow === d; }).map(function (s) { return s.seconds; }));
      });
    });
    var maxY = Math.max.apply(null, meds[0].concat(meds[1]).filter(isFinite).concat([0]));
    var ax = yAxis(a, maxY, cfg.tick, fmtTime);
    var out = p.svg + ax.svg;
    var slot = a.w / 7;
    var bw = slot * 0.36;
    DAYS.forEach(function (day, d) {
      var cx = a.x + slot * (d + 0.5);
      [NO_HINT, HINT].forEach(function (color, i) {
        var v = meds[i][d];
        if (!isFinite(v)) { return; }
        var bx = cx + (i === 0 ? -bw - 1 : 1);
        out += bar(bx, ax.y(v), bw, a.y + a.h - ax.y(v), color);
      });
      out += text(cx, a.y + a.h + 18, day.slice(0, 3), { size: 11, anchor: "middle" });
    });
    return out;
  }

  function plotDistribution(x, y, w, h, solves, cfg) {
    var p = panel(x, y, w, h, "How long solves take", true);
    var a = { x: p.area.x, y: p.area.y, w: p.area.w, h: p.area.h - 14 };
    var nBins = cfg.histCap / cfg.histBin;
    var counts = [false, true].map(function (flag) {
      var c = new Array(nBins).fill(0);
      byFlag(solves, flag).forEach(function (s) {
        if (!isFinite(s.seconds)) { return; }
        c[Math.min(nBins - 1, Math.floor(Math.min(s.seconds, cfg.histCap) / cfg.histBin))]++;
      });
      return c;
    });
    var maxY = Math.max.apply(null, counts[0].concat(counts[1]));
    var ax = yAxis(a, maxY, 1, fmtInt);
    var out = p.svg + ax.svg;
    function px(sec) { return a.x + sec / cfg.histCap * a.w; }
    [NO_HINT, HINT].forEach(function (color, i) {
      var d = "M" + px(0) + "," + ax.y(0);
      counts[i].forEach(function (c, b) {
        d += "V" + ax.y(c).toFixed(1) + "H" + px((b + 1) * cfg.histBin).toFixed(1);
      });
      d += "V" + ax.y(0);
      out += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>';
    });
    for (var s = 0; s <= cfg.histCap; s += cfg.tick) {
      out += text(px(s), a.y + a.h + 18, s === cfg.histCap ? fmtTime(s) + "+" : fmtTime(s), { size: 11, anchor: "middle" });
    }
    out += text(a.x + a.w / 2, a.y + a.h + 38, "Solve time", { size: 12, anchor: "middle" });
    out += text(0, 0, "Puzzles", { size: 12, anchor: "middle", transform: "translate(" + (x + 10) + "," + (a.y + a.h / 2) + ") rotate(-90)" });
    return out;
  }

  function plotYears(x, y, w, h, solves) {
    var p = panel(x, y, w, h, "Solves per year", true);
    var a = p.area;
    var counts = {};
    solves.forEach(function (s) {
      var yr = s.date.slice(0, 4);
      counts[yr] = counts[yr] || [0, 0];
      counts[yr][s.hints ? 1 : 0]++;
    });
    var years = Object.keys(counts).sort();
    var maxY = Math.max.apply(null, years.map(function (yr) { return counts[yr][0] + counts[yr][1]; }).concat([0]));
    var ax = yAxis(a, maxY * 1.08, 1, fmtInt);
    var out = p.svg + ax.svg;
    var slot = a.w / Math.max(1, years.length);
    var bw = slot * 0.8;
    var showPct = slot >= 26;
    var labelStep = Math.max(1, Math.ceil(years.length / 12));
    years.forEach(function (yr, i) {
      var c = counts[yr];
      var bx = a.x + slot * i + (slot - bw) / 2;
      var base = a.y + a.h;
      var top0 = ax.y(c[0]);
      var top1 = ax.y(c[0] + c[1]);
      if (c[1]) {
        out += bar(bx, top1, bw, top0 - top1 - (c[0] ? 1 : 0), HINT);
        if (c[0]) { out += '<rect x="' + bx + '" y="' + top0 + '" width="' + bw + '" height="' + (base - top0) + '" fill="' + NO_HINT + '"/>'; }
      } else {
        out += bar(bx, top0, bw, base - top0, NO_HINT);
      }
      if (showPct) { out += text(bx + bw / 2, top1 - 5, fmtPct(c[0] / (c[0] + c[1])), { size: 10, anchor: "middle" }); }
      if (i % labelStep === 0) { out += text(bx + bw / 2, base + 18, yr, { size: 11, anchor: "middle" }); }
    });
    if (showPct) { out += text(x + w, y + h - 4, "Label = share solved with no hints", { size: 11, anchor: "end" }); }
    return out;
  }

  function summaryTable(x, y, w, rows, cfg) {
    var headers = ["", "Solves", "Share", "Median", "Average", "Best", "Under " + fmtTime(cfg.under)];
    var firstW = w * 0.22;
    var colW = (w - firstW) / (headers.length - 1);
    var headH = 34;
    var rowH = 44;
    var out = "";
    function colX(c) { return c === 0 ? x : x + firstW + colW * (c - 1); }
    for (var r = 0; r <= rows.length + 1; r++) {
      var yy = r === 0 ? y : y + headH + rowH * (r - 1);
      out += line(x, yy, x + w, yy, GRID);
    }
    headers.forEach(function (hd, c) {
      out += text(colX(c) + colW / 2, y + 22, hd, { size: 13, anchor: "middle" });
    });
    rows.forEach(function (row, r) {
      var yy = y + headH + rowH * r + 28;
      row.forEach(function (v, c) {
        if (c === 0) {
          out += text(x + 14, yy, v, { size: 17, weight: "bold", fill: r === 1 ? NO_HINT : r === 2 ? HINT : TEXT });
        } else {
          out += text(colX(c) + colW / 2, yy, v, { size: 17, anchor: "middle", fill: TEXT });
        }
      });
    });
    return out;
  }

  var SVG_W = 1200;
  var SVG_H = 1260;

  function dashboardSvg(solves, cfg) {
    var first = solves[0].date;
    var last = solves[solves.length - 1].date;
    function monthYear(d) { return MONTHS[+d.slice(5, 7) - 1] + " " + d.slice(0, 4); }
    var body = '<rect width="' + SVG_W + '" height="' + SVG_H + '" fill="' + SURFACE + '"/>' +
      text(84, 62, cfg.title, { size: 30, weight: "bold", fill: TEXT }) +
      text(84, 92, fmtInt(solves.length) + " puzzles solved · " + monthYear(first) + " – " + monthYear(last) +
        " · “hints” = check, reveal or autocheck used", { size: 15 }) +
      summaryTable(84, 122, 1032, summaryRows(solves, cfg), cfg) +
      plotTrend(84, 350, 490, 400, solves, cfg) +
      plotWeekday(642, 350, 474, 400, solves, cfg) +
      plotDistribution(84, 810, 490, 410, solves, cfg) +
      plotYears(642, 810, 474, 410, solves);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SVG_W + '" height="' + SVG_H + '" viewBox="0 0 ' +
      SVG_W + " " + SVG_H + '" font-family="' + FONT.replace(/"/g, "'") + '">' + body + "</svg>";
  }

  // Node imports the pure helpers for testing; the browser runs the UI below.
  if (typeof window === "undefined") {
    module.exports = {
      TYPES: TYPES, roundHalfEven: roundHalfEven, fmtTime: fmtTime, solvesFrom: solvesFrom,
      summaryRows: summaryRows, toCsv: toCsv, dateBatches: dateBatches, parseDay: parseDay,
      shapeOverview: shapeOverview, mergeState: mergeState, dashboardSvg: dashboardSvg
    };
    return;
  }

  // ---------------------------------------------------------------- overlay UI

  var HOST_ID = "xw-stats-host";
  var old = document.getElementById(HOST_ID);
  if (old && old.xwClose) { old.xwClose(); }

  var host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
  var root = host.attachShadow({ mode: "open" });
  var controller = new AbortController();
  var prevOverflow = document.documentElement.style.overflow;

  root.innerHTML = "<style>" +
    ":host{all:initial}" +
    ".wrap{position:fixed;inset:0;background:#f1f0ec;color:" + TEXT + ";font:15px/1.45 " + FONT + ";overflow:auto;-webkit-font-smoothing:antialiased}" +
    ".bar{position:sticky;top:0;display:flex;align-items:center;gap:16px;padding:12px 20px;background:" + SURFACE + ";border-bottom:1px solid " + GRID + ";z-index:1}" +
    ".brand{font-weight:700;font-size:17px;margin-right:8px}" +
    ".tabs{display:flex;gap:4px}" +
    ".tab{font:inherit;font-weight:600;padding:7px 16px;border-radius:8px;border:0;background:transparent;color:" + TEXT_2 + ";cursor:pointer}" +
    ".tab[aria-selected=true]{background:" + TEXT + ";color:#fff}" +
    ".close{margin-left:auto;font:inherit;font-size:22px;line-height:1;width:36px;height:36px;border-radius:8px;border:0;background:transparent;color:" + TEXT_2 + ";cursor:pointer}" +
    ".close:hover,.tab:hover:not([aria-selected=true]){background:" + GRID + "}" +
    ".panel{max-width:1200px;margin:24px auto;padding:0 16px}" +
    ".panel[hidden]{display:none}" +
    ".card{background:" + SURFACE + ";border:1px solid " + GRID + ";border-radius:12px;padding:28px}" +
    ".msg{font-size:17px;max-width:620px}" +
    ".sub{color:" + TEXT_2 + ";font-size:14px;margin-top:6px}" +
    ".track{height:8px;background:" + GRID + ";border-radius:4px;margin-top:16px;overflow:hidden;max-width:620px}" +
    ".fill{height:100%;width:0;background:" + NO_HINT + ";transition:width .2s}" +
    ".actions{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap}" +
    ".btn{font:inherit;font-weight:600;padding:9px 16px;border-radius:8px;border:1px solid " + GRID + ";background:" + SURFACE + ";color:" + TEXT + ";cursor:pointer;text-decoration:none;display:inline-block}" +
    ".btn:hover{border-color:" + TEXT_2 + "}" +
    ".btn.primary{background:" + TEXT + ";border-color:" + TEXT + ";color:#fff}" +
    ".chart svg{display:block;width:100%;height:auto;border:1px solid " + GRID + ";border-radius:12px}" +
    "</style>" +
    '<div class="wrap"><div class="bar"><span class="brand">Crossword stats</span>' +
    '<div class="tabs" role="tablist"></div>' +
    '<button class="close" aria-label="Close" title="Close">×</button></div><div class="panels"></div></div>';

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (txt) { e.textContent = txt; }
    return e;
  }

  function close() {
    controller.abort();
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.style.overflow = prevOverflow;
    host.remove();
  }
  function onKey(e) { if (e.key === "Escape") { close(); } }
  host.xwClose = close;
  root.querySelector(".close").onclick = close;
  document.addEventListener("keydown", onKey, true);
  document.documentElement.style.overflow = "hidden";
  document.body.appendChild(host);

  var tabsEl = root.querySelector(".tabs");
  var panelsEl = root.querySelector(".panels");

  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function savePng(svgMarkup, name, onFail) {
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = SVG_W * 2;
        canvas.height = SVG_H * 2;
        var ctx = canvas.getContext("2d");
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0, SVG_W, SVG_H);
        canvas.toBlob(function (b) { if (b) { download(b, name); } else { onFail(); } }, "image/png");
      } catch (e) { onFail(); }
    };
    img.onerror = onFail;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup);
  }

  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).catch(function () { return fallbackCopy(s); });
    }
    return Promise.resolve(fallbackCopy(s));
  }
  function fallbackCopy(s) {
    var ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  // Plain-English wording for each failure; the copied details never include cookies.
  function errorMessage(err, cfg) {
    if (err.kind === "auth") { return "NYT says you're not logged in. Log in to nytimes.com in this tab, then click the bookmark again."; }
    if (err.kind === "network") { return "Couldn't reach the NYT. Check your internet connection, then click the bookmark again."; }
    return "Something went wrong while reading your " + cfg.label + " stats. Click “Copy error details” and send them to whoever gave you this bookmark.";
  }

  function errorDetails(err, cfg) {
    return [
      "NYT crossword stats bookmarklet v" + VERSION,
      "Puzzle: " + cfg.label,
      "Step: " + (err.step || "drawing"),
      "Error: " + (err.kind || "script") + (err.status ? " (HTTP " + err.status + ")" : ""),
      "Request: " + (err.path || "none"),
      "Detail: " + (err.detail || (err instanceof Error ? err.message : "")),
      "Browser: " + navigator.userAgent,
      "Time: " + new Date().toISOString()
    ].join("\n");
  }

  function makeTab(cfg, selected) {
    var tab = el("button", "tab", cfg.label);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(selected));
    var pnl = el("div", "panel");
    pnl.hidden = !selected;
    tab.onclick = function () {
      Array.prototype.forEach.call(tabsEl.children, function (t) { t.setAttribute("aria-selected", "false"); });
      Array.prototype.forEach.call(panelsEl.children, function (p) { p.hidden = true; });
      tab.setAttribute("aria-selected", "true");
      pnl.hidden = false;
    };
    tabsEl.appendChild(tab);
    panelsEl.appendChild(pnl);
    return pnl;
  }

  function showStatus(pnl, msg, sub) {
    pnl.innerHTML = "";
    var card = el("div", "card");
    card.appendChild(el("div", "msg", msg));
    if (sub) { card.appendChild(el("div", "sub", sub)); }
    pnl.appendChild(card);
    return card;
  }

  function showProgress(pnl, cfg) {
    var card = showStatus(pnl, "Loading your " + cfg.label + " stats…", "Starting");
    var track = el("div", "track");
    var fill = el("div", "fill");
    track.appendChild(fill);
    card.appendChild(track);
    var sub = card.querySelector(".sub");
    return function (frac, label) {
      fill.style.width = Math.round(frac * 100) + "%";
      sub.textContent = label;
    };
  }

  function showError(pnl, err, cfg) {
    var card = showStatus(pnl, errorMessage(err, cfg));
    var actions = el("div", "actions");
    actions.style.marginTop = "18px";
    var copy = el("button", "btn", "Copy error details");
    copy.onclick = function () {
      copyText(errorDetails(err, cfg)).then(function () { copy.textContent = "Copied"; });
    };
    actions.appendChild(copy);
    card.appendChild(actions);
  }

  function showDashboard(pnl, rows, cfg) {
    var solves = solvesFrom(rows);
    if (!solves.length) {
      showStatus(pnl, "No solved " + cfg.label + " puzzles found on this account.",
        "If you solve in the NYT Games app, make sure this tab is logged in to the same NYT account.");
      return;
    }
    var svg = dashboardSvg(solves, cfg);
    pnl.innerHTML = "";
    var actions = el("div", "actions");
    var png = el("button", "btn primary", "Save image");
    png.onclick = function () {
      savePng(svg, "nyt_" + cfg.key + "_stats.png", function () {
        png.textContent = "Couldn't save. Take a screenshot instead";
      });
    };
    var csv = el("button", "btn", "Download CSV");
    csv.onclick = function () {
      download(new Blob([toCsv(rows)], { type: "text/csv" }), "nyt_" + cfg.key + "_stats.csv");
    };
    actions.appendChild(png);
    actions.appendChild(csv);
    var chart = el("div", "chart");
    chart.innerHTML = svg;
    pnl.appendChild(actions);
    pnl.appendChild(chart);
  }

  if (location.hostname !== "www.nytimes.com" && !window.XW_STATS_TEST) {
    root.querySelector(".brand").textContent = "Crossword stats";
    var only = el("div", "panel");
    panelsEl.appendChild(only);
    var card = showStatus(only, "Open the NYT crossword page, log in, then click the bookmark again.",
      "This bookmark only works on www.nytimes.com.");
    var go = el("a", "btn primary", "Go to nytimes.com/crosswords");
    go.href = "https://www.nytimes.com/crosswords";
    go.style.marginTop = "18px";
    card.appendChild(go);
    return;
  }

  var order = [TYPES.mini, TYPES.daily];
  var panels = order.map(function (cfg, i) {
    var pnl = makeTab(cfg, i === 0);
    showStatus(pnl, "Waiting for the " + order[0].label + " to finish…");
    return pnl;
  });

  // Mini first, then Daily; a failure in one tab leaves the other untouched.
  order.reduce(function (chain, cfg, i) {
    return chain.then(function () {
      if (controller.signal.aborted) { return; }
      var progress = showProgress(panels[i], cfg);
      return fetchType(cfg, controller.signal, progress).then(function (rows) {
        try { showDashboard(panels[i], rows, cfg); } catch (e) { showError(panels[i], e, cfg); }
      }, function (e) {
        if (e && e.name === "AbortError") { return; }
        showError(panels[i], e, cfg);
      });
    });
  }, Promise.resolve());
})();
