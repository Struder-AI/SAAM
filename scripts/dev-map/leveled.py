"""Leveled layout adapted from PackIT; see maps/README.md for provenance and changes."""
from __future__ import annotations

import math
from xml.sax.saxutils import escape

from svg import FONT, tw

FS_TITLE, FS_NOTE, FS_FOOT, FS_EDGE = 14.5, 9.5, 8.5, 9.5
LH_TITLE, LH_NOTE = 18.0, 12.0
PADX, PADY = 12, 9
MIN_W = 96

HGAP = 96           # between columns; GH's median wire dx less its median width
VGAP = 30           # minimum clear space between stacked boxes
TARGET_W = 1800     # wrap onto another map row past this, unless the page names its own
ROW_GAP = 96        # clear space between map rows, for a wrap wire to run in

# How a wire that crosses from one map row to a later one is drawn. REVERTABLE: change this
# one name, rebuild, and every page redraws -- nothing else in the tree depends on which is
# chosen.
#
#   "gutter"  every crossing runs out past the right edge, back along the gutter under the
#             row, and in on the left of the next -- the shape a line of text makes.
#   "forward" a crossing whose destination is further RIGHT than its source is drawn as an
#             ordinary bezier, forward and down, because that path is short and reads
#             directly. Only a crossing that genuinely goes backwards (destination at or
#             left of source) still takes the gutter, where the long way round is telling
#             the truth about the direction.
#   "direct"  no crossing ever takes the gutter. The most compact, and it lets a wire run
#             right-to-left across a row, which is the thing the gutter exists to avoid.
WRAP_STYLE = "forward"
MARGIN_L, MARGIN_T = 40, 92
MARGIN_R, MARGIN_B = 40, 34

# Zones: full-height tinted bands saying which machine a column of boxes runs on. Full
# height rather than a bounding box around the members, because the layering already sorts
# the page left to right along the journey -- so the split is a vertical line, and a band
# also claims the externals standing beside each half, which is the true statement (the
# operator is at the phone, the orchestrator is at the PC).
ZONE_TOP = 30       # extra headroom over MARGIN_T so the band label clears the boxes
ZONE_Y = 88         # zone bands start below the title block
ZONE_FILLS = [("#eff6ff", "#2563eb"), ("#faf5ff", "#7e22ce"), ("#f0fdf4", "#15803d")]

STYLE = {
    "stage": dict(fill="#ffffff", stroke="#1e293b", sw=1.9, rx=7, tc="#0f172a"),
    "gap":   dict(fill="#fffbeb", stroke="#d97706", sw=1.5, rx=6, tc="#78350f", dash="6 3"),
    "state": dict(fill="#fefce8", stroke="#ca8a04", sw=1.5, rx=5, tc="#713f12"),
    "port":  dict(fill="#f0fdfa", stroke="#0d9488", sw=1.4, rx=13, tc="#115e59"),
    "ext":   dict(fill="#f1f5f9", stroke="#94a3b8", sw=1.2, rx=13, tc="#475569", dash="5 3"),
    # A step the design calls for and the tree does not have. Distinct from `ext`, which is
    # code that exists somewhere else, and from `gap`, which is code that exists without a
    # name — a stub has nothing to point at, so it carries no foot and the ledger ignores it.
    "stub":  dict(fill="#ffffff", stroke="#7c3aed", sw=1.4, rx=7, tc="#5b21b6", dash="2 4"),
}
EDGE = {
    "data": dict(stroke="#334155", sw=1.5, head="l-data"),
    "gate": dict(stroke="#be123c", sw=1.4, head="l-gate", dash="5 4"),
    "io":   dict(stroke="#0891b2", sw=1.6, head="l-io"),
}
ANCHOR_TC, EXPLODE_TC = "#0f766e", "#7c3aed"
# The third title line: what the marks on this page mean in one line. A page whose marks are
# not the authored map's says so by setting `key_line`.
KEY_LINE = ("▸ opens a page   ·   file:lines = the code it is   ·   "
            "red ↓ = shared uses   ·   dashed red = condition")
# Co-ownership stub. Its own colour because it says something no other mark on the page
# says: this declaration is not exclusively ours.
CO_TC, CO_LEN = "#dc2626", 22


class LNode:
    def __init__(self, nid, label, kind="stage", anchor=None, explodes=None,
                 note=None, tag=None, num=None, co=()):
        # `num` is the IDEF0-style address (1.1, then 1.1.2 on its child page). Drawn
        # muted ahead of the name so the operation stays the title and the number is
        # there to point at in conversation.
        self.num = num
        self.id, self.label, self.kind = nid, label, kind
        self.anchor, self.explodes, self.note, self.tag = anchor, explodes, note, tag
        # Flow numbers that also own this declaration. Drawn as a left-facing stub carrying
        # the number and nothing else -- there is no node standing for the other flow
        # (decisions.md, 2026-08-02). Legitimate only where the flows genuinely meet inside
        # the node; non-touching paths through one node mean it should have been two.
        self.co = tuple(co)
        self.reference_rows = []        # [(text, destination)] segments, attached port evidence
        self.anchor_ref = None
        self.x = self.y = 0.0
        self.column = 0
        self.children = ()          # leveled pages never nest; kept for shared checks

    def walk(self):
        """Leveled nodes never nest; `walk` exists so the shared cross-checks in
        flow_index / overlay can traverse a Page and a Diagram the same way."""
        yield self

    @property
    def lines(self):
        return self.label.split("\n")

    @property
    def note_lines(self):
        return self.note.split("\n") if self.note else []

    @property
    def foot(self):
        if self.explodes:
            return f"▸ {self.explodes}", EXPLODE_TC
        if self.anchor:
            return getattr(self, "display_foot", None) or self.anchor_ref or self.anchor, ANCHOR_TC
        return None, None

    def measure(self):
        w = max(tw(l, FS_TITLE) for l in self.lines)
        if self.num:
            w += tw(self.num + " ", FS_TITLE)
        for nl in self.note_lines:
            w = max(w, tw(nl, FS_NOTE))
        foot, _c = self.foot
        if foot:
            w = max(w, tw(foot, FS_FOOT))
        for row in self.reference_rows:
            w = max(w, sum(tw(text, FS_FOOT) for text, _go in row))
        self.w = max(w + 2 * PADX, MIN_W)
        self.h = (len(self.lines) * LH_TITLE + len(self.note_lines) * LH_NOTE
                  + LH_NOTE * len(self.reference_rows) + (LH_NOTE + 3 if foot else 0) + 2 * PADY)

        self.box_h = self.h
        self.shared_lines = [" · ".join(self.co[i:i + 3]) for i in range(0, len(self.co), 3)]
        if self.co:
            self.h += max(CO_LEN + 5, len(self.shared_lines) * 11 + 18)
            self.w = max(self.w, max(tw(line, FS_FOOT) for line in self.shared_lines) + 30)

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.box_h / 2


def _attrs(n):
    """Node metadata onto its <g>, for the viewer to hit-test and act on.

    The rendered box says `file.mjs:483-502` because that is what reads well on a page; an
    editor needs the repo-relative path and a bare first line, so both are carried here.
    """
    data = {"id": n.id, "kind": n.kind, "num": n.num or "",
            "label": " ".join(n.lines), "note": " · ".join(n.note_lines),
            "anchor": n.anchor or "", "ref": n.anchor_ref or "",
            "explodes": n.explodes or "",
            # The page this box opens, where a page holds boxes that are themselves pages.
            "go": getattr(n, "go", "") or "",
            "co": " · ".join(n.co)}
    if n.anchor_ref:
        data["src"] = n.source_path
        data["line"] = str(n.source_line)
    return "".join(f' data-{k}="{escape(v, {chr(34): "&quot;"})}"'
                   for k, v in data.items() if v)


def _ends(e):
    """A wire's two endpoints as attributes, for the viewer to select it by."""
    return (f' data-a="{escape(e["src"], {chr(34): "&quot;"})}"'
            f' data-b="{escape(e["dst"], {chr(34): "&quot;"})}"')


def bezier_at(p, t):
    """Point on a cubic, for placing an edge label."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p
    u = 1 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)


class Page:
    def __init__(self, key, title, subtitle, parent=None, ports_in=(), ports_out=(),
                 breaks=(),
                 zones=(), width=None):
        self.key, self.title, self.subtitle = key, title, subtitle
        self.key_line = KEY_LINE
        self.parent = parent
        self.ports_in, self.ports_out = list(ports_in), list(ports_out)
        # [(label, [node_id, ...])] -- which machine each part of the page runs on.
        self.zones = [(lab, list(ids)) for lab, ids in zones]
        # Own wrap width. A page that must read as one left-to-right line says so here
        # rather than being folded at the shared TARGET_W.
        self.width = width
        # Node ids that each start a new map row. When set, they decide the wrapping
        # instead of the width, because a split that carries meaning is not a fit question.
        self.breaks = list(breaks)
        self.zone_rects = []
        self.nodes, self.edges = [], []
        self.index = {}
        self.shape_of = None

    def n(self, nid, label, **kw):
        node = LNode(nid, label, **kw)
        if nid in self.index:
            raise ValueError(f"[{self.key}] duplicate id {nid!r}")
        self.index[nid] = node
        self.nodes.append(node)
        return node

    def e(self, src, dst, label="", kind="data", rank=True):
        """`rank=False` draws the wire but keeps it out of column assignment.

        For a wire that states a PRECEDENCE between two otherwise parallel branches
        rather than a payload moving along it. Ranking such a wire serialises the branches
        and the drawing then claims a pipeline where the code has a race.
        """
        self.edges.append(dict(src=src, dst=dst, label=label, kind=kind, rank=rank))
        return self

    # -- shared checks -----------------------------------------------------
    @property
    def rows(self):
        """One pseudo-row of every node, so flow_index / overlay can walk a Page with the
        same loop they use for a Diagram. A leveled page has no rows of its own -- its
        placement is computed, not declared."""
        return [dict(nodes=self.nodes, indent=0, gap=0)]

    def leaves(self):
        return iter(self.nodes)

    def check(self):
        out = []
        for e in self.edges:
            for k in ("src", "dst"):
                if e[k] not in self.index:
                    out.append(f"[{self.key}] edge {k} {e[k]!r} not found")
        for n in self.nodes:
            if n.kind == "port":
                continue
            if not any(e["src"] == n.id or e["dst"] == n.id for e in self.edges):
                out.append(f"[{self.key}] {n.label!r} has no wire — a box that connects "
                           f"to nothing states nothing")
        for label, ids in self.zones:
            for i in ids:
                if i not in self.index:
                    out.append(f"[{self.key}] zone {label!r} names {i!r}, which is not "
                               f"a box on this page")
        return out

    def check_routes(self):
        return []

    # -- layout ------------------------------------------------------------
    def layout(self):
        for n in self.nodes:
            n.measure()
        ids = [n.id for n in self.nodes]
        succ = {i: [] for i in ids}
        pred = {i: [] for i in ids}
        rsucc = {i: [] for i in ids}
        for e in self.edges:
            succ[e["src"]].append(e["dst"])
            pred[e["dst"]].append(e["src"])
            if e.get("rank", True):
                rsucc[e["src"]].append(e["dst"])

        back = self._back_edges(ids, rsucc)
        fsucc = {i: [d for d in rsucc[i] if (i, d) not in back] for i in ids}
        fpred = {i: [] for i in ids}
        for i in ids:
            for d in fsucc[i]:
                fpred[d].append(i)

        # 1 - column by longest path over forward edges only
        column = {}

        def depth(i, seen=()):
            if i in column:
                return column[i]
            if i in seen:
                return 0
            v = 0 if not fpred[i] else max(depth(p, seen + (i,)) + 1 for p in fpred[i])
            column[i] = v
            return v

        for i in ids:
            depth(i)
        # ports pin the boundary: an in-port is the left edge, an out-port the right
        for n in self.nodes:
            if n.kind == "port" and not fpred[n.id]:
                column[n.id] = 0
        # A page with no boxes at all still has a title, a subtitle and whatever it prints
        # below the drawing; the extents below fall back to the margins rather than taking
        # the maximum of nothing.
        top = max(column.values(), default=0)
        for n in self.nodes:
            if n.kind == "port" and not fsucc[n.id]:
                column[n.id] = top
        for n in self.nodes:
            n.column = column[n.id]

        columns = {}
        for n in self.nodes:
            columns.setdefault(n.column, []).append(n)
        L = sorted(columns)

        # 2 - crossing reduction: barycentre sweeps over the undirected adjacency
        adj = {i: succ[i] + pred[i] for i in ids}
        pos = {}
        for l in L:
            for k, n in enumerate(columns[l]):
                pos[n.id] = float(k)
        for it in range(10):
            for l in (L if it % 2 == 0 else L[::-1]):
                grp = columns[l]
                bary = {}
                for n in grp:
                    nb = [pos[a] for a in adj[n.id] if a in pos]
                    bary[n.id] = sum(nb) / len(nb) if nb else pos[n.id]
                grp.sort(key=lambda n: bary[n.id])
                for k, n in enumerate(grp):
                    pos[n.id] = float(k)

        # 3 - map_rows. A deep graph drawn as one row is a strip several thousand px wide and
        #     one box tall, which is honest about the structure and unreadable as a page.
        #     Past TARGET_W the columns wrap onto a second band, the way a long node-editor
        #     definition gets stacked. Within a band everything still runs left to right;
        #     the wrap is one wire, drawn as a wrap.
        lw = {l: max(n.w for n in columns[l]) + HGAP for l in L}
        if self.breaks:
            # The page says where the rows divide. Width-based wrapping asks "what fits",
            # which is the wrong question when the split carries meaning -- one row per
            # machine, say. A break names the box that starts a row, and the column that
            # box lands in is the cut.
            cut = {self.index[i].column for i in self.breaks if i in self.index}
            map_rows, cur = [], []
            for l in L:
                if l in cut and cur:
                    map_rows.append(cur)
                    cur = []
                cur.append(l)
            if cur:
                map_rows.append(cur)
        else:
            total = sum(lw.values())
            nb = max(1, math.ceil(total / (self.width or TARGET_W)))
            aim = total / nb      # even map_rows, so one stray column never wraps alone
            map_rows, cur, cw = [], [], 0.0
            for l in L:
                if cur and cw + lw[l] * 0.5 > aim and len(map_rows) < nb - 1:
                    map_rows.append(cur)
                    cur, cw = [], 0.0
                cur.append(l)
                cw += lw[l]
            if cur:
                map_rows.append(cur)
        self.map_rows = map_rows
        row_of = self.row_of = {l: bi for bi, b in enumerate(map_rows) for l in b}

        # 4 - x: column map_rows sized by their widest member; each node CENTRED in its band,
        #     so x varies with the node's own width rather than snapping to a lattice
        for b in map_rows:
            x = MARGIN_L
            for l in b:
                bw = max(n.w for n in columns[l])
                for n in columns[l]:
                    n.x = x + (bw - n.w) / 2
                x += bw + HGAP

        # 5 - y: barycentric relaxation, order-preserving, per band. Cross-band neighbours
        #     are excluded from the barycentre — letting them pull would drag a whole band
        #     toward one wire that is already drawn as a wrap.
        same = {n.id: [a for a in adj[n.id]
                       if row_of[self.index[a].column] == row_of[n.column]]
                for n in self.nodes}
        top_y = MARGIN_T + (ZONE_TOP if self.zones else 0)
        for b in map_rows:
            for l in b:
                y = top_y
                for n in columns[l]:
                    n.y = y
                    y += n.h + VGAP
            # A node whose every neighbour is in another band has nothing in here to want.
            # Its target is pinned to where it starts, ONCE: letting it want its own current
            # centre each pass makes it a free parameter, and _pack's open-out then re-centre
            # turns that into a ratchet — the node creeps one way, its column-mates the other,
            # and over 60 passes a connected component drifts a page-height clear of the band
            # (measured on 5c_quad and 6a_save, 2026-08-03: ~1500 px of void).
            pin = {n.id: n.cy for n in self.nodes if not same[n.id]}
            for it in range(60):
                for l in (b if it % 2 == 0 else b[::-1]):
                    grp = columns[l]
                    want = []
                    for n in grp:
                        nb = [self.index[a].cy for a in same[n.id]]
                        want.append(sum(nb) / len(nb) if nb else pin[n.id])
                    self._pack(grp, want)
            ns = [n for l in b for n in columns[l]]
            # Normalise on the nodes the relaxation could actually place. A node with no
            # neighbour in this band kept its pin, which is wherever the initial stacking
            # left it -- so letting it set `lo` anchors the band to a number no wire on the
            # band agrees with, and the connected members float off below it. That is the
            # 2026-08-03 ratchet from the other side: same void, opened by the pin rather
            # than by the drift. Measured on 1b_surfaces, 2026-08-04: ~730 px.
            conn = [n for n in ns if same[n.id]]
            lo = min(n.y for n in (conn or ns))
            for n in ns:
                n.y += top_y - lo
            # ...and having not set the origin, such a node must not escape the band either:
            # an out-port is pinned to the last column by design, so its producer can be map_rows
            # away and its pin with it. Clamp it into the extent its band actually occupies.
            if conn:
                row_lo = min(n.y for n in conn)
                row_hi = max(n.y + n.h for n in conn)
                for n in ns:
                    if not same[n.id]:
                        n.y = min(max(n.y, row_lo), max(row_lo, row_hi - n.h))
                # Several disconnected nodes can clamp to the same position.
                # Restore column separation once, after clamping, without another
                # relaxation loop or any invented graph connections.
                for l in b:
                    grp = columns[l]
                    self._pack(grp, [n.y + n.h / 2 for n in grp])
                lo = min(n.y for n in ns)
                for n in ns:
                    n.y += top_y - lo
            self._squeeze(ns)
            top_y = max(n.y + n.h for n in ns) + ROW_GAP

        # 5 - ports: wires leave and arrive at distinct points on a box's edge, spread in
        #     the order of what they connect to. One shared exit point makes a fan of
        #     wires start as a single stroke, which is exactly where a path becomes hard
        #     to follow.
        self.slot = {}
        fwd = [k for k, e in enumerate(self.edges)
               if (e["src"], e["dst"]) not in back
               and self.index[e["dst"]].x + self.index[e["dst"]].w > self.index[e["src"]].x]
        for side, keyf in (("out", lambda e: e["src"]), ("in", lambda e: e["dst"])):
            groups = {}
            for k in fwd:
                groups.setdefault(keyf(self.edges[k]), []).append(k)
            for nid, ks in groups.items():
                node = self.index[nid]
                other = "dst" if side == "out" else "src"
                ks.sort(key=lambda k: self.index[self.edges[k][other]].cy)
                span = min(node.h * 0.62, 15.0 * (len(ks) - 1))
                for j, k in enumerate(ks):
                    off = 0.0 if len(ks) == 1 else (j / (len(ks) - 1) - 0.5) * span
                    self.slot[(side, k)] = node.cy + off

        self.right_edge = max((n.x + n.w for n in self.nodes), default=MARGIN_L) + 24
        self.gutter_lane = {}
        self.wrapped = set()
        self.routes = [self._route(e, back) for e in self.edges]
        self.W = max((n.x + n.w for n in self.nodes), default=MARGIN_L) + MARGIN_R
        self.H = max((n.y + n.h for n in self.nodes), default=MARGIN_T) + MARGIN_B
        for e, (_pts, lab) in zip(self.edges, self.routes):
            if lab:
                self.H = max(self.H, lab[1] + 20 + 12 * (len(e["label"].split("\n")) - 1))
        self.zone_rects = self._zones()
        return self

    def _zones(self):
        """-> [(label, x0, x1, fill, ink)]. Zones are ordered by where their members
        actually sit, and the boundary between two adjacent ones is the midpoint of the
        clear space between them, so no band ever cuts through a box."""
        groups = []
        for label, ids in self.zones:
            ns = [self.index[i] for i in ids if i in self.index]
            if ns:
                groups.append((sum(n.cx for n in ns) / len(ns),
                               min(n.x for n in ns), max(n.x + n.w for n in ns), label))
        groups.sort()
        out, left = [], 0.0
        for k, (_mid, _lo, hi, label) in enumerate(groups):
            right = (hi + groups[k + 1][1]) / 2 if k + 1 < len(groups) else self.W
            fill, ink = ZONE_FILLS[k % len(ZONE_FILLS)]
            out.append((label, left, right, fill, ink))
            left = right
        return out

    @staticmethod
    def _squeeze(ns):
        """Collapse any horizontal strip of this map row that no box occupies.

        The barycentre places a node at the mean of its neighbours, which says nothing
        about where a whole CONNECTED COMPONENT of the row sits: if every neighbour of
        every member is inside the component, its offset from the rest of the row is a
        free parameter, and `_pack`'s open-out-then-re-centre walks it. Measured
        2026-08-04, four pages with two or more components per row: 6a_save 5035 px of
        empty page between its two, 3_coverage / 3d_frame / 5_detection ~650 px each.

        A strip no box occupies anywhere in the row is void by construction — nothing is
        aligned across it — so it closes to the ordinary VGAP. This moves whole groups
        rigidly, so it changes no within-group geometry and no ordering; components that
        interleave in y (different columns, overlapping rows) are untouched, which is why
        this is the fix and packing the components into a stack is not.
        """
        if not ns:
            return
        order = sorted(ns, key=lambda n: n.y)
        groups, end = [[order[0]]], order[0].y + order[0].h
        for n in order[1:]:
            if n.y > end + VGAP:
                groups.append([])
            groups[-1].append(n)
            end = max(end, n.y + n.h)
        dy, prev_bottom = 0.0, None
        for g in groups:
            if prev_bottom is not None:
                dy = prev_bottom + VGAP - min(n.y for n in g)
            for n in g:
                n.y += dy
            prev_bottom = max(n.y + n.h for n in g)

    @staticmethod
    def _pack(grp, want):
        """Place `grp` at its desired centres, then open out any overlap in order."""
        for n, w in zip(grp, want):
            n.y = w - n.h / 2
        for k in range(1, len(grp)):
            lo = grp[k - 1].y + grp[k - 1].h + VGAP
            if grp[k].y < lo:
                grp[k].y = lo
        # re-centre the opened block on what it wanted, so packing does not drag the
        # whole column downward every pass
        if grp:
            got = sum(n.cy for n in grp) / len(grp)
            aim = sum(want) / len(want)
            for n in grp:
                n.y += aim - got

    def _back_edges(self, ids, succ):
        """Edges that close a cycle, found by DFS. These are the feedback wires."""
        back, state = set(), {i: 0 for i in ids}

        def visit(i):
            state[i] = 1
            for d in succ[i]:
                if state[d] == 1:
                    back.add((i, d))
                elif state[d] == 0:
                    visit(d)
            state[i] = 2

        for i in ids:
            if state[i] == 0:
                visit(i)
        return back

    def _route(self, e, back):
        """-> (points, label_point). Points are M + one triple per cubic segment."""
        k_i = self.edges.index(e)
        a, b = self.index[e["src"]], self.index[e["dst"]]
        ba, bb = self.row_of[a.column], self.row_of[b.column]
        # A crossing only needs the gutter when the short path would be a lie about
        # direction. See WRAP_STYLE.
        gutter = bb > ba and (WRAP_STYLE == "gutter"
                              or (WRAP_STYLE == "forward" and b.x <= a.x))
        if gutter:
            # Wrap: out past the right of this band, back along the gutter, in on the left
            # of the next -- the same shape a line of text makes, and readable as one.
            sx, sy = a.x + a.w, self.slot.get(("out", k_i), a.cy)
            dx, dy = b.x, self.slot.get(("in", k_i), b.cy)
            lane = self.gutter_lane.setdefault((ba, k_i), len(
                [k for (bb2, k) in self.gutter_lane if bb2 == ba]))
            gut = (max(n.y + n.h for n in self.nodes if self.row_of[n.column] == ba)
                   + ROW_GAP * 0.42 + lane * 15)
            rx, lx = self.right_edge, MARGIN_L * 0.4
            pts = [(sx, sy),
                   (sx + 50, sy), (rx, sy), (rx, gut),
                   (rx - 70, gut), (lx + 70, gut), (lx, gut),
                   (lx, dy), (dx - 55, dy), (dx, dy)]
            self.wrapped.add(k_i)
            return pts, (((rx + lx) / 2, gut - 4) if e["label"] else None)
        if (a.id, b.id) in back or b.x + b.w <= a.x:
            # feedback: under the row, entering from below
            sx, sy = a.cx, a.y + a.h
            dx, dy = b.cx, b.y + b.h
            bow = 46 + 0.10 * abs(dx - sx)
            pts = [(sx, sy), (sx, sy + bow), (dx, dy + bow), (dx, dy)]
        else:
            sx = a.x + a.w
            sy = self.slot.get(("out", k_i), a.cy)
            dx = b.x
            dy = self.slot.get(("in", k_i), b.cy)
            k = min(150.0, max(34.0, (dx - sx) * 0.55))
            pts = [(sx, sy), (sx + k, sy), (dx - k, dy), (dx, dy)]
        lab = bezier_at(pts[:4], 0.5) if e["label"] else None
        return pts, lab

    # -- render ------------------------------------------------------------
    def render(self):
        o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.W:.0f}" '
             f'height="{self.H:.0f}" viewBox="0 0 {self.W:.0f} {self.H:.0f}" '
             f'font-family="{FONT}">', "<defs>"]
        for name, col in [("l-data", "#334155"), ("l-gate", "#be123c"),
                          ("l-io", "#0891b2"), ("l-co", CO_TC)]:
            o.append(f'<marker id="{name}" viewBox="0 0 10 8" refX="9" refY="4" '
                     f'markerWidth="8" markerHeight="7" orient="auto-start-reverse">'
                     f'<path d="M0,0 L10,4 L0,8 z" fill="{col}"/></marker>')
        o.append("</defs>")
        o.append(f'<rect width="{self.W:.0f}" height="{self.H:.0f}" fill="#ffffff"/>')
        for k, (label, x0, x1, fill, ink) in enumerate(self.zone_rects):
            o.append(f'<rect x="{x0:.1f}" y="{ZONE_Y}" width="{x1 - x0:.1f}" '
                     f'height="{self.H - ZONE_Y:.0f}" fill="{fill}"/>')
            if k:
                o.append(f'<path d="M{x0:.1f},{ZONE_Y} L{x0:.1f},{self.H:.0f}" '
                         f'stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="7 5"/>')
            o.append(f'<text x="{x0 + 16:.1f}" y="{ZONE_Y + 20}" font-size="12.5" '
                     f'font-weight="700" letter-spacing="1.6" fill="{ink}" '
                     f'opacity="0.72">{escape(label.upper())}</text>')
        o.append(f'<text x="{MARGIN_L}" y="44" font-size="21" font-weight="700" '
                 f'fill="#0f172a">{escape(self.title)}</text>')
        o.append(f'<text x="{MARGIN_L}" y="66" font-size="12" fill="#64748b">'
                 f'{escape(self.subtitle)}</text>')
        o.append(f'<text x="{MARGIN_L}" y="82" font-size="10" fill="#94a3b8">'
                 f'{escape(self.key_line)}</text>')

        for k_i, (e, (pts, lab)) in enumerate(zip(self.edges, self.routes)):
            st = EDGE[e["kind"]]
            dash = f' stroke-dasharray="{st["dash"]}"' if "dash" in st else ""
            # A wrap carries the same payload as any other wire, but it is a consequence
            # of the page being folded, not of the flow. Drawn recessive so it reads as
            # "continues below" instead of competing with the band it crosses.
            wrap = ' opacity="0.5"' if k_i in self.wrapped else ""
            d = f'M{pts[0][0]:.1f},{pts[0][1]:.1f}'
            for i in range(1, len(pts), 3):
                d += " C" + " ".join(f"{x:.1f},{y:.1f}" for x, y in pts[i:i + 3])
            # The endpoints ride on the path so the viewer can thicken every wire touching
            # a hovered box -- what a box connects to is the question the drawing is for.
            o.append(f'<path class="fm-edge"{_ends(e)} d="{d}" fill="none" '
                     f'stroke="{st["stroke"]}" '
                     f'stroke-width="{st["sw"]}"{dash}{wrap} '
                     f'marker-end="url(#{st["head"]})"/>')
        for e, (_pts, lab) in zip(self.edges, self.routes):
            if not lab:
                continue
            shape = self.shape_of(e["src"], e["dst"], e["label"]) if self.shape_of else None
            st = EDGE[e["kind"]]
            lines = e["label"].split("\n")
            w = max(max(tw(line, FS_EDGE) for line in lines), tw(shape, FS_FOOT) if shape else 0) + 10
            h = 13 + 12 * (len(lines) - 1) + (10 if shape else 0)
            o.append(f'<g class="fm-elab"{_ends(e)}>')
            o.append(f'<rect x="{lab[0] - w / 2:.1f}" y="{lab[1] - 10:.1f}" '
                     f'width="{w:.1f}" height="{h}" rx="3" fill="#ffffff" opacity="0.93"/>')
            for line_index, line in enumerate(lines):
                o.append(f'<text x="{lab[0]:.1f}" y="{lab[1] + 12 * line_index:.1f}" font-size="{FS_EDGE}" '
                         f'fill="{st["stroke"]}" text-anchor="middle">'
                         f'{escape(line)}</text>')
            if shape:
                o.append(f'<text x="{lab[0]:.1f}" y="{lab[1] + 12 * (len(lines) - 1) + 9.5:.1f}" '
                         f'font-size="{FS_FOOT}" fill="{ANCHOR_TC}" text-anchor="middle">'
                         f'{escape(shape)}</text>')
            o.append("</g>")
        for n in self.nodes:
            self._draw(n, o)
        o.append("</svg>")
        return "\n".join(o)

    def _draw(self, n, o):
        s = STYLE[n.kind]
        dash = f' stroke-dasharray="{s["dash"]}"' if "dash" in s else ""
        o.append(f'<g class="fm-node"{_attrs(n)}>')
        if n.co:
            x, y = n.x + 10, n.y + n.box_h
            callers = getattr(n, "co_role", "") == "calledFrom"
            o.append(f'<path class="fm-caller-arrow" d="M{x:.1f},{y:.1f} L{x:.1f},{y + CO_LEN:.1f}" '
                     f'fill="none" stroke="{CO_TC}" stroke-width="1.5" '
                     f'marker-end="url(#l-co)"/>')
            if callers:
                o.append(f'<text x="{x + 9:.1f}" y="{y + 10:.1f}" font-size="{FS_FOOT}" fill="{CO_TC}">called from</text>')
            for i in range(0, len(n.co), 3):
                tx, ty = x + 9, y + (22 if callers else 13) + (i // 3) * 11
                for j, label in enumerate(n.co[i:i + 3]):
                    if j:
                        tx += tw(" · ", FS_FOOT)
                    target = getattr(n, "co_targets", {}).get(label)
                    if target:
                        o.append(f'<g class="fm-go fm-caller-reference" data-go="{escape(target, {chr(34): "&quot;"})}">')
                        o.append(f'<rect x="{tx - 2:.1f}" y="{ty - 9:.1f}" width="{tw(label, FS_FOOT) + 4:.1f}" height="12" fill="{CO_TC}" fill-opacity="0.004"/>')
                    else:
                        o.append('<g class="fm-caller-unresolved">')
                    o.append(f'<text x="{tx:.1f}" y="{ty:.1f}" font-size="{FS_FOOT}" fill="{CO_TC}">{escape(label)}</text>')
                    o.append('</g>')
                    tx += tw(label, FS_FOOT)
        o.append(f'<rect x="{n.x:.1f}" y="{n.y:.1f}" width="{n.w:.1f}" height="{n.box_h:.1f}" '
                 f'rx="{s["rx"]}" fill="{s["fill"]}" stroke="{s["stroke"]}" '
                 f'stroke-width="{s["sw"]}"{dash}/>')
        ty = n.y + PADY + LH_TITLE * .75
        for i, line in enumerate(n.lines):
            tx = n.x + PADX
            if i == 0 and n.num:
                o.append(f'<text x="{tx:.1f}" y="{ty:.1f}" font-size="{FS_TITLE}" '
                         f'font-weight="700" fill="#94a3b8">{escape(n.num)}</text>')
                tx += tw(n.num + " ", FS_TITLE)
            o.append(f'<text x="{tx:.1f}" y="{ty:.1f}" font-size="{FS_TITLE}" '
                     f'font-weight="700" fill="{s["tc"]}">{escape(line)}</text>')
            ty += LH_TITLE
        for line in n.note_lines:
            o.append(f'<text x="{n.x + PADX:.1f}" y="{ty:.1f}" font-size="{FS_NOTE}" '
                     f'fill="#64748b">{escape(line)}</text>')
            ty += LH_NOTE
        for row in n.reference_rows:
            tx = n.x + PADX
            for text, target in row:
                if target:
                    o.append(f'<g class="fm-go fm-port-reference" data-go="{escape(target, {chr(34): "&quot;"})}">'
                             f'<rect x="{tx - 2:.1f}" y="{ty - 9:.1f}" width="{tw(text, FS_FOOT) + 4:.1f}" '
                             f'height="12" fill="#0369a1" fill-opacity="0.004"/>')
                o.append(f'<text x="{tx:.1f}" y="{ty:.1f}" font-size="{FS_FOOT}" '
                         f'fill="{"#0369a1" if target else "#475569"}">{escape(text)}</text>')
                if target:
                    o.append('</g>')
                tx += tw(text, FS_FOOT)
            ty += LH_NOTE
        foot, col = n.foot
        if foot:
            o.append(f'<text x="{n.x + PADX:.1f}" y="{ty + FS_FOOT:.1f}" '
                     f'font-size="{FS_FOOT}" fill="{col}">{escape(foot)}</text>')
        o.append("</g>")
