---
name: hole-transitions
description: Experimental. Edge-based membranes and advancing shoulders, with stepped reduction.
metadata:
  saam-kind: extension
---

# Hole transitions

[Hole guidance](../hole-supports/SKILL.md) owns choice and finishing. Call
`apply_extension` with `extensionId:"hole-transitions"` and a lowercase `id`.

## Select edges

Select `base` with [printed-edge selectors](../bridging/SKILL.md); the tool
derives geometry and prerequisites. `target` may also select
`{geometry:"existing-spatial-curve-id",part:null}`.

## Membrane and wave

`strategy:"membrane"` uses one closed boundary, or two printed bounding edges.
Its straight spans preserve 3D endpoints, including nonplanar bounds. This is
[bridging](../bridging/SKILL.md)'s exact construction and dependency wiring.
`strategy:"wave"` interpolates fronts from base to target. Only the base and
previous front are required; the target defines geometry. Both retain the solid.

Process inherits the base. Overrides: `spacingMm` (bead width), `layerHeightMm`,
`beadWidthMm`, `speedMmS`, `sampleStepMm`, seam/direction `correspondence`,
`angleDeg` for one-boundary spans, and `normalSide` (1 or -1). Membrane endpoints
rise one bead height; waves follow the selected base-to-target surface.

## Stepped reduction

`strategy:"stepped-reduction"` selects a closed native Slice base and a final
edge on a later slice of that stack. Partial bridge bands become ordinary
`sliceOverrides.regionUv` material masks with dense, alternating row fill.
Only native predecessor order applies; no duplicate producer or target
prerequisite is added. The design solid stays unchanged.

The final aperture must be convex, fit inside the base and finish within half a
bead width of the last stage; select a later target for more stages. Concave
passages need explicit bridge bands. Tilted/nonplanar charts use the same query,
physical offsets and masks. Optional `angleDeg`, `sampleStepMm` and `toleranceMm`
control layout. Reapply from the prior recipe after edge or stack-spacing edits.

[Examples](examples/README.md) verify software construction only. Review span,
cooling, attachment, machine access and finishing.
