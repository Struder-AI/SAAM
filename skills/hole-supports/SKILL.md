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
| Drill-through membrane · [example](examples/membrane.json) | Printed rim → one dense straight bridge membrane → first bore wall; pierce or drill through afterward. | Ordinary Slice can use planes or regular spline references; the worked layer placement below is horizontal. |
| [Stepped reduction](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/stepped.json) | Printed rim → slot → square → octagon at 0/90/45° → round bore on the fourth course. Enlarges the bore locally; retains an open passage. | Planar source layers, including tilted planes and oblique stack translations; curved slices unsupported. |
| [Wave shoulder](../hole-transitions/SKILL.md) · [example](../hole-transitions/examples/wave.json) | Printed seed → inward fronts → next bore walls, retaining the bore. The seed region denotes existing material; inspect front residuals and bore-wall contact. | Regular injective spline charts and translated stacks, including curved references and non-Z directions; no normal-offset or multi-chart stacks. |

Declare incoming and outgoing operation dependencies: Trace uses `after`; Slice uses `dependencies.after`. Name the supporting base course and make the later bridge/bore wall wait for its support. Keep higher body layers available to interleave.
Stepped reduction wires rim walls → stages → first bore walls automatically; `after` adds prerequisites. `sequence:true` chains support Trace repetitions; bridge-supports reports `lastOperationId` for its landing. Membrane/wave and removable-support callers still wire their boundary edges; use Slice `operationAfter` in the relevant slice override to target walls. Inspect required edges, ownership and bead contact in execution.

Membranes use a thin filled guide solid and one dense, single-direction Slice: `loops:0`, `fillDensity:1`, `fillAnglesDeg:[0]`, `rotateFill:false`, `connectNearby:false`. Anchor straight strands at both ends on the printed rim. The reviewed example has its guide at Z3.8–4.0, bridges at Z4.0, then prints the first bore walls at Z4.2 on the same 0.2mm grid.
This earlier membrane adapts TKeller's [original exemplar](references/README.md), which uses the overhang course. Other references need corresponding earlier surfaces and anchors; curved membranes remain unverified.

Each linked example is one complete 16×16×8mm part with one technique (R5 recess to Z4; R2 bore). Inspect support contact and both operation and strand order around Z4–4.6 in chronological playback; report unresolved wave residue. Example Trace curves use assembly XYZ.
