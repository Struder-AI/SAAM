---
name: hole-supports
description: Experimental. Downward-hole printing with removable supports, a drill-through membrane, stepped reduction or wave fronts.
metadata:
  saam-kind: guidance
---

# Downward-facing holes

Choose in chat for a recess narrowing into a bore above air; review removal access, span, material and cooling. All four constructions are physically unqualified.

| Construction | Treatment and finishing | Reference scope |
|---|---|---|
| [Removable landing support](../bridge-supports/SKILL.md) | Trace stacks join selected base and landing curves; bridge from the printed edge and remove it later. | General XYZ/NURBS curves, open or closed; no horizontal/planar-curve restriction. The bed-base exception uses Z=0. |
| Drill-through membrane | Additional dense, zero-loop, single-direction Slice below the first overhang course; anchor into the rim, then drill through. | Ordinary Slice can use planes or regular spline references; the worked layer placement below is horizontal. |
| [Stepped reduction](../hole-transitions/SKILL.md) | Slot → square → octagon over three bridge courses at 0/90/45°; the fourth resumes the round bore. Enlarges the bore locally; retains an open passage. | Planar source layers, including tilted planes and oblique stack translations; curved slices unsupported. |
| [Wave shoulder](../hole-transitions/SKILL.md) | Seeded fronts grow inward from the supported rim, retaining the bore. Inspect residuals and the next bore layer's contact. | Regular injective spline charts and translated stacks, including curved references and non-Z directions; no normal-offset or multi-chart stacks. |

Membranes need a thin filled guide solid. With a Z6 shoulder and 0.2mm layers,
place it at Z5.8–6.0 before the first overhang at Z6.2; order lower body, membrane and upper body on one grid, retaining walls/fill and rim overlap.
This earlier membrane is the owner's adaptation of TKeller's [original exemplar](references/README.md), which uses the overhang course.
Other references need corresponding earlier surfaces and anchors; curved membranes remain unverified.

[Whole-part comparison](examples/whole-parts.json): four complete Ø30×12mm bodies (Ø14 recess to Z6; Ø6 bore), with original membrane, stepped reduction and 50%/75% sleeves left to right.
This geometry-review `create_bundle` input omits `bundleId`; ordinary Slice does not encode TK's reserved bridge-before-contour ordering.
Its 48-segment meshes derive from the supplied TK reference: original membrane Z6–6.2, 0.2mm layers; sleeve dimensions remain in the recipe descriptions.
Use normal Bundle revisions and the [shared review workflow](../../core/print/USAGE.md).
