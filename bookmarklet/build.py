"""Bundle the bookmarklet sources into the draggable button on the install page.

    python bookmarklet/build.py

Wraps stats_config.json and bookmarklet/src/*.js in one function, packs it into
a javascript: link, and fills it and the palette into install_template.html to
write docs/index.html, which GitHub Pages serves. Rerun after editing any of
them; tests/test_bookmarklet.py fails while docs/index.html is out of date.
"""

import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
CONFIG = REPO_ROOT / "stats_config.json"
SOURCES = HERE / "src"
# ui.js runs the overlay as soon as it loads, so it must come last
UI_SOURCE = SOURCES / "ui.js"
TEMPLATE = HERE / "install_template.html"
OUTPUT = REPO_ROOT / "docs" / "index.html"

# Characters left unescaped are harmless inside a double-quoted href.
URL_SAFE = "!'()*+,;=:@/?$[]{}|^`~"


def library_sources():
    """The sources that only define things, in a stable order"""
    return sorted(p for p in SOURCES.glob("*.js") if p != UI_SOURCE)


def config_js():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    return f"var CONFIG = {json.dumps(config, ensure_ascii=False)};"


def bundle():
    parts = [config_js()] + [p.read_text(encoding="utf-8") for p in library_sources() + [UI_SOURCE]]
    return '(function () {\n"use strict";\n' + "\n".join(parts) + "\n})();\n"


def pack(js):
    lines = []
    for number, raw in enumerate(js.splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("//"):
            continue
        # A trailing comment would swallow the rest of the packed line.
        if re.search(r"(?<!:)//", stripped):
            sys.exit(f"bundle line {number}: move the trailing // comment onto its own line: {stripped}")
        lines.append(stripped)
    return "javascript:" + quote("\n".join(lines), safe=URL_SAFE)


def render_page():
    palette = json.loads(CONFIG.read_text(encoding="utf-8"))["palette"]
    page = TEMPLATE.read_text(encoding="utf-8").replace("{{BOOKMARKLET_HREF}}", pack(bundle()))
    for name, color in palette.items():
        page = page.replace("{{" + name + "}}", color)
    if "{{" in page:
        sys.exit(f"{TEMPLATE.name} has an unfilled placeholder near: {page[page.index('{{'):][:40]}")
    return page


def main():
    page = render_page()
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(page, encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)} ({len(page):,} characters)")


if __name__ == "__main__":
    main()
