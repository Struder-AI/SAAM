# Planar Layer Filling

The most basic additive operation: cover a flat cross-section with printable
paths, one layer at a time. Two boundary shapes, chosen automatically from
the requested geometry (see `manifest.json` &rarr; `inputs`) — a rectangle
or a circle/annulus — but the same fill strategy either way: raster lines
that alternate direction by layer, clipped to whichever boundary was
requested.

**Why fill always alternates by layer, boundary shape aside.** Identical
fill stacked layer after layer — even a "circular" pattern like evenly
spaced concentric rings — has no strength perpendicular to whatever
direction it repeats in, no matter how the outer perimeter is shaped. This
operation had that gap for a while: the rectangular case always alternated
raster direction by layer, but the circular case used to fall back to
concentric rings that were identical on every layer, with no crosshatch at
all — a real inconsistency between the two branches, not a deliberate
design choice. Fixed by giving circular/annular geometry the same
alternating raster fill the rectangular case already had, clipped to the
circular boundary instead of a rectangular one.

## Perimeters

- **Rectangular:** `wallCount` concentric offset perimeters
  (`Prioritized perimeter`). Each sits at `beadWidth / 2 + wall * spacing`
  from the nominal edge — the first perimeter's centerline lands a half
  bead-width inside the boundary, and each perimeter after it steps inward
  by one full bead spacing, so adjacent beads overlap by a controlled,
  consistent amount rather than leaving a gap or over-fusing.
- **Circular/annular:** an `Outer perimeter`, and an `Inner perimeter` when
  `innerDiameter` is set.

## Fill (`Region-first raster`)

Raster direction alternates by layer — horizontal lines on even layers,
vertical on odd — so successive layers cross rather than stack, which is
what gives a solid infill region its strength perpendicular to any single
layer's fill direction. Within one layer, each line's start and end
alternate sides, turning what would otherwise be many disconnected
segments into one connected sweep across the region — this is what
"region-first" means: finish traversing a connected area before leaving
it, rather than jumping between distant segments.

For a circular or annular boundary, each raster line's endpoints are the
chord where that line crosses the outer circle; where a line also crosses
the inner circle (an annulus), it splits into two segments routed around
the hole instead of running through it.

## Inputs, outputs, and evidence

See `manifest.json`. This operation's generator (`generator.mjs`) has no
dependencies and is deterministic: identical `parameters` and `settings`
always produce byte-identical output — see `../../../../tests/golden/` for
the fixture this is checked against.

Its `maturity` is `experimental`: the generator is tested and internally
consistent, but this exact manifest/generator revision has not yet been
run on physical hardware. See `../../../../docs/authoring/evidence-labels.md`.
