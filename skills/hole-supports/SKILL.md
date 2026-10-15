---
name: hole-supports
description: Experimental. Downward-hole printing with removable supports, a drill-through membrane, stepped reduction or wave fronts.
metadata:
  saam-kind: guidance
---

# Downward-facing holes

For a recess narrowing into a bore above air, choose the construction in chat.
Review removal access, bridge span, material and cooling; all four are physically unqualified.

| Construction | Treatment and finishing | Reference scope |
|---|---|---|
| [Removable landing support](../bridge-supports/SKILL.md) | Trace stacks join selected base and landing curves; bridge from the printed edge and remove it later. | General XYZ/NURBS curves, open or closed; no horizontal/planar-curve restriction. The bed-base exception uses Z=0. |
| Drill-through membrane | Additional dense, zero-loop, single-direction Slice below the first overhang course; anchor into the rim, then drill through. | Ordinary Slice can use planes or regular spline references; the worked layer placement below is horizontal. |
| [Stepped reduction](../hole-transitions/SKILL.md) | Slot → square → octagon over three bridge courses at 0/90/45°; the fourth resumes the round bore. Enlarges the bore locally; retains an open passage. | Planar source layers, including tilted planes and oblique stack translations; curved slices unsupported. |
| [Wave shoulder](../hole-transitions/SKILL.md) | Seeded fronts grow inward from the supported rim, retaining the bore. Inspect residuals and the next bore layer's contact. | Regular injective spline charts and translated stacks, including curved references and non-Z directions; no normal-offset or multi-chart stacks. |

Membranes need a thin filled guide solid/footprint: slicing empty air cannot create one.
With a shoulder at Z6.0 and 0.2mm layers, its course tops at Z6.0 (material 5.8–6.0),
and the first model overhang course tops at Z6.2. Order lower body, membrane and
upper body on the same grid, preserving model geometry and ordinary wall/fill settings.
Anchor overlap is intentional. This earlier membrane is the owner's adaptation of
TKeller's idea; the [original exemplar](references/README.md) prints it in the overhang course.
For other references author the corresponding earlier surface and supported anchors;
this is an available Slice construction, not a verified curved-membrane example.
Use normal Bundle revisions and the [shared review workflow](../../core/print/USAGE.md).
