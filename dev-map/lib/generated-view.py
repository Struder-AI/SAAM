"""The whole stored map, drawn for the owner: one leveled page per stored page, the navigation
between them, and the source every box is. Layout and box styles are the shared leveled ones;
this module adds the page kinds the store holds, the lists a page owes in data, the stale mark,
and a viewer that loads one page's drawing at a time. Nothing here is authored except the
legend, which is stated once and reachable from every page."""
from __future__ import annotations

import json
import math
import pathlib
import re
import sys
import textwrap
from xml.sax.saxutils import escape

from leveled import (Page, STYLE, EDGE, ASPECT, MARGIN_L, FS_FOOT, FS_NOTE, LH_NOTE,
                     LH_TITLE, PADX, PADY, box_rx, direct_routes)
from svg import tw
from flow import MARKERS, kind_of      # importing flow registers its box and wire styles
from viewer import CSS as BASE_CSS

# The box a page IS, drawn when the body calls nothing; and code in a file that no entry
# point of that file reaches.
STYLE["subject"] = dict(fill="#f8fafc", stroke="#0f172a", sw=2.6, rx=7, tc="#0f172a")
STYLE["choice"] = dict(fill="#faf5ff", stroke="#7e22ce", sw=1.8, rx=12, tc="#581c87")
STYLE["code"] = dict(fill="#fff7ed", stroke="#c2410c", sw=1.8, rx=7, tc="#7c2d12")
STYLE["assertion"] = dict(fill="#faf5ff", stroke="#7e22ce", sw=1.8, rx=15, tc="#581c87")
STYLE["assertion-code"] = dict(fill="#fff7ed", stroke="#c2410c", sw=1.8, rx=15, tc="#7c2d12")
STYLE["caller"] = dict(fill="#fff1f2", stroke="#dc2626", sw=1.4, rx=13, tc="#991b1b")
STYLE["invocation"] = dict(fill="#eef2ff", stroke="#4f46e5", sw=1.8, rx=7, tc="#312e81")
STYLE["outside"] = dict(fill="#ecfdf5", stroke="#059669", sw=1.8, rx=7, tc="#065f46")
STYLE["emphasis"] = dict(fill="#e0f2fe", stroke="#0284c7", sw=2.5, rx=9, tc="#0c4a6e")
# An influence set's command leaf (it changes state; a query only answers), and the marker boxes
# that stand for a list the drawing cannot show, one colour per list.
STYLE["command"] = dict(fill="#eef2ff", stroke="#4f46e5", sw=1.8, rx=7, tc="#312e81")
TONE = {"link": "#ea580c", "unowned": "#7c3aed", "missing": "#dc2626"}
for _tone, _colour in TONE.items():
    STYLE["mark-" + _tone] = dict(fill="#ffffff", stroke=_colour, sw=2.2, rx=12, tc=_colour, dash="6 3")
EDGE["caller"] = dict(stroke="#dc2626", sw=1.5, head="l-co", dash="2 3")
EDGE["capture"] = dict(stroke="#0369a1", sw=1.5, head="l-data", dash="3 3")
ROW = 14.0
# The ledger under a drawing runs no taller than the map above it and no wider than this many
# columns; below a screenful of rows it stays in one column, where it reads as a list.
LIST_ROWS, LIST_COLS_MAX, LIST_GAP = 44, 8, 34
QUOTE = {chr(34): "&quot;"}
REGENERATE = "node scripts/agent-toolkit.mjs regenerate"
WIRE = {"state": "state", "return": "io", "gate": "gate", "capture": "capture"}


def at(index):
    return tuple(int(part) for part in index.split("."))


def clip(text, n=150):
    return text if len(text) <= n else text[:n - 1] + "…"


class MapPage(Page):
    """A leveled page with the stored page's own lists under it, a stale mark when the source
    has moved, and a hit box over every box's foot so the foot opens that box's source."""

    def __init__(self, stale, **kw):
        super().__init__(**kw)
        self.stale = stale
        self.lists = []                 # (style, text, index-to-open, presented-item marker)
        self.list_cols, self.list_x = [], []
        self.caller_refs = []

    def row(self, style, text, go="", mark=""):
        """One ledger row. `mark` names the presented item this row is drawn for, so a check
        can ask the drawing which of them it carried instead of matching its prose."""
        self.lists.append((style, clip(text), go, mark))

    def layout(self):
        super().layout()
        if getattr(self, "authored", None):
            if self.authored.get("overlay"):
                self.position_overlay()
            else:
                self.position_authored()
        # The expanded owner is the page frame. Its references leave that boundary;
        # diagnostic lists stay outside it rather than masquerading as function contents.
        self.frame_w = max(self.W, 2 * MARGIN_L + max(tw(self.title, 21), tw(self.subtitle, 12),
                                                     tw(self.key_line, 10)))
        self.caller_y = self.H
        if self.caller_refs:
            self.H += 40 + 13 * ((len(self.caller_refs) + 2) // 3)
            rows = [" · ".join(label for label, _target in self.caller_refs[i:i + 3])
                    for i in range(0, len(self.caller_refs), 3)]
            self.W = max(self.W, 2 * MARGIN_L + 30 + max(tw(row, FS_NOTE) for row in rows))
        self.list_y = self.H
        self.list_cols = []
        if self.lists:
            # The ledger under the drawing, set in columns rather than one long strip. A
            # thousand rows in one strip is fifteen thousand pixels of page that the drawing
            # is then fitted alongside, so the map above it shrinks to nothing; in columns
            # the block is about as wide as the map and about as tall.
            rows = len(self.lists)
            mean = sum(tw(t, FS_NOTE) for _s, t, _g, _m in self.lists) / rows + LIST_GAP
            # However many columns leave the whole page -- map and ledger together -- closest
            # to the shape a map is read in. One column while the ledger is short, because a
            # short list reads as a list; more as it grows past the drawing it belongs to.
            def shape(c):
                page = self.list_y + 24 + ROW * -(-rows // c)
                return abs(math.log(max(self.W, c * mean) / page) - math.log(ASPECT))
            columns = min(range(1, min(LIST_COLS_MAX, -(-rows // LIST_ROWS)) + 1), key=shape)
            want = -(-rows // max(1, columns))
            # A section is never cut, so the cut can land a column over; widening the column
            # until it does not is what keeps the block inside the width it was given.
            self.list_cols = self._list_columns(want)
            while len(self.list_cols) > columns and want < rows:
                want += max(4, want // 4)
                self.list_cols = self._list_columns(want)
            self.H += 24 + ROW * max(len(c) for c in self.list_cols)
            x = MARGIN_L
            for col in self.list_cols:
                self.list_x.append(x)
                x += max(tw(t, FS_NOTE) for _s, t, _g, _m in col) + LIST_GAP
            self.W = max(self.W, x + MARGIN_L)
        if self.stale:
            self.W = max(self.W, 2 * MARGIN_L + tw(self.stale_text(), 11.5))
        # A page with one small box is narrower than its own heading; the heading is the page's
        # index and declaration path, so it is the thing that must not be cut off.
        self.W = max(self.W, 2 * MARGIN_L + max(tw(self.title, 21), tw(self.subtitle, 12),
                                                tw(self.key_line, 10)))
        return self

    def position_authored(self):
        positions = self.authored.get("positions") or {}
        if not positions:
            return
        for nid, point in positions.items():
            node = self.index[nid]
            node.x, node.y = point["x"], point["y"]
            if point.get("emphasis"):
                node.kind = "emphasis"
        # Unpositioned dependencies stay on this same page, below the authored area.
        main = [self.index[nid] for nid in positions]
        right = max(n.x + n.w for n in main) + 50
        bottom = max(n.y + n.h for n in main) + 70
        self.focus = self.authored.get("viewport", [0, 0, right, bottom])
        outside = [n for n in self.nodes if n.id not in positions]
        cell = max([n.w for n in outside] + [210]) + 70
        y = bottom + 170
        for i in range(0, len(outside), 5):
            row = outside[i:i + 5]
            for j, node in enumerate(row):
                node.x, node.y = MARGIN_L + j * cell, y
            y += max(n.h for n in row) + 85
        # A page whose unplaced boxes are part of what it says is fitted to all of them.
        if self.authored.get("frame") == "all":
            self.focus = [0, 0, max(n.x + n.w for n in self.nodes) + 50, max(n.y + n.h for n in self.nodes) + 70]
        for node in self.nodes:
            node.column = 0
        self.row_of, self.slot, self.gutter_lane, self.wrapped = {0: 0}, {}, {}, set()
        self.right_edge = max(n.x + n.w for n in self.nodes) + 24
        # Authored overviews show actual connected boundaries, never detached end stubs.
        self.long = set()
        self.fan = {}
        for i in self.long:
            for end in (self.edges[i]["src"], self.edges[i]["dst"]):
                self.fan[end] = self.fan.get(end, 0) + 1
        direct = (self.direct_routes(range(len(self.edges)))
                  if getattr(self, "design", False) or self.authored.get("route") == "direct" else {})

        def route(k, edge):
            a, b = self.index[edge["src"]], self.index[edge["dst"]]
            if k in direct:
                return direct[k]
            if (a.id.startswith("external:") or b.id.startswith("external:")) and abs(b.cy - a.cy) > 100:
                down = b.cy > a.cy
                sx, sy = a.cx, a.y + a.h if down else a.y
                dx, dy = b.cx, b.y if down else b.y + b.h
                bend = (dy - sy) * .45
                return ([(sx, sy), (sx, sy + bend), (dx, dy - bend), (dx, dy)],
                        ((sx + dx) / 2, (sy + dy) / 2))
            return self._route(edge, set())
        self.routes = [route(k, e) for k, e in enumerate(self.edges)]
        self.W, self.H = self.right_edge + 30, max(n.y + n.h for n in self.nodes) + 100
        self.zone_rects = []

    def direct_routes(self, ks):
        """{edge index: (points, label point)} for wires `ks` drawn straight from one box to the
        other: every wire of an authored page, and every wire touching a box the owner placed.
        Each end meets its box where it faces the other end, spread along the side from the
        page's other direct wires there (leveled.direct_routes). The viewer's live drag
        (AUTHOR_JS directRoutes) draws the same curves, so a move looks the same before and
        after it is redrawn."""
        ks = sorted(ks)
        self.direct = set(ks)
        pairs = {(self.edges[k]["src"], self.edges[k]["dst"]) for k in ks}
        boxes = {n.id: dict(x=n.x, y=n.y, w=n.w, h=n.box_h, rx=box_rx(n)) for n in self.nodes}
        wires = [(self.edges[k]["src"], self.edges[k]["dst"],
                  (self.edges[k]["dst"], self.edges[k]["src"]) in pairs) for k in ks]
        return dict(zip(ks, direct_routes(boxes, wires)))

    def position_overlay(self):
        """Authored positions over the solved layout (plans/dev-maps.md milestone 5): each
        placed box stands where the owner put it, every other box where the solver did, and
        only the wires touching a placed box are re-routed, drawn whole and direct."""
        moved = set()
        for nid, point in (self.authored.get("positions") or {}).items():
            node = self.index.get(nid)
            if node is None:
                continue
            node.x, node.y = float(point["x"]), float(point["y"])
            moved.add(nid)
        if not moved:
            return
        touched = [k for k, e in enumerate(self.edges) if e["src"] in moved or e["dst"] in moved]
        for k, r in self.direct_routes(touched).items():
            self.routes[k] = r
            self.long.discard(k)
            self.wrapped.discard(k)
        self.fan = {}
        for k in self.long:
            for end in (self.edges[k]["src"], self.edges[k]["dst"]):
                self.fan[end] = self.fan.get(end, 0) + 1
        self.right_edge = max(self.right_edge, max(n.x + n.w for n in self.nodes) + 24)
        self.W = max(self.W, max(n.x + n.w for n in self.nodes) + 40)
        self.H = max(self.H, max(n.y + n.h for n in self.nodes) + 34)
        for e, (_pts, lab) in zip(self.edges, self.routes):
            if lab:
                self.H = max(self.H, lab[1] + 20 + 12 * e["label"].count(chr(10)))

    def _list_columns(self, want):
        """The ledger split into columns of about `want` rows, cut only between sections — a
        heading and the rows it names stay together, because a row's section is what says
        which node the finding is about."""
        sections, section = [], []
        for row in self.lists:
            if row[0] == "head" and section:
                sections.append(section)
                section = []
            section.append(row)
        if section:
            sections.append(section)
        # A section longer than a column carries its heading onto the next one, so a row is
        # never read without the node it is about.
        pieces = []
        for section in sections:
            if len(section) <= want:
                pieces.append(section)
                continue
            head, rows, step = section[0], section[1:], max(1, want - 1)
            for k in range(0, len(rows), step):
                pieces.append([(head[0], head[1] + (" (cont.)" if k else ""), head[2], head[3])]
                              + rows[k:k + step])
        cols, col = [], []
        for section in pieces:
            if col and len(col) + len(section) > want:
                cols.append(col)
                col = []
            col.extend(section)
        return cols + ([col] if col else [])

    def stale_text(self):
        return (f'STALE — generation inputs changed; matching snapshot remains readable. '
                f'Run: {REGENERATE} {self.stale["regenerate"]}')

    def render(self):
        svg = super().render().replace("</defs>", MARKERS)
        return svg.replace("</svg>", self._extras() + "</svg>")

    def _extras(self):
        o, top = [], self.list_y + 22
        for caption in getattr(self, "authored", {}).get("captions", []):
            o.append(f'<text x="{caption["x"]}" y="{caption["y"]}" font-size="16" font-weight="700" fill="#64748b">{escape(caption["text"])}</text>')
        if self.list_cols:
            o.append(f'<path d="M{MARGIN_L},{top - 15:.1f} L{self.W - MARGIN_L:.1f},{top - 15:.1f}" '
                     f'stroke="#cbd5e1" stroke-width="1"/>')
        for left, col in zip(self.list_x, self.list_cols):
            y = top
            for style, text, go, mark in col:
                x = left + (0 if style == "head" else 14)
                carries = f' data-row="{escape(mark, QUOTE)}"' if mark else ""
                if go:
                    o.append(f'<g class="fm-go" data-go="{escape(go, QUOTE)}"{carries}>'
                             f'<rect x="{x - 4:.1f}" y="{y - 10:.1f}" width="{tw(text, FS_NOTE) + 9:.1f}" '
                             f'height="{ROW:.1f}" rx="3" fill="#0ea5e9" fill-opacity="0.004"/>'
                             f'<text x="{x:.1f}" y="{y:.1f}" font-size="{FS_NOTE}" fill="#0369a1">'
                             f'{escape(text)}</text></g>')
                else:
                    fill = {"head": "#0f172a", "note": NOTE_FILL, **{k: v[0] for k, v in MISSING.items()}}.get(style, "#475569")
                    weight = ' font-weight="700"' if style == "head" else ""
                    o.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{FS_NOTE}" fill="{fill}"'
                             f'{weight}{carries}>{escape(text)}</text>')
                y += ROW
        if self.caller_refs:
            x, y = MARGIN_L + 5, self.caller_y
            o.append(f'<rect class="fm-owner-frame" data-owner="{escape(self.key, QUOTE)}" x="20" y="28" '
                     f'width="{self.frame_w - 40:.1f}" height="{y - 28:.1f}" rx="8" '
                     f'fill="none" stroke="#94a3b8" stroke-width="1.2"/>')
            o.append(f'<text class="fm-owner-callers" x="{x + 13}" y="{y + 8}" '
                     f'font-size="{FS_NOTE}" fill="#475569">called from</text>')
            for i in range(0, len(self.caller_refs), 3):
                tx, ty = x + 13, y + 24 + (i // 3) * 13
                for j, (label, target) in enumerate(self.caller_refs[i:i + 3]):
                    if j:
                        tx += tw(" · ", FS_NOTE)
                    if target:
                        o.append(f'<g class="fm-go fm-caller-reference" data-go="{escape(target, QUOTE)}"><rect x="{tx - 2}" y="{ty - 10}" width="{tw(label, FS_NOTE) + 4}" height="13" fill="#0369a1" fill-opacity="0.004"/>')
                    o.append(f'<text x="{tx}" y="{ty}" font-size="{FS_NOTE}" fill="#0369a1" '
                             f'data-row="callerReferences#{escape(label, QUOTE)}">{escape(label)}</text>')
                    if target:
                        o.append('</g>')
                    tx += tw(label, FS_NOTE)
        # A count that opens a list: a whole marker box, or one badge row on a box.
        for n in self.nodes:
            if getattr(n, "list", ""):
                o.append(f'<rect class="fm-list" data-list="{escape(n.list, QUOTE)}" data-node="{escape(n.id, QUOTE)}" x="{n.x:.1f}" y="{n.y:.1f}" '
                         f'width="{n.w:.1f}" height="{n.box_h:.1f}" rx="12" fill="#0ea5e9" fill-opacity="0.004"/>')
            for row, name in getattr(n, "list_rows", {}).items():
                row_y = n.y + PADY + LH_TITLE * .75 + LH_TITLE * len(n.lines) + row * LH_NOTE
                o.append(f'<rect class="fm-list" data-list="{escape(name, QUOTE)}" data-node="{escape(n.id, QUOTE)}" x="{n.x + PADX - 3:.1f}" '
                         f'y="{row_y - FS_NOTE:.1f}" width="{tw(n.note_lines[row], FS_NOTE) + 6:.1f}" '
                         f'height="{LH_NOTE:.1f}" fill="#0ea5e9" fill-opacity="0.004"/>')
        # The foot of a box is where its source is. Drawn by the base; the hit box goes over it.
        for n in self.nodes:
            note_refs = dict(getattr(n, "note_refs", {}))
            if getattr(n, "gate_ref", None):
                note_refs[0] = n.gate_ref
            for row, gate_ref in note_refs.items():
                gate_y = n.y + PADY + LH_TITLE * .75 + LH_TITLE * len(n.lines) + row * LH_NOTE
                o.append(f'<rect class="fm-src fm-gate-source" data-ref="{escape(gate_ref, QUOTE)}" data-node="{escape(n.id, QUOTE)}" '
                         f'x="{n.x + PADX - 3:.1f}" y="{gate_y - FS_NOTE:.1f}" '
                         f'width="{tw(n.note_lines[row], FS_NOTE) + 6:.1f}" height="{LH_NOTE:.1f}" '
                         f'fill="#0ea5e9" fill-opacity="0.004"><title>Condition source</title></rect>')
            foot, _c = n.foot
            if not foot or not getattr(n, "anchor_ref", None):
                continue
            ty = (n.y + PADY + LH_TITLE * 0.75 + LH_TITLE * len(n.lines)
                  + LH_NOTE * (len(n.note_lines) + len(n.reference_rows)))
            o.append(f'<rect class="fm-src" data-ref="{escape(n.anchor_ref, QUOTE)}" data-key="{escape(n.id, QUOTE)}" data-node="{escape(n.id, QUOTE)}" '
                     f'x="{n.x + PADX - 4:.1f}" y="{ty - 1:.1f}" '
                     f'width="{tw(foot, FS_FOOT) + 9:.1f}" height="{FS_FOOT + 5:.1f}" rx="2" '
                     f'fill="#0ea5e9" fill-opacity="0.004"/>')
        if self.stale:
            o.append(f'<rect x="0" y="0" width="{self.W:.0f}" height="26" fill="#fecdd3"/>')
            o.append(f'<text x="{MARGIN_L}" y="17.5" font-size="11.5" font-weight="700" '
                     f'fill="#9f1239">{escape(self.stale_text())}</text>')
            o.append(f'<rect x="3" y="3" width="{self.W - 6:.0f}" height="{self.H - 6:.0f}" '
                     f'fill="none" stroke="#e11d48" stroke-width="6"/>')
        return "\n".join(o)


def aggregate(w):
    """One wire stands for every link between two boxes; its label is the kinds and counts."""
    if w.get("label"):
        return w["label"]
    return " ".join(f'{kind}×{n}' for kind, n in sorted(w["kinds"].items()))


def port_target(name, pages):
    """A port that names another page: a caller's own index."""
    return name if name in pages else ""


def wire(page, w, label, kind, drawn, dropped, ends="one"):
    if w["from"] not in drawn or w["to"] not in drawn:
        dropped.append((page.key, w["from"], w["to"]))
        return
    page.e(w["from"], w["to"], label, kind, ends=ends)


def one_per_pair(wires):
    """Each pair of boxes is drawn as one wire: a wire and its reverse become one wire with two
    heads, its label naming each direction. The stored wires stay directional."""
    by = {(w["from"], w["to"]): w for w in wires}
    done = set()
    for w in wires:
        key = (w["from"], w["to"])
        if key in done:
            continue
        back = by.get((w["to"], w["from"]))
        done.add(key)
        if back is not None and back is not w:
            done.add((w["to"], w["from"]))
        yield w, (back if back is not w else None)


def value_bundles(wires):
    """Draw compatible values together without changing the stored relationships.

    Direction, gates, operator ports, kind and other semantic attributes must match.
    Argument slots may share a line while retaining their individual value/slot pairs.
    Only the value label and its expression evidence otherwise differ. Calls and state/control
    relationships remain separate, even when their endpoints happen to match.
    """
    bundles, positions = [], {}
    for w in wires:
        if w.get("kind") not in ("data", "return"):
            bundles.append(dict(w))
            continue
        argument = bool(re.fullmatch(r'arg\d+', w.get("toPort", "")))
        ignored = {"label", "expression"} | ({"toPort", "positionUnknown", "spread"} if argument else set())
        signature = json.dumps({k: v for k, v in w.items() if k not in ignored}, sort_keys=True) + ("|arguments" if argument else "")
        value = {k: w[k] for k in ("label", "toPort", "positionUnknown", "spread") if k in w}
        if signature not in positions:
            positions[signature] = len(bundles)
            bundles.append(dict(w))
            if argument:
                bundles[-1]["argumentValues"] = [value]
        else:
            target = bundles[positions[signature]]
            if argument:
                if value not in target["argumentValues"]:
                    target["argumentValues"].append(value)
                continue
            labels = target.get("label", "").split("\n")
            if w.get("label") and w["label"] not in labels:
                target["label"] = "\n".join([label for label in labels if label] + [w["label"]])
    return bundles


def port_context(node, packet, pages):
    """The default presentation names the direct call boundary, with uncertainty explicit."""
    role = packet.get("role", "throw" if packet.get("kind") == "throw" else
                      "input" if str(packet["port"]).startswith("in") else "return")

    def link(text, index):
        return (text, index if index in pages else "")

    def location(record):
        label = record.get("index") or record.get("path") or record.get("file") or "unknown caller"
        if record.get("line") is not None:
            label += ":" + str(record["line"])
            if record.get("column") is not None:
                label += ":" + str(record["column"])
        return label

    for ref in packet.get("references", []):
        incoming = role == "input"
        row = [("from caller " if incoming else "to caller ", ""), link(location(ref), ref.get("index"))]
        sites = ref.get("sites", 1)
        if sites > 1:
            row.append((f' · {sites} sites', ""))
        flags = []
        for field, text in (("optional", "optional call"), ("positionUnknown", "position unknown"),
                 ("unknown", "origin unknown"), ("spread", "spread"),
                 ("executionUnknown", "execution unknown"), ("possibleTarget", "possible target"),
                 ("omitted", "omitted"), ("defaulted", "defaulted"), ("rest", "rest"),
                 ("usesUnknown", "uses untraced")):
            count = ref.get("flagCounts", {}).get(field, sites if ref.get(field) else 0)
            if count:
                flags.append(text + (f' {count}/{sites}' if sites > 1 else ""))
        if flags:
            row.append((" · " + ", ".join(flags), ""))
        node.reference_rows.append(row)


def build_page(packet, ctx):
    """One stored page as a leveled page. Every box carries the index of the page it opens."""
    pages, stale = ctx["pages"], ctx["stale"].get(packet["index"])
    meta = pages[packet["index"]]
    page = MapPage(stale, key=packet["index"], title=meta["t"], subtitle=meta["s"])
    page.context_pages = pages
    page.authored = packet.get("layout", {})
    page.design = packet.get("design", False)
    page.key_line = meta["k"] + ("  ·  " + meta["d"] if meta["d"] else "")
    if packet.get("stateful"):
        page.key_line += " · stateful boundary"
    kind, drawn, dropped = packet["kind"], set(), ctx["dropped"]
    # A call that leaves the mapped scope ends in the name of the scanned root it reaches, not in
    # a box: nothing on this page stands for outside code. The port and its wires come off the
    # drawing and become an arrow out of the calling box carrying that name and its count.
    headless, outward = {}, {}
    for p in list(packet.get("ports", [])) + list(packet.get("outputs", [])):
        if p.get("outside") and (p.get("direction") == "out" or p.get("role") == "outgoing-relation"):
            headless[p["port"]] = p.get("mechanism") or p.get("name") or p["port"]
    if headless:
        kept = []
        for w in packet["wires"]:
            name = headless.get(w.get("to"))
            if name is None:
                kept.append(w)
                continue
            count = w.get("count", 1)
            outward.setdefault(w["from"], []).append(f'→ {name}' + (f' ×{count}' if count > 1 else ""))
        packet = {**packet, "wires": kept,
                  "ports": [p for p in packet.get("ports", []) if p["port"] not in headless],
                  "outputs": [p for p in packet.get("outputs", []) if p["port"] not in headless]}
    def references(rows):
        found = {}
        for row in rows:
            label = row.get("index") or row.get("path") or row.get("file") or "external"
            found[label] = row.get("index") if row.get("index") in pages else ""
        return list(found.items())
    # Mapped callers when there are any, the observed call sites otherwise: an empty caller list
    # is not an answer, and the read falls back the same way.
    page.caller_refs = references(packet.get("callerReferences") or packet.get("calledFrom", []))

    def unit(index, label, note, foot, style, ref=None, path=None, target=None):
        address = target or index
        if pages.get(address, {}).get("destination") == "code":
            style = "assertion-code" if style == "assertion" else "code"
        node = page.n(index, label, kind=style, num=address, note=note or None,
                      anchor=path or index)
        node.display_foot = foot
        node.anchor_ref = ref
        if ref:
            node.source_path, node.source_line = ref.rsplit(":", 1)[0], ref.rsplit(":", 1)[1].split("-")[0]
        node.go = address if address in pages else ""
        component = next((c for c in packet.get("components", []) if c.get("id", c["index"]) == index), None)
        if page.design and component and "internal" in component:
            node.boundary_role = "internal" if component["internal"] else "external"
        callers = references(component.get("callerReferences", [])) if component else []
        summary = component.get("callerSummary") if component else None
        if summary:
            target = summary.get("index", "")
            callers = [(f'{summary["count"]} callers → {target}', target if target in pages else "")]
        # A node drawn away from its home map links to that map; its home box links back to
        # every map that repeats it.
        repeats = []
        if component and component.get("home"):
            repeats.append(("home " + component["home"], component["home"] if component["home"] in pages else ""))
        others = component.get("alsoOn", []) if component else []
        if len(others) > 5:
            repeats.append((f'also on {len(others)} maps', ""))
        else:
            repeats += [("also on " + other, other if other in pages else "") for other in others]
        if callers or repeats:
            node.co = tuple(label for label, _target in callers + repeats)
            node.co_targets = dict(callers + repeats)
            node.co_role = "calledFrom" if callers else ""
        drawn.add(index)
        return node

    def port(nid, label, style="port", go=""):
        if nid in drawn:
            return page.index[nid]
        if pages.get(go, {}).get("destination") == "code":
            style = "code"
        node = page.n(nid, label, kind=style)
        if page.design:
            node.boundary_role = "external"
        node.go = go
        drawn.add(nid)
        return node

    if kind in ("root", "group"):
        # The top map and each cluster draw leaves and clusters, and at the edge a boundary box
        # for each node on another map that a link crosses to.
        for c in packet["components"]:
            if c.get("kind") == "concept":
                note = textwrap.fill(c.get("description", ""), 31)
                style = "emphasis" if c.get("stateful") else "recv" if c.get("type") == "actor" else "stage"
                source = c.get("sourceSpan")
                ref = f'{source["file"]}:{source["line"]}-{source["endLine"]}' if source else None
                node = unit(c["index"], c["label"], note, ref or "", style, ref=ref, path=c["path"])
                node.show_foot = bool(source)
                if c.get("type") == "actor":
                    node.num = ""
                continue
            # A box whose code is in no single source file (a cluster, or externals from several
            # files) draws no line naming where it is: the list would outgrow the box.
            if c.get("kind") == "group":
                note = c.get("description", "")
                note = (textwrap.fill(note, 29) + "\n" if note else "") + f'{c["count"]} leaves'
                unit(c["index"], c["label"], note, "", "stage", path=c["path"]).show_foot = False
                continue
            if c.get("kind") == "external":
                label = c["label"]
                node = port(c["index"], textwrap.fill(label, 28) if page.authored else label, "recv")
                files = {e.split("::")[0] for e in c["externals"]}
                if page.authored:
                    node.note = f'{c["count"]} declarations · click to inspect'
                elif c["count"] > 1 and len(files) == 1 and next(iter(files)).endswith((".mjs", ".js")):
                    node.note = " · ".join(c["externals"][:6]) + (f' · +{c["count"] - 6}' if c["count"] > 6 else "")
                continue
            node = unit(c["index"], c["label"], "",
                        f'{c["file"]}:{c["line"]}-{c["endLine"]}', "ast",
                        ref=f'{c["file"]}:{c["line"]}-{c["endLine"]}', path=c.get("path") or f'{c["file"]}::{c["label"]}')
            if c.get("role") == "command":
                node.kind = "command"
            if c.get("possiblyCallerDependent"):
                node.note, node.note_fills = "mode argument?", {0: TONE["link"]}
        for p in packet["ports"]:
            if p.get("mechanism") == "boundary":
                port(p["port"], f'{p["index"]} {p["label"]}', "caller", p["index"] if p["index"] in pages else "")
            else:
                port(p["port"], p["port"], go=port_target(p["port"], pages))
        # What the page cannot draw, as boxes: a count that opens its list, or a marked list.
        for m in packet.get("markers", []):
            node = page.n(m["id"], m["label"], kind="mark-" + m["tone"], note=m.get("note"))
            node.list = m.get("list", "")
            drawn.add(m["id"])
        for w in packet["wires"]:
            if w.get("kind") == "invocation":
                invocation_edge(page, w, drawn, dropped)
        for w, back in one_per_pair([w for w in packet["wires"] if w.get("kind") != "invocation"]):
            if back is None:
                wire(page, w, aggregate(w), "data", drawn, dropped, w.get("ends", "one"))
            else:
                if back["from"] not in drawn or back["to"] not in drawn:
                    dropped.append((page.key, back["from"], back["to"]))
                wire(page, w, f'→ {aggregate(w)}' + chr(10) + f'← {aggregate(back)}', "data", drawn, dropped, "both")
    else:
        node_page(packet, page, unit, port, drawn, dropped)
    boundary = packet.get("callerBoundary")
    if boundary:
        port(boundary["id"], boundary["index"] + " · " + boundary["label"], "caller", boundary["index"])
    for w in packet.get("callerWires", []):
        if w["from"] not in drawn or w["to"] not in drawn:
            dropped.append((page.key, w["from"], w["to"]))
            continue
        page.e(w["from"], w["to"], "calls", "caller", rank=False)
    for nid, labels in outward.items():
        node = page.index.get(nid)
        if node is None:
            dropped.append((page.key, nid, "outside"))
            continue
        node.co = tuple(node.co) + tuple(labels)
    # The findings of the node a box draws are listed below; the box says how many of each missing
    # class there are, each count in its class's colour.
    for c in packet.get("components", []):
        node = page.index.get(c.get("id", c["index"]))
        if node is None:
            continue
        counts = c.get("findings") or missing_counts(c.get("uncertainty", []) + c.get("unresolved", []))
        for cls, (fill, name) in MISSING.items():
            if counts.get(cls):
                row = len(node.note.split("\n")) if node.note else 0
                node.note = (node.note + "\n" if node.note else "") + f'{counts[cls]} {name}'
                node.note_fills = {**getattr(node, "note_fills", {}), row: fill}
    for b in packet.get("badges", []):
        node = page.index.get(b["index"])
        if node is None:
            continue
        row = len(node.note_lines)
        node.note = (node.note + "\n" if node.note else "") + b["text"]
        node.note_fills = {**getattr(node, "note_fills", {}), row: TONE[b["tone"]]}
        node.list_rows = {**getattr(node, "list_rows", {}), row: b["list"]}
    for nid, ident in packet.get("idents", {}).items():
        if nid in page.index:
            page.index[nid].ident = ident
    lists(packet, page, pages)
    page.layout()
    if getattr(page, "focus", None):
        meta["focus"] = page.focus
    return page


STUB_LINE = 46      # characters; a long value takes a line rather than widening the box

# The two missing classes (dev-map/lib/findings.mjs) each have one colour, wherever a row or a
# count of them is drawn: code outside every leaf is red, a relationship no link draws is orange.
# Every other finding is a note about what is drawn, in the list's own grey.
MISSING = {"code": ("#dc2626", "outside every leaf"), "link": ("#ea580c", "unlinked")}
NOTE_FILL = "#64748b"


def missing_counts(rows):
    counts = {}
    for row in rows:
        if row.get("missing"):
            counts[row["missing"]] = counts.get(row["missing"], 0) + row.get("count", 1)
    return counts


def stub_note(rows):
    """An argument slot with no wire, said out loud on the box. A constant slot carries the
    value the call site writes there, drawn on the slot the way a panel feeds an input; every
    other slot names the gap the tracer could not follow. Values wrap onto further lines so a
    box grows as wide as its widest slot, not as wide as all of them together."""
    def said(row):
        if "literal" not in row:
            return row["reason"]
        value = row["literal"]
        return value if isinstance(value, str) else json.dumps(value)
    slots = [f'{row["slot"]} {said(row)}' for row in rows[:4]]
    if len(rows) > 4:
        slots.append(f'+{len(rows) - 4}')
    lines = ["stub"]
    for slot in slots:
        if len(lines[-1]) + len(slot) + 2 <= STUB_LINE:
            lines[-1] += (" " if lines[-1] == "stub" else ", ") + slot
        else:
            lines.append(slot)
    return "\n".join(lines)


def gate_runs(w, caption):
    """The conditions the call sites behind one wire stand under, each said once, with the call
    numbers that share it. A wire whose sites all stand under the same condition carries it
    whole; one whose sites differ carries them per site, and they are gathered back here."""
    runs = {}
    for site in w.get("siteGates", []):
        text = caption(site["gate"])
        if text:
            runs.setdefault(text, []).append(site["order"])
    return [(text, orders) for text, orders in runs.items()]


def invocation_label(w, caption=None):
    if w.get("provenance") == "declaration":
        return "declares"
    if w.get("provenance") == "reference":
        return "value"
    # An operation this body performs whose result nothing here takes: no call number to state.
    if w.get("provenance") == "operation":
        return "performs"
    head = f'call {w["order"]}' + (f' ×{w["sites"]}' if w.get("sites") else "")
    if caption is None:
        return head
    # A call reached only under a test says so on its own wire, in the wording every other
    # drawing of that condition uses — unless the box it arrives at already states it, and then
    # the caller passes no caption for it. Conditions wrap onto further lines, four of them, so
    # a wire states the guards a reader can act on rather than the whole table.
    if w.get("gate") is not None:
        text = caption(w["gate"])
        return f'{head} [{text}]' if text else head
    runs = gate_runs(w, caption)
    lines = [head] + [f'call {", ".join(str(o) for o in orders)} [{text}]'
                      for text, orders in runs[:4]]
    if len(runs) > 4:
        lines.append(f'+{len(runs) - 4}')
    return "\n".join(lines)


def invocation_edge(page, w, drawn, dropped, caption=None):
    """The call, drawn from whatever makes it: the page's own function, or a leaf it homes."""
    source = w["from"]
    if w["to"] not in drawn or (source != "self" and source not in drawn):
        dropped.append((page.key, source, w["to"]))
        return
    # The call's own number is what ranks the box when no value wire does; the wire itself
    # still states the call without ordering the drawing, which is what `rank=False` says.
    if w.get("order") is not None:
        page.index[w["to"]].seq = w["order"]
    page.e(source, w["to"], invocation_label(w, caption), "invocation", rank=False)


def gate_caption(gates, number):
    """The condition a gate states, in the one wording every drawing of it uses."""
    gate = gates[number]
    if gate.get("terms"):
        terms = gate["terms"]
        if len(set(term["name"] for term in terms)) == 1:
            runs = []
            for term in terms:
                if runs and runs[-1][0] == term["branch"]:
                    runs[-1][1] += 1
                else:
                    runs.append([term["branch"], 1])
            branches = " ∧ ".join(branch + (f' ×{count}' if count > 1 else "") for branch, count in runs)
            return f'g{number + 1} · {terms[0]["name"]} · {branches}'
        return f'g{number + 1} · ' + " ∧ ".join(term["name"] + ":" + term["branch"] for term in terms)
    return gate.get("name", f'condition {number + 1}') + " · " + gate.get("branch", gate["kind"])


def node_page(packet, page, unit, port, drawn, dropped):
    """A function, method, handler or class page: what it takes in, what it calls, what leaves."""
    gates = packet["gates"]
    def gate_name(number):
        return gate_caption(gates, number)
    def safe_gate_name(number):
        return gate_caption(gates, number) if number is not None and number < len(gates) else ""
    # A condition is said once where it is read. The box a call arrives at states its own gate,
    # so the wire into it stays quiet and says the condition only where the box does not: a box
    # with no gate of its own, or one whose collapsed sites stand under conditions it cannot
    # state as a single one.
    def wire_caption(w):
        stated = box_gates.get(w["to"], "")
        return lambda number: "" if safe_gate_name(number) == stated else safe_gate_name(number)
    for p in packet["inputs"]:
        node = port(p["port"], p["name"], go=p.get("index") or "")
        port_context(node, p, page.context_pages)
    # The function itself. Every box below is something it invokes, so it is drawn and every box
    # is wired to it; the argument slots the tracer could not source are marked on the box.
    invocations = [w for w in packet["wires"] if w.get("kind") == "invocation"]
    stubs = {w["to"]: w.get("stubs", []) for w in invocations}
    # Closure-owned state is read and written by this body itself, so the subject box is drawn
    # for a page that holds state even when it calls nothing; an inlined chain wires from the
    # leaf's box instead, so "self" is drawn only when something actually wires from it.
    state = packet.get("state", [])
    from_self = any(w["from"] == "self" for w in invocations)
    subject = "self" if from_self or state else packet["index"]
    if (from_self or state) and packet.get("file"):
        me = unit(subject, packet["path"][len(packet["file"]) + 2:], "this function",
                  f'{packet["file"]}:{packet["line"]}-{packet["endLine"]}', "subject",
                  ref=f'{packet["file"]}:{packet["line"]}-{packet["endLine"]}', path=packet["path"])
        me.go = ""
        # The body is where the order starts, so it stands left of everything it calls.
        me.seq = 0
    box_gates = {c.get("id", c["index"]): gate_name(c["gate"])
                 for c in packet["components"] if c.get("gate") is not None}
    for c in packet["components"]:
        if c.get("kind") == "group":
            unit(c["index"], c["label"], f'{c["count"]} declarations · authored grouping',
                 "", "stage", path=c["path"])
            continue
        note = []
        if c.get("gate") is not None:
            note.append(gate_name(c["gate"]))
        if c.get("reference") == "callable" or c.get("closure") and c.get("calls") == 0:
            note.append("function value")
        elif c.get("calls") is not None and c["calls"] != 1:
            note.append(f'{c["calls"]} call sites')
        if c.get("possibleTarget"):
            note.append("possible target")
        if c.get("executionUnknown"):
            note.append("execution unknown")
        rows = stubs.get(c.get("id", c["index"]), [])
        if rows:
            note.append(stub_note(rows))
        assertion = c.get("assertion", {}).get("condition")
        assertion_row = len(note)
        if assertion:
            note.append("check · " + assertion.get("name", "condition"))
        label = c.get("binding", "") + " · " + c["label"] if c.get("binding") else c["label"]
        node = unit(c.get("id", c["index"]), label, "\n".join(note),
             f'{c["file"]}:{c["line"]}-{c["endLine"]}',
             "assertion" if c.get("shape") == "assertion" else kind_of(c.get("links") or []),
             ref=f'{c["file"]}:{c["line"]}-{c["endLine"]}', path=f'{c["file"]}::{c["label"]}', target=c["index"])
        if c.get("gate") is not None:
            gate = gates[c["gate"]]
            if gate.get("file") and gate.get("line"):
                node.gate_ref = f'{gate["file"]}:{gate["line"]}-{gate.get("endLine", gate["line"])}'
        if assertion and assertion.get("source"):
            source = assertion["source"]
            node.note_refs = {assertion_row: f'{source["file"]}:{source["line"]}-{source.get("endLine", source["line"])}'}
    for op in packet.get("operators", []):
        unresolved = any(op.get(key) for key in ("unresolved", "unknown", "controlUnknown", "iterationSourceUnknown", "targetUnknown", "argumentUnknown"))
        unresolved = unresolved or any(a.get("unknown") or a.get("unknownFields") for a in op.get("arguments", []))
        identity = op.get("callee") or op.get("binding") or op.get("collection")
        operation = op.get("operation") or ("construct" if op.get("callKind") == "construct" else
                    {"iteration": "loop", "choice": "choose", "invocation": "call"}.get(op["kind"], op["kind"]))
        title = identity + " · " + operation if identity else operation
        uncertainty_label = "argument origin unknown" if op.get("scope") == "outside" and op.get("argumentUnknown") and not op.get("targetUnknown") else "unresolved"
        # An operation reached only under a test says so, on its first line and opening the
        # condition's own source, exactly as a call box does.
        note = [gate_name(op["gate"])] if op.get("gate") is not None else []
        # An operator no call takes the result of is on the page because a finding names it.
        flags = " · ".join(text for condition, text in ((unresolved, uncertainty_label),
                           (op.get("possibleTarget"), "possible target"),
                           (op.get("keptFor"), f'kept for {op.get("keptFor")}')) if condition)
        if flags:
            note.append(flags)
        # An operator kept because a finding names it carries the inputs it could not source as
        # stub rows, the way a call box carries its untraced argument slots.
        rows = stubs.get(op["id"], [])
        if rows:
            note.append(stub_note(rows))
        node = unit(op["id"], title, "\n".join(note),
             f'{op["file"]}:{op["line"]}-{op["endLine"]}',
             "outside" if op.get("scope") == "outside" else {"choice": "choice", "invocation": "invocation"}.get(op["kind"], "state"),
             ref=f'{op["file"]}:{op["line"]}-{op["endLine"]}')
        if op.get("gate") is not None:
            gate = gates[op["gate"]]
            if gate.get("file") and gate.get("line"):
                node.gate_ref = f'{gate["file"]}:{gate["line"]}-{gate.get("endLine", gate["line"])}'
    for p in packet.get("ports", []):
        port(p["index"], p["label"], go=p["index"])
    for p in packet["outputs"]:
        note = []
        if p.get("spread"):
            note.append("spread")
        if p.get("computedKeys"):
            note.append("computed keys")
        if p.get("gate") is not None:
            note.append(gate_name(p["gate"]))
        node = page.n(p["port"], p["name"], kind="throw" if p.get("kind") == "throw" else "port",
                      note="\n".join(note) or None)
        node.go = p.get("index") or ""
        if p.get("gate") is not None:
            gate = gates[p["gate"]]
            if gate.get("file") and gate.get("line"):
                last = max([gate.get("endLine", gate["line"])] + p.get("lines", []))
                node.anchor_ref = f'{gate["file"]}:{gate["line"]}-{last}'
                node.source_path, node.source_line = gate["file"], str(gate["line"])
        elif p.get("source"):
            source = p["source"]
            node.anchor_ref = f'{source["file"]}:{source["line"]}-{source.get("endLine", source["line"])}'
            node.source_path, node.source_line = source["file"], str(source["line"])
        port_context(node, p, page.context_pages)
        drawn.add(p["port"])
    # A binding the holder declares and its members share: state this body reads and writes,
    # drawn as its own node rather than recited as text on a box.
    for s in state:
        ref = f'{s["file"]}:{s["line"]}-{s["endLine"]}'
        owner = s.get("ownerIndex") or s["owner"]
        node = page.n(s["id"], s["name"], kind="state",
                      note=f'{s["binding"]} · {s["access"]} · owned by {owner}', anchor=ref)
        node.display_foot = ref
        node.anchor_ref = ref
        node.source_path, node.source_line = s["file"], str(s["line"])
        node.go = owner if owner in page.context_pages else ""
        drawn.add(s["id"])
    # A body that calls nothing still has a page: itself, what reaches it and what leaves it.
    if not packet["components"] and not packet.get("operators"):
        if subject not in drawn:
            me = unit(subject, packet["path"][len(packet["file"]) + 2:], packet["kind"],
                      f'{packet["file"]}:{packet["line"]}-{packet["endLine"]}',
                      "subject", ref=f'{packet["file"]}:{packet["line"]}-{packet["endLine"]}',
                      path=packet["path"])
            me.go = ""
        for p in packet["inputs"]:
            page.e(p["port"], subject, p["name"], "data")
        for p in packet["outputs"]:
            page.e(subject, p["port"], "", "io")
        for c in packet["calledFrom"]:
            caller = c.get("index") or c.get("path") or c.get("file") or "external"
            port("from:" + caller, caller, go=c.get("index") or "")
            page.e("from:" + caller, subject, ", ".join(c.get("labels", [])), "data")
    # An owned-state wire names this body as one of its ends; the box for it is `subject`.
    body = [w if w.get("provenance") != "owned-state" else
            {**w, "from": subject if w["from"] == "self" else w["from"],
             "to": subject if w["to"] == "self" else w["to"]}
            for w in packet["wires"] if w.get("kind") != "invocation"]
    for w in value_bundles(body):
        if w.get("provenance") == "owned-state":
            wire(page, w, " · ".join(x for x in (w.get("label", ""), w.get("stub", "")) if x),
                 "state", drawn, dropped)
        else:
            gate = gate_name(w["gate"]) if w.get("gate") is not None else ""
            def value_label(value):
                roles = " → ".join(x for x in [w.get("fromPort", ""), value.get("toPort", "")] if x)
                flags = ", ".join(text for key, text in (("spread", "spread"), ("positionUnknown", "position unknown")) if value.get(key))
                return " ".join(x for x in [value.get("label", ""), f'({roles})' if roles else "", flags, f'[{gate}]' if gate else ""] if x)
            label = "\n".join(value_label(value) for value in w.get("argumentValues", [w]))
            wire(page, w, label, "gate" if gate else WIRE.get(w.get("kind"), "data"), drawn, dropped)
    # Last, so a box is placed by the values that reach it and not by the call that makes it:
    # the invocation edge states the call, it does not order the drawing.
    for w in invocations:
        invocation_edge(page, w, drawn, dropped, wire_caption(w))


def value_text(value):
    """A stored value said the way the packet says it. A ledger row prints what is in the JSON,
    so a boolean is `true` and an absent one is `null`, never Python's spelling of them."""
    return value if isinstance(value, str) else json.dumps(value)


def lists(packet, page, pages):
    """What the stored packet holds beside its boxes and wires, printed as data."""
    if packet.get("design"):
        page.row("head", "Authored map · source references are not conformance evidence")
        for line in textwrap.wrap(packet.get("description", ""), 115):
            page.row("item", line)
        for note in packet.get("notes", []):
            for line in textwrap.wrap(note, 115):
                page.row("item", line)
        page.row("item", "Click a source box to preview its file; click a wire for its contract and evidence. No transitive access.")
        return
    # How this page came to be drawn: whether its wires are relationships rather than execution,
    # how many call sites are behind them, and where its grouping was authored. A reader who does
    # not know which kind of drawing this is would read every arrow wrong. A code destination is
    # not drawn and its read carries none of this, so its panel says none of it either.
    drawn = packet.get("destination") != "code"
    if drawn and (packet.get("structural") or packet.get("relationshipSummary") or packet.get("composition")):
        page.row("head", "this page", "", "")
    if drawn and packet.get("structural"):
        page.row("item", "containment view — a wire says the code under one box reaches the code "
                         "under the other, not that it runs next", "", "structural")
    if drawn and packet.get("relationshipSummary"):
        summary = packet["relationshipSummary"]
        page.row("item", f'{summary["sites"]} sites collapsed into {summary["connections"]} drawn '
                         f'connections — every site remains under --details on {summary["details"]}',
                 "", "relationshipSummary")
    if drawn and packet.get("composition"):
        c = packet["composition"]
        counted = (f'  ·  {c["edges"]} relationships, {c["internal"]} inside groups, '
                   f'{c["crossing"]} crossing') if c.get("edges") is not None else ""
        page.row("item", f'authored: {", ".join(c["authored"])} — {c["source"]}  ·  '
                         f'relations {c["relations"]}{counted}', "", "composition")
    # A field the page lists but owns no box for: a group drawn out of a stateful declaration
    # names the state its members touch, and the boxes for it stand on the declaration's own page.
    if drawn and packet.get("stateFields") and not packet.get("state"):
        page.row("head", f'state fields ({len(packet["stateFields"])}) — touched here, owned above: '
                         f'the state boxes stand on the declaration that owns them', "", "stateFields")
        for f in packet["stateFields"]:
            where = f.get("source") or {}
            at = f'{packet.get("file", "")}:{where["line"]}' if where.get("line") else ""
            page.row("item", f'{f["name"]}  {f.get("receiver", "")}  {at}'.rstrip(),
                     "", f'stateFields#{f["id"]}')
    # The one authored thing on any page: a row of dev-map/facts.tsv about this declaration.
    if packet.get("facts"):
        page.row("head", f'facts ({len(packet["facts"])}) — authored, from dev-map/facts.tsv', "", "facts")
        for i, f in enumerate(packet["facts"]):
            page.row("item", f'{f["kind"]}  {f["date"]}  {f["fact"]}  [{f["source"]}]', "", f'facts#{i}')
    if packet.get("requires"):
        page.row("head", f'requires ({len(packet["requires"])})', "", "requires")
        for i, item in enumerate(packet["requires"]):
            text = f'{item["line"]}: {item["text"]}'
            if item.get("message"):
                text += "  |  " + item["message"]
            page.row("item", text + f'  → {item["index"]} {item["by"]}', item.get("index", ""), f'requires#{i}')
    if packet.get("formulas"):
        page.row("head", f'formulas ({len(packet["formulas"])})', "", "formulas")
        for i, f in enumerate(packet["formulas"]):
            page.row("item", f'{f["index"]} {f["label"]}  {f["file"]}  lines '
                             + ", ".join(str(n) for n in f["lines"]), f["index"], f'formulas#{i}')
    if packet.get("couplings"):
        page.row("head", f'couplings ({len(packet["couplings"])})', "", "couplings")
        for i, c in enumerate(packet["couplings"]):
            end = c.get("index") or c.get("path") or c.get("file") or ""
            page.row("item", f'{c["kind"]} {c["direction"]} {c.get("label", "")}  → {end}'
                             + (f'  {c["path"]}' if c.get("index") and c.get("path") else ""),
                     c["index"] if c.get("index") in pages else "", f'couplings#{i}')
    # A callable a caller passes into a parameter this page invokes. Its box is on the caller's
    # page, where it is written and wired into the argument slot; here it is one row, so a page
    # that only invokes its callback stays code rather than a wall of other people's lambdas.
    targets = [(port, row) for port in packet.get("inputs", []) for row in port.get("parameterTargets", [])]
    if targets:
        page.row("head", f'parameter targets ({len(targets)}) — passed in by callers, drawn on the caller page',
                 "", "parameterTargets")
        for i, (port, row) in enumerate(targets):
            supplier = row.get("from") or row.get("fromPath") or row.get("fromFile") or "caller"
            page.row("item", f'{port["port"]} {port["name"]}  →  {row["index"]} {row["path"]}'
                             + f'  · from {supplier}' + ("  · possible target" if row.get("possible") else ""),
                     row["index"] if row["index"] in pages else "", f'parameterTargets#{i}')
    if packet.get("declarationReferences"):
        page.row("head", "declaration calls — invocation not established", "", "declarationReferences")
        for i, relation in enumerate(packet["declarationReferences"]):
            page.row("item", f'{relation["from"]} calls {relation["to"]}', relation["from"],
                     f'declarationReferences#{i}')
    # A row carries the file it is about, because a section lists the rows of a node this page
    # only draws. The drawing names that file where it is not the file the page is about.
    own_file = packet.get("file")

    def unresolved_rows(rows, go="", mark=""):
        for i, u in enumerate(rows):
            elsewhere = u.get("file") and u.get("file") != own_file
            location = (u["file"] + ":" if elsewhere else "") + str(u["line"])
            page.row(u.get("missing", "note"), f'{location}: {u["call"]}  —  {u["rule"]}', go, f'{mark}#{i}' if mark else "")

    def uncertainty_rows(rows, go="", mark=""):
        for i, u in enumerate(rows):
            item = f'{mark}#{i}' if mark else ""
            style = u.get("missing", "note")
            u = {k: v for k, v in u.items() if k != "missing" and (k != "file" or v != own_file)}
            if u.get("kind") == "closure-capture" and u.get("bindings"):
                target = next((index for index, meta in pages.items() if meta.get("d") == u["closure"]), "")
                identity = target or u["closure"]
                limits = ", ".join(k for k, v in u.items() if k.endswith("Unknown") and v)
                page.row(style, f'closure-capture {identity} · {u["count"]} bindings · {limits}',
                         target or go, item)
                for access, bindings in u["bindings"].items():
                    for line in textwrap.wrap(f'{access}: ' + ", ".join(bindings), width=120):
                        page.row(style, line, target or go, item)
            else:
                page.row(style, "  ".join(f'{k}: {value_text(v)}' for k, v in u.items()), go, item)

    emit = {"unresolved": unresolved_rows, "uncertainty": uncertainty_rows}

    # A list of findings is headed by what they are: a missing class when every row is of it.
    def heading(category, rows):
        classes = {r.get("missing") for r in rows}
        name = MISSING[classes.pop()][1] if len(classes) == 1 and None not in classes else category
        return f'{name} ({sum(r.get("count", 1) for r in rows)})'

    if packet.get("unresolved"):
        page.row("head", heading("unresolved", packet["unresolved"]), "", "unresolved")
        unresolved_rows(packet["unresolved"], mark="unresolved")
    if packet.get("uncertainty"):
        page.row("head", heading("uncertainty", packet["uncertainty"]), "", "uncertainty")
        uncertainty_rows(packet["uncertainty"], mark="uncertainty")
    # A finding belongs to the node it is about, so every page that draws that node shows its
    # rows under that box. A group or file box is not a node and carries its count alone.
    def section(index, name, category, rows, mark):
        go = index if index in pages else ""
        page.row("head", f'{heading(category, rows)} — {index} {name}', go, mark)
        emit[category](rows, go, mark)

    for category in ("unresolved", "uncertainty"):
        for c in packet.get("components", []):
            if c.get(category):
                section(c["index"], c.get("label") or c.get("path") or c.get("file") or c["index"],
                        category, c[category], f'components#{c["index"]}#{category}')
    # A node page draws the same declaration once per call site; its rows are listed once, in
    # drawing order, under the node they are about.
    for node in packet.get("nodeFindings", []):
        for category in ("unresolved", "uncertainty"):
            if node.get(category):
                section(node["index"], node["path"].split("::", 1)[-1], category, node[category],
                        f'nodeFindings#{node["index"]}#{category}')
    if packet.get("analysisContext"):
        context = packet["analysisContext"]
        page.row("head", "analysis context", "", "analysisContext")
        page.row("item", f'{context["index"]} {context["path"]}  uncertainty: {context["uncertainty"]}  '
                         f'unresolved: {context["unresolved"]}', context["index"], "analysisContext#0")
    if packet.get("consumedBy"):
        page.row("head", f'consumedBy ({len(packet["consumedBy"])})', "", "consumedBy")
        for i, c in enumerate(packet["consumedBy"]):
            page.row("item", "  ".join(f'{k}: {value_text(v)}' for k, v in c.items()), c.get("index") or "",
                     f'consumedBy#{i}')
    if packet.get("outsideCallers"):
        page.row("head", f'outside callers ({sum(packet["outsideCallers"].values())}) — not active while making a part',
                 "", "outsideCallers")
        for where, count in packet["outsideCallers"].items():
            page.row("item", f'{where} · {count}', "", f'outsideCallers#{where}')
    if packet.get("outside"):
        page.row("head", f'outside ({packet["outside"]})', "", "outside")
        page.row("item", f'{packet["outside"]} call sites reaching scanned source the map does not cover',
                 "", "outside#0")
    if packet.get("platform"):
        page.row("head", f'platform ({packet["platform"]})', "", "platform")
        page.row("item", f'{packet["platform"]} call sites with no target in any scanned root',
                 "", "platform#0")
    # A generator that has its own listings (a solved influence set: its arrows' leaf arrows,
    # unlinked and unowned leaves, preview notes) supplies them as titled sections of rows.
    for s, section in enumerate(packet.get("sections", [])):
        page.row("head", section["title"], "", f'sections#{s}')
        for i, item in enumerate(section["items"]):
            page.row(item.get("style", "item"), item["text"], item.get("go", ""), f'sections#{s}#{i}')


LEGEND = [
    ("h", None, "Generated relationships; authored grouping and external facts."),
    ("p", None, "Declarations, wires, data labels and gates are produced from parsed source by "
                "dev-map/lib/flow.mjs and dev-map/lib/store.mjs, and drawn by "
                "dev-map/lib/generated-view.py. dev-map/flows.json selects groups and group labels; "
                "group boundary ports are generated from the crossing relationships. Facts list rows "
                "are written by hand in dev-map/facts.tsv because code cannot state a measurement, a "
                "vendor behaviour or a recorded decision; each such list says so above itself. "
                "This legend is the only other writing in the viewer."),
    ("h", None, "Boxes"),
    ("b", "ast", "a callee read straight from the AST (ast-call-site, ast-closure, ast-member)."),
    ("b", "code", "opens the matching source directly. Other declaration boxes open a graph. "
                  "The index and source span remain the same in the CLI and viewer."),
    ("b", "assertion-code", "an assertion gate. Its condition caption opens the caller's predicate; "
                           "its body opens the assertion implementation. Wires name its inputs, without "
                           "claiming downstream success or exception order."),
    ("b", "invocation", "an invocation whose callee is a parameter or is otherwise unresolved. Callable or "
                        "receiver and argument ports come from source; optional calls retain their nullish "
                        "gates. Where callers could be followed to concrete callables, those are listed as "
                        "parameter-target rows below the drawing and drawn on the caller's own page."),
    ("b", "outside", "a call to a resolved source declaration outside the mapped roots, such as a skill. "
                      "Its wires come from the invocation; clicking opens that invocation's matching source. "
                      "CLI target metadata names the outside declaration without inventing a map index."),
    ("b", "recv", "a callee resolved by following the receiver's or callee's value "
                  "(receiver-value, value-follow)."),
    ("b", "subject", "the function this page is. Every box it draws is wired to it by an "
                     "invocation edge, so no box floats; stub rows on a box name the argument "
                     "slots the tracer could not source."),
    ("b", "state", "local loop, update or collection state, with initial/current/next/final roles on its wires. "
                   "A small named state box is owned state: a binding the enclosing declaration "
                   "owns, or a `this.` field of the class this member belongs to. Its note says "
                   "the binding kind, the access and which declaration owns it, and clicking it "
                   "opens that owner."),
    ("h", None, "Ports"),
    ("b", "port", "in: a parameter, or a way in from outside this page — an outside caller, or a caller of this function. Out: a return, named "
                  "as the source writes it. From/to caller rows link each observed call site. "
                  "Unknown positions and origins stay explicit; full argument and result traces "
                  "remain available through CLI --details. Throws do not imply a traced catcher."),
    ("b", "throw", "a throw out, named by the constructor it throws."),
    ("h", None, "Wires"),
    ("p", None, "Red outward reference arrows attach to a shared box and point to observed callers elsewhere. Each index opens "
                "that canonical destination. These references use stored calledFrom evidence; "
                "unresolved and unrepresented callers are not invented. The expanded function instead "
                "lists its own callers as plain links, without a frame-level arrow."),
    ("w", "data", "ast-param / ast-def-use / ast-nested-call: a parameter, a bound call result, "
                  "or a call written inside another call's arguments, passed on. Compatible values "
                  "between the same boxes share one drawn connection with every value named; "
                  "separate wires do not imply asynchronous execution."),
    ("w", "data:ack", "an activation that returns only its outcome: the dot is at the caller, "
                      "which learns that the command completed or failed, or what it created."),
    ("w", "data:both", "influence both ways: one wire per pair of boxes, its label naming each direction. "
                       "Between leaves it marks a command returning data its caller uses."),
    ("w", "caller", "calls: an observed caller already displayed on this page connects to its "
                    "callee, or to the rounded page boundary. This is a call relationship, "
                    "not returned data or an execution-order constraint."),
    ("w", "capture", "a value's binding is captured by a nested function. This carries a reference, "
                     "not an invocation or an execution-order constraint. Mutable or untraced captures "
                     "retain their analysis limits."),
    ("w", "state", "state-thread: the same receiver at successive call sites, in source order. On "
                   "owned-state: a binding a factory owns or a field a class owns is a box; the "
                   "arrow points out of it for a read and into it for a write, so the holder or "
                   "class page says which members share which state and a member page says what "
                   "it reads and writes. A write whose value the tracer could not follow leaves "
                   "this function's own box and names the gap beside the name."),
    ("w", "gate", "ast-guard: the call is reached only under a test. The label names the condition "
                  "and branch; the full predicate remains under source and CLI --details."),
    ("w", "io", "ast-return / ast-throw: what leaves through a return or a throw."),
    ("w", "invocation", "this function invokes that box, as its Nth call (×N when one "
                        "declaration is called from several sites that did not separate), or "
                        "declares it without calling it here. It carries no value: the values "
                        "are the data wires, and the slots with none are the box's stub rows."),
    ("p", None, "On page 0 and on its clusters one wire stands for every link between "
                "those two boxes; its label is the kinds and their counts."),
    ("h", None, "What order means"),
    ("p", None, "Boxes are possible callees at a call site, ordered by first call site and placed "
                "left to right by the wires between them. That order is not an execution trace."),
    ("p", None, "A state thread is one reaching construction of a receiver, drawn in source order: "
                "not proof that these calls run on the same object, in this order."),
    ("h", None, "Lists"),
    ("p", None, "Assertion calls appear as connected gates; full requirements remain in source and CLI --details. "
                "Formula-shaped functions remain boxes, with their generated data wires; "
                "purity does not suppress a called stage. calledFrom — generated incoming call sites, including "
                "callers outside mapped roots. consumedBy — observed consumers of return values. "
                "couplings — links that are not calls. uncertainty — unsupported control or data analysis. "
                "unresolved — a call site whose callee the scanner cannot name, with the rule that "
                "stopped it. outside — call sites reaching scanned source the map does not cover; "
                "platform — call sites with no target in any scanned root. Neither establishes "
                "their runtime origin or a user/agent boundary."),
    ("h", None, "Findings"),
    ("f", "code", "red: code outside every leaf, which no box draws — module-level code that runs at "
                  "load, or a callable no leaf holds. Listed on page 0."),
    ("f", "link", "orange: a relationship between leaves that no link draws — a call whose target is "
                  "unknown, a write to state another leaf shares, contents that escape the leaf."),
    ("f", "note", "grey: a precise aspect of what a leaf or link already draws that the scanner could "
                  "not trace. In the leaf's own read only."),
    ("h", None, "Stale"),
    ("p", None, "A red frame and a red band mean a file behind the page has changed since the "
                "store was written: the drawing is what the code used to be. Run the command the "
                "band names to regenerate the map and drawing."),
]

CSS = BASE_CSS + """
#tree a{font-family:ui-monospace,Consolas,monospace;font-size:11.4px;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis}
#tree a .ix{color:#64748b;margin-right:7px}
#tree a{cursor:pointer;padding-top:3px;padding-bottom:3px}
#tree a .tw{display:inline-block;width:13px;margin-left:-13px;color:#64748b;text-align:center}
#tree a .tw:hover{color:#f8fafc}
#tree a.open>.tw{transform:rotate(90deg)}
body.noside #side{display:none}
#bar{flex-wrap:wrap}
#crumb{flex:1 1 260px;max-height:3.1em;overflow:hidden}
@media (max-width:760px){#side{width:200px;flex-basis:200px}}
.fm-src{cursor:pointer}
.fm-src:hover{fill-opacity:0.16!important}
.fm-go{cursor:pointer}
.fm-go:hover rect{fill-opacity:0.16!important}
.fm-node[data-go] rect:first-of-type{cursor:pointer}
.fm-node[data-go]:hover rect:first-of-type{stroke-width:3.4}
#legendpane{position:absolute;right:0;top:0;bottom:0;width:620px;max-width:60%;background:#fff;
            border-left:1px solid #cbd5e1;box-shadow:-6px 0 22px rgba(15,23,42,.13);display:none;
            flex-direction:column}
#legendpane.on{display:flex}
#legendpane .lh{flex:0 0 auto;padding:9px 15px;border-bottom:1px solid #e2e8f0;background:#f8fafc;
                font-weight:650}
#legendpane .lh .x{float:right;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1}
#legendpane .lb{flex:1;overflow-y:auto;padding:8px 18px 40px}
#legendpane h3{margin:16px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.8px;
               color:#64748b}
#legendpane h2{margin:12px 0 6px;font-size:15px}
#legendpane p{margin:0 0 9px;font-size:12.5px;line-height:1.55;color:#334155}
#legendpane .r{display:flex;gap:10px;align-items:flex-start;margin:0 0 7px}
#legendpane .r svg{flex:0 0 auto;margin-top:2px}
#legendpane .r span{font-size:12.5px;line-height:1.5;color:#334155}
#legendpane .r b{color:#0f172a}
#crumb span.up{color:#0369a1;cursor:pointer}
#stale{font-size:11.5px;color:#9f1239;background:#fee2e2;border-radius:5px;padding:2px 8px}
#stale:empty{display:none}
#score{order:9;flex:1 0 100%;font-size:11.5px;color:#334155;background:#f1f5f9;border-radius:5px;padding:2px 8px;font-variant-numeric:tabular-nums}
#score:empty{display:none}
#score[hidden]{display:none}
#score b{color:#0f172a}
#score .bad{color:#9f1239}
#codepane .cb{min-width:0;min-height:0;overflow:auto}
#codepane .cb.list button{display:block;width:100%;text-align:left;font:12.5px/1.4 inherit;background:none;border:0;border-bottom:1px solid #f1f5f9;padding:5px 14px;cursor:pointer}
#codepane .cb.list button:hover{background:#f0f9ff}
#codepane .cb.list span{color:#64748b;font:11.5px ui-monospace,Consolas,monospace}
.fm-list{cursor:pointer}.fm-list:hover{fill-opacity:.12!important}
#codepane .cb>pre{width:max-content;min-width:100%;box-sizing:border-box;overflow:visible;white-space:pre}
#codepane details{margin:8px 14px;color:#475569}
#codepane details summary{cursor:pointer;font-size:12px}
#codepane details pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:8px 0}
#codepane .interfaces{padding:16px;overflow-wrap:anywhere}
#codepane .interface{border:1px solid #e2e8f0;border-radius:7px;padding:14px;margin-bottom:16px}
#codepane .interface h3{margin:0 0 6px;font-size:15px}
#codepane .interface-id{font:11px ui-monospace,Consolas,monospace;color:#64748b}
#codepane .interface pre{padding:10px;margin:8px 0;background:#f8fafc;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
#codepane .interface .entry{border-top:1px solid #e2e8f0;margin-top:14px;padding-top:8px}
#codepane .interface h4{margin:8px 0;font:600 13px ui-monospace,Consolas,monospace}
#codepane .interface details{margin:10px 0}
#codepane .interface dt{font-size:11px;font-weight:650;color:#64748b;margin-top:14px}
#codepane .interface dd{margin:4px 0;white-space:pre-wrap}
#codepane .interface ul{margin:0;padding-left:20px}
#codepane .endpoint{font:inherit;color:#0369a1;background:none;border:0;padding:0;cursor:pointer;text-align:left}
#codepane .endpoint:hover{text-decoration:underline}
#canvas.wires .fm-edge,#canvas.wires .fm-elab,.fm-wire-hit{cursor:pointer}
#canvas>svg{overflow:visible}
#canvas.arrange .fm-node[data-ident]{cursor:grab}
#stage.drag #canvas.arrange .fm-node{cursor:grabbing}
#arrange.on{background:#0284c7;color:#fff;border-color:#0284c7}
#author-status{font-size:12px;color:#475569;margin:0 6px}
#author-status.bad{color:#dc2626;font-weight:600}
#canvas.design .fm-node[data-boundary-role="internal"]>rect{stroke:#334155;stroke-dasharray:none;stroke-width:1.8}
#canvas.design .fm-node[data-boundary-role="external"]>rect{stroke:#64748b;stroke-dasharray:7 4;stroke-width:1.8;fill:#f8fafc}
.boundary-key{display:flex;gap:16px;align-items:center;font-size:12px;color:#475569}
.boundary-key span:before{content:'';display:inline-block;width:24px;height:13px;border:2px solid #334155;border-radius:3px;margin-right:6px;vertical-align:middle}
.boundary-key .external:before{border-color:#64748b;border-style:dashed;background:#f8fafc}
#boundary-key{position:absolute;top:10px;right:14px;z-index:1;padding:6px 9px;background:#ffffffed;border-radius:4px;pointer-events:none}
#canvas.contents{inset:45px 22px 20px;overflow:auto;transform:none!important;width:auto}
.map-contents{max-width:820px;padding:12px 18px;background:#fff}
.map-contents h2{font-size:18px}.map-contents h3{font-size:14px;margin-top:22px}
.map-contents ul{padding:0;list-style:none}.map-contents li{margin:10px 0}
.map-contents button{cursor:pointer;text-align:left;padding:8px 12px;background:#fff;border:1px solid #334155;border-radius:4px;font:inherit}
.map-contents button.external{border-style:dashed;color:#475569}.map-contents small{display:block;margin:4px 0;color:#64748b}
#canvas.wires .fm-edge.wire-hot{stroke:#0284c7;stroke-width:3.4;opacity:1}
#canvas.wires .fm-elab.wire-hot{opacity:1}
#codepane .leafarrows ul{margin:0 0 10px;padding-left:16px}
#codepane .leafarrows li{margin:3px 0;line-height:1.35}
#codepane .leafarrows .tail{color:#64748b}
#canvas.wire-focus .fm-node:not(.wire-end){opacity:.14}
#canvas.wire-focus .fm-node.wire-end{opacity:1}
#canvas.wire-focus .fm-node.wire-end rect:first-of-type{stroke:#0284c7;stroke-width:3.4}
#canvas.wire-focus .fm-edge:not(.wire-hot){opacity:.07}
#canvas.wire-focus .fm-elab:not(.wire-hot),#canvas.wire-focus .fm-endtag:not(.wire-hot){opacity:.12}
#canvas.authored .fm-elab:not(.hot):not(.wire-hot){pointer-events:none}
.fm-wire-hit:focus{outline:none;stroke:#38bdf8;stroke-opacity:.3}

#back:disabled{opacity:.4;cursor:default}

/* -- semantic zoom: which of a box's two drawings is on ------------------------------
   Every box is drawn twice, as its name alone at the size the box will hold and as the
   whole box. Below FAR the page is a shape, so the name is what is on; at or above it the
   reader is reading, so everything is. Nothing moves between the two. */
#canvas .fm-far{display:none}
#canvas.far .fm-far{display:inline}
#canvas.far .fm-near,#canvas.far .fm-elab,#canvas.far .fm-endtag,#canvas.far .fm-src,
#canvas.far .fm-owner-callers{display:none}
#canvas.far .fm-edge{stroke-width:3.2}
#canvas.far .fm-edge.long{stroke-width:5}

/* -- focus: one box, its wires and what they reach; everything else recessive -------- */
#canvas.focus .fm-node:not(.sel):not(.peer){opacity:.15}
#canvas.focus .fm-edge:not(.hot){opacity:.07}
#canvas.focus .fm-elab:not(.hot),#canvas.focus .fm-endtag:not(.hot){opacity:.12}
#canvas .fm-node.peer>rect:first-of-type{stroke:#0284c7;stroke-width:3}
#canvas .fm-node.at>rect:first-of-type{stroke:#c026d3;stroke-width:4.2}
#canvas .fm-endtag{cursor:pointer}
#canvas .fm-endtag.hot text{font-weight:700}
#canvas.authored .fm-elab:not(.hot),#canvas.authored .fm-endtag:not(.hot){opacity:0}
#canvas.authored .fm-edge.long:not(.hot){opacity:.18}
#canvas.authored .fm-edge[data-a^="external:"]:not(.hot),#canvas.authored .fm-edge[data-b^="external:"]:not(.hot){opacity:.35;stroke-width:1.5}
#canvas.authored.focus .fm-edge:not(.hot){opacity:.06}

/* -- where am I: the whole page, and the rectangle this screen is looking at --------- */
#minimap{position:absolute;right:16px;bottom:42px;background:rgba(255,255,255,.93);
         border:1px solid #cbd5e1;border-radius:7px;padding:4px;display:none;cursor:crosshair;
         box-shadow:0 3px 14px rgba(15,23,42,.14)}
#minimap svg{display:block}
body.nomini #minimap{display:none!important}
#pin{position:absolute;left:16px;top:14px;font-size:11.5px;color:#0f172a;
     background:rgba(255,255,255,.93);border:1px solid #cbd5e1;border-radius:6px;
     padding:3px 9px;display:none;max-width:44%;overflow:hidden;text-overflow:ellipsis;
     white-space:nowrap}
#pin b{color:#0284c7}
"""

JS = """
const stage=document.getElementById('stage'),canvas=document.getElementById('canvas'),
      crumb=document.getElementById('crumb'),zoomLbl=document.getElementById('zoom'),
      codePane=document.getElementById('codepane'),legendPane=document.getElementById('legendpane'),
      filter=document.getElementById('filter'),backButton=document.getElementById('back'),
      mini=document.getElementById('minimap'),pinLbl=document.getElementById('pin');
let view={x:0,y:0,k:1},cur=null,graphCur=null,SVG={},SRC=null,hotId=null,moved=false,down=null;
/* The zoom at which the drawing stops being a shape and becomes a text: a 14.5px title
   draws at 7px below it, which is a mark, not a word. */
const FAR=0.5;
let pinId=null,peerAt=-1,jumped=[];
const visits=[],visitSession=Date.now()+'-'+Math.random();
let visitAt=-1,showVersion=0,sourceVersion=0;
let liveFreshness=null;
function freshnessMessage(now=Date.now()){
  if(DESIGN)return {warning:'AUTHORED · conformance unchecked',source:'Source snapshot captured at build · check the design to verify freshness'};
  const status=liveFreshness,checked=status&&Date.parse(status.checkedAt);
  if(!status||!Number.isFinite(checked)||now<checked||now-checked>Math.min(status.validForMs||0,10000))
    return {warning:'Live freshness unavailable',source:'Snapshot source · live freshness unavailable'};
  if(status.snapshotId!==SNAPSHOT_ID)
    return {warning:'Map generation changed; waiting for its drawing',source:'Previous snapshot source · generation changed'};
  if(status.state==='current')return {warning:'',source:'Snapshot source · current with checked code'};
  if(status.state==='stale'){
    const instruction='regenerate '+(status.stale?.regenerate||'0');
    return {warning:'STALE · '+instruction,source:'STALE snapshot source · '+instruction};
  }
  return {warning:'Freshness '+status.state+' · snapshot remains readable',source:'Snapshot source · freshness '+status.state};
}
function updateFreshness(){
  const message=freshnessMessage(),drawn=PAGES[cur]?.x;
  document.getElementById('freshness-status').textContent=message.warning||'Live check: current with the code.';
  document.getElementById('stale').textContent=message.warning||(drawn?'Stale at drawing time; live check is current':'');
  const sourceStatus=document.getElementById('source-freshness');
  if(sourceStatus)sourceStatus.textContent=message.source;
}
function freshnessAt(status){liveFreshness=status;updateFreshness();}
function pollFreshness(){
  updateFreshness();
  if(DESIGN)return;
  const script=document.createElement('script');script.src='freshness.js?'+Date.now();
  script.onload=script.onerror=()=>{script.remove();updateFreshness();};document.head.appendChild(script);
}
function remember(entry,push){
  if(JSON.stringify(visits[visitAt])===JSON.stringify(entry))return;
  visits.splice(visitAt+1);visits.push(entry);visitAt=visits.length-1;
  const paths=[];for(let k=entry.key;k!=null&&PAGES[k];k=PAGES[k].p)paths.push(PAGES[k].d);
  const state={mapSession:visitSession,mapVisit:visitAt,mapKey:entry.key,mapPaths:paths};
  history[push===false?'replaceState':'pushState'](state,'','#'+entry.key);
  backButton.disabled=visitAt<=0;
}
function goBack(){if(visitAt>0)history.back();}
function svgAt(k,v){SVG[k]=v;}
const LINKS={};
function srcAll(v){SRC=v;}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function apply(){canvas.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.k})`;
  zoomLbl.textContent=Math.round(view.k*100)+'%';
  canvas.classList.toggle('far',view.k<FAR);
  const box=document.getElementById('mv');
  if(box){const r=stage.getBoundingClientRect();
    box.setAttribute('x',(-view.x/view.k).toFixed(1));box.setAttribute('y',(-view.y/view.k).toFixed(1));
    box.setAttribute('width',(r.width/view.k).toFixed(1));box.setAttribute('height',(r.height/view.k).toFixed(1));}}

/* -- where am I: the whole page in the corner, with this screen drawn on it ---------- */
/* The minimap folds away and stays folded across maps and reloads. */
function toggleMinimap(){const off=document.body.classList.toggle('nomini');
  try{localStorage.setItem('devmap-minimap',off?'off':'on');}catch(e){}}
try{if(localStorage.getItem('devmap-minimap')==='off')document.body.classList.add('nomini');}catch(e){}
/* A box's rectangle where it stands now: its drawn rect, plus the move an authored placement made. */
function rectOf(g){const r=g.querySelector('rect');if(!r)return null;
  const m=g.transform?.baseVal?.numberOfItems?g.transform.baseVal.consolidate().matrix:null;
  return {x:r.x.baseVal.value+(m?m.e:0),y:r.y.baseVal.value+(m?m.f:0),w:r.width.baseVal.value,h:r.height.baseVal.value};}
function minimap(){const s=canvas.querySelector(':scope>svg');
  if(!s){mini.style.display='none';return;}
  const w=s.width.baseVal.value,h=s.height.baseVal.value;
  let body='';
  for(const g of canvas.querySelectorAll('.fm-node')){const r=rectOf(g);if(!r)continue;
    body+=`<rect x="${r.x.toFixed(0)}" y="${r.y.toFixed(0)}" `+
          `width="${r.w.toFixed(0)}" height="${r.h.toFixed(0)}" fill="#64748b"/>`;}
  mini.innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="200" height="132">${body}`+
    `<rect id="mv" fill="#0284c7" fill-opacity="0.14" stroke="#0284c7" stroke-width="${(w/200*1.6).toFixed(1)}"/></svg>`;
  mini.style.display='block';apply();}
function at(ux,uy){const r=stage.getBoundingClientRect();
  view.x=r.width/2-ux*view.k;view.y=r.height/2-uy*view.k;apply();}
mini.addEventListener('pointerdown',e=>{const s=mini.firstElementChild,d=canvas.firstElementChild;
  if(!s||!d)return;e.stopPropagation();
  const b=s.getBoundingClientRect(),w=d.width.baseVal.value,h=d.height.baseVal.value,
        k=Math.min(b.width/w,b.height/h);
  at((e.clientX-b.left-(b.width-w*k)/2)/k,(e.clientY-b.top-(b.height-h*k)/2)/k);});
function fit(){const s=canvas.querySelector(':scope>svg');if(!s)return;
  const w=s.width.baseVal.value,h=s.height.baseVal.value,r=stage.getBoundingClientRect();
  /* Never zero or negative: a stage narrower than its own padding would otherwise fold the
     page inside out, and the drawing would be gone rather than small. */
  view.k=Math.max(0.02,Math.min(Math.min((r.width-48)/w,(r.height-48)/h),1));
  view.x=(r.width-w*view.k)/2;view.y=Math.max(18,(r.height-h*view.k)/2);apply();}
function actual(){const s=canvas.querySelector(':scope>svg');if(!s)return;const r=stage.getBoundingClientRect();
  view.k=1;view.x=(r.width-s.width.baseVal.value)/2;view.y=18;apply();}
function overview(){const bounds=PAGES[cur]?.focus;if(!bounds)return fit();
  const [x,y,w,h]=bounds,r=stage.getBoundingClientRect();
  view.k=Math.max(.02,Math.min((r.width-48)/w,(r.height-48)/h,1));
  view.x=(r.width-w*view.k)/2-x*view.k;view.y=18-y*view.k;apply();}

/* One page's drawing at a time, fetched as a script so the viewer opens from file:// with no
   server. The whole map inlined is an order of magnitude more bytes on every open. */
function load(key,then){if(PAGES[key]?.destination==='contents'||SVG[key]!==undefined)return then();
  const s=document.createElement('script');s.src='svg/'+key+'.js?'+encodeURIComponent(BUILT);
  s.onload=()=>then();s.onerror=()=>{SVG[key]=null;then();};document.head.appendChild(s);}

/* The scorer's reading of this map (dev-map/lib/score.mjs): each part a penalty, 0 when ideal. */
function showScore(s){const el=document.getElementById('score');if(!s){el.innerHTML='';return;}
  const part=(name,v,what)=>`<span class="${v>0?'bad':''}">${name} ${v>0?'-'+v.toFixed(2):'0'}</span> (${what})`;
  el.innerHTML=`<b>Score ${s.score>0?'-'+s.score.toFixed(2):'0'}</b> · `+[
    part('size',s.badness.size,`${s.nodes} boxes`),
    part('edge',s.badness.edge,`${s.edge.boundary} boundary, ${s.edge.externals} external`),
    part('hubs',s.badness.hubs,`most wires ${s.hubs.max}, mean ${s.hubs.mean}`),
    part('islands',s.badness.islands,`${s.islands} island${s.islands===1?'':'s'}`),
    part('backflow',s.badness.backflow,`${s.backflow.links} of ${s.backflow.of} backward`),
    part('balance',s.badness.balance,'')].join(' · ');}
function trail(key){const out=[];let k=key;
  while(k!==null&&k!==undefined&&PAGES[k]){out.unshift(k);k=PAGES[k].p;}
  return out.map((k,i)=>i===out.length-1?`<b>${esc(PAGES[k].t)}</b> — ${esc(PAGES[k].s)}`
    :`<span class="up" data-go="${k}">${esc(PAGES[k].t)}</span>`).join(' &rsaquo; ');}

function contents(p){
  const item=c=>`<li><button class="${c.internal?'':'external'}" data-go="${esc(c.index)}">${esc(c.index)} ${esc(c.label)}</button>`+
    (c.description?`<small>${esc(c.description)}</small>`:'')+'</li>';
  const groups=[['Internal operations',true],['External boundaries',false]].map(([label,inside])=>{
    const rows=(p.components??[]).filter(c=>c.internal===inside);return rows.length?`<h3>${label}</h3><ul>${rows.map(item).join('')}</ul>`:'';}).join('');
  const wires=(p.contracts??[]).map(w=>`<li><button data-a="${esc(w.from)}" data-b="${esc(w.to)}">${esc(p.componentLabels[w.from]??w.from)} → ${esc(p.componentLabels[w.to]??w.to)}</button></li>`).join('');
  return `<section class="map-contents"><h2>${esc(p.t)}</h2>${groups}${wires?'<h3>Interfaces</h3><ul>'+wires+'</ul>':''}</section>`;
}
function show(key,push,restore){const p=PAGES[key];if(!p)return false;
  if(p.aliasOf)return show(p.aliasOf,push);
  if(p.destination==='code'&&graphCur){openCode(p.r,key);return true;}
  const version=++showVersion;
  // Opening another map closes the code a leaf had open.
  if(p.destination!=='code')closeCode();
  let drawing=restore?restore.graph:(p.destination==='code'&&graphCur?graphCur:key);
  while(PAGES[drawing]&&PAGES[drawing].destination==='code')drawing=PAGES[drawing].p;
  load(drawing,()=>{if(version!==showVersion)return;
    const listing=PAGES[drawing].destination==='contents';
    canvas.classList.toggle('contents',listing);
    canvas.innerHTML=listing?contents(PAGES[drawing]):SVG[drawing]||'';cur=drawing;graphCur=drawing;pinId=null;jumped=[];hot(null);highlightWire(null);
    if(listing)zoomLbl.textContent='';
    canvas.classList.toggle('authored',!!PAGES[drawing].focus);
    canvas.classList.toggle('design',DESIGN);canvas.classList.toggle('wires',DESIGN||!!PAGES[drawing].links);
    if(PAGES[drawing].links)wireHits();
    if(AUTHORING)authorShow();
    document.getElementById('fit-all').hidden=!PAGES[drawing].focus;
    crumb.innerHTML=trail(drawing);showScore(PAGES[drawing].sc);
    const mapped=PAGES[drawing];
    updateFreshness();
    reveal(drawing);paint();
    document.querySelectorAll('#tree a.on').forEach(a=>a.classList.remove('on'));
    const row=document.querySelector(`#tree a[data-key="${CSS.escape(drawing)}"]`);
    if(row){row.classList.add('on');row.scrollIntoView({block:'nearest'});}
    overview();requestAnimationFrame(overview);minimap();
    const entry=restore||{key:drawing,graph:drawing};
    if(!restore)remember(entry,push);
    backButton.disabled=visitAt<=0;
    if(p.destination==='code'){if(key!==drawing)hot(key);openCode(p.r,key);}});
  return true;}

/* -- focus: the box, every wire touching it, and what those wires reach -------------
   Dimming the rest is the point: on a page of two hundred boxes, thickening a wire says
   nothing unless everything it is not goes quiet. */
function node(id){return id?canvas.querySelector(`.fm-node[data-id="${CSS.escape(id)}"]`):null;}
function peers(id){const out=[];
  for(const el of canvas.querySelectorAll(`.fm-edge[data-a="${CSS.escape(id)}"],.fm-edge[data-b="${CSS.escape(id)}"]`)){
    const other=el.dataset.a===id?el.dataset.b:el.dataset.a;
    if(other&&other!==id&&!out.includes(other))out.push(other);}
  return out;}
function hot(id){if(id===hotId)return;
  canvas.querySelectorAll('.hot,.peer,.sel,.at').forEach(el=>el.classList.remove('hot','peer','sel','at'));
  hotId=id;peerAt=-1;canvas.classList.toggle('focus',!!id);
  if(!id){pinLbl.style.display='none';return;}
  canvas.querySelectorAll(`[data-a="${CSS.escape(id)}"],[data-b="${CSS.escape(id)}"]`)
    .forEach(el=>el.classList.add('hot'));
  const me=node(id);if(me)me.classList.add('sel');
  const near=peers(id);
  for(const other of near){const g=node(other);if(g)g.classList.add('peer');}
  if(pinId===id){pinLbl.style.display='block';
    pinLbl.innerHTML=`<b>${esc(me?me.dataset.label:id)}</b> · ${near.length} connected · ] [ to walk them`;}
  else pinLbl.style.display='none';}
function centre(id){const g=node(id);if(!g)return;const r=rectOf(g);if(!r)return;
  at(r.x+r.w/2,r.y+r.h/2);}
/* Stand at the other end of a wire, and be able to come back. */
function standAt(id){if(!node(id))return;
  if(pinId&&pinId!==id)jumped.push(pinId);
  pinId=id;hot(null);hot(id);centre(id);}
function walk(step){const from=pinId||hotId;if(!from)return;
  const near=peers(from);if(!near.length)return;
  peerAt=(peerAt+step+near.length*2)%near.length;
  canvas.querySelectorAll('.at').forEach(el=>el.classList.remove('at'));
  const g=node(near[peerAt]);if(g)g.classList.add('at');
  centre(near[peerAt]);}
function highlightWire(edge){
  canvas.querySelectorAll('.wire-hot,.wire-end').forEach(w=>w.classList.remove('wire-hot','wire-end'));
  canvas.classList.toggle('wire-focus',!!edge);
  if(!edge)return;
  const {a,b}=edge.dataset;
  canvas.querySelectorAll(`[data-a="${CSS.escape(a)}"][data-b="${CSS.escape(b)}"]`)
    .forEach(w=>w.classList.add('wire-hot'));
  for(const id of [a,b])node(id)?.classList.add('wire-end');
}
stage.addEventListener('pointerover',e=>{
  const el=document.elementFromPoint(e.clientX,e.clientY),g=el&&el.closest('.fm-node');
  const edge=(DESIGN||PAGES[cur]?.links)&&el?.closest('.fm-edge,.fm-elab,.fm-wire-hit');
  hot(edge?null:pinId??g?.dataset.id??null);
  highlightWire(edge);});
stage.addEventListener('pointerleave',()=>{highlightWire(null);hot(pinId);});
stage.addEventListener('focusin',e=>{
  const edge=e.target.closest('.fm-wire-hit');
  if(edge){hot(null);highlightWire(edge);}
});
stage.addEventListener('focusout',e=>{if(e.target.closest('.fm-wire-hit')){highlightWire(null);hot(pinId);}});
stage.addEventListener('keydown',e=>{
  const edge=e.target.closest('.fm-wire-hit');
  if(edge&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openWire(edge.dataset.a,edge.dataset.b);}
});

/* -- pan / zoom ------------------------------------------------------------ */
stage.addEventListener('wheel',e=>{if(e.target.closest('#codepane,#legendpane,.map-contents'))return;e.preventDefault();
  const r=stage.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,
        nk=Math.min(8,Math.max(.02,view.k*Math.exp(-e.deltaY*.0015)));
  view.x=mx-(mx-view.x)*(nk/view.k);view.y=my-(my-view.y)*(nk/view.k);view.k=nk;apply();},
  {passive:false});
stage.addEventListener('pointerdown',e=>{if(e.target.closest('#codepane,#legendpane,.map-contents')){moved=false;return;}
  /* Arranging, a box under the pointer is picked up instead of the page (authorGrab). */
  if(AUTHORING&&authorGrab(e)){moved=false;stage.setPointerCapture(e.pointerId);return;}
  down={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};
  moved=false;stage.setPointerCapture(e.pointerId);stage.classList.add('drag');});
stage.addEventListener('pointermove',e=>{if(AUTHORING&&AUTHOR.drag){authorMove(e);return;}if(!down)return;
  const dx=e.clientX-down.x,dy=e.clientY-down.y;
  if(Math.abs(dx)+Math.abs(dy)>4)moved=true;
  view.x=down.vx+dx;view.y=down.vy+dy;apply();});
stage.addEventListener('pointerup',()=>{if(AUTHORING&&AUTHOR.drag)authorDrop();down=null;stage.classList.remove('drag');});

/* A captured pointer retargets the click to #stage, so the mark under the cursor is
   hit-tested rather than read off the event. */
stage.addEventListener('click',e=>{if(e.target.closest('#codepane,#legendpane')||moved)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);if(!el)return;
  if(el.closest('.fm-caller-unresolved'))return;
  /* A long wire is drawn as its two ends; its end tag names the other end and is the way
     to go and stand there. */
  const jump=el.closest('.fm-endtag[data-jump]');
  if(jump){standAt(jump.dataset.jump);return;}
  const edge=el.closest('[data-a][data-b]');
  if(edge&&(DESIGN||PAGES[cur]?.links)){openWire(edge.dataset.a,edge.dataset.b);return;}
  const list=el.closest('.fm-list');
  if(list){openList(list.dataset.list);return;}
  const src=el.closest('.fm-src');
  if(src){const target=PAGES[src.dataset.key];
    if(target&&target.destination==='code')show(src.dataset.key);else openCode(src.dataset.ref);return;}
  const go=el.closest('[data-go]');
  if(go&&go.dataset.go&&PAGES[go.dataset.go]){show(go.dataset.go);return;}
  const sourceNode=el.closest('.fm-node[data-ref]');
  if(sourceNode){openCode(sourceNode.dataset.ref);return;}
  const external=el.closest('.fm-node[data-id]');
  const details=external&&PAGES[cur]?.externals?.[external.dataset.id];
  if(details){openExternal(details,PAGES[cur]?.externalConnections?.[external.dataset.id]??[]);return;}
  dismissCode();});
document.addEventListener('click',e=>{
  const leafEnd=e.target.closest('#codepane [data-ref]');
  if(leafEnd){openCode(leafEnd.dataset.ref,PAGES[leafEnd.dataset.key]?leafEnd.dataset.key:null);return;}
  const evidence=e.target.closest('#codepane [data-go]');
  if(evidence&&PAGES[evidence.dataset.go]){dismissCode();show(evidence.dataset.go);return;}
  const tw=e.target.closest('#tree .tw');
  if(tw){const k=tw.parentElement.dataset.key;collapsed.has(k)?collapsed.delete(k):collapsed.add(k);paint();return;}
  const go=e.target.closest('#bar [data-go],#tree [data-go]');
  if(go&&PAGES[go.dataset.go])show(go.dataset.go);});

/* -- the index: a tree of pages, closed below the top map until a page is opened -- */
const ROWS=[...document.querySelectorAll('#tree a')];
const collapsed=new Set(ROWS.filter(a=>a.querySelector('.tw')&&a.dataset.key!=='0').map(a=>a.dataset.key));
function reveal(key){collapsed.delete(key);
  for(let p=PAGES[key]&&PAGES[key].p;p!=null&&PAGES[p];p=PAGES[p].p)collapsed.delete(p);}

/* Resolve saved navigation by declaration identity: numeric indexes can be reassigned.
   If that declaration disappeared, use its nearest surviving parent. */
function navigationKey(state,hash){
  if(state?.mapKey===hash&&state.mapPaths){
    for(const path of state.mapPaths){const key=Object.keys(PAGES).find(k=>PAGES[k].d===path);if(key)return key;}
    return '0';
  }
  return PAGES[hash]?hash:'0';
}
/* Every build writes a new stamp. The reload follows the declaration, not its old index.
   A script tag keeps this working from file:// as well. */
function stampAt(v){if(v!==BUILT)location.reload();}
setInterval(()=>{const s=document.createElement('script');s.src='stamp.js?'+Date.now();
  s.onload=s.onerror=()=>s.remove();document.head.appendChild(s);},3000);
pollFreshness();setInterval(pollFreshness,3000);
function shut(key){for(let p=PAGES[key].p;p!=null&&PAGES[p];p=PAGES[p].p)if(collapsed.has(p))return true;return false;}
function paint(){const q=filter.value.trim().toLowerCase();
  for(const a of ROWS){const k=a.dataset.key;
    a.classList.toggle('hide',q?!a.dataset.find.includes(q):shut(k));
    a.classList.toggle('open',!collapsed.has(k));}}

/* -- the code pane: matching generated source ---------------------------- */
function need(then){if(SRC)return then();
  const s=document.createElement('script');s.src='sources.js'+'?'+encodeURIComponent(BUILT);
  s.onload=()=>then();s.onerror=()=>{SRC={};then();};document.head.appendChild(s);}
function closeCode(){sourceVersion++;codePane.classList.remove('on');codePane.innerHTML='';}
function dismissCode(){closeCode();}
function openExternal(details,connections){closeCode();legendPane.classList.remove('on');
  const describe=path=>connections.filter(c=>c.external===path).map(c=>{
    const inside=c.from.startsWith('external:')?c.to:c.from, direction=c.from===inside?'uses':'called / reached by';
    return `${esc(PAGES[inside]?.t??inside)} · ${direction} · ${esc(c.kind)}${c.count>1?' ×'+c.count:''}`;
  }).join('<br>');
  codePane.innerHTML=`<div class="ch"><span class="x" onclick="dismissCode()">&times;</span>`+
    `<h3>${details.length} external dependencies</h3><p>Grouped for navigation. Every declaration and its calculated connections are retained below.</p></div>`+
    `<div class="cb">${details.map(path=>`<p>${esc(path)}<br><small>${describe(path)}</small></p>`).join('')}</div>`;
  codePane.classList.add('on');}
/* A list the drawing counts but cannot show. A drawn leaf opens on its map; another opens its source. */
function openList(name){const list=LISTS[name];if(!list)return;closeCode();legendPane.classList.remove('on');
  codePane.innerHTML=`<div class="ch"><span class="x" onclick="dismissCode()">&times;</span>`+
    `<h3>${esc(list.title)}</h3></div><div class="cb list">`+list.items.map((it,i)=>
      `<button data-item="${i}"><b>${esc(it.t)}</b> <span>${esc(it.ref??'')}${it.n?(it.ref?' · ':'')+esc(it.n):''}</span></button>`).join('')+`</div>`;
  codePane.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{const it=list.items[+b.dataset.item];
    if(it.go&&PAGES[it.go]){graphCur=null;show(it.go);}else if(it.ref)openCode(it.ref);});
  codePane.classList.add('on');}
function openCode(ref,key){const cut=ref.lastIndexOf(':'),file=ref.slice(0,cut),
        span=ref.slice(cut+1).split('-'),a=+span[0],b=+span[1];
  const version=++sourceVersion;
  legendPane.classList.remove('on');
  need(()=>{if(version!==sourceVersion)return;const text=SRC[file];
    let body=`<p class="note">no matching source for ${esc(file)} in this build · run regenerate 0</p>`;
    if(text!==undefined){const lines=text.split('\\n').slice(a-1,b);let rows='';
      for(let i=0;i<lines.length;i++)rows+=`<span class="ln">${a+i}</span>${esc(lines[i])}\\n`;
      body=`<pre>${rows}</pre>`;}
    const page=key&&PAGES[key];
    for(const helper of page?.foldedCode??[]){
      const source=SRC[helper.file];
      body+=`<h3>Folded helper · ${esc(helper.path)}</h3>`;
      if(source===undefined)body+=`<p>Matching source unavailable</p>`;
      else {const lines=source.split('\\n').slice(helper.line-1,helper.endLine);let rows='';
        for(let i=0;i<lines.length;i++)rows+=`<span class="ln">${helper.line+i}</span>${esc(lines[i])}\\n`;
        body+=`<pre>${rows}</pre>`;}
    }
    const paint=()=>{if(version!==sourceVersion)return;
      codePane.innerHTML=`<div class="ch"><span class="x" onclick="dismissCode()">&times;</span>`+
        `<div class="num">${page?esc(page.t)+' · ':''}${esc(file)}</div><h3>lines ${a}–${b}</h3>`+
        `<div id="source-freshness">${esc(freshnessMessage().source)}</div>`+
        `<button onclick="copy('${esc(file)}:${a}')">Copy path:line</button></div>`+
        `<div class="cb">${body}</div>`;
      codePane.classList.add('on');};
    paint();});}
function openContracts(from,to){
  const links=(PAGES[cur]?.contracts??[]).filter(w=>w.from===from&&w.to===to||w.from===to&&w.to===from);
  const contracts=links.flatMap(w=>w.contracts);
  if(!contracts.length)return;
  const name=index=>PAGES[index]?.t??PAGES[cur]?.componentLabels?.[index]??index;
  const endpoint=index=>PAGES[index]?`<button class="endpoint" data-go="${esc(index)}">${esc(name(index))}</button>`:esc(name(index));
  closeCode();legendPane.classList.remove('on');
  const version=sourceVersion;
  need(()=>{if(version!==sourceVersion)return;
  const entry=e=>{
    if(e.unavailable)return `<p class="note">${esc(e.target)} · ${esc(e.unavailable)}</p>`;
    const source=SRC[e.file]?.split('\\n').slice(e.line-1,e.endLine).join('\\n');
    return `<article class="entry"><h4>${esc(e.name)}</h4><pre>${esc(e.signature)}</pre>`+
      (e.returns.length?`<div class="interface-id">Returns</div>`+e.returns.map(r=>`<pre>${esc(r)}</pre>`).join(''):'')+
      `<details><summary>Implementation · ${esc(e.file)}:${e.line}–${e.endLine}</summary><pre>${esc(source??'Source unavailable in this build.')}</pre></details></article>`;
  };
  codePane.innerHTML=`<div class="ch"><button class="x" onclick="dismissCode()" aria-label="Close interfaces">&times;</button>`+
    `<div class="num">${contracts.length===1?'Interface':`Interface set · ${contracts.length} interfaces`}</div>`+
    `<h3>${esc(name(from))} ${links.some(w=>w.from===to)?'↔':'→'} ${esc(name(to))}</h3><div class="interface-id">${links.map(w=>esc(w.address)).join(' · ')}</div></div>`+
    '<div class="cb interfaces">'+contracts.map(c=>`<section class="interface"><h3>${esc(c.label)}</h3><div class="interface-id">${esc(c.id)}</div>`+
      `<p>${endpoint(c.fromIndex)} → ${endpoint(c.toIndex)}</p>`+
      ((c.code??[]).length?c.code.map(entry).join(''):'<p class="note">No code entry is bound to this wire.</p>')+
      '</section>').join('')+'</div>';
  codePane.classList.add('on');});
}
/* An influence drawing ships its arrows bare; each gets the wide transparent hit path a design
   wire is drawn with, here rather than in every sidecar, so it can be clicked and focused. The
   hits sit above every arrow, the shortest on top: where wires share a run into a box, the
   short one would otherwise lie wholly under a long one and could never be picked. */
function wireHits(){const edges=[...canvas.querySelectorAll('.fm-edge[data-a][data-b]')];if(!edges.length)return;
  const hits=edges.map(edge=>{const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
    hit.setAttribute('class','fm-wire-hit');hit.setAttribute('d',edge.getAttribute('d'));
    hit.dataset.a=edge.dataset.a;hit.dataset.b=edge.dataset.b;
    for(const [k,v] of [['fill','none'],['stroke','transparent'],['stroke-width','14'],['vector-effect','non-scaling-stroke'],
      ['pointer-events','stroke'],['tabindex','0'],['role','button'],['aria-label',`Open leaf arrows: ${edge.dataset.a} → ${edge.dataset.b}`]])hit.setAttribute(k,v);
    return [edge.getTotalLength(),hit];}).sort((x,y)=>y[0]-x[0]);
  edges[edges.length-1].after(...hits.map(([,hit])=>hit));}
function openWire(a,b){if(DESIGN)openContracts(a,b);else openLeafArrows(a,b);}
/* An influence arrow's leaf arrows, as the agent link read @link/MAP/FROM/TO gives them (both
   come from solved-set.mjs: viewerLinks and linkRead share linkGroups and leafArrowParts):
   grouped by box direction, each `FROM → TO kind ×N`. A leaf end opens its source; a box opens
   its map. A page's leaf arrows load on first use from svg/<page>.links.js. */
function loadLinks(key,then){if(LINKS[key]!==undefined)return then();
  const s=document.createElement('script');s.src='svg/'+key+'.links.js?'+encodeURIComponent(BUILT);
  s.onload=()=>then();s.onerror=()=>{LINKS[key]=null;then();};document.head.appendChild(s);}
function linksAt(k,v){LINKS[k]=v;}
function openLeafArrows(from,to){const key=cur;closeCode();const version=sourceVersion;
  loadLinks(key,()=>{if(version!==sourceVersion||key!==cur)return;
    const data=LINKS[key],groups=data?.wires[from+'/'+to]??data?.wires[to+'/'+from];if(!groups)return;
    const box=i=>{const k=i.startsWith('b:')?i.slice(2):i,t=esc(PAGES[k]?.t??i),b=i.startsWith('b:')?'boundary · ':'';
      return PAGES[k]?`<button class="endpoint" data-go="${esc(k)}">${b}${t}</button>`:b+t;};
    const end=n=>{const [name,ref,go]=data.leaves[n];
      return ref?`<button class="endpoint" data-ref="${esc(ref)}" data-key="${esc(go)}">${esc(name)}</button>`:esc(name);};
    const total=groups.reduce((t,[,l])=>t+l.length,0);
    legendPane.classList.remove('on');
    codePane.innerHTML=`<div class="ch"><button class="x" onclick="dismissCode()" aria-label="Close leaf arrows">&times;</button>`+
      `<div class="num">@link/${esc(key)}/${esc(from)}/${esc(to)} · ${total} leaf arrow${total===1?'':'s'}</div>`+
      `<h3>${box(from)} ${groups.length>1?'↔':'→'} ${box(to)}</h3></div><div class="cb leafarrows">`+
      groups.map(([dir,list])=>{const [x,y]=dir.split(' → ');
        return `<section class="leafdir"><h3>${box(x)} → ${box(y)} · ${list.length}</h3><ul>`+
          list.map(([f,t,tail])=>`<li>${end(f)} → ${end(t)} <span class="tail">${esc(tail)}</span></li>`).join('')+'</ul></section>';}).join('')+'</div>';
    codePane.classList.add('on');});}
function pageCode(){const p=PAGES[cur];if(p&&p.r)openCode(p.r,p.destination==='code'?cur:null);}
function copy(t){navigator.clipboard.writeText(t);}

function toggleLegend(){dismissCode();legendPane.classList.toggle('on');}

/* -- search: an index, or a substring of a declaration path ---------------- */
filter.addEventListener('input',paint);
filter.addEventListener('keydown',e=>{if(e.key!=='Enter')return;
  const q=filter.value.trim();
  if(PAGES[q]){show(q);return;}
  const exact=Object.keys(PAGES).find(k=>PAGES[k].d===q);
  if(exact){show(exact);return;}
  const hit=document.querySelector('#tree a:not(.hide)');if(hit){show(hit.dataset.key);return;}
  /* A leaf has no row of its own: it opens as a box on the map that homes it. */
  const leaf=Object.keys(PAGES).find(k=>PAGES[k].find.toLowerCase().includes(q.toLowerCase()));
  if(leaf)show(leaf);});

addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();dismissCode();legendPane.classList.remove('on');
    if(pinId){pinId=null;jumped=[];hot(null);}return;}
  if(e.target===filter||e.target.closest('input,textarea,[contenteditable="true"]')||!cur)return;
  if(e.key==='f')fit();
  if(e.key==='0')actual();
  /* Focus, and walking out of it: pin what is under the cursor, step along its wires, come
     back to the box -- or back to the box a wire's end tag was clicked from. */
  if(e.key==='x'){if(pinId){pinId=null;jumped=[];hot(null);}else if(hotId)standAt(hotId);}
  if(e.key===']'){e.preventDefault();walk(1);}
  if(e.key==='['){e.preventDefault();walk(-1);}
  if(e.key==='\\\\'){e.preventDefault();
    if(peerAt>=0){peerAt=-1;canvas.querySelectorAll('.at').forEach(el=>el.classList.remove('at'));
      if(pinId)centre(pinId);}
    else if(jumped.length){const back=jumped.pop();pinId=null;standAt(back);}}
  if(e.key==='Backspace'){e.preventDefault();goBack();}
  if(e.key==='u'&&PAGES[cur].p)show(PAGES[cur].p);});
addEventListener('popstate',e=>{
  if(e.state&&e.state.mapSession===visitSession&&visits[e.state.mapVisit]){
    visitAt=e.state.mapVisit;const entry=visits[visitAt];show(entry.key,false,entry);
  }else show(navigationKey(e.state,location.hash.slice(1)),false);});
addEventListener('load',overview);addEventListener('resize',overview);
show(navigationKey(history.state,location.hash.slice(1)),false);
"""


AUTHOR_JS = """

/* -- authored placement (plans/dev-maps.md milestone 5) ------------------------------------
   Arranging, any box can be dragged: the wires touching it are re-routed as it moves
   (directRoutes draws the curves leveled.py direct_routes draws) and every other box
   stays put. A drop is saved at once, by box identity (data-ident), never by index: through
   the authoring server (`node dev-map/cli.mjs --set NAME serve`) into the committed layout
   files, or, opened any other way, into this browser's storage, which Export layout writes
   out for `node dev-map/cli.mjs --set NAME import-layout FILE`. */
const AUTHOR={server:false,on:false,maps:{},undo:[],first:{},at:{},drag:null};
const AUTHOR_STORE='devmap-layout:'+AUTHORING.set;
function authorSay(text,bad){const s=document.getElementById('author-status');s.textContent=text;s.classList.toggle('bad',!!bad);}
function authorCount(){return Object.values(AUTHOR.maps).reduce((t,m)=>t+Object.keys(m).length,0);}
function authorBar(){const on=AUTHOR.on;document.getElementById('arrange').classList.toggle('on',on);
  for(const id of ['author-undo','author-reset'])document.getElementById(id).hidden=!on;
  document.getElementById('author-export').hidden=!on||AUTHOR.server;canvas.classList.toggle('arrange',on);}
function arrange(){AUTHOR.on=!AUTHOR.on;authorBar();}
function drawnBox(g){const [x,y,w,h,bh,rx]=g.dataset.box.split(',').map(Number);return {x,y,w,h,bh,rx:Number.isFinite(rx)?rx:Math.min(7,w/2,bh/2)};}
function geom(id){const g=node(id);if(!g||!g.dataset.box)return null;const b=drawnBox(g),p=AUTHOR.at[id];
  const x=p?p.x:b.x,y=p?p.y:b.y;return {x,y,w:b.w,h:b.h,cx:x+b.w/2,cy:y+b.bh/2};}
/* leveled.py spread and direct_routes, line for line: each end of a direct wire meets its box
   where it faces the other end, the ends on one side spread along it in the order they face. */
const PORT_GAP=12,BEND_MIN=16,PORT_ADJ={L:['T','B'],R:['T','B'],T:['L','R'],B:['L','R']};
const portSpan=(N,side)=>side==='L'||side==='R'?[N.y,N.y+N.h]:[N.x,N.x+N.w];
function portRoom(N,side){const [s0,s1]=portSpan(N,side),free=s1-s0-2*(2+0.35*N.rx);return free<0?1:Math.floor(free/PORT_GAP)+1;}
function spread(ts,lo,hi,gap){const n=ts.length;if(!n)return [];
  if(hi<lo)return ts.map(()=>(lo+hi)/2);
  if(n>1&&(n-1)*gap>hi-lo)return ts.map((_,i)=>lo+(hi-lo)*i/(n-1));
  const runs=[];
  ts.forEach((t,i)=>{let run=[i,1,t],last;
    while(runs.length&&(last=runs[runs.length-1])[2]/last[1]+last[1]*gap>run[2]/run[1]){const p=runs.pop();run=[p[0],p[1]+run[1],p[2]+run[2]-run[1]*p[1]*gap];}
    runs.push(run);});
  const out=[];
  for(const [,count,total] of runs){const at=Math.min(Math.max(total/count,lo),hi-(count-1)*gap);for(let j=0;j<count;j++)out.push(at+j*gap);}
  for(let i=1;i<n;i++)out[i]=Math.max(out[i],out[i-1]+gap);
  out[n-1]=Math.min(out[n-1],hi);
  for(let i=n-2;i>=0;i--)out[i]=Math.min(out[i],out[i+1]-gap);
  return out;}
function bezierAt(p,t){const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;
  return [a*p[0][0]+b*p[1][0]+c*p[2][0]+d*p[3][0],a*p[0][1]+b*p[1][1]+c*p[2][1]+d*p[3][1]];}
function directRoutes(boxes,wires){const ends=new Map(),order=[],lr=s=>s==='L'||s==='R';
  const group=(id,side)=>{const key=JSON.stringify([id,side]);return (ends.get(key)??ends.set(key,{id,side,g:[]}).get(key)).g;};
  wires.forEach(([a,b],k)=>{[[a,boxes[a],boxes[b]],[b,boxes[b],boxes[a]]].forEach(([id,N,F],end)=>{
    const ncx=N.x+N.w/2,ncy=N.y+N.h/2,ux=F.x+F.w/2-ncx,uy=F.y+F.h/2-ncy;let side,t;
    if(Math.abs(uy)*(N.w/2)>Math.abs(ux)*(N.h/2)){side=uy>0?'B':'T';t=ncx+ux*(N.h/2)/Math.abs(uy);}
    else{side=ux>=0?'R':'L';t=ncy+uy*(N.w/2)/Math.max(Math.abs(ux),1e-6);}
    if(!order.includes(id))order.push(id);
    group(id,side).push([t,k,end]);});});
  const byPlace=(p,q)=>p[0]-q[0]||p[1]-q[1]||p[2]-q[2];
  for(const id of order){const N=boxes[id];let moved=0;
    for(const side of ['L','R','T','B']){const key=JSON.stringify([id,side]);if(!ends.has(key)||!ends.get(key).g.length)continue;
      const g=ends.get(key).g;g.sort(byPlace);const [s0,s1]=portSpan(N,side),mid=(s0+s1)/2;
      while(g.length>portRoom(N,side)){
        const tries=[[mid-g[0][0],0,PORT_ADJ[side][0]],[g[g.length-1][0]-mid,1,PORT_ADJ[side][1]]];
        if(tries[1][0]>tries[0][0])tries.reverse();
        let done=false;
        for(const [,high,to] of tries){const there=group(id,to);
          if(there.length<portRoom(N,to)){const [,k,end]=high?g.pop():g.shift();moved++;
            const t=lr(side)?(side==='L'?N.x-moved:N.x+N.w+moved):(side==='T'?N.y-moved:N.y+N.h+moved);
            there.push([t,k,end]);done=true;break;}}
        if(!done)break;}}}
  const port={};
  for(const {id,side,g} of ends.values()){const N=boxes[id];g.sort(byPlace);
    const [s0,s1]=portSpan(N,side),r=N.rx,m=2+0.35*r;
    const vs=spread(g.map(e=>e[0]),s0+m,s1-m,PORT_GAP);
    g.forEach(([,k,end],i)=>{const v=vs[i],u=Math.min(v-s0,s1-v),inset=u<r?r-Math.sqrt(Math.max(0,r*r-(r-u)*(r-u))):0;
      port[k+','+end]=side==='R'?[N.x+N.w-inset,v,1,0]:side==='L'?[N.x+inset,v,-1,0]:side==='B'?[v,N.y+N.h-inset,0,1]:[v,N.y+inset,0,-1];});}
  return wires.map(([,,paired],k)=>{const [sx,sy,snx,sny]=port[k+',0'],[dx,dy,dnx,dny]=port[k+',1'];
    const bs=Math.max(BEND_MIN,0.45*Math.abs((dx-sx)*snx+(dy-sy)*sny)),bd=Math.max(BEND_MIN,0.45*Math.abs((dx-sx)*dnx+(dy-sy)*dny));
    const pts=[[sx,sy],[sx+snx*bs,sy+sny*bs],[dx+dnx*bd,dy+dny*bd],[dx,dy]];
    let [lx,ly]=bezierAt(pts,.5);
    if(paired){if(snx!==0)ly+=dx>sx?22:-22;else lx+=dy>sy?55:-55;}
    return {pts,lab:[lx,ly]};});}
function pathOf(pts){const xy=p=>p[0].toFixed(1)+','+p[1].toFixed(1);return 'M'+xy(pts[0])+' C'+pts.slice(1).map(xy).join(' ');}
/* Every direct wire on the page -- each one the drawing routed direct, and each touching a box
   moved here -- drawn from where its boxes stand now, with the ports on every side shared out
   again as a rebuild would: the arrow (its head and tail marks ride on it), its hit path, its
   label; a long wire's end tags go, since the wire is now drawn whole. A wire no longer direct
   (its box moved back to where it was drawn) takes its drawn route again. */
function directWires(){const edges=[...canvas.querySelectorAll('.fm-edge[data-a][data-b]')],boxes={};
  for(const g of canvas.querySelectorAll('.fm-node[data-box]')){const b=drawnBox(g),p=AUTHOR.at[g.dataset.id];
    boxes[g.dataset.id]={x:p?p.x:b.x,y:p?p.y:b.y,w:b.w,h:b.bh,rx:b.rx};}
  const direct=edges.filter(e=>boxes[e.dataset.a]&&boxes[e.dataset.b]&&(e.dataset.direct||AUTHOR.at[e.dataset.a]||AUTHOR.at[e.dataset.b]));
  const pairs=new Set(direct.map(e=>JSON.stringify([e.dataset.a,e.dataset.b])));
  const routes=directRoutes(boxes,direct.map(e=>[e.dataset.a,e.dataset.b,pairs.has(JSON.stringify([e.dataset.b,e.dataset.a]))]));
  return {edges,direct,routes};}
function reroute(){const {edges,direct,routes}=directWires();
  const set=(edge,d,lab)=>{const {a,b}=edge.dataset,pair=`[data-a="${CSS.escape(a)}"][data-b="${CSS.escape(b)}"]`;
    if(edge.dataset.d0===undefined){edge.dataset.d0=edge.getAttribute('d');edge.dataset.long0=edge.classList.contains('long')?'1':'';}
    if(edge.getAttribute('d')===d)return;
    edge.setAttribute('d',d);edge.classList.toggle('long',!lab&&!!edge.dataset.long0);
    canvas.querySelectorAll('.fm-wire-hit'+pair).forEach(h=>h.setAttribute('d',d));
    canvas.querySelectorAll('.fm-endtag'+pair).forEach(t=>t.style.display=lab?'none':'');
    canvas.querySelectorAll('.fm-elab'+pair).forEach(l=>lab?l.setAttribute('transform',
      `translate(${(lab[0]-l.dataset.lx).toFixed(1)},${(lab[1]-l.dataset.ly).toFixed(1)})`):l.removeAttribute('transform'));};
  const on=new Set(direct);
  direct.forEach((edge,i)=>set(edge,pathOf(routes[i].pts),routes[i].lab));
  for(const edge of edges)if(!on.has(edge)&&edge.dataset.d0!==undefined)set(edge,edge.dataset.d0,null);}
/* A box, its overlay hit boxes (data-node) and its wires, moved to x,y on the drawing. */
function place(id,x,y){const g=node(id);if(!g||!g.dataset.box)return;const b=drawnBox(g);
  x=Math.max(0,x);y=Math.max(0,y);
  if(Math.abs(x-b.x)<.05&&Math.abs(y-b.y)<.05)delete AUTHOR.at[id];else AUTHOR.at[id]={x,y};
  const t=AUTHOR.at[id]?`translate(${(x-b.x).toFixed(1)},${(y-b.y).toFixed(1)})`:null;
  for(const el of [g,...canvas.querySelectorAll(`[data-node="${CSS.escape(id)}"]`)])t?el.setAttribute('transform',t):el.removeAttribute('transform');
  reroute();}
/* A drawing is laid out from the layout files as they were at build; what has been saved
   since (or kept in this browser) is applied over it when the page opens. */
function authorShow(){AUTHOR.at={};AUTHOR.drag=null;const saved=AUTHOR.maps[PAGES[cur]?.lp];if(!saved)return;
  for(const g of canvas.querySelectorAll('.fm-node[data-ident][data-box]')){const p=saved[g.dataset.ident];if(!p)continue;
    const b=drawnBox(g);if(Math.abs(p.x-b.x)>.5||Math.abs(p.y-b.y)>.5)place(g.dataset.id,p.x,p.y);}
  minimap();}
function authorGrab(e){if(!AUTHOR.on||!PAGES[cur]?.lp||!e.target.closest)return false;
  let g=e.target.closest('.fm-node[data-box]');
  if(!g){const o=e.target.closest('[data-node]');g=o&&node(o.dataset.node);}
  if(!g||!g.dataset.ident||!g.dataset.box)return false;
  const at=geom(g.dataset.id);AUTHOR.drag={id:g.dataset.id,ident:g.dataset.ident,cx:e.clientX,cy:e.clientY,x:at.x,y:at.y,moved:false};
  return true;}
function authorMove(e){const d=AUTHOR.drag,dx=e.clientX-d.cx,dy=e.clientY-d.cy;
  if(!d.moved&&Math.abs(dx)+Math.abs(dy)<=4)return;
  d.moved=true;moved=true;place(d.id,d.x+dx/view.k,d.y+dy/view.k);}
function authorDrop(){const d=AUTHOR.drag;AUTHOR.drag=null;if(!d||!d.moved)return;
  const lp=PAGES[cur].lp,now=geom(d.id),point={x:Math.round(now.x),y:Math.round(now.y)};
  const from={x:d.x,y:d.y,authored:!!AUTHOR.maps[lp]?.[d.ident]};
  place(d.id,point.x,point.y);
  AUTHOR.undo.push({map:lp,id:d.id,ident:d.ident,from});
  const first=(AUTHOR.first[lp]??={});if(!(d.ident in first))first[d.ident]={...from,id:d.id};
  authorSave(lp,{[d.ident]:point});minimap();}
async function authorSave(map,set){
  if(!AUTHOR.server){const m=(AUTHOR.maps[map]??={});
    for(const [k,v] of Object.entries(set))v?m[k]=v:delete m[k];
    if(!Object.keys(m).length)delete AUTHOR.maps[map];
    try{localStorage.setItem(AUTHOR_STORE,JSON.stringify(AUTHOR.maps));
      authorSay(`${authorCount()} positions kept in this browser only · Export layout to commit them`);}
    catch(e){authorSay('browser storage unavailable: Export layout before closing',true);}
    return true;}
  authorSay('saving…');
  try{const r=await fetch('api/positions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({map,set})});
    const j=await r.json();if(!r.ok)throw Error(j.error||r.status);
    AUTHOR.maps=j.maps;authorSay('saved to '+j.wrote.join(' and '));return true;}
  catch(e){authorSay('not saved: '+e.message,true);return false;}}
/* The last move on this map, undone: the box goes back, and so does its saved position (or
   its lack of one, which leaves it to the solver). */
function authorUndo(){const lp=PAGES[cur]?.lp;let k=AUTHOR.undo.length-1;
  while(k>=0&&AUTHOR.undo[k].map!==lp)k--;
  if(k<0){authorSay('nothing to undo on this map');return;}
  const [u]=AUTHOR.undo.splice(k,1);place(u.id,u.from.x,u.from.y);minimap();
  authorSave(lp,{[u.ident]:u.from.authored?{x:Math.round(u.from.x),y:Math.round(u.from.y)}:null});}
/* A submap goes back to its solved layout: its authored positions are removed and it is
   redrawn. Map 0 has no solved layout (its nodes are placed in the authored set), so there
   every box moved this session goes back to where it stood when first moved. */
async function authorReset(){const lp=PAGES[cur]?.lp;if(!lp)return;
  if(lp==='0'){const first=AUTHOR.first[lp];
    if(!first||!Object.keys(first).length){authorSay('no moves on map 0 this session');return;}
    if(!confirm('Put every box moved on map 0 this session back where it stood?'))return;
    const set={};for(const [ident,f] of Object.entries(first)){place(f.id,f.x,f.y);set[ident]=f.authored?{x:Math.round(f.x),y:Math.round(f.y)}:null;}
    delete AUTHOR.first[lp];AUTHOR.undo=AUTHOR.undo.filter(u=>u.map!==lp);minimap();authorSave(lp,set);return;}
  if(!confirm('Reset this map to its solved layout? Every authored position on it is removed.'))return;
  AUTHOR.undo=AUTHOR.undo.filter(u=>u.map!==lp);delete AUTHOR.first[lp];
  if(!AUTHOR.server){delete AUTHOR.maps[lp];try{localStorage.setItem(AUTHOR_STORE,JSON.stringify(AUTHOR.maps));}catch(e){}
    show(cur,false);authorSay('this browser\\'s positions for the map removed; committed ones stay until imported over or reset by the server');return;}
  authorSay('resetting and redrawing…');
  try{const r=await fetch('api/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({map:lp})});
    const j=await r.json();if(!r.ok)throw Error(j.error||r.status);AUTHOR.maps=j.maps;authorSay('reset and redrawn; reloading');}
  catch(e){authorSay('not reset: '+e.message,true);}}
function authorExport(){const body=JSON.stringify({schema:1,set:AUTHORING.set,exported:new Date().toISOString(),maps:AUTHOR.maps},null,1);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type:'application/json'}));
  a.download=AUTHORING.set+'-layout.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  authorSay(`exported · commit with: node dev-map/cli.mjs --set ${AUTHORING.set} import-layout FILE`);}
function authorStart(){let local={};try{local=JSON.parse(localStorage.getItem(AUTHOR_STORE)||'{}')||{};}catch(e){}
  const offline=()=>{AUTHOR.server=false;AUTHOR.maps=local;authorBar();const n=authorCount();
    authorSay(n?`${n} positions kept in this browser only · Export layout to commit them`:'no authoring server: Arrange keeps moves in this browser');
    if(cur)authorShow();};
  if(!/^https?:$/.test(location.protocol))return offline();
  fetch('api/layout',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(Error(r.status))).then(j=>{
    if(j.mode!=='server')throw Error('not the authoring server');
    AUTHOR.server=true;AUTHOR.on=true;AUTHOR.maps=j.maps;authorBar();
    authorSay(`authoring · a drop saves to ${j.files.join(' and ')}`+(j.missing?` · ${j.missing} positions not found (map 0 list)`:''));
    if(cur)authorShow();}).catch(offline);}
addEventListener('keydown',e=>{if(!AUTHOR.on||e.target.closest?.('input,textarea'))return;
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();authorUndo();}});
"""


def influence_legend():
    def box(style):
        s = STYLE[style]
        dash = f' stroke-dasharray="{s["dash"]}"' if "dash" in s else ""
        return (f'<svg width="34" height="14"><rect x="1" y="1" width="32" height="12" rx="{min(s["rx"], 6)}" '
                f'fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{s["sw"]}"{dash}/></svg>')
    rows = [("stage", "cluster", "opens its map; ≈ and library labels are provisional, derived from its leaves"),
            ("code", "query leaf", "answers; its foot opens its source"),
            ("command", "command leaf", "changes state"),
            ("caller", "boundary", "the node on an enclosing map an arrow leaves to"),
            ("mark-link", "unlinked", "leaves with no arrow, so not drawn; the count opens the list"),
            ("mark-unowned", "unowned", "leaves no map-0 node owns; the count opens the list"),
            ("mark-missing", "not analysed", "in-scope files whose leaves and arrows are absent")]
    return ("<h2>Influence map</h2><p>Map 0 is the authored top level, placed as the authored set places it; "
            "everything below it is unreviewed solver output. An arrow is every leaf arrow between two boxes, "
            "labelled with its kinds and counts; two heads mean influence both ways. "
            "<code>read ADDRESS</code> lists the leaf arrows.</p>"
            + "".join(f'<div class="r">{box(style)}<span><b>{escape(name)}</b> — {escape(text)}</span></div>'
                      for style, name, text in rows))


def swatch(kind, key):
    if kind == "b":
        s = STYLE[key]
        dash = f' stroke-dasharray="{s["dash"]}"' if "dash" in s else ""
        return (f'<svg width="34" height="14"><rect x="1" y="1" width="32" height="12" '
                f'rx="{min(s["rx"], 6)}" fill="{s["fill"]}" stroke="{s["stroke"]}" '
                f'stroke-width="{s["sw"]}"{dash}/></svg>')
    key, _, tail = key.partition(":")
    e = EDGE[key]
    dash = f' stroke-dasharray="{e["dash"]}"' if "dash" in e else ""
    start = {"ack": f' marker-start="url(#d-{key})"', "both": f' marker-start="url(#m-{key})"'}.get(tail, "")
    return (f'<svg width="34" height="14"><defs><marker id="m-{key}" viewBox="0 0 10 8" refX="9" '
            f'refY="4" markerWidth="7" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,4 L0,8 z" fill="{e["stroke"]}"/></marker>'
            f'<marker id="d-{key}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">'
            f'<circle cx="5" cy="5" r="4" fill="{e["stroke"]}"/></marker></defs>'
            f'<path d="M{8 if tail else 1},7 L26,7" fill="none" stroke="{e["stroke"]}" stroke-width="{e["sw"]}"'
            f'{dash}{start} marker-end="url(#m-{key})"/></svg>')


def legend_html():
    o = []
    for style, key, text in LEGEND:
        if style == "h":
            o.append(f'<h3>{escape(text)}</h3>' if key is None and text != LEGEND[0][2]
                     else f'<h2>{escape(text)}</h2>')
        elif style == "p":
            o.append(f'<p>{escape(text)}</p>')
        elif style == "f":
            fill = {"note": NOTE_FILL, **{k: v[0] for k, v in MISSING.items()}}[key]
            o.append(f'<div class="r"><svg width="34" height="14"><rect x="1" y="3" width="32" height="8" '
                     f'rx="3" fill="{fill}"/></svg><span><b>{escape(key)}</b> — {escape(text)}</span></div>')
        else:
            o.append(f'<div class="r">{swatch(style, key)}<span><b>{escape(key)}</b> — '
                     f'{escape(text)}</span></div>')
    return "".join(o)


AUTHOR_BAR = ('<button id="arrange" onclick="arrange()" title="drag boxes to place them; their wires follow">Arrange</button>'
              '<button id="author-undo" onclick="authorUndo()" hidden title="undo the last move on this map (ctrl+z)">Undo move</button>'
              '<button id="author-reset" onclick="authorReset()" hidden title="a submap: back to its solved layout; map 0: this session&#39;s moves undone">Reset map</button>'
              '<button id="author-export" onclick="authorExport()" hidden title="write this browser&#39;s positions to a file for import-layout">Export layout</button>'
              '<span id="author-status"></span>')


def emit(out, model, pages, svgs, links=None):
    (out / "svg").mkdir(parents=True, exist_ok=True)
    inline = 0
    for key, body in svgs.items():
        inline += len(body)
        (out / "svg" / f"{key}.js").write_text(f"svgAt({json.dumps(key)},{json.dumps(body)})",
                                               encoding="utf-8")
    # An influence page's leaf arrows, fetched the first time one of its arrows is opened: the
    # drawing stays light and the shell carries none of them.
    for key, data in (links or {}).items():
        body = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
        (out / "svg" / f"{key}.links.js").write_text(f"linksAt({json.dumps(key)},{body})",
                                                     encoding="utf-8")
    (out / "sources.js").write_text("srcAll(" + json.dumps(model["sources"]).replace("</", r"<\/")
                                    + ")", encoding="utf-8")
    # A source line holding `</script>` would close the block early, so the sequence is broken
    # the way it has to be broken in HTML.
    (out / "stamp.js").write_text(f'stampAt({json.dumps(model.get("built", ""))})', encoding="utf-8")
    page_data = json.dumps(pages).replace("</", "<\\/")
    authoring_data = json.dumps(model.get("authoring")).replace("</", "<" + chr(92) + "/")
    lists_data = json.dumps(model.get("lists", {})).replace("</", "<\\/")
    graph_pages = {key: p for key, p in pages.items() if p["destination"] in ("graph", "contents")}
    rows, parents = [], {p["p"] for p in graph_pages.values()}

    def depth(key):
        d, k = 0, pages[key]["p"]
        while k is not None and k in pages:
            d, k = d + 1, pages[k]["p"]
        return d

    # Rows follow the page tree: a row sits directly under the page that opens it.
    kids = {}
    for key in sorted(graph_pages, key=at):
        kids.setdefault(pages[key]["p"], []).append(key)
    order, stack = [], [k for k in reversed(kids.get(None, []))]
    while stack:
        key = stack.pop()
        order.append(key)
        stack.extend(reversed(kids.get(key, [])))
    order += [k for k in sorted(graph_pages, key=at) if k not in set(order)]
    for key in order:
        p = pages[key]
        twisty = '<span class="tw">&#9656;</span>' if key in parents else ''
        rows.append(f'<a data-key="{escape(key, QUOTE)}" data-find="{escape(p["find"].lower(), QUOTE)}"'
                    f' data-go="{escape(key, QUOTE)}" style="padding-left:{26 + 11 * depth(key)}px">'
                    f'{twisty}<span class="ix">{escape(key)}</span>'
                    f'{escape(p["t"].split(" ", 1)[-1])}</a>')
    heading = model.get("title", "SAAM — the generated map")
    boundary_key = '<div class="boundary-key"><span>Internal node</span><span class="external">External boundary node</span></div>'
    legend = (boundary_key + "<p>Internal nodes belong to this displayed map. Dashed boundary nodes belong elsewhere and show connections across its edge.</p>"
              "<p>Authored target architecture, with source evidence where available.</p>"
              "<p>Boxes open submaps or referenced source. Wires open contracts and evidence, including exact nested endpoints. "
              "Wire direction follows the stated contract flow. Each pair of boxes is one wire: two heads mean flow both ways, its label naming each direction; a dot at the tail marks an activation that returns only its outcome. Separate access entries, where supplied, name permitted call/read directions. "
              "No transitive access is granted. Implementation conformance remains unchecked.</p>"
              if model.get("design") else INFLUENCE_LEGEND if model.get("influence") else legend_html())
    html = f"""<!doctype html><meta charset="utf-8"><title>{escape(heading)}</title>
<style>{CSS}</style>
<div id="side">
  <h1>{escape(heading)}</h1>
  {f'<div class="sub" style="color:#fca5a5;font-weight:600">{escape(model["notice"])}</div>' if model.get("notice") else ''}
  <div class="sub">{'' if model.get('influence') else f"{len(svgs)} graph pages · {sum(p['destination']=='contents' for p in pages.values())} contents pages · {sum(p['destination']=='code' for p in pages.values())} source destinations, "}stored {escape(model["generated"][:16].replace("T", " "))}, drawn
    {escape(model.get("built", "")[:16].replace("T", " "))} UTC.
    <span id="freshness-status">Live freshness unavailable; snapshot remains readable.</span>
    {'' if model.get('influence') else 'Redrawn by every <code>regenerate</code>; this page reloads itself.'}</div>
  <input id="filter" placeholder="index or declaration path…" autocomplete="off">
  <div id="tree">{''.join(rows)}</div>
</div>
<div id="main">
  <div id="bar">
    <button id="back" onclick="goBack()" disabled title="return to the previous map">&#8592; Back</button>
    <button onclick="document.body.classList.toggle('noside');overview()" title="show or hide the index">&#9776;</button>
    <div id="crumb"></div>
    <span id="stale"></span>
    <span id="score" hidden title="Map score: 0 is ideal, each part is a penalty from 0 to -1. See scores.html for every map."></span>
    <button onclick="toggleLegend()">Legend</button>
    <button onclick="const s=document.getElementById('score');s.hidden=!s.hidden;overview()">Score</button>
    <button onclick="pageCode()">Source</button>
    {f'''<button onclick="location.href='audit.html#'+cur">Boundary audit · {model['audit']['totals'].get('forbidden', 0)} conflicts</button>''' if model.get('design') and model.get('auditAvailable') else ''}
    <button onclick="overview()">Fit</button><button id="fit-all" onclick="fit()" hidden>Fit all dependencies</button>
    <button onclick="actual()">100%</button>
    <button onclick="toggleMinimap()" title="show or hide the minimap">Minimap</button>
    {AUTHOR_BAR if model.get("authoring") else ""}
    <span id="zoom"></span>
  </div>
  <div id="stage"><div id="canvas"></div>
    {f'<div id="boundary-key">{boundary_key}</div>' if model.get('design') else ''}
    <div id="codepane"></div>
    <div id="legendpane"><div class="lh">Legend<span class="x" onclick="toggleLegend()">&times;</span></div>
      <div class="lb">{legend}</div></div>
    <div id="minimap"></div>
    <div id="pin"></div>
    <div id="hint">{"click a wire = its interface set · " if model.get("design") else "click an arrow = its leaf arrows · " if model.get("influence") else ""}scroll = zoom · drag = pan · click a box = its page · click a box foot = its
      source · {"Arrange: drag a box = place it, ctrl+z undo · " if model.get("authoring") else ""}hover = its wires · x pin focus · ] [ next/previous end · \ back to the box ·
      click a wire's end tag = stand at its other end · Back previous map · f fit · 0 actual ·
      u up · esc close</div>
  </div>
</div>
<script>
const PAGES={page_data};
const BUILT={json.dumps(model.get("built", ""))};
const SNAPSHOT_ID={json.dumps(model.get("snapshotId"))};
const DESIGN={json.dumps(model.get("design", False))};
const LISTS={lists_data};
const AUTHORING={authoring_data};
{AUTHOR_JS if model.get("authoring") else ""}{JS}{"authorStart();" if model.get("authoring") else ""}
</script>
"""
    (out / "index.html").write_text(html, encoding="utf-8")
    return len(html), inline


def build(model, out):
    global REGENERATE, INFLUENCE_LEGEND
    INFLUENCE_LEGEND = influence_legend() if model.get("influence") else ""
    REGENERATE = model.get("regenerate", REGENERATE)
    packets = {p["index"]: p for p in model["pages"]}
    pages = {}
    for index, p in packets.items():
        kind = p["kind"]
        if kind == "root":
            title, detail, ref = "0" + (" · " + p["label"] if p.get("label") else ""), "", None
            sub = f'top map · {len(p["components"])} boxes · {p["leaves"]} leaves'
        elif kind == "group":
            title = f'{index} {p["label"]}'
            sub = f'cluster · {len(p["components"])} boxes · {p["leaves"]} leaves'
            detail, ref = p["path"], None
        elif not p.get("file"):
            # An actor channel (channels.mjs) has no source file or lines.
            title = f'{index} {p.get("label") or p["path"]}'
            sub = (f'{p.get("kind") or "leaf"} · {p["path"]} · '
                   f'{len(p["components"])} components, {len(p["wires"])} wires')
            detail, ref = p["path"], None
        else:
            title = f'{index} {p["path"][len(p["file"]) + 2:]}'
            sub = (f'{p["path"]} · {p["file"]}:{p["line"]}-{p["endLine"]} · {p["lines"]} lines · '
                   f'{len(p["components"])} components, {len(p["wires"])} wires')
            detail, ref = p["path"], f'{p["file"]}:{p["line"]}-{p["endLine"]}'
        if p.get("design"):
            sub = f'authored map · {len(p["components"])} boxes · {len(p["wires"])} interfaces · conformance unchecked'
        parent = p.get("parent")
        if "parent" not in p:
            cut = index
            while "." in cut:
                cut = cut.rsplit(".", 1)[0]
                if cut in packets:
                    parent = cut
                    break
            if parent is None and index != "0":
                parent = "0"
        stale = model["stale"].get(index)
        destination = p.get("destination", "graph")
        source_span = p.get("sourceSpan")
        if source_span:
            ref = f'{source_span["file"]}:{source_span["line"]}-{source_span["endLine"]}'
        # A leaf opens as its source alone; the shell holds the index and the way in, not the
        # pages themselves.
        pages[index] = dict(t=title, s=sub, find=f'{index} {detail}'.strip(), d=detail, r=ref, k=kind, p=parent,
                            destination=destination,
                            x=(stale["regenerate"] if stale else ""))
        if p.get("aliasOf"):
            pages[index]["aliasOf"] = p["aliasOf"]
        if destination == "contents":
            pages[index]["components"] = p["components"]
        if p.get("foldedCode"):
            pages[index]["foldedCode"] = p["foldedCode"]
        pages[index]["externals"] = {c["index"]: c["externals"] for c in p.get("components", []) if c.get("kind") == "external"}
        pages[index]["externalConnections"] = {c["index"]: c.get("externalConnections", []) for c in p.get("components", []) if c.get("kind") == "external"}
        if p.get("links"):
            pages[index]["links"] = 1
        if model.get("authoring") and destination == "graph":
            pages[index]["lp"] = p["path"]
        if p.get("design"):
            pages[index]["contracts"] = p["wires"]
            pages[index]["componentLabels"] = {c["index"]: c["label"] for c in p["components"]}
        score = model.get("scores", {}).get(index)
        if score:
            pages[index]["sc"] = score
    ctx = dict(pages=pages, stale=model["stale"], dropped=[])
    svgs = {}
    for index in sorted(packets, key=at):
        if pages[index]["destination"] == "graph":
            svgs[index] = build_page(packets[index], ctx).render()
    links = {index: p["links"] for index, p in packets.items() if p.get("links")}
    size, inline = emit(out, model, pages, svgs, links)
    kinds = {}
    for p in packets.values():
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print(f'{out / "index.html"}: {len(pages)} pages ({", ".join(f"{k} {n}" for k, n in sorted(kinds.items()))})')
    print(f'shell {size:,} bytes; {len(svgs)} sidecar drawings, {inline:,} bytes of SVG '
          f'(inlining them would make the shell {size + inline:,} bytes); '
          f'sources {len(model["sources"])} files')
    if ctx["dropped"]:
        print(f'{len(ctx["dropped"])} wires had an endpoint that is not a box on their page: '
              + ", ".join(f"{k} {a}->{b}" for k, a, b in ctx["dropped"][:10]))
    if model["stale"]:
        print(f'{len(model["stale"])} pages are marked stale on their drawing.')


if __name__ == "__main__":
    build(json.load(sys.stdin), pathlib.Path(sys.argv[1]))
