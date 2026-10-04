"""Draws one influence map from JSON on stdin with the shared map renderer: boxes, and one arrow
per pair whose tail shows nothing, a dot (an activation returning its outcome) or a second head
(influence both ways). Writes the SVG to stdout. Input:
{"title", "subtitle", "nodes": [{"id", "label", "note", "kind"}], "edges": [{"from", "to", "label", "ends"}]}
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from leveled import Page  # noqa: E402

spec = json.load(sys.stdin.buffer)
page = Page("influence", spec["title"], spec.get("subtitle", ""))
page.key_line = "→ influence   ·   •→ activation returning its outcome   ·   ↔ influence both ways"
for n in spec["nodes"]:
    page.n(n["id"], n["label"], kind=n.get("kind", "stage"), note=n.get("note"))
for e in spec["edges"]:
    page.e(e["from"], e["to"], e.get("label", ""), "data", ends=e.get("ends", "one"))
page.layout()
sys.stdout.reconfigure(encoding="utf-8")
# Standalone, so it carries its encoding and shows the near-reading labels the viewer would.
svg = page.render().replace("<defs>", "<style>.fm-far{display:none}</style><defs>", 1)
sys.stdout.write('<?xml version="1.0" encoding="UTF-8"?>\n' + svg)
