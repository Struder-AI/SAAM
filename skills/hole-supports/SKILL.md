---
name: hole-supports
description: Experimental. Downward-hole printing with removable supports, a drill-through membrane, stepped reduction or wave fronts.
metadata:
  saam-kind: guidance
---

# Downward-facing holes

Choose for a recess narrowing into a bore above air; [general support guidance](../supports/SKILL.md) separately covers exposed edges and underside patches using the same tools. Review removal, span, material and cooling through the [shared workflow](../../core/print/USAGE.md). All four constructions are physically unqualified.

| Construction | Treatment and finishing | Reference scope |
|---|---|---|
| [Breakaway edge support](../bridge-supports/SKILL.md) · [historical example](../bridge-supports/examples/removable.json) | Printed base or explicit plate → two-bead support wall → selected landing edge. Remove afterward. | Model edges or portions, open or closed, with derived Slice targets. Plate bases are explicit. |
| [Drill-through membrane](../hole-transitions/SKILL.md) · [example](examples/membrane.json) | Printed boundary → straight bridge spans. Pierce or drill through afterward. | One closed edge or two loft bounds, including nonplanar geometry; identical to general bridging. |
| [Stepped reduction](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/stepped.json) | Partial bridge stages retain an open passage, then resume the bore. | Select the printed base and final edge; ordinary native Slice masks own the partial bridge stages. |
| [Wave shoulder](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/wave.json) | Printed base edge → interpolated fronts toward a final geometric edge. | Paired edges, including nonplanar geometry. Only the base edge is an external prerequisite. |

Helpers derive prerequisites; the scheduler places independent work and handles uncovered interference. Export owns machine transfers. Inspect geometry, material ownership and attachment in Studio.

The membrane example fills a printed square rim through shared bridging. Other examples have their own geometry and scale; [original STEP provenance](references/README.md) is historical. Inspect actual attachment and native slice order.
