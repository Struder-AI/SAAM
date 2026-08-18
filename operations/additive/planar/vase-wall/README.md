# Vase / Spiral Wall

A single continuous helical wall — the "vase mode" or "spiral vase" family
found in mainstream slicers (see `ROADMAP.md`'s planar operation catalog):
no separate inner perimeter, no infill, no distinct top/bottom layers of
its own. By definition it's just one wall, wound upward.

`baseOuterDiameter` and `topOuterDiameter` don't have to match — when they
differ, the wall tapers linearly from one to the other over `height`, in
addition to spiraling upward. A straight (non-tapered) vase wall is the
special case where they're equal.

## What this actually requires of a machine

This is an ordinary planar (XY) ring — the same family as `layer-filling`'s
own "Outer perimeter" — that simply never resets Z to a constant between
passes, and whose radius is allowed to change per revolution instead of
staying fixed. It is not a heightfield surface like `non-planar-cladding`
(Z is never a function of X/Y position within a pass), and it does not
need `coordinated-xyz-motion`: `planar-motion` is all this requires — the
same capability `layer-filling` already depends on, which is
ROBOT-CONFIRMED on the reference machine from extensive prior print
history. Don't reach for this operation's manifest and assume it inherits
`non-planar-cladding`'s much less certain evidence; it doesn't.

## How it composes

This operation only needs a starting Z (`zStart`) — it has no dependency
on any other operation at the code level. The usual composition is
`layer-filling` first (a solid or perimeter-only base), then this
operation continuing upward from that base's own top Z. See
`docs/authoring/operations.md`.

## Evidence and safety

This generator is deterministic and tested against golden fixtures, but
this exact manifest/generator revision has not itself been run on
physical hardware yet — the same maturity gap `layer-filling` and
`non-planar-cladding` both carry, unrelated to the underlying motion
capability's own evidence.

**The steep-taper warning is general FDM knowledge, not this project's own
evidence.** When the requested taper implies a per-revolution radial shift
steeper than roughly 45&deg; from vertical — the widely-cited
unsupported-overhang guideline used across FDM printing generally — the
generator's return value includes a `warnings` entry explaining the actual
angle involved. That threshold isn't ROBOT-CONFIRMED for this machine;
it's a general heuristic applied here because nothing more specific exists
yet. A plan can still be compiled and previewed past that warning — this
operation reports, it doesn't refuse — but treat the warning as real
information, not noise.
