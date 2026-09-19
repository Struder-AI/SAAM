"""The whole stored map, drawn for the owner: one leveled page per stored page, the navigation
between them, and the source every box is. Layout and box styles are the shared leveled ones;
this module adds the page kinds the store holds, the lists a page owes in data, the stale mark,
and a viewer that loads one page's drawing at a time. Nothing here is authored except the
legend, which is stated once and reachable from every page."""
from __future__ import annotations

import json
import pathlib
import sys
from xml.sax.saxutils import escape

from leveled import (Page, STYLE, EDGE, MARGIN_L, FS_FOOT, FS_NOTE, LH_NOTE, LH_TITLE,
                     PADX, PADY)
from svg import tw
from flow import MARKERS, kind_of      # importing flow registers its box and wire styles
from viewer import CSS as BASE_CSS

# The box a page IS, drawn when the body calls nothing; and code in a file that no entry
# point of that file reaches.
STYLE["subject"] = dict(fill="#f8fafc", stroke="#0f172a", sw=2.6, rx=7, tc="#0f172a")
STYLE["unreached"] = dict(fill="#f1f5f9", stroke="#94a3b8", sw=1.3, rx=6, tc="#475569", dash="4 4")
ROW = 14.0
QUOTE = {chr(34): "&quot;"}
REGENERATE = "node scripts/agent-toolkit.mjs regenerate"
WIRE = {"state": "state", "return": "io", "gate": "gate"}


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

    def row(self, style, text, go=""):
        self.lists.append((style, clip(text), go))

    def layout(self):
        super().layout()
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
        return (f'STALE — {", ".join(self.stale["files"])} changed since this page was stored. '
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
        # The foot of a box is where its source is. Drawn by the base; the hit box goes over it.
        for n in self.nodes:
            foot, _c = n.foot
            if not foot or not getattr(n, "anchor_ref", None):
                continue
            ty = (n.y + PADY + LH_TITLE * 0.75 + LH_TITLE * len(n.lines)
                  + LH_NOTE * len(n.note_lines))
            o.append(f'<rect class="fm-src" data-ref="{escape(n.anchor_ref, QUOTE)}" '
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


def build_page(packet, ctx):
    """One stored page as a leveled page. Every box carries the index of the page it opens."""
    pages, stale = ctx["pages"], ctx["stale"].get(packet["index"])
    meta = pages[packet["index"]]
    page = MapPage(stale, key=packet["index"], title=meta["t"], subtitle=meta["s"])
    page.key_line = meta["k"] + ("  ·  " + meta["d"] if meta["d"] else "")
    kind, drawn, dropped = packet["kind"], set(), ctx["dropped"]

    def unit(index, label, note, foot, style, ref=None, path=None):
        node = page.n(index, label, kind=style, num=index, note=note or None,
                      anchor=path or index)
        node.display_foot = foot
        node.anchor_ref = ref
        if ref:
            node.source_path, node.source_line = ref.rsplit(":", 1)[0], ref.rsplit(":", 1)[1].split("-")[0]
        node.go = index if index in pages else ""
        drawn.add(index)
        return node

    def port(nid, label, style="port", go=""):
        if nid in drawn:
            return
        node = page.n(nid, label, kind=style)
        node.go = go
        drawn.add(nid)

    if kind == "root":
        for r in packet["regions"]:
            unit(r["index"], r["path"],
                 f'{r["files"]} files · {r["nodes"]} nodes · {r["entries"]} entry points',
                 f'{r["lines"]} lines', "stage")
        for p in packet["ports"]:
            port(p["port"], p["port"], go=port_target(p["port"], pages))
        for w in packet["wires"]:
            wire(page, w, aggregate(w), "data", drawn, dropped)
    elif kind == "region":
        for c in packet["components"]:
            note = f'{c["nodes"]} nodes · {c["entries"]} entry points'
            if c.get("unreached"):
                note += f' · {c["unreached"]} unreached'
            unit(c["index"], c["file"].rsplit("/", 1)[-1], note,
                 f'{c["file"]} · {c["lines"]} lines', "stage",
                 ref=f'{c["file"]}:1-{c["lines"]}', path=c["file"])
        for p in packet["ports"]:
            port(p["port"], p["port"], go=port_target(p["port"], pages))
        for w in packet["wires"]:
            wire(page, w, aggregate(w), "data", drawn, dropped)
    elif kind == "file":
        for c in packet["components"]:
            unit(c["index"], c["label"], "leaf" if c.get("leaf") else "",
                 f'{c["file"]}:{c["line"]}-{c["endLine"]} · {c["lines"]} lines', "ast",
                 ref=f'{c["file"]}:{c["line"]}-{c["endLine"]}', path=f'{c["file"]}::{c["label"]}')
        for c in packet["unreached"]["nodes"]:
            unit(c["index"], c["label"], "unreached" + (" · leaf" if c.get("leaf") else ""),
                 f'{c["file"]}:{c["line"]}-{c["endLine"]} · {c["lines"]} lines', "unreached",
                 ref=f'{c["file"]}:{c["line"]}-{c["endLine"]}', path=f'{c["file"]}::{c["label"]}')
        for p in packet["ports"]:
            port(p["port"], p["port"], go=port_target(p["port"], pages))
        for w in packet["wires"]:
            wire(page, w, aggregate(w), "data", drawn, dropped)
    else:
        node_page(packet, page, unit, port, drawn, dropped)
    lists(packet, page, pages)
    return page.layout()


def node_page(packet, page, unit, port, drawn, dropped):
    """A function, method, handler or class page: what it takes in, what it calls, what leaves."""
    gates = packet["gates"]
    for p in packet["inputs"]:
        port(p["port"], p["name"])
    for c in packet["components"]:
        note = []
        if c.get("gate") is not None:
            note.append("gate: " + gates[c["gate"]]["text"])
        if c.get("calls") is not None and c["calls"] != 1:
            note.append(f'{c["calls"]} call sites')
        if c.get("leaf"):
            note.append("leaf")
        unit(c["index"], c["label"], "\n".join(note),
             f'{c["file"]}:{c["line"]}-{c["endLine"]} · {c["lines"]} lines · '
             + ", ".join(c.get("links") or ["ast-call-site"]),
             kind_of(c.get("links") or []),
             ref=f'{c["file"]}:{c["line"]}-{c["endLine"]}', path=f'{c["file"]}::{c["label"]}')
    for p in packet.get("ports", []):
        port(p["index"], p["label"], go=p["index"])
    for p in packet["outputs"]:
        note = []
        if p.get("gate") is not None:
            note.append("gate: " + gates[p["gate"]]["text"])
        node = page.n(p["port"], p["name"], kind="throw" if p.get("kind") == "throw" else "port",
                      note="\n".join(note) or None)
        node.go = ""
        drawn.add(p["port"])
    # A body that calls nothing still has a page: itself, what reaches it and what leaves it.
    if not packet["components"]:
        me = unit(packet["index"], packet["path"][len(packet["file"]) + 2:], packet["kind"],
                  f'{packet["file"]}:{packet["line"]}-{packet["endLine"]} · {packet["lines"]} lines',
                  "subject", ref=f'{packet["file"]}:{packet["line"]}-{packet["endLine"]}',
                  path=packet["path"])
        me.go = ""
        for p in packet["inputs"]:
            page.e(p["port"], packet["index"], p["name"], "data")
        for p in packet["outputs"]:
            page.e(packet["index"], p["port"], "", "io")
        for c in packet["calledFrom"]:
            port("from:" + c["index"], c["index"], go=c["index"])
            page.e("from:" + c["index"], packet["index"], ", ".join(c.get("labels", [])), "data")
    # A state wire that is not a thread is a `this.` field two members share, and the store holds
    # one such wire per writer-reader pair: the field itself becomes the box, so each member is
    # drawn once against it instead of once per partner. A thread carries its own order and is
    # left alone.
    shared = {}
    for w in packet["wires"]:
        if w["kind"] == "state" and w.get("provenance") != "state-thread":
            ends = shared.setdefault(w.get("label", ""), ([], []))
            for side, end in ((0, w["from"]), (1, w["to"])):
                if end not in ends[side]:
                    ends[side].append(end)
        else:
            gate = gates[w["gate"]]["text"] if w.get("gate") is not None else ""
            label = " ".join(x for x in [w.get("label", ""), f'[{gate}]' if gate else ""] if x)
            wire(page, w, label, "gate" if gate else WIRE.get(w["kind"], "data"), drawn, dropped)
    for field in sorted(shared):
        writers, readers = shared[field]
        if not all(end in drawn for end in writers + readers):
            dropped.append((page.key, field, "field"))
            continue
        hub = page.n("field:" + field, field, kind="state")
        hub.go = ""
        drawn.add("field:" + field)
        for end in writers:
            page.e(end, "field:" + field, "", "state")
        for end in readers:
            page.e("field:" + field, end, "", "state")


def lists(packet, page, pages):
    """What the stored packet holds beside its boxes and wires, printed as data."""
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
    if packet.get("calledFrom"):
        page.row("head", f'calledFrom ({len(packet["calledFrom"])})')
        for c in packet["calledFrom"]:
            label = f'{c["index"]} {pages[c["index"]]["find"].split(" ", 1)[-1]}' if c["index"] in pages else c["index"]
            if c.get("labels"):
                label += "  (" + ", ".join(c["labels"]) + ")"
            page.row("item", label, c["index"] if c["index"] in pages else "")
    if packet.get("couplings"):
        page.row("head", f'couplings ({len(packet["couplings"])})')
        for c in packet["couplings"]:
            end = c.get("index") or c.get("path") or c.get("file") or ""
            page.row("item", f'{c["kind"]} {c["direction"]} {c.get("label", "")}  → {end}'
                             + (f'  {c["path"]}' if c.get("index") and c.get("path") else ""),
                     c["index"] if c.get("index") in pages else "")
    if packet.get("unresolved"):
        page.row("head", f'unresolved ({len(packet["unresolved"])})')
        for u in packet["unresolved"]:
            page.row("warn", f'{u["line"]}: {u["call"]}  —  {u["rule"]}')
    if packet.get("external"):
        page.row("head", f'external ({packet["external"]})')
        page.row("item", f'{packet["external"]} call sites here leave core/studio by rule')


# ---- the viewer ---------------------------------------------------------------------------
LEGEND = [
    ("h", None, "Nothing on these pages is authored."),
    ("p", None, "Every box, wire, label, gate and list was produced from the parsed source by "
                "scripts/dev-map/flow.mjs and scripts/dev-map/store.mjs, and drawn by "
                "scripts/dev-map/generated-view.py. This legend is the only writing in the viewer."),
    ("h", None, "Boxes"),
    ("b", "stage", "a page one level down: a region on page 0, a file on a region page."),
    ("b", "ast", "a callee read straight from the AST (ast-call-site, ast-closure, ast-member)."),
    ("b", "recv", "a callee resolved by following the receiver's or callee's value "
                  "(receiver-value, value-follow)."),
    ("b", "subject", "the function this page is, drawn when its body calls nothing."),
    ("b", "state", "a `this.` field the members of a class share. The wires in are the members "
                   "that write it, the wires out the members that read it; the store holds one "
                   "wire per writer-reader pair and they are drawn against the field instead."),
    ("b", "unreached", "code in this file that no entry point of the file reaches."),
    ("h", None, "Ports"),
    ("b", "port", "in: a parameter, or a way in from outside this page — another file, another "
                  "region, an outside caller, or a caller of this function. Out: a return, named "
                  "as the source writes it."),
    ("b", "throw", "a throw out, named by the constructor it throws."),
    ("h", None, "Wires"),
    ("w", "data", "ast-param / ast-def-use / ast-nested-call: a parameter, a bound call result, "
                  "or a call written inside another call's arguments, passed on."),
    ("w", "state", "state-thread: the same receiver at successive call sites, in source order. On "
                   "a class page: a field one member writes and another reads."),
    ("w", "gate", "ast-guard: the call is reached only under a test. The label is the test's own "
                  "source text."),
    ("w", "io", "ast-return / ast-throw: what leaves through a return or a throw."),
    ("p", None, "On page 0 and on region and file pages one wire stands for every link between "
                "those two boxes; its label is the kinds and their counts."),
    ("h", None, "What order means"),
    ("p", None, "Boxes are possible callees at a call site, ordered by first call site and placed "
                "left to right by the wires between them. That order is not an execution trace."),
    ("p", None, "A state thread is one reaching construction of a receiver, drawn in source order: "
                "not proof that these calls run on the same object, in this order."),
    ("h", None, "Lists"),
    ("p", None, "requires — what the calls in this body assert, with the line and the asserting "
                "function. formulas — nodes used here that draw no box because they only compute; "
                "each opens its own page. calledFrom — the exact inverse of the component lists: "
                "every page that draws this one as a box. couplings — links that are not calls. "
                "unresolved — a call site whose callee the scanner cannot name, with the rule that "
                "stopped it. external — how many call sites here leave core/studio by rule."),
    ("h", None, "Stale"),
    ("p", None, "A red frame and a red band mean a file behind the page has changed since the "
                "store was written: the drawing is what the code used to be. Run the command the "
                "band names, then build again."),
]

CSS = BASE_CSS + """
#tree a{font-family:ui-monospace,Consolas,monospace;font-size:11.4px;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis}
#tree a .ix{color:#64748b;margin-right:7px}
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
"""

JS = """
const stage=document.getElementById('stage'),canvas=document.getElementById('canvas'),
      crumb=document.getElementById('crumb'),zoomLbl=document.getElementById('zoom'),
      codePane=document.getElementById('codepane'),legendPane=document.getElementById('legendpane'),
      filter=document.getElementById('filter');
let view={x:0,y:0,k:1},cur=null,SVG={},SRC=null,hotId=null,moved=false,down=null;
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
  const s=document.createElement('script');s.src='svg/'+key+'.js';
  s.onload=()=>then();s.onerror=()=>{SVG[key]=null;then();};document.head.appendChild(s);}

function trail(key){const out=[];let k=key;
  while(k!==null&&k!==undefined&&PAGES[k]){out.unshift(k);k=PAGES[k].p;}
  return out.map((k,i)=>i===out.length-1?`<b>${esc(PAGES[k].t)}</b> — ${esc(PAGES[k].s)}`
    :`<span class="up" data-go="${k}">${esc(PAGES[k].t)}</span>`).join(' &rsaquo; ');}

function show(key,push){const p=PAGES[key];if(!p)return false;
  load(key,()=>{canvas.innerHTML=SVG[key]||'';cur=key;hot(null);closeCode();
    crumb.innerHTML=trail(key);
    document.getElementById('stale').textContent=p.x?('stale: '+p.x):'';
    document.querySelectorAll('#tree a.on').forEach(a=>a.classList.remove('on'));
    const row=document.querySelector(`#tree a[data-key="${CSS.escape(key)}"]`);
    if(row){row.classList.add('on');row.scrollIntoView({block:'nearest'});}
    fit();requestAnimationFrame(fit);});
  if(push!==false&&location.hash.slice(1)!==key)history.pushState({key},'','#'+key);
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
stage.addEventListener('wheel',e=>{e.preventDefault();
  const r=stage.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,
        nk=Math.min(8,Math.max(.02,view.k*Math.exp(-e.deltaY*.0015)));
  view.x=mx-(mx-view.x)*(nk/view.k);view.y=my-(my-view.y)*(nk/view.k);view.k=nk;apply();},
  {passive:false});
stage.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};
  moved=false;stage.setPointerCapture(e.pointerId);stage.classList.add('drag');});
stage.addEventListener('pointermove',e=>{if(!down)return;
  const dx=e.clientX-down.x,dy=e.clientY-down.y;
  if(Math.abs(dx)+Math.abs(dy)>4)moved=true;
  view.x=down.vx+dx;view.y=down.vy+dy;apply();});
stage.addEventListener('pointerup',()=>{down=null;stage.classList.remove('drag');});

/* A captured pointer retargets the click to #stage, so the mark under the cursor is
   hit-tested rather than read off the event. */
stage.addEventListener('click',e=>{if(moved)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);if(!el)return;
  const src=el.closest('.fm-src');
  if(src){openCode(src.dataset.ref);return;}
  const go=el.closest('[data-go]');
  if(go&&go.dataset.go&&PAGES[go.dataset.go]){show(go.dataset.go);return;}
  closeCode();});
document.addEventListener('click',e=>{const go=e.target.closest('#bar [data-go]');
  if(go&&PAGES[go.dataset.go])show(go.dataset.go);});

/* -- the code pane: what the box is, from the repo at build time ----------- */
function need(then){if(SRC)return then();
  const s=document.createElement('script');s.src='sources.js';
  s.onload=()=>then();s.onerror=()=>{SRC={};then();};document.head.appendChild(s);}
function closeCode(){codePane.classList.remove('on');codePane.innerHTML='';}
function openCode(ref){const cut=ref.lastIndexOf(':'),file=ref.slice(0,cut),
        span=ref.slice(cut+1).split('-'),a=+span[0],b=+span[1];
  legendPane.classList.remove('on');
  need(()=>{const text=SRC[file];
    let body=`<p class="note">no source for ${esc(file)} in this build</p>`;
    if(text!==undefined){const lines=text.split('\\n').slice(a-1,b);let rows='';
      for(let i=0;i<lines.length;i++)rows+=`<span class="ln">${a+i}</span>${esc(lines[i])}\\n`;
      body=`<pre>${rows}</pre>`;}
    codePane.innerHTML=`<div class="ch"><span class="x" onclick="closeCode()">&times;</span>`+
      `<div class="num">${esc(file)}</div><h3>lines ${a}–${b}</h3>`+
      `<button onclick="copy('${esc(file)}:${a}')">Copy path:line</button></div>`+
      `<div class="cb">${body}</div>`;
    codePane.classList.add('on');});}
function pageCode(){const p=PAGES[cur];if(p&&p.r)openCode(p.r);}
function copy(t){navigator.clipboard.writeText(t);}

function toggleLegend(){closeCode();legendPane.classList.toggle('on');}

/* -- search: an index, or a substring of a declaration path ---------------- */
filter.addEventListener('input',()=>{const q=filter.value.trim().toLowerCase();
  document.querySelectorAll('#tree a').forEach(a=>
    a.classList.toggle('hide',!!q&&!a.dataset.find.includes(q)));});
filter.addEventListener('keydown',e=>{if(e.key!=='Enter')return;
  const q=filter.value.trim();
  if(PAGES[q]){show(q);return;}
  const hit=document.querySelector('#tree a:not(.hide)');if(hit)show(hit.dataset.key);});

addEventListener('keydown',e=>{if(e.target===filter||!cur)return;
  if(e.key==='Escape'){closeCode();legendPane.classList.remove('on');}
  if(e.key==='f')fit();
  if(e.key==='0')actual();
  if((e.key==='Backspace'||e.key==='u')&&PAGES[cur].p)show(PAGES[cur].p);});
addEventListener('popstate',()=>{const k=location.hash.slice(1);if(PAGES[k])show(k,false);});
addEventListener('load',fit);addEventListener('resize',fit);
show(PAGES[location.hash.slice(1)]?location.hash.slice(1):'0',false);
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
    page_data = json.dumps(pages).replace("</", "<\\/")
    rows = []
    for key in sorted(pages, key=at):
        p = pages[key]
        rows.append(f'<a data-key="{escape(key, QUOTE)}" data-find="{escape(p["find"].lower(), QUOTE)}"'
                    f' data-go="{escape(key, QUOTE)}"><span class="ix">{escape(key)}</span>'
                    f'{escape(p["t"].split(" ", 1)[-1])}</a>')
    html = f"""<!doctype html><meta charset="utf-8"><title>SAAM generated map</title>
<style>{CSS}</style>
<div id="side">
  <h1>SAAM — the generated map</h1>
  <div class="sub">{len(pages)} pages, generated {escape(model["generated"])}. Read by
    <code>read-map INDEX --generated</code>; drawn by
    <code>node scripts/dev-map.mjs build --generated</code>.</div>
  <input id="filter" placeholder="index or declaration path…" autocomplete="off">
  <div id="tree">{''.join(rows)}</div>
</div>
<div id="main">
  <div id="bar">
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
      source · f fit · 0 actual · u up · esc close</div>
  </div>
</div>
<script>
const PAGES={page_data};
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
            sub = f'{len(p["files"])} files · {p["lines"]} lines · {p["nodes"]} nodes'
            detail, ref = p["path"], None
        elif kind == "file":
            title = f'{index} {p["file"]}'
            sub = f'{p["lines"]} lines · {p["nodes"]} nodes · region {p["region"]}'
            detail, ref = p["file"], f'{p["file"]}:1-{p["lines"]}'
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
        pages[index] = dict(t=title, s=sub, find=f'{index} {detail}'.strip(), d=detail, r=ref, k=kind, p=parent,
                            x=(stale["regenerate"] if stale else ""))
    ctx = dict(pages=pages, stale=model["stale"], dropped=[])
    svgs = {}
    for index in sorted(packets, key=at):
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
