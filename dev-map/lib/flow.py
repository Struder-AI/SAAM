"""Flow-page marks: the box and wire styles a function-body page draws with, and the rule that
reads a box's style off how its link was resolved. Importing this module registers those styles.
Nothing on a flow page is authored."""
from leveled import STYLE, EDGE

# Box: how the link from this function to that component was resolved.
STYLE["ast"] = dict(fill="#ffffff", stroke="#1e293b", sw=1.9, rx=7, tc="#0f172a")
STYLE["recv"] = dict(fill="#eff6ff", stroke="#2563eb", sw=1.9, rx=7, tc="#1e3a8a")
STYLE["heur"] = dict(fill="#fffbeb", stroke="#d97706", sw=1.5, rx=6, tc="#78350f", dash="2 4")
STYLE["throw"] = dict(fill="#fff1f2", stroke="#be123c", sw=1.5, rx=13, tc="#9f1239")
EDGE["state"] = dict(stroke="#ca8a04", sw=1.7, head="l-state")
# The invocation edge: this function invokes that box, as its Nth call. Thin, dotted and its own
# colour, because it carries no value — every wire that carries one is solid and darker.
EDGE["invocation"] = dict(stroke="#6366f1", sw=1.1, head="l-invoke", dash="1 4")
MARKERS = '<marker id="l-state" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" ' \
          'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,4 L0,8 z" ' \
          'fill="#ca8a04"/></marker>' \
          '<marker id="l-invoke" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="7" ' \
          'markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,4 L0,8 z" ' \
          'fill="#6366f1"/></marker></defs>'


def kind_of(links):
    return "recv" if ("receiver-value" in links or "value-follow" in links) else "ast"
