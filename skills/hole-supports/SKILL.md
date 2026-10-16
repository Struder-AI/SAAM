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
| [Removable landing support](../bridge-supports/SKILL.md) · [example](../bridge-supports/examples/removable.json) | Printed base or bed → sequential Trace stack → landing bridge → bore walls; remove the stack afterward. | General XYZ/NURBS curves, open or closed; no horizontal/planar-curve restriction. The bed-base exception uses Z=0. |
| [Drill-through membrane](../hole-transitions/SKILL.md) · [example](examples/membrane.json) | Printed rim → one dense straight bridge membrane → first bore wall; pierce or drill through afterward. | Helper supports planar references, including tilted planes and oblique stacks; curved membranes unverified. |
| [Stepped reduction](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/stepped.json) | Printed rim → slot → square → octagon at 0/90/45° → round bore on the fourth course. Enlarges the bore locally; retains an open passage. | Planar source layers, including tilted planes and oblique stack translations; curved slices unsupported. |
| [Wave shoulder](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/wave.json) | Printed seed → inward fronts → next bore walls, retaining the bore. The seed region denotes existing material; inspect front residuals and bore-wall contact. | Regular injective spline charts and translated stacks, including curved references and non-Z directions; no normal-offset or multi-chart stacks. |

Helpers own hard support sequences; select printed base/seed and landing/bore operations using their native Slice or named Trace identity. Membrane/stepped boundaries are derived automatically; removable/wave helpers bind the selected boundaries. Unrelated body work stays free, fill traversal stays soft, and scheduling owns travel. Inspect hard edges, strand order, ownership and contact in execution.

The membrane helper owns its guide, fill and edges. The static example bridges at Z4.0 from Z3.8 rim walls, then continues the bore at Z4.2, adapting TKeller's [original exemplar](references/README.md).
Each linked example is one complete 16×16×8mm part with one technique (R5 recess to Z4; R2 bore), visually accepted 2026-10-16. Inspect contact and operation/strand order around Z4–4.6; report wave residue. Example Trace curves use assembly XYZ.
