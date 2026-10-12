// The dashboard as one SVG, laid out like mini_stats_summary.py's PNG.
// A box is { x, y, w, h } in SVG pixels.

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

function rect(x, y, w, h, color, radius) {
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' +
    (radius ? ' rx="' + radius + '"' : "") + ' fill="' + color + '"/>';
}

function strokePath(d, color) {
  return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>';
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

// Title, optional legend, and the inner plot box for one chart.
function chartFrame(box, title, legend) {
  var plot = { x: box.x + 52, y: box.y + 40, w: box.w - 62, h: box.h - 84 };
  var svg = text(box.x, box.y + 14, title, { size: 16, weight: "bold", fill: TEXT });
  if (legend) {
    var lx = box.x + box.w;
    SERIES.slice().reverse().forEach(function (s) {
      lx -= s.label.length * 6.6 + 30;
      svg += rect(lx, box.y + 5, 12, 12, s.color, 2) + text(lx + 18, box.y + 15, s.label, { size: 12 });
    });
  }
  return { plot: plot, svg: svg };
}

function yAxis(plot, max, base, fmt) {
  var step = niceStep(max || 1, base);
  var top = Math.max(step, Math.ceil(max / step) * step);
  var svg = "";
  for (var v = 0; v <= top + 1e-9; v += step) {
    var yy = plot.y + plot.h - v / top * plot.h;
    svg += line(plot.x, yy, plot.x + plot.w, yy, GRID, v === 0 ? 1.2 : 0.8);
    svg += text(plot.x - 8, yy + 4, fmt(v), { size: 11, anchor: "end" });
  }
  return { svg: svg, y: function (val) { return plot.y + plot.h - val / top * plot.h; } };
}

function plotTrend(box, solves, cfg) {
  var frame = chartFrame(box, "Monthly median solve time");
  var plot = frame.plot;
  var series = SERIES.map(function (s) {
    return { color: s.color, label: s.label, points: monthlyMedians(solves, s.hints) };
  }).filter(function (s) { return s.points.length; });
  var all = [].concat.apply([], series.map(function (s) { return s.points; }));
  var lo = Math.min.apply(null, all.map(function (pt) { return pt[0]; }));
  var hi = Math.max.apply(null, all.map(function (pt) { return pt[0]; }));
  var maxY = Math.max.apply(null, all.map(function (pt) { return isFinite(pt[1]) ? pt[1] : 0; }));
  var axis = yAxis(plot, maxY, cfg.tick_seconds, fmtTime);
  // Leave room on the right for the end-of-line labels.
  var plotW = plot.w - 78;
  function px(m) { return plot.x + (hi === lo ? plotW / 2 : (m - lo) / (hi - lo) * plotW); }
  var svg = frame.svg + axis.svg;
  var firstYear = Math.ceil(lo / 12);
  var lastYear = Math.floor(hi / 12);
  var yearStep = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 7));
  for (var yr = firstYear; yr <= lastYear; yr += yearStep) {
    svg += text(px(yr * 12), plot.y + plot.h + 18, String(yr), { size: 11, anchor: "middle" });
  }
  var ends = [];
  series.forEach(function (s) {
    var d = "";
    var penDown = false;
    s.points.forEach(function (pt) {
      if (!isFinite(pt[1])) { penDown = false; return; }
      d += (penDown ? "L" : "M") + px(pt[0]).toFixed(1) + "," + axis.y(pt[1]).toFixed(1);
      penDown = true;
    });
    svg += strokePath(d, s.color);
    var lastPt = s.points.filter(function (pt) { return isFinite(pt[1]); }).pop();
    if (lastPt) { ends.push({ x: px(lastPt[0]) + 6, y: axis.y(lastPt[1]) + 4, label: s.label }); }
  });
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
    var mid = (ends[0].y + ends[1].y) / 2;
    var up = ends[0].y <= ends[1].y ? 0 : 1;
    ends[up].y = mid - 7;
    ends[1 - up].y = mid + 7;
  }
  ends.forEach(function (e) { svg += text(e.x, e.y, e.label, { size: 12 }); });
  return svg;
}

function plotWeekday(box, solves, cfg) {
  var frame = chartFrame(box, "Median by day of week", true);
  var plot = frame.plot;
  var meds = SERIES.map(function (s) { return weekdayMedians(solves, s.hints); });
  var maxY = Math.max.apply(null, meds[0].concat(meds[1]).filter(isFinite).concat([0]));
  var axis = yAxis(plot, maxY, cfg.tick_seconds, fmtTime);
  var svg = frame.svg + axis.svg;
  var slot = plot.w / 7;
  var barW = slot * 0.36;
  DAYS.forEach(function (day, d) {
    var cx = plot.x + slot * (d + 0.5);
    SERIES.forEach(function (s, i) {
      var v = meds[i][d];
      if (!isFinite(v)) { return; }
      var bx = cx + (i === 0 ? -barW - 1 : 1);
      svg += bar(bx, axis.y(v), barW, plot.y + plot.h - axis.y(v), s.color);
    });
    svg += text(cx, plot.y + plot.h + 18, day.slice(0, 3), { size: 11, anchor: "middle" });
  });
  return svg;
}

function plotDistribution(box, solves, cfg) {
  var frame = chartFrame(box, "How long solves take", true);
  var plot = { x: frame.plot.x, y: frame.plot.y, w: frame.plot.w, h: frame.plot.h - 14 };
  var cap = cfg.hist_cap_seconds;
  var counts = SERIES.map(function (s) { return histogramCounts(solves, s.hints, cfg); });
  var maxY = Math.max.apply(null, counts[0].concat(counts[1]));
  var axis = yAxis(plot, maxY, 1, fmtInt);
  var svg = frame.svg + axis.svg;
  function px(sec) { return plot.x + sec / cap * plot.w; }
  SERIES.forEach(function (s, i) {
    var d = "M" + px(0) + "," + axis.y(0);
    counts[i].forEach(function (c, b) {
      d += "V" + axis.y(c).toFixed(1) + "H" + px((b + 1) * cfg.hist_bin_seconds).toFixed(1);
    });
    svg += strokePath(d + "V" + axis.y(0), s.color);
  });
  for (var sec = 0; sec <= cap; sec += cfg.tick_seconds) {
    svg += text(px(sec), plot.y + plot.h + 18, sec === cap ? fmtTime(sec) + "+" : fmtTime(sec), { size: 11, anchor: "middle" });
  }
  svg += text(plot.x + plot.w / 2, plot.y + plot.h + 38, "Solve time", { size: 12, anchor: "middle" });
  svg += text(0, 0, "Puzzles", { size: 12, anchor: "middle", transform: "translate(" + (box.x + 10) + "," + (plot.y + plot.h / 2) + ") rotate(-90)" });
  return svg;
}

function plotYears(box, solves) {
  var frame = chartFrame(box, "Solves per year", true);
  var plot = frame.plot;
  var counts = yearCounts(solves);
  var years = Object.keys(counts).sort();
  var maxY = Math.max.apply(null, years.map(function (yr) { return counts[yr][0] + counts[yr][1]; }).concat([0]));
  var axis = yAxis(plot, maxY * 1.08, 1, fmtInt);
  var svg = frame.svg + axis.svg;
  var slot = plot.w / Math.max(1, years.length);
  var barW = slot * 0.8;
  var showPct = slot >= 26;
  var labelStep = Math.max(1, Math.ceil(years.length / 12));
  years.forEach(function (yr, i) {
    var c = counts[yr];
    var bx = plot.x + slot * i + (slot - barW) / 2;
    var base = plot.y + plot.h;
    var noHintTop = axis.y(c[0]);
    var totalTop = axis.y(c[0] + c[1]);
    if (c[1]) {
      svg += bar(bx, totalTop, barW, noHintTop - totalTop - (c[0] ? 1 : 0), HINT);
      if (c[0]) { svg += rect(bx, noHintTop, barW, base - noHintTop, NO_HINT); }
    } else {
      svg += bar(bx, noHintTop, barW, base - noHintTop, NO_HINT);
    }
    if (showPct) { svg += text(bx + barW / 2, totalTop - 5, fmtPct(c[0] / (c[0] + c[1])), { size: 10, anchor: "middle" }); }
    if (i % labelStep === 0) { svg += text(bx + barW / 2, base + 18, yr, { size: 11, anchor: "middle" }); }
  });
  if (showPct) { svg += text(box.x + box.w, box.y + box.h - 4, "Label = share solved with no hints", { size: 11, anchor: "end" }); }
  return svg;
}

function summaryTable(x, y, w, rows, cfg) {
  var headers = ["", "Solves", "Share", "Median", "Average", "Best", "Under " + fmtTime(cfg.under_seconds)];
  var firstW = w * 0.22;
  var colW = (w - firstW) / (headers.length - 1);
  var headH = 34;
  var rowH = 44;
  var svg = "";
  function colX(c) { return c === 0 ? x : x + firstW + colW * (c - 1); }
  for (var r = 0; r <= rows.length + 1; r++) {
    var yy = r === 0 ? y : y + headH + rowH * (r - 1);
    svg += line(x, yy, x + w, yy, GRID);
  }
  headers.forEach(function (hd, c) {
    svg += text(colX(c) + colW / 2, y + 22, hd, { size: 13, anchor: "middle" });
  });
  // Row 0 is All solves, then one row per SERIES entry.
  rows.forEach(function (row, r) {
    var yy = y + headH + rowH * r + 28;
    row.forEach(function (v, c) {
      if (c === 0) {
        svg += text(x + 14, yy, v, { size: 17, weight: "bold", fill: r > 0 ? SERIES[r - 1].color : TEXT });
      } else {
        svg += text(colX(c) + colW / 2, yy, v, { size: 17, anchor: "middle", fill: TEXT });
      }
    });
  });
  return svg;
}

var SVG_W = 1200;
var SVG_H = 1260;

function dashboardSvg(solves, cfg) {
  var first = solves[0].date;
  var last = solves[solves.length - 1].date;
  function monthYear(d) { return MONTHS[+d.slice(5, 7) - 1] + " " + d.slice(0, 4); }
  var body = rect(0, 0, SVG_W, SVG_H, SURFACE) +
    text(84, 62, cfg.title, { size: 30, weight: "bold", fill: TEXT }) +
    text(84, 92, fmtInt(solves.length) + " puzzles solved · " + monthYear(first) + " – " + monthYear(last) +
      " · " + CONFIG.hint_note, { size: 15 }) +
    summaryTable(84, 122, 1032, summaryRows(solves, cfg), cfg) +
    plotTrend({ x: 84, y: 350, w: 490, h: 400 }, solves, cfg) +
    plotWeekday({ x: 642, y: 350, w: 474, h: 400 }, solves, cfg) +
    plotDistribution({ x: 84, y: 810, w: 490, h: 410 }, solves, cfg) +
    plotYears({ x: 642, y: 810, w: 474, h: 410 }, solves);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SVG_W + '" height="' + SVG_H + '" viewBox="0 0 ' +
    SVG_W + " " + SVG_H + '" font-family="' + FONT.replace(/"/g, "'") + '">' + body + "</svg>";
}
