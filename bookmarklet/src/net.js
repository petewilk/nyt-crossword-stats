// Fetching from the two NYT endpoints, with retries and a small worker pool.

function XwError(kind, step, url, status, detail) {
  this.kind = kind;
  this.step = step;
  this.path = url ? url.split("?")[0].replace("https://www.nytimes.com", "") : "";
  this.status = status || 0;
  this.detail = detail || "";
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Retry 429s and 5xx twice, with a growing pause.
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

// The same two passes as fetch_stats(): puzzle list by date, then solve states.
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
    var puzzleIds = [];
    lists.forEach(function (list) {
      list.forEach(function (p) {
        var id = String(p.puzzle_id);
        if (!(id in byId)) { puzzleIds.push(id); }
        byId[id] = shapeOverview(p);
      });
    });
    var chunks = [];
    for (var i = 0; i < puzzleIds.length; i += STATE_CHUNK) { chunks.push(puzzleIds.slice(i, i + STATE_CHUNK)); }
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
        "Reading solves (" + fmtInt(Math.min(got * STATE_CHUNK, puzzleIds.length)) + " of " + fmtInt(puzzleIds.length) + " puzzles)");
    }).then(function () {
      return puzzleIds.map(function (id) { return byId[id]; });
    });
  });
}
