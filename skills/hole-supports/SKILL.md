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
| [Removable landing support](../bridge-supports/SKILL.md) | Printed base or bed → sequential Trace stack → landing bridge → bore walls; remove the stack afterward. | General XYZ/NURBS curves, open or closed; no horizontal/planar-curve restriction. The bed-base exception uses Z=0. |
| Drill-through membrane | Printed rim → one dense straight bridge membrane → first bore wall; pierce or drill through afterward. | Ordinary Slice can use planes or regular spline references; the worked layer placement below is horizontal. |
| [Stepped reduction](../hole-transitions/SKILL.md) | Printed rim → slot → square → octagon at 0/90/45° → round bore on the fourth course. Enlarges the bore locally; retains an open passage. | Planar source layers, including tilted planes and oblique stack translations; curved slices unsupported. |
| [Wave shoulder](../hole-transitions/SKILL.md) | Printed seed → inward fronts → next bore walls, retaining the bore. The seed region denotes existing material; inspect front residuals and bore-wall contact. | Regular injective spline charts and translated stacks, including curved references and non-Z directions; no normal-offset or multi-chart stacks. |

Declare incoming and outgoing operation dependencies: Trace uses `after`; Slice uses `dependencies.after`. Name the supporting base course and make the later bridge/bore wall wait for its support. Keep higher body layers available to interleave.
Helpers accept the first predecessor through `after`, defaulting to empty. `sequence:true` chains Trace repetitions; stepped reduction chains its stages; bridge-supports reports `lastOperationId`. The caller wires the outgoing edge to the continuing body. Inspect these edges in the generated schedule, alongside ownership and bead contact.

Membranes need a thin filled guide solid and straight, dense bridge strands anchored at both ends on the printed rim. With a Z6 shoulder and 0.2mm layers, place it at Z5.8–6.0 before the first overhang at Z6.2, retaining body walls/fill and rim overlap on one grid.
This earlier membrane adapts TKeller's [original exemplar](references/README.md), which uses the overhang course. Other references need corresponding earlier surfaces and anchors; curved membranes remain unverified.

[Membrane alone](examples/membrane.json) isolates one technique. The [whole-part comparison](examples/whole-parts.json) has four complete 16×16×8mm bodies (R5 recess to Z4; R2 bore), left to right: removable landing support, membrane, stepped reduction and wave shoulder.
The recipe separates support courses from the ordinary body: Trace landing stack, membrane at Z4, bridges at Z4.2/4.4/4.6, and printed anchor rings followed by inward fronts at Z4.2. Its authored Trace curves use assembly XYZ. Inspect Z4–4.6 and succeeding bore walls in chronological playback; report unresolved wave residue.
