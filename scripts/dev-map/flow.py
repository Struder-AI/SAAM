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
STYLE["name"] = dict(fill="#faf5ff", stroke="#7e22ce", sw=1.6, rx=7, tc="#5b21b6", dash="7 3")
STYLE["heur"] = dict(fill="#fffbeb", stroke="#d97706", sw=1.5, rx=6, tc="#78350f", dash="2 4")
EDGE["state"] = dict(stroke="#ca8a04", sw=1.7, head="l-state")
MARKERS = '<marker id="l-state" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" ' \
          'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,4 L0,8 z" ' \
          'fill="#ca8a04"/></marker></defs>'

LEGEND = [("ast", "box: callee read straight from the AST (ast-call-site, ast-closure)"),
          ("recv", "box: link resolved by receiver-value — the receiver's construction was followed"),
          ("name", "box: link resolved by unique-method-name — one mapped class declares that name"),
          ("heur", "box: held out of the flow by a heuristic; every one is listed below and in the packet")]
WIRES = [("data", "wire: ast-param / ast-def-use / ast-nested-call — a parameter, a bound call "
                  "result or a call written inside another call's arguments, passed on"),
         ("state", "wire: state-thread — the same receiver at successive call sites, in source order"),
         ("gate", "wire: ast-guard — the call is under a test; the test's own source text is the label"),
         ("io", "wire: ast-return — what leaves through a return")]
ROW = 15.0


def kind_of(links):
    if links and all(l == "unique-method-name" for l in links):
        return "name"
    return "recv" if "receiver-value" in links else "ast"


class FlowPage(Page):
    """A leveled page with a provenance legend and a strip for heuristically held items."""

    def __init__(self, packet, opened, **kw):
        super().__init__(**kw)
        self.packet = packet
        self.opened = opened
        self.held = packet["vocabulary"] + packet["weak"]
        self.legend_rows = ([("title", None, "Nothing on this page is authored: every box, wire, "
                                             "label and gate below was produced by "
                                             "scripts/dev-map/flow.mjs from the parsed source.")]
                            + [("legend", k, t) for k, t in LEGEND + WIRES]
                            + [("rule", None, f'{h["name"]}: {h["rule"]}') for h in packet["heuristics"]]
                            + [("note", None, f'{len(packet["unresolved"])} call sites in this body '
                                              f'resolve to no mapped declaration and stay in the packet '
                                              f'as unresolved: '
                                              + ", ".join(sorted({u["call"] for u in packet["unresolved"]})))])
        if packet["authored"]:
            self.legend_rows.insert(0, ("authored", None, "AUTHORED CONTENT ON THIS PAGE: "
                                                          + ", ".join(map(str, packet["authored"]))))

    def layout(self):
        super().layout()
        self.legend_y = self.H
        self.H += 26 + ROW * len(self.legend_rows) + (56 + 44 * ((len(self.held) + 2) // 3) if self.held else 0)
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
            fill = {"authored": "#dc2626", "title": "#0f172a", "rule": "#78350f"}.get(kind, "#475569")
            weight = ' font-weight="700"' if kind in ("authored", "title") else ""
            o.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{FS_NOTE}" fill="{fill}"{weight}>'
                     f'{escape(t)}</text>')
            y += ROW
        if self.held:
            y += 22
            o.append(f'<text x="{MARGIN_L}" y="{y:.1f}" font-size="{FS_NOTE}" font-weight="700" '
                     f'fill="#78350f">Held out of the flow by a heuristic — not drawn as steps, '
                     f'still called by this body:</text>')
            y += 12
            s = STYLE["heur"]
            for i, item in enumerate(self.held):
                col, row = i % 3, i // 3
                x = MARGIN_L + col * ((self.W - 2 * MARGIN_L) / 3)
                top = y + row * 44
                w = min((self.W - 2 * MARGIN_L) / 3 - 12,
                        max(tw(f'{item["handle"]} {item["label"]}', 12), tw(item["provenance"], FS_FOOT),
                            tw(item["foot"], FS_FOOT)) + 20)
                o.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{w:.1f}" height="36" rx="{s["rx"]}" '
                         f'fill="{s["fill"]}" stroke="{s["stroke"]}" stroke-width="{s["sw"]}" '
                         f'stroke-dasharray="{s["dash"]}"/>')
                o.append(f'<text x="{x + 9:.1f}" y="{top + 14:.1f}" font-size="12" font-weight="700" '
                         f'fill="{s["tc"]}">{escape(item["handle"])} {escape(item["label"])} '
                         f'×{item["calls"]}</text>')
                o.append(f'<text x="{x + 9:.1f}" y="{top + 25:.1f}" font-size="{FS_FOOT}" '
                         f'fill="#78350f">{escape(item["provenance"])}</text>')
                o.append(f'<text x="{x + 9:.1f}" y="{top + 33:.1f}" font-size="{FS_FOOT}" '
                         f'fill="#a16207">{escape(item["foot"])}</text>')
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
            if c["opens"]:
                note.append("▸ opens its own flow page" + (f' — {keys[c["path"]]}' if c["path"] in keys else ""))
            node = page.n(c["path"], c["label"], kind=kind_of(c["links"]), num=c["handle"],
                          note="\n".join(note) or None, anchor=c["path"])
            node.anchor_ref = f'{c["file"]}:{c["line"]}-{c["endLine"]}'
            node.display_foot = c["foot"] + "  ·  " + ", ".join(c["links"])
            node.source_path, node.source_line = c["file"], c["line"]
            code[node.anchor_ref] = dict(src=c["file"], a=c["line"],
                                         t="\n".join(model["sources"][c["file"]].split("\n")[c["line"] - 1:c["endLine"]]))
        for port in packet["outputs"]:
            page.n(port["port"], port["name"], kind="port", note=port["provenance"])
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
