"""The whole stored map, drawn for the owner: one leveled page per stored page, the navigation
between them, and the source every box is. Layout and box styles are the shared leveled ones;
this module adds the page kinds the store holds, the lists a page owes in data, the stale mark,
and a viewer that loads one page's drawing at a time. Nothing here is authored except the
legend, which is stated once and reachable from every page."""
from __future__ import annotations

import json
import pathlib
import re
import sys
import textwrap
from xml.sax.saxutils import escape

from leveled import (Page, STYLE, EDGE, MARGIN_L, FS_FOOT, FS_NOTE, LH_NOTE, LH_TITLE,
                     PADX, PADY)
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
EDGE["caller"] = dict(stroke="#dc2626", sw=1.5, head="l-co", dash="2 3")
EDGE["capture"] = dict(stroke="#0369a1", sw=1.5, head="l-data", dash="3 3")
ROW = 14.0
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
        self.lists = []                 # (style, text, index-to-open)
        self.caller_refs = []

    def row(self, style, text, go=""):
        self.lists.append((style, clip(text), go))

    def layout(self):
        super().layout()
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
        if self.lists:
            self.H += 24 + ROW * len(self.lists)
            self.W = max(self.W, 2 * MARGIN_L + 20
                         + max(tw(t, FS_NOTE) for _s, t, _g in self.lists))
        if self.stale:
            self.W = max(self.W, 2 * MARGIN_L + tw(self.stale_text(), 11.5))
        # A page with one small box is narrower than its own heading; the heading is the page's
        # index and declaration path, so it is the thing that must not be cut off.
        self.W = max(self.W, 2 * MARGIN_L + max(tw(self.title, 21), tw(self.subtitle, 12),
                                                tw(self.key_line, 10)))
        return self

    def stale_text(self):
        return (f'STALE — generation inputs changed; matching snapshot remains readable. '
                f'Run: {REGENERATE} {self.stale["regenerate"]}')

    def render(self):
        svg = super().render().replace("</defs>", MARKERS)
        return svg.replace("</svg>", self._extras() + "</svg>")

    def _extras(self):
        o, y = [], self.list_y + 22
        if self.lists:
            o.append(f'<path d="M{MARGIN_L},{y - 15:.1f} L{self.W - MARGIN_L:.1f},{y - 15:.1f}" '
                     f'stroke="#cbd5e1" stroke-width="1"/>')
        for style, text, go in self.lists:
            x = MARGIN_L + (0 if style == "head" else 14)
            if go:
                o.append(f'<g class="fm-go" data-go="{escape(go, QUOTE)}">'
                         f'<rect x="{x - 4:.1f}" y="{y - 10:.1f}" width="{tw(text, FS_NOTE) + 9:.1f}" '
                         f'height="{ROW:.1f}" rx="3" fill="#0ea5e9" fill-opacity="0.004"/>'
                         f'<text x="{x:.1f}" y="{y:.1f}" font-size="{FS_NOTE}" fill="#0369a1">'
                         f'{escape(text)}</text></g>')
            else:
                fill = {"head": "#0f172a", "warn": "#9f1239"}.get(style, "#475569")
                weight = ' font-weight="700"' if style == "head" else ""
                o.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{FS_NOTE}" fill="{fill}"'
                         f'{weight}>{escape(text)}</text>')
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
                    o.append(f'<text x="{tx}" y="{ty}" font-size="{FS_NOTE}" fill="#0369a1">{escape(label)}</text>')
                    if target:
                        o.append('</g>')
                    tx += tw(label, FS_NOTE)
        # The foot of a box is where its source is. Drawn by the base; the hit box goes over it.
        for n in self.nodes:
            note_refs = dict(getattr(n, "note_refs", {}))
            if getattr(n, "gate_ref", None):
                note_refs[0] = n.gate_ref
            for row, gate_ref in note_refs.items():
                gate_y = n.y + PADY + LH_TITLE * .75 + LH_TITLE * len(n.lines) + row * LH_NOTE
                o.append(f'<rect class="fm-src fm-gate-source" data-ref="{escape(gate_ref, QUOTE)}" '
                         f'x="{n.x + PADX - 3:.1f}" y="{gate_y - FS_NOTE:.1f}" '
                         f'width="{tw(n.note_lines[row], FS_NOTE) + 6:.1f}" height="{LH_NOTE:.1f}" '
                         f'fill="#0ea5e9" fill-opacity="0.004"><title>Condition source</title></rect>')
            foot, _c = n.foot
            if not foot or not getattr(n, "anchor_ref", None):
                continue
            ty = (n.y + PADY + LH_TITLE * 0.75 + LH_TITLE * len(n.lines)
                  + LH_NOTE * (len(n.note_lines) + len(n.reference_rows)))
            o.append(f'<rect class="fm-src" data-ref="{escape(n.anchor_ref, QUOTE)}" data-key="{escape(n.id, QUOTE)}" '
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
    """A port that names another page: `region:6`, `file:6.3`, or a caller's own index."""
    target = name.split(":", 1)[1] if name.split(":", 1)[0] in ("region", "file") and ":" in name else name
    return target if target in pages else ""


def wire(page, w, label, kind, drawn, dropped):
    if w["from"] not in drawn or w["to"] not in drawn:
        dropped.append((page.key, w["from"], w["to"]))
        return
    page.e(w["from"], w["to"], label, kind)


def value_bundles(wires):
    """Draw compatible values together without changing the stored relationships.

    Direction, gates, operator ports, kind and other semantic attributes must match.
    Argument slots may share a line while retaining their individual value/slot pairs.
    Only the value label and its expression evidence otherwise differ. Calls and state/control
    relationships remain separate, even when their endpoints happen to match.
    """
    bundles, positions = [], {}
    for w in wires:
        if w["kind"] not in ("data", "return"):
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
    page.caller_refs = references(packet.get("callerReferences", packet.get("calledFrom", [])))

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
        node.go = go
        drawn.add(nid)
        return node

    if packet.get("composition") or kind == "group":
        node_page(packet, page, unit, port, drawn, dropped)
    elif kind == "root":
        for r in packet["regions"]:
            unit(r["index"], r["path"],
                 f'{r["files"]} files · {r["nodes"]} nodes · {r["roots"]} flow roots',
                 f'{r["lines"]} lines', "stage")
        for p in packet["ports"]:
            port(p["port"], p["port"], go=port_target(p["port"], pages))
        for w in packet["wires"]:
            wire(page, w, aggregate(w), "data", drawn, dropped)
    elif kind == "region":
        # A region draws the flow roots it holds; module-only source keeps its file box.
        for c in packet["components"]:
            if c.get("kind") == "file":
                unit(c["index"], c["file"].rsplit("/", 1)[-1], "module only",
                     f'{c["file"]} · {c["lines"]} lines', "stage",
                     ref=f'{c["file"]}:1-{c["lines"]}', path=c["file"])
                continue
            unit(c["index"], c["label"], "",
                 f'{c["file"]}:{c["line"]}-{c["endLine"]}', "ast",
                 ref=f'{c["file"]}:{c["line"]}-{c["endLine"]}', path=c["path"])
        for p in packet["ports"]:
            port(p["port"], p["port"], go=port_target(p["port"], pages))
        for w in packet["wires"]:
            if w.get("kind") == "invocation":
                invocation_edge(page, w, drawn, dropped)
            else:
                wire(page, w, aggregate(w), "data", drawn, dropped)
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
    # The findings of the node a box draws are listed below; the box says how many there are.
    for c in packet.get("components", []):
        node = page.index.get(c.get("id", c["index"]))
        if node is None:
            continue
        count = c.get("findings", sum(r.get("count", 1) for r in c.get("uncertainty", []))
                      + len(c.get("unresolved", [])))
        if count:
            node.note = (node.note + "\n" if node.note else "") + f'{count} findings'
    lists(packet, page, pages)
    return page.layout()


def stub_note(rows):
    """An argument slot with no wire, said out loud on the box. `literal` is a constant written
    at the call site; every other reason is a value the tracer could not follow."""
    shown = ", ".join(f'{row["slot"]} {row["reason"]}' for row in rows[:4])
    return "stub " + shown + (f' +{len(rows) - 4}' if len(rows) > 4 else "")


def invocation_label(w):
    if w.get("provenance") == "declaration":
        return "declares"
    if w.get("provenance") == "reference":
        return "value"
    return f'call {w["order"]}' + (f' ×{w["sites"]}' if w.get("sites") else "")


def invocation_edge(page, w, drawn, dropped):
    """The call, drawn from whatever makes it: the page's own function, or a leaf it homes."""
    source = w["from"]
    if w["to"] not in drawn or (source != "self" and source not in drawn):
        dropped.append((page.key, source, w["to"]))
        return
    page.e(source, w["to"], invocation_label(w), "invocation", rank=False)


def node_page(packet, page, unit, port, drawn, dropped):
    """A function, method, handler or class page: what it takes in, what it calls, what leaves."""
    gates = packet["gates"]
    def gate_name(number):
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
    for p in packet["inputs"]:
        node = port(p["port"], p["name"], go=p.get("index") or "")
        port_context(node, p, page.context_pages)
    # The function itself. Every box below is something it invokes, so it is drawn and every box
    # is wired to it; the argument slots the tracer could not source are marked on the box.
    invocations = [w for w in packet["wires"] if w["kind"] == "invocation"]
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
        note = " · ".join(text for condition, text in ((unresolved, uncertainty_label), (op.get("possibleTarget"), "possible target")) if condition)
        unit(op["id"], title, note,
             f'{op["file"]}:{op["line"]}-{op["endLine"]}',
             "outside" if op.get("scope") == "outside" else {"choice": "choice", "invocation": "invocation"}.get(op["kind"], "state"),
             ref=f'{op["file"]}:{op["line"]}-{op["endLine"]}')
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
    # A state wire that is not a thread is a `this.` field two members share, and the store holds
    # one such wire per writer-reader pair: the field itself becomes the box, so each member is
    # drawn once against it instead of once per partner. A thread carries its own order and is
    # left alone.
    shared = {}
    fields = {field["id"]: field for field in packet.get("stateFields", [])}
    # A closure-state wire names this body as one of its ends; the box for it is `subject`.
    body = [w if w.get("provenance") != "closure-state" else
            {**w, "from": subject if w["from"] == "self" else w["from"],
             "to": subject if w["to"] == "self" else w["to"]}
            for w in packet["wires"] if w["kind"] != "invocation"]
    for w in value_bundles(body):
        if w.get("provenance") == "closure-state":
            wire(page, w, " · ".join(x for x in (w.get("label", ""), w.get("stub", "")) if x),
                 "state", drawn, dropped)
        elif w["kind"] == "state" and w.get("provenance") != "state-thread":
            ends = shared.setdefault(w.get("stateField", w.get("label", "")), ([], []))
            for side, end in ((0, w["from"]), (1, w["to"])):
                if end not in ends[side]:
                    ends[side].append(end)
        else:
            gate = gate_name(w["gate"]) if w.get("gate") is not None else ""
            def value_label(value):
                roles = " → ".join(x for x in [w.get("fromPort", ""), value.get("toPort", "")] if x)
                flags = ", ".join(text for key, text in (("spread", "spread"), ("positionUnknown", "position unknown")) if value.get(key))
                return " ".join(x for x in [value.get("label", ""), f'({roles})' if roles else "", flags, f'[{gate}]' if gate else ""] if x)
            label = "\n".join(value_label(value) for value in w.get("argumentValues", [w]))
            wire(page, w, label, "gate" if gate else WIRE.get(w["kind"], "data"), drawn, dropped)
    for field in sorted(shared):
        writers, readers = shared[field]
        if not all(end in drawn for end in writers + readers):
            dropped.append((page.key, field, "field"))
            continue
        definition = fields.get(field, {})
        hub_id = definition.get("id", "field:" + field)
        name = definition.get("name", field)
        if definition.get("receiver") == "static":
            name = "static " + name
        source = definition.get("source")
        ref = f'{source["file"]}:{source["line"]}-{source["endLine"]}' if source else None
        hub = page.n(hub_id, name, kind="state", anchor=ref)
        if ref:
            hub.anchor_ref = ref
            hub.source_path, hub.source_line = source["file"], str(source["line"])
        hub.go = ""
        drawn.add(hub_id)
        for end in writers:
            page.e(end, hub_id, "", "state")
        for end in readers:
            page.e(hub_id, end, "", "state")
    # Last, so a box is placed by the values that reach it and not by the call that makes it:
    # the invocation edge states the call, it does not order the drawing.
    for w in invocations:
        invocation_edge(page, w, drawn, dropped)


def lists(packet, page, pages):
    """What the stored packet holds beside its boxes and wires, printed as data."""
    # The one authored thing on any page: a row of dev-map/facts.tsv about this declaration or file.
    if packet.get("facts"):
        page.row("head", f'facts ({len(packet["facts"])}) — authored, from dev-map/facts.tsv')
        for f in packet["facts"]:
            # A file's row carried by the region it is part of names that file.
            about = f'{f["file"]}  ' if f.get("file") else ""
            page.row("item", f'{about}{f["kind"]}  {f["date"]}  {f["fact"]}  [{f["source"]}]')
    if packet.get("requires"):
        page.row("head", f'requires ({len(packet["requires"])})')
        for item in packet["requires"]:
            text = f'{item["line"]}: {item["text"]}'
            if item.get("message"):
                text += "  |  " + item["message"]
            page.row("item", text + f'  → {item["index"]} {item["by"]}', item.get("index", ""))
    if packet.get("formulas"):
        page.row("head", f'formulas ({len(packet["formulas"])})')
        for f in packet["formulas"]:
            page.row("item", f'{f["index"]} {f["label"]}  {f["file"]}  lines '
                             + ", ".join(str(n) for n in f["lines"]), f["index"])
    if packet.get("couplings"):
        page.row("head", f'couplings ({len(packet["couplings"])})')
        for c in packet["couplings"]:
            end = c.get("index") or c.get("path") or c.get("file") or ""
            page.row("item", f'{c["kind"]} {c["direction"]} {c.get("label", "")}  → {end}'
                             + (f'  {c["path"]}' if c.get("index") and c.get("path") else ""),
                     c["index"] if c.get("index") in pages else "")
    # A callable a caller passes into a parameter this page invokes. Its box is on the caller's
    # page, where it is written and wired into the argument slot; here it is one row, so a page
    # that only invokes its callback stays code rather than a wall of other people's lambdas.
    targets = [(port, row) for port in packet.get("inputs", []) for row in port.get("parameterTargets", [])]
    if targets:
        page.row("head", f'parameter targets ({len(targets)}) — passed in by callers, drawn on the caller page')
        for port, row in targets:
            supplier = row.get("from") or row.get("fromPath") or row.get("fromFile") or "caller"
            page.row("item", f'{port["port"]} {port["name"]}  →  {row["index"]} {row["path"]}'
                             + f'  · from {supplier}' + ("  · possible target" if row.get("possible") else ""),
                     row["index"] if row["index"] in pages else "")
    if packet.get("declarationReferences"):
        page.row("head", "declaration calls — invocation not established")
        for relation in packet["declarationReferences"]:
            page.row("item", f'{relation["from"]} calls {relation["to"]}', relation["from"])
    def unresolved_rows(rows, go=""):
        for u in rows:
            location = (u.get("file", "") + ":" if u.get("file") else "") + str(u["line"])
            page.row("warn", f'{location}: {u["call"]}  —  {u["rule"]}', go)

    def uncertainty_rows(rows, go=""):
        for u in rows:
            if u.get("kind") == "closure-capture" and u.get("bindings"):
                target = next((index for index, meta in pages.items() if meta.get("d") == u["closure"]), "")
                identity = target or u["closure"]
                limits = ", ".join(k for k, v in u.items() if k.endswith("Unknown") and v)
                page.row("warn", f'closure-capture {identity} · {u["count"]} bindings · {limits}', target or go)
                for access, bindings in u["bindings"].items():
                    for line in textwrap.wrap(f'{access}: ' + ", ".join(bindings), width=120):
                        page.row("warn", line, target or go)
            else:
                page.row("warn", "  ".join(f'{k}: {v}' for k, v in u.items()), go)

    emit = {"unresolved": unresolved_rows, "uncertainty": uncertainty_rows}
    if packet.get("unresolved"):
        page.row("head", f'unresolved ({len(packet["unresolved"])})')
        unresolved_rows(packet["unresolved"])
    if packet.get("uncertainty"):
        page.row("head", f'uncertainty ({sum(u.get("count", 1) for u in packet["uncertainty"])})')
        uncertainty_rows(packet["uncertainty"])
    # A finding belongs to the node it is about, so every page that draws that node shows its
    # rows under that box. A group or file box is not a node and carries its count alone.
    def section(index, name, category, rows):
        go = index if index in pages else ""
        page.row("head", f'{category} ({sum(r.get("count", 1) for r in rows)}) — {index} {name}', go)
        emit[category](rows, go)

    for category in ("unresolved", "uncertainty"):
        for c in packet.get("components", []):
            if c.get(category):
                section(c["index"], c.get("label") or c.get("path") or c.get("file") or c["index"],
                        category, c[category])
    # A node page draws the same declaration once per call site; its rows are listed once, in
    # drawing order, under the node they are about.
    for node in packet.get("nodeFindings", []):
        for category in ("unresolved", "uncertainty"):
            if node.get(category):
                section(node["index"], node["path"].split("::", 1)[-1], category, node[category])
    if packet.get("analysisContext"):
        context = packet["analysisContext"]
        page.row("head", "analysis context")
        page.row("item", f'{context["index"]} {context["path"]}  uncertainty: {context["uncertainty"]}  '
                         f'unresolved: {context["unresolved"]}', context["index"])
    if packet.get("consumedBy"):
        page.row("head", f'consumedBy ({len(packet["consumedBy"])})')
        for c in packet["consumedBy"]:
            page.row("item", "  ".join(f'{k}: {v}' for k, v in c.items()), c.get("index") or "")
    if packet.get("outsideCallers"):
        page.row("head", f'outside callers ({sum(packet["outsideCallers"].values())}) — not active while making a part')
        for where, count in packet["outsideCallers"].items():
            page.row("item", f'{where} · {count}')
    if packet.get("outside"):
        page.row("head", f'outside ({packet["outside"]})')
        page.row("item", f'{packet["outside"]} call sites reaching scanned source the map does not cover')
    if packet.get("platform"):
        page.row("head", f'platform ({packet["platform"]})')
        page.row("item", f'{packet["platform"]} call sites with no target in any scanned root')


# ---- the viewer ---------------------------------------------------------------------------
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
    ("b", "stage", "a page one level down: a region on page 0, a file on a region page."),
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
                   "A class field instead connects the members that write and read it. A small named "
                   "state box is a binding the enclosing declaration owns: its note says the binding "
                   "kind, the access and which declaration owns it, and clicking it opens that owner."),
    ("h", None, "Ports"),
    ("b", "port", "in: a parameter, or a way in from outside this page — another file, another "
                  "region, an outside caller, or a caller of this function. Out: a return, named "
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
    ("w", "caller", "calls: an observed caller already displayed on this page connects to its "
                    "callee, or to the rounded page boundary. This is a call relationship, "
                    "not returned data or an execution-order constraint."),
    ("w", "capture", "a value's binding is captured by a nested function. This carries a reference, "
                     "not an invocation or an execution-order constraint. Mutable or untraced captures "
                     "retain their analysis limits."),
    ("w", "state", "state-thread: the same receiver at successive call sites, in source order. On "
                   "a class page: a field one member writes and another reads. closure-state: the "
                   "arrow points out of a state box for a read and into it for a write, so the "
                   "holder page says which members share which binding and a member page says what "
                   "it reads and writes. A write whose value the tracer could not follow leaves "
                   "this function's own box and names the gap beside the binding."),
    ("w", "gate", "ast-guard: the call is reached only under a test. The label names the condition "
                  "and branch; the full predicate remains under source and CLI --details."),
    ("w", "io", "ast-return / ast-throw: what leaves through a return or a throw."),
    ("w", "invocation", "this function invokes that box, as its Nth call (×N when one "
                        "declaration is called from several sites that did not separate), or "
                        "declares it without calling it here. It carries no value: the values "
                        "are the data wires, and the slots with none are the box's stub rows."),
    ("p", None, "On page 0 and on region and file pages one wire stands for every link between "
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
#codepane .cb{min-width:0;min-height:0;overflow:auto}
#codepane .cb>pre{width:max-content;min-width:100%;box-sizing:border-box;overflow:visible;white-space:pre}
#codepane details{margin:8px 14px;color:#475569}
#codepane details summary{cursor:pointer;font-size:12px}
#codepane details pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:8px 0}
#back:disabled{opacity:.4;cursor:default}
"""

JS = """
const stage=document.getElementById('stage'),canvas=document.getElementById('canvas'),
      crumb=document.getElementById('crumb'),zoomLbl=document.getElementById('zoom'),
      codePane=document.getElementById('codepane'),legendPane=document.getElementById('legendpane'),
      filter=document.getElementById('filter'),backButton=document.getElementById('back');
let view={x:0,y:0,k:1},cur=null,graphCur=null,SVG={},SRC=null,hotId=null,moved=false,down=null;
const visits=[],visitSession=Date.now()+'-'+Math.random();
let visitAt=-1,showVersion=0,sourceVersion=0;
let liveFreshness=null;
function freshnessMessage(now=Date.now()){
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
function srcAll(v){SRC=v;}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function apply(){canvas.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.k})`;
  zoomLbl.textContent=Math.round(view.k*100)+'%';}
function fit(){const s=canvas.firstElementChild;if(!s)return;
  const w=s.width.baseVal.value,h=s.height.baseVal.value,r=stage.getBoundingClientRect();
  view.k=Math.min(Math.min((r.width-48)/w,(r.height-48)/h),1);
  view.x=(r.width-w*view.k)/2;view.y=Math.max(18,(r.height-h*view.k)/2);apply();}
function actual(){const s=canvas.firstElementChild;if(!s)return;const r=stage.getBoundingClientRect();
  view.k=1;view.x=(r.width-s.width.baseVal.value)/2;view.y=18;apply();}

/* One page's drawing at a time, fetched as a script so the viewer opens from file:// with no
   server. The whole map inlined is an order of magnitude more bytes on every open. */
function load(key,then){if(SVG[key]!==undefined)return then();
  const s=document.createElement('script');s.src='svg/'+key+'.js?'+encodeURIComponent(BUILT);
  s.onload=()=>then();s.onerror=()=>{SVG[key]=null;then();};document.head.appendChild(s);}

function trail(key){const out=[];let k=key;
  while(k!==null&&k!==undefined&&PAGES[k]){out.unshift(k);k=PAGES[k].p;}
  return out.map((k,i)=>i===out.length-1?`<b>${esc(PAGES[k].t)}</b> — ${esc(PAGES[k].s)}`
    :`<span class="up" data-go="${k}">${esc(PAGES[k].t)}</span>`).join(' &rsaquo; ');}

function show(key,push,restore){const p=PAGES[key];if(!p)return false;
  if(p.destination==='code'&&graphCur){openCode(p.r,key);return true;}
  const version=++showVersion;
  let drawing=restore?restore.graph:(p.destination==='code'&&graphCur?graphCur:key);
  while(PAGES[drawing]&&PAGES[drawing].destination==='code')drawing=PAGES[drawing].p;
  load(drawing,()=>{if(version!==showVersion)return;
    canvas.innerHTML=SVG[drawing]||'';cur=drawing;graphCur=drawing;hot(null);
    crumb.innerHTML=trail(drawing);
    const mapped=PAGES[drawing];
    updateFreshness();
    reveal(drawing);paint();
    document.querySelectorAll('#tree a.on').forEach(a=>a.classList.remove('on'));
    const row=document.querySelector(`#tree a[data-key="${CSS.escape(drawing)}"]`);
    if(row){row.classList.add('on');row.scrollIntoView({block:'nearest'});}
    fit();requestAnimationFrame(fit);
    const entry=restore||{key:drawing,graph:drawing};
    if(!restore)remember(entry,push);
    backButton.disabled=visitAt<=0;
    if(p.destination==='code'){if(key!==drawing)hot(key);openCode(p.r,key);}});
  return true;}

/* -- hover: the box, and every wire touching it ---------------------------- */
function hot(id){if(id===hotId)return;
  canvas.querySelectorAll('.hot').forEach(el=>el.classList.remove('hot'));
  hotId=id;if(!id)return;
  canvas.querySelectorAll(`[data-a="${CSS.escape(id)}"],[data-b="${CSS.escape(id)}"]`)
    .forEach(el=>el.classList.add('hot'));}
stage.addEventListener('pointerover',e=>{
  const el=document.elementFromPoint(e.clientX,e.clientY),g=el&&el.closest('.fm-node');
  hot(g?g.dataset.id:null);});
stage.addEventListener('pointerleave',()=>hot(null));

/* -- pan / zoom ------------------------------------------------------------ */
stage.addEventListener('wheel',e=>{if(e.target.closest('#codepane,#legendpane'))return;e.preventDefault();
  const r=stage.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,
        nk=Math.min(8,Math.max(.02,view.k*Math.exp(-e.deltaY*.0015)));
  view.x=mx-(mx-view.x)*(nk/view.k);view.y=my-(my-view.y)*(nk/view.k);view.k=nk;apply();},
  {passive:false});
stage.addEventListener('pointerdown',e=>{if(e.target.closest('#codepane,#legendpane'))return;down={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};
  moved=false;stage.setPointerCapture(e.pointerId);stage.classList.add('drag');});
stage.addEventListener('pointermove',e=>{if(!down)return;
  const dx=e.clientX-down.x,dy=e.clientY-down.y;
  if(Math.abs(dx)+Math.abs(dy)>4)moved=true;
  view.x=down.vx+dx;view.y=down.vy+dy;apply();});
stage.addEventListener('pointerup',()=>{down=null;stage.classList.remove('drag');});

/* A captured pointer retargets the click to #stage, so the mark under the cursor is
   hit-tested rather than read off the event. */
stage.addEventListener('click',e=>{if(e.target.closest('#codepane,#legendpane')||moved)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);if(!el)return;
  if(el.closest('.fm-caller-unresolved'))return;
  const src=el.closest('.fm-src');
  if(src){const target=PAGES[src.dataset.key];
    if(target&&target.destination==='code')show(src.dataset.key);else openCode(src.dataset.ref);return;}
  const go=el.closest('[data-go]');
  if(go&&go.dataset.go&&PAGES[go.dataset.go]){show(go.dataset.go);return;}
  const sourceNode=el.closest('.fm-node[data-ref]');
  if(sourceNode){openCode(sourceNode.dataset.ref);return;}
  dismissCode();});
document.addEventListener('click',e=>{
  const evidence=e.target.closest('#codepane [data-go]');
  if(evidence&&PAGES[evidence.dataset.go]){dismissCode();show(evidence.dataset.go);return;}
  const tw=e.target.closest('#tree .tw');
  if(tw){const k=tw.parentElement.dataset.key;collapsed.has(k)?collapsed.delete(k):collapsed.add(k);paint();return;}
  const go=e.target.closest('#bar [data-go],#tree [data-go]');
  if(go&&PAGES[go.dataset.go])show(go.dataset.go);});

/* -- the index: a tree of pages, closed below the regions until a page is opened -- */
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
function callerEvidence(page){const rows=page?.metadata?.callerReferences||page?.metadata?.calledFrom||[];
  const counted=page?.metadata?.outsideCallers||{};
  if(!rows.length&&!Object.keys(counted).length)return '';
  let body='';for(const row of rows){const label=row.index||row.path||row.file||'external caller';
    body+=`<div>${row.index&&PAGES[row.index]?`<a data-go="${esc(row.index)}">${esc(label)}</a>`:`<span>${esc(label)}${row.unmapped?' · outside the map':''}</span>`}</div>`;}
  for(const where in counted)body+=`<div><span>${esc(where)} · ${counted[where]} · not active while making a part</span></div>`;
  return `<details open><summary>called from · ${rows.length}</summary><div class="caller-evidence">${body}</div></details>`;}
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
    codePane.innerHTML=`<div class="ch"><span class="x" onclick="dismissCode()">&times;</span>`+
      `<div class="num">${page?esc(page.t)+' · ':''}${esc(file)}</div><h3>lines ${a}–${b}</h3>`+
      `<div id="source-freshness">${esc(freshnessMessage().source)}</div>`+
      `<button onclick="copy('${esc(file)}:${a}')">Copy path:line</button></div>`+
      `<div class="cb">${body}${callerEvidence(page)}</div>`;
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
  if(e.key==='Escape'){e.preventDefault();dismissCode();legendPane.classList.remove('on');return;}
  if(e.target===filter||e.target.closest('input,textarea,[contenteditable="true"]')||!cur)return;
  if(e.key==='f')fit();
  if(e.key==='0')actual();
  if(e.key==='Backspace'){e.preventDefault();goBack();}
  if(e.key==='u'&&PAGES[cur].p)show(PAGES[cur].p);});
addEventListener('popstate',e=>{
  if(e.state&&e.state.mapSession===visitSession&&visits[e.state.mapVisit]){
    visitAt=e.state.mapVisit;const entry=visits[visitAt];show(entry.key,false,entry);
  }else show(navigationKey(e.state,location.hash.slice(1)),false);});
addEventListener('load',fit);addEventListener('resize',fit);
show(navigationKey(history.state,location.hash.slice(1)),false);
"""


def swatch(kind, key):
    if kind == "b":
        s = STYLE[key]
        dash = f' stroke-dasharray="{s["dash"]}"' if "dash" in s else ""
        return (f'<svg width="34" height="14"><rect x="1" y="1" width="32" height="12" '
                f'rx="{min(s["rx"], 6)}" fill="{s["fill"]}" stroke="{s["stroke"]}" '
                f'stroke-width="{s["sw"]}"{dash}/></svg>')
    e = EDGE[key]
    dash = f' stroke-dasharray="{e["dash"]}"' if "dash" in e else ""
    return (f'<svg width="34" height="14"><defs><marker id="m-{key}" viewBox="0 0 10 8" refX="9" '
            f'refY="4" markerWidth="7" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,4 L0,8 z" fill="{e["stroke"]}"/></marker></defs>'
            f'<path d="M1,7 L26,7" fill="none" stroke="{e["stroke"]}" stroke-width="{e["sw"]}"'
            f'{dash} marker-end="url(#m-{key})"/></svg>')


def legend_html():
    o = []
    for style, key, text in LEGEND:
        if style == "h":
            o.append(f'<h3>{escape(text)}</h3>' if key is None and text != LEGEND[0][2]
                     else f'<h2>{escape(text)}</h2>')
        elif style == "p":
            o.append(f'<p>{escape(text)}</p>')
        else:
            o.append(f'<div class="r">{swatch(style, key)}<span><b>{escape(key)}</b> — '
                     f'{escape(text)}</span></div>')
    return "".join(o)


def emit(out, model, pages, svgs):
    (out / "svg").mkdir(parents=True, exist_ok=True)
    inline = 0
    for key, body in svgs.items():
        inline += len(body)
        (out / "svg" / f"{key}.js").write_text(f"svgAt({json.dumps(key)},{json.dumps(body)})",
                                               encoding="utf-8")
    (out / "sources.js").write_text("srcAll(" + json.dumps(model["sources"]).replace("</", r"<\/")
                                    + ")", encoding="utf-8")
    # A source line holding `</script>` would close the block early, so the sequence is broken
    # the way it has to be broken in HTML.
    (out / "stamp.js").write_text(f'stampAt({json.dumps(model.get("built", ""))})', encoding="utf-8")
    page_data = json.dumps(pages).replace("</", "<\\/")
    graph_pages = {key: p for key, p in pages.items() if p["destination"] != "code"}
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
    html = f"""<!doctype html><meta charset="utf-8"><title>SAAM generated map</title>
<style>{CSS}</style>
<div id="side">
  <h1>SAAM — the generated map</h1>
  <div class="sub">{len(svgs)} graph pages · {len(pages) - len(svgs)} code destinations, stored {escape(model["generated"])}, drawn
    {escape(model.get("built", "")[:16].replace("T", " "))} UTC.
    <span id="freshness-status">Live freshness unavailable; snapshot remains readable.</span>
    Redrawn by every <code>regenerate</code>; this page reloads itself.</div>
  <input id="filter" placeholder="index or declaration path…" autocomplete="off">
  <div id="tree">{''.join(rows)}</div>
</div>
<div id="main">
  <div id="bar">
    <button id="back" onclick="goBack()" disabled title="return to the previous map">&#8592; Back</button>
    <button onclick="document.body.classList.toggle('noside');fit()" title="show or hide the index">&#9776;</button>
    <div id="crumb"></div>
    <span id="stale"></span>
    <button onclick="toggleLegend()">Legend</button>
    <button onclick="pageCode()">Source</button>
    <button onclick="fit()">Fit</button>
    <button onclick="actual()">100%</button>
    <span id="zoom"></span>
  </div>
  <div id="stage"><div id="canvas"></div>
    <div id="codepane"></div>
    <div id="legendpane"><div class="lh">Legend<span class="x" onclick="toggleLegend()">&times;</span></div>
      <div class="lb">{legend_html()}</div></div>
    <div id="hint">scroll = zoom · drag = pan · click a box = its page · click a box foot = its
      source · Back previous map · f fit · 0 actual · u up · esc close</div>
  </div>
</div>
<script>
const PAGES={page_data};
const BUILT={json.dumps(model.get("built", ""))};
const SNAPSHOT_ID={json.dumps(model.get("snapshotId"))};
{JS}
</script>
"""
    (out / "index.html").write_text(html, encoding="utf-8")
    return len(html), inline


def build(model, out):
    packets = {p["index"]: p for p in model["pages"]}
    pages = {}
    for index, p in packets.items():
        kind = p["kind"]
        if kind == "root":
            title, detail, ref = "0", "", None
            sub = (f'{len(p["regions"])} regions · {sum(r["files"] for r in p["regions"])} files · '
                   f'{sum(r["nodes"] for r in p["regions"])} nodes')
        elif kind == "region":
            title = f'{index} {p["path"]}'
            sub = f'{p["fileCount"]} files · {p["lines"]} lines · {p["nodes"]} nodes'
            detail, ref = p["path"], None
        elif kind == "file":
            title = f'{index} {p["file"]}'
            sub = f'{p["lines"]} lines · {p["nodes"]} nodes · region {p["region"]}'
            detail, ref = p["file"], f'{p["file"]}:1-{p["lines"]}'
        elif kind == "group":
            title = f'{index} {p["label"]}'
            sub = f'{p["owner"]} · {len(p["components"])} declarations · generated boundary'
            detail, ref = p["path"], None
        else:
            title = f'{index} {p["path"][len(p["file"]) + 2:]}'
            sub = (f'{p["path"]} · {p["file"]}:{p["line"]}-{p["endLine"]} · {p["lines"]} lines · '
                   f'{len(p["components"])} components, {len(p["wires"])} wires')
            detail, ref = p["path"], f'{p["file"]}:{p["line"]}-{p["endLine"]}'
        parent = None
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
        metadata = {key: p[key] for key in ("inputs", "outputs", "requires", "formulas", "gates", "calledFrom",
                    "consumedBy", "couplings", "unresolved", "uncertainty", "outside", "platform",
                    "outsideCallers", "callerReferences", "facts") if key in p}
        if stale:
            metadata["stale"] = stale
        pages[index] = dict(t=title, s=sub, find=f'{index} {detail}'.strip(), d=detail, r=ref, k=kind, p=parent,
                            destination=destination, metadata=metadata if destination == "code" else None,
                            x=(stale["regenerate"] if stale else ""))
    ctx = dict(pages=pages, stale=model["stale"], dropped=[])
    svgs = {}
    for index in sorted(packets, key=at):
        if pages[index]["destination"] != "code":
            svgs[index] = build_page(packets[index], ctx).render()
    size, inline = emit(out, model, pages, svgs)
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
