"""Generate the browser mirror of the KCE knowledge base.

The canonical source of truth is ``knowledge/kce-knowledge.json``. This script
writes ``knowledge/kce-knowledge.js`` so the static site can load the same data
without a network request (works from ``file://`` too).

Run from the project root:

    python knowledge/sync_knowledge.py
"""

from __future__ import annotations

import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SOURCE = BASE_DIR / "kce-knowledge.json"
TARGET = BASE_DIR / "kce-knowledge.js"


def main() -> None:
    entries = json.loads(SOURCE.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise SystemExit("kce-knowledge.json must contain a JSON array")

    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    banner = (
        "/* AUTO-GENERATED from kce-knowledge.json — do not edit by hand.\n"
        "   Regenerate with: python knowledge/sync_knowledge.py */\n"
    )
    TARGET.write_text(
        f"{banner}window.KCE_KNOWLEDGE_BASE = {payload};\n",
        encoding="utf-8",
    )
    print(f"Wrote {TARGET.relative_to(BASE_DIR.parent)} with {len(entries)} entries")


if __name__ == "__main__":
    main()
