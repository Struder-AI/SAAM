---
name: wave-overhangs
description: Guidance for lateral overhangs using the shared printed-base/final-edge wave construction.
metadata:
  saam-kind: guidance
---

# Wave overhangs

Use [hole transitions](../hole-transitions/SKILL.md#membrane-and-wave) with
`strategy:"wave"`. Select an actual printed base edge and a final geometric
edge. Shared curve-pair construction interpolates fronts between them; only
the base and each front's predecessor are manufacturing prerequisites.
The target defines geometry and need not be printed first.

The [canopy](examples/box-canopy.json) grows inward from the actual final
Slice rim of an open box toward a small central opening. The selected base
uses the emitted rim height, not the design solid's unsliced top. The
[saddle](examples/box-saddle.json) shows the same construction on curved
geometry; its varying orientation needs a compatible machine for Export.
These examples replace the old seeded-domain examples; they do not assert
identical geometry or physical qualification.

The seeded-front Slice fill engine and its propagation settings are retired.
Old recipes require new base/target selection and review. Existing saved
toolpaths remain inspectable. Use separate edge pairs for branches that a
single correspondence cannot represent; do not hide topology changes in
control-point density. Inspect attachment, lateral spacing and cooling in
Studio. Lateral adhesion and warping remain physically unqualified.

[Research provenance](DEVELOPER.md) records the earlier investigation.
