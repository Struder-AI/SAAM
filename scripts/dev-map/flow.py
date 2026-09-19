"""Flow pages: one function body drawn as a leveled page, with the mechanism that produced
every mark shown on the page. Layout and viewer are the existing PackIT-derived ones; the
only additions are three box styles, one wire style, a provenance legend and the strip that
holds what a heuristic kept out of the flow. Nothing on a flow page is authored."""
import json
import pathlib
import sys
from xml.sax.saxutils import escape

from leveled import Page, STYLE, EDGE, MARGIN_L, FS_FOOT, FS_NOTE
from svg import tw
from viewer import emit

# Box: how the link from this function to that component was resolved.
STYLE["ast"] = dict(fill="#ffffff", stroke="#1e293b", sw=1.9, rx=7, tc="#0f172a")
STYLE["recv"] = dict(fill="#eff6ff", stroke="#2563eb", sw=1.9, rx=7, tc="#1e3a8a")
STYLE["heur"] = dict(fill="#fffbeb", stroke="#d97706", sw=1.5, rx=6, tc="#78350f", dash="2 4")
STYLE["throw"] = dict(fill="#fff1f2", stroke="#be123c", sw=1.5, rx=13, tc="#9f1239")
EDGE["state"] = dict(stroke="#ca8a04", sw=1.7, head="l-state")
MARKERS = '<marker id="l-state" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" ' \
          'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,4 L0,8 z" ' \
          'fill="#ca8a04"/></marker></defs>'

LEGEND = [("ast", "box: callee read straight from the AST (ast-call-site, ast-closure)"),
          ("recv", "box: link resolved by following the receiver's or callee's value "
                   "(receiver-value, value-follow)"),
          ("port", "port: a parameter in, or a return out, named as the source writes it"),
          ("throw", "port: a throw out, named by the constructor it throws"),
          ("heur", "not a box: an assertion becomes a requirement below, a formula stays in the "
                   "wires that pass through it")]
WIRES = [("data", "wire: ast-param / ast-def-use / ast-nested-call — a parameter, a bound call "
                  "result or a call written inside another call's arguments, passed on"),
         ("state", "wire: state-thread — the same receiver at successive call sites, in source order"),
         ("gate", "wire: ast-guard — the call is under a test; the test's own source text is the label"),
         ("io", "wire: ast-return / ast-throw — what leaves through a return or a throw")]
# What the drawing's two least literal elements mean. They are stated here, on the page the
# owner reads, and nowhere else.
MEANING = ["Boxes are possible callees at a call site, ordered by first call site. That order is "
           "not an execution trace.",
           "A state thread is one reaching construction of a receiver, drawn in source order: "
           "not proof that these calls run on the same object, in this order."]
ROW = 15.0


def kind_of(links):
    return "recv" if ("receiver-value" in links or "value-follow" in links) else "ast"


class FlowPage(Page):
    """A leveled page with a provenance legend and a strip for heuristically held items."""

    def __init__(self, packet, opened, **kw):
        super().__init__(**kw)
        self.packet = packet
        self.opened = opened
        self.held = packet["requires"]
        self.throw_ports = [p["port"] for p in packet["outputs"] if p["kind"] == "throw"]
        self.legend_rows = ([("title", None, "Nothing on this page is authored: every box, wire, "
                                             "label and gate below was produced by "
                                             "scripts/dev-map/flow.mjs from the parsed source.")]
                            + [("legend", k, t) for k, t in LEGEND + WIRES]
                            + [("meaning", None, t) for t in MEANING]
                            + [("note", None, f'{len(packet["unresolved"])} call sites here reach code '
                                              f'the scanner cannot name: '
                                              + ", ".join(sorted({u["call"] for u in packet["unresolved"]})))]
                            + [("note", None, f'{len(packet["external"])} call sites here are outside '
                                              f'core/studio by rule: '
                                              + ", ".join(sorted({u["rule"] for u in packet["external"]})))])
        if packet["authored"]:
            self.legend_rows.insert(0, ("authored", None, "AUTHORED CONTENT ON THIS PAGE: "
                                                          + ", ".join(map(str, packet["authored"]))))

    def layout(self):
        super().layout()
        # Throw ports lay out as ports — pinned to the right edge — and are drawn as throws.
        for port in self.throw_ports:
            self.index[port].kind = "throw"
        self.legend_y = self.H
        self.H += 26 + ROW * len(self.legend_rows) + (56 + ROW * len(self.held) if self.held else 0)
        self.W = max(self.W, 80 + max(tw(t, FS_NOTE) for _k, _s, t in self.legend_rows))
        return self

    def render(self):
        return super().render().replace("</defs>", MARKERS).replace("</svg>", self._legend() + "</svg>")

    def _legend(self):
        o, y = [], self.legend_y + 18
        o.append(f'<path d="M{MARGIN_L},{y - 12:.1f} L{self.W - MARGIN_L:.1f},{y - 12:.1f}" '
                 f'stroke="#cbd5e1" stroke-width="1"/>')
        for kind, key, t in self.legend_rows:
            x = MARGIN_L
            if key:
                if key in STYLE:
                    s = STYLE[key]
                    dash = f' stroke-dasharray="{s["dash"]}"' if "dash" in s else ""
                    o.append(f'<rect x="{x:.1f}" y="{y - 8:.1f}" width="22" height="10" rx="3" '
                             f'fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="1.4"{dash}/>')
                else:
                    e = EDGE[key]
                    dash = f' stroke-dasharray="{e["dash"]}"' if "dash" in e else ""
                    o.append(f'<path d="M{x:.1f},{y - 3:.1f} L{x + 22:.1f},{y - 3:.1f}" fill="none" '
                             f'stroke="{e["stroke"]}" stroke-width="{e["sw"]}"{dash} '
                             f'marker-end="url(#{e["head"]})"/>')
                x += 30
            fill = {"authored": "#dc2626", "title": "#0f172a", "rule": "#78350f",
                    "meaning": "#0f172a"}.get(kind, "#475569")
            weight = ' font-weight="700"' if kind in ("authored", "title") else ""
            o.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{FS_NOTE}" fill="{fill}"{weight}>'
                     f'{escape(t)}</text>')
            y += ROW
        if self.held:
            y += 22
            o.append(f'<text x="{MARGIN_L}" y="{y:.1f}" font-size="{FS_NOTE}" font-weight="700" '
                     f'fill="#78350f">Asserted by the calls in this body:</text>')
            y += 12
            for item in self.held:
                text = f'{item["line"]}: {item["text"]}'
                if item.get("message"):
                    text += "  |  " + item["message"]
                o.append(f'<text x="{MARGIN_L}" y="{y:.1f}" font-size="{FS_NOTE}" '
                         f'fill="#78350f">{escape(text)}</text>')
                y += ROW
        return "\n".join(o)


def build(model, out):
    out.mkdir(parents=True, exist_ok=True)
    keys = {p["node"]["path"]: p["key"] for p in model["pages"]}
    entries, blobs, code = [], {}, {}
    for packet in model["pages"]:
        page = FlowPage(packet, keys, key=packet["key"], title=packet["node"]["label"],
                        subtitle=f'{packet["node"]["path"]} · {packet["node"]["foot"]} · '
                                 f'{len(packet["components"])} components, {len(packet["wires"])} wires')
        for port in packet["inputs"]:
            page.n(port["port"], port["name"], kind="port", note=port["provenance"])
        for c in packet["components"]:
            note = []
            if c.get("gate"):
                note.append("gate: " + c["gate"]["text"])
            if c["calls"] != 1:
                note.append(f'{c["calls"]} call sites')
            note.append(f'{c["lines"]} lines')
            node = page.n(c["path"], c["label"], kind=kind_of(c["links"]), num=c["handle"],
                          note="\n".join(note) or None, anchor=c["path"])
            node.anchor_ref = f'{c["file"]}:{c["line"]}-{c["endLine"]}'
            node.display_foot = c["foot"] + "  ·  " + ", ".join(c["links"])
            node.source_path, node.source_line = c["file"], c["line"]
            code[node.anchor_ref] = dict(src=c["file"], a=c["line"],
                                         t="\n".join(model["sources"][c["file"]].split("\n")[c["line"] - 1:c["endLine"]]))
        for port in packet["outputs"]:
            note = port["provenance"]
            if port.get("gate"):
                note += "\ngate: " + port["gate"]["text"]
            page.n(port["port"], port["name"], kind="port", note=note)
        for w in packet["wires"]:
            gate = w.get("gate")
            label = " ".join(x for x in [w["label"], f'[{gate["text"]}]' if gate else ""] if x)
            page.e(w["from"], w["to"], label, "gate" if gate or w["kind"] == "gate"
                   else {"state": "state", "return": "io"}.get(w["kind"], "data"))
        page.layout()
        svg = page.render()
        (out / f'{page.key}.svg').write_text(svg, encoding="utf-8")
        blobs[page.key] = svg
        entries.append(dict(key=page.key, title=page.title, subtitle=page.subtitle, sources=[],
                            spec=None, parent=None, kid=False, depth=0))
    path, size = emit(out, [("Generated flow pages", entries)], blobs=blobs, code=code)
    print(f'{path}: {len(entries)} flow pages, {size:,} bytes')


if __name__ == "__main__":
    build(json.load(sys.stdin), pathlib.Path(sys.argv[1]))
