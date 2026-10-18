---
name: hole-supports
description: Experimental. Downward-hole printing with removable supports, a drill-through membrane, stepped reduction or wave fronts.
metadata:
  saam-kind: guidance
---

# Downward-facing holes

Choose in chat for a recess narrowing into a bore above air; review removal access, span, material and cooling through the [shared review workflow](../../core/print/USAGE.md). All four constructions are physically unqualified.

| Construction | Treatment and finishing | Reference scope |
|---|---|---|
| [Removable landing support](../bridge-supports/SKILL.md) · [example](../bridge-supports/examples/removable.json) | Printed base or explicit plate → two-loop support courses → selected landing edge. Remove afterward. | Existing printed edges; open or closed, with matched geometry. Plate bases are explicit. |
| [Drill-through membrane](../hole-transitions/SKILL.md) · [example](examples/membrane.json) | Printed boundary → straight bridge spans. Pierce or drill through afterward. | One closed edge or two loft bounds, including nonplanar geometry; identical to general bridging. |
| [Stepped reduction](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/stepped.json) | Partial bridge stages retain an open passage, then resume the bore. | Select the printed base and final edge; ordinary native Slice masks own the partial bridge stages. |
| [Wave shoulder](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/wave.json) | Printed base edge → interpolated fronts toward a final geometric edge. | Paired edges, including nonplanar geometry. Only the base edge is an external prerequisite. |

Helpers derive manufacturing prerequisites. The scheduler places independent
work and handles uncovered interference; Export owns physical machine transfers.
Inspect geometry, material ownership and attachment in Studio.

The membrane example selects a printed square rim and fills its interior
through the same shared edge construction as bridging. The other linked
examples demonstrate their own geometry and scale; they are not all variants
of one 16 mm exemplar. [Original STEP provenance](references/README.md) remains
historical reference material. Inspect actual attachment and native slice order.
