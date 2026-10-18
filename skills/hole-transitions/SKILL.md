---
name: hole-transitions
description: Experimental. Edge-based membranes and advancing shoulders, with stepped reduction.
metadata:
  saam-kind: extension
---

# Hole transitions

The [hole-support guidance](../hole-supports/SKILL.md) owns choice and finishing.
Call `apply_extension` with `extensionId:"hole-transitions"` and an unused `id`.

## Membrane and wave

Select an existing printed `base` edge: `{assignment,index,edge:{loop,ring:0}}`
for Slice, or `{assignment,repetition,edge:{curve}}` for Trace. Optional `part`
disambiguates a producer's component. Use `intersect_geometry`'s `edges` request
for discovery. Geometry and prerequisites resolve automatically.

`strategy:"membrane"` uses one closed base boundary, or `base` and `target`
printed bounds for a loft. Straight strands preserve the actual 3D endpoint
positions, including nonplanar boundaries. This is the same construction and
manufacturing wiring as [bridging](../bridging/SKILL.md), with no special hole
geometry or continuation wall IDs. The generated Trace requires its supporting
edge or edges. It leaves part geometry unchanged.

`strategy:"wave"` requires `base` and a final `target` edge. The target can be a
printed-edge selector or `{geometry:"existing-spatial-curve-id",part:null}` for
an existing XYZ curve. It defines geometry and is never a printed prerequisite.
Interpolated fronts require the base, then only the previous front. No seed
regions, source stack, continuation wiring, offsets, brim or plate base are used.

Both use `spacingMm` (default bead width), `layerHeightMm`, `beadWidthMm`,
`speedMmS` and `sampleStepMm` overrides. Process inherits the base edge.
`correspondence` chooses paired-curve directions/seams; `angleDeg` chooses the
single-boundary membrane's span direction. `normalSide` is 1 or -1. Regenerate and
review after changes. Bridge endpoints rise one bead height above their support;
wave geometry follows the selected base-to-target surface.

## Stepped reduction

The current stepped helper still uses `sourceAssignment`, `centerMm`,
`boreRadiusMm`, `counterboreRadiusMm`, `angleDeg`, `speedMmS` and `toleranceMm`.
It requires a planar source shoulder and four continuing bore layers. It cuts
three intermediate openings and publishes their native slice order. This older
construction remains scheduled for replacement by the common edge mechanism;
the membrane/wave interfaces above do not use it.

Saved [examples](examples/README.md) are ordinary recipe records, not physical
qualification. Review cooling, span, attachment and finishing.
