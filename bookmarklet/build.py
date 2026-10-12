"""Pack xw_stats.js into the draggable button on the install page.

    python bookmarklet/build.py

Reads bookmarklet/xw_stats.js and bookmarklet/install_template.html and writes
docs/index.html, which GitHub Pages serves. Rerun after editing either file.
"""

import re
import sys
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "xw_stats.js"
TEMPLATE = HERE / "install_template.html"
OUTPUT = HERE.parent / "docs" / "index.html"

# Characters left unescaped are harmless inside a double-quoted href.
URL_SAFE = "!'()*+,;=:@/?$[]{}|^`~"


def pack(js):
    lines = []
    for number, raw in enumerate(js.splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("//"):
            continue
        # A trailing comment would swallow the rest of the packed line.
        if re.search(r"(?<!:)//", stripped):
            sys.exit(f"{SOURCE.name}:{number}: move the trailing // comment onto its own line")
        lines.append(stripped)
    return "javascript:" + quote("\n".join(lines), safe=URL_SAFE)


def main():
    href = pack(SOURCE.read_text(encoding="utf-8"))
    page = TEMPLATE.read_text(encoding="utf-8").replace("{{BOOKMARKLET_HREF}}", href)
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(page, encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(HERE.parent)} (bookmark is {len(href):,} characters)")


if __name__ == "__main__":
    main()
