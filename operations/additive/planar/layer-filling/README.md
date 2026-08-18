# Planar Layer Filling

The most basic additive operation: cover a flat cross-section with printable
paths, one layer at a time. Two coverage strategies, chosen automatically
from the requested geometry (see `manifest.json` &rarr; `inputs`).

## Rectilinear

For a rectangular cross-section: `wallCount` concentric offset perimeters
(`Prioritized perimeter`), then a raster fill (`Region-first raster`) sized
to stay inside them.

- **Perimeter offset.** Each perimeter sits at `beadWidth / 2 + wall *
  spacing` from the nominal edge — the first perimeter's centerline lands a
  half bead-width inside the boundary, and each perimeter after it steps
  inward by one full bead spacing, so adjacent beads overlap by a
  controlled, consistent amount rather than leaving a gap or over-fusing.
- **Region-first raster.** The raster direction alternates by layer
  (horizontal lines on even layers, vertical on odd) so successive layers
  cross rather than stack, which is what gives a solid infill region its
  strength perpendicular to any single layer's fill direction. Within one
  layer, each line's start and end alternate sides, turning what would
  otherwise be many disconnected segments into one connected sweep across
  the region — this is what "region-first" means: finish traversing a
  connected area before leaving it, rather than jumping between distant
  segments.

## Concentric

For a circular or annular cross-section: an `Outer perimeter`, an optional
`Inner perimeter` when `innerDiameter` is set, and evenly-spaced
`Concentric fill` rings between them.

- Ring spacing starts at the innermost radius that still fits a full bead
  (`max(spacing / 2, innerRadius + spacing / 2)`) and steps outward by
  `spacing` until the outer boundary is reached, so coverage is complete
  without an oversized or undersized final gap at either edge.

## Inputs, outputs, and evidence

See `manifest.json`. This operation's generator (`generator.mjs`) has no
dependencies and is deterministic: identical `parameters` and `settings`
always produce byte-identical output — see `../../../../tests/golden/` for
the fixture this is checked against.

Its `maturity` is `experimental`: the generator is tested and internally
consistent, but this exact manifest/generator revision has not yet been
run on physical hardware. See `../../../../docs/authoring/evidence-labels.md`.
