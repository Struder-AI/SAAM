---
name: supports
description: Guidance for removable edge, underside and tree supports, chosen by unsupported feature and removal access.
metadata:
  saam-kind: guidance
---

# Supports

Choose for the unsupported feature, span, material, finish and removal access; often nothing is needed. Arches and spans between pillars can bridge directly without additional support. Owner experience: overhangs of 45° from vertical usually print, supports are often omitted even at 60°, and small steeper patches may need none. These guide judgment, never thresholds.

| Need | Construction and useful cases |
|---|---|
| Support an edge, not its whole underside | [Two-bead breakaway edge supports](../bridge-supports/SKILL.md) place two adjacent paths alongside a selected model edge or portion, between a printed base and landing. Use for exposed ribbon/ledge edges or hole/recess landing edges that need support. A plate base is optional. |
| Support an area | [Standard support](../standard-support/SKILL.md) copies selected underside patches into bed-reaching, infill-only solids. Use for broad roofs; a flat footprint covers a level patch. Choose patches and row direction together: rows under roughly 8 mm may print poorly. |
| Reach scattered contacts | The same standard-support tool accepts a tree skeleton. Use bed-rooted branches and accessible tips instead of filling the whole intervening volume. |

Breakaway edge supports automatically offset selected part edges outward by half the support bead width; use the original edges without adding a manual clearance offset. Inspect actual sliced bead clearance beside nearby pillars/walls, separately from standard support's roof/tip gap. Preserve intended base/landing attachment, a bed base/brim where needed, and removal access.

[Hole guidance](../hole-supports/SKILL.md) separately compares bore/recess treatments, including removable supports, membranes, stepped reduction and wave shoulders; it shares the underlying tools. Review [saved geometry and toolpath](../../core/print/USAGE.md), support readiness and clearances before Export. Software does not establish adhesion, clean removal or physical printing.
