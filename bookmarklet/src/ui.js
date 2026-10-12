// The overlay: one tab per puzzle type, each loading in turn. Runs last.

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
  ".pane{max-width:1200px;margin:24px auto;padding:0 16px}" +
  ".pane[hidden]{display:none}" +
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
  '<button class="close" aria-label="Close" title="Close">×</button></div><div class="panes"></div></div>';

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
var panesEl = root.querySelector(".panes");

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
  var pane = el("div", "pane");
  pane.hidden = !selected;
  tab.onclick = function () {
    Array.prototype.forEach.call(tabsEl.children, function (t) { t.setAttribute("aria-selected", "false"); });
    Array.prototype.forEach.call(panesEl.children, function (p) { p.hidden = true; });
    tab.setAttribute("aria-selected", "true");
    pane.hidden = false;
  };
  tabsEl.appendChild(tab);
  panesEl.appendChild(pane);
  return pane;
}

function showStatus(pane, msg, sub) {
  pane.innerHTML = "";
  var card = el("div", "card");
  card.appendChild(el("div", "msg", msg));
  if (sub) { card.appendChild(el("div", "sub", sub)); }
  pane.appendChild(card);
  return card;
}

function showProgress(pane, cfg) {
  var card = showStatus(pane, "Loading your " + cfg.label + " stats…", "Starting");
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

function showError(pane, err, cfg) {
  var card = showStatus(pane, errorMessage(err, cfg));
  var actions = el("div", "actions");
  actions.style.marginTop = "18px";
  var copy = el("button", "btn", "Copy error details");
  copy.onclick = function () {
    copyText(errorDetails(err, cfg)).then(function () { copy.textContent = "Copied"; });
  };
  actions.appendChild(copy);
  card.appendChild(actions);
}

function showDashboard(pane, rows, cfg) {
  var solves = solvesFrom(rows);
  if (!solves.length) {
    showStatus(pane, "No solved " + cfg.label + " puzzles found on this account.",
      "If you solve in the NYT Games app, make sure this tab is logged in to the same NYT account.");
    return;
  }
  var svg = dashboardSvg(solves, cfg);
  pane.innerHTML = "";
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
  pane.appendChild(actions);
  pane.appendChild(chart);
}

if (location.hostname !== "www.nytimes.com") {
  root.querySelector(".brand").textContent = "Crossword stats";
  var only = el("div", "pane");
  panesEl.appendChild(only);
  var card = showStatus(only, "Open the NYT crossword page, log in, then click the bookmark again.",
    "This bookmark only works on www.nytimes.com.");
  var go = el("a", "btn primary", "Go to nytimes.com/crosswords");
  go.href = "https://www.nytimes.com/crosswords";
  go.style.marginTop = "18px";
  card.appendChild(go);
  return;
}

var tabTypes = [TYPES.mini, TYPES.daily];
var panes = tabTypes.map(function (cfg, i) {
  var pane = makeTab(cfg, i === 0);
  showStatus(pane, "Waiting for the " + tabTypes[0].label + " to finish…");
  return pane;
});

// Mini first, then Daily; a failure in one tab leaves the other untouched.
tabTypes.reduce(function (chain, cfg, i) {
  return chain.then(function () {
    if (controller.signal.aborted) { return; }
    var progress = showProgress(panes[i], cfg);
    return fetchType(cfg, controller.signal, progress).then(function (rows) {
      try { showDashboard(panes[i], rows, cfg); } catch (e) { showError(panes[i], e, cfg); }
    }, function (e) {
      if (e && e.name === "AbortError") { return; }
      showError(panes[i], e, cfg);
    });
  });
}, Promise.resolve());
