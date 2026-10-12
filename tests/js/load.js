// Load the bookmarklet's non-UI sources the way build.py bundles them,
// minus ui.js, and return every top-level function and constant by name.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "bookmarklet", "src");

function loadBookmarklet() {
  const config = fs.readFileSync(path.join(ROOT, "stats_config.json"), "utf8");
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".js") && f !== "ui.js").sort();
  const code = files.map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
  const names = [...code.matchAll(/^(?:function|var) ([A-Za-z_]\w*)/gm)].map((m) => m[1]);
  const body = '"use strict";\nvar CONFIG = ' + config + ";\n" + code + "\nreturn {CONFIG," + names.join(",") + "};";
  return new Function(body)();
}

module.exports = { loadBookmarklet, ROOT };
