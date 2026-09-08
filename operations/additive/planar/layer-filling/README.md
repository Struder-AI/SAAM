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
- **Circular/annular:** `wallCount` outer loops, plus `wallCount` inner loops when `innerDiameter` is set. Off-center holes also receive `wallCount` loops.

## Fill and boundary clearance

Scan rows alternate direction by layer. Holes split each row into printable
intervals. At every interval split or merge, the ordering code starts a new
region; it finishes that region's complete zigzag before visiting another.
A single central hole therefore has one sweep on each side instead of a
cross-hole transfer on every row. Multiple holes can create more regions
and require more than one transfer overall.

Consecutive strokes inside one region are joined by print-intent
`Raster connection` paths, regardless of connector length. The short row
at the front of a curved region therefore stays connected even when its
neighbor's endpoint is far away. There is no travel-distance threshold.
Only region boundaries get travel/hops. If a very sparse scan would make
a straight connector cross a hole's innermost boundary loop, that connector
marks a geometric region break instead of printing through the void.

The circular fill outer radius is
`outerDiameter/2 - beadWidth/2 - wallCount*spacing`. The bore exclusion
radius is `innerDiameter/2 + beadWidth/2 + wallCount*spacing`; off-center
holes use the same outward allowance. These are centerline boundaries, one
spacing beyond the last boundary loop, and are recalculated for every loop
count. Previously circular fill used the nominal radii and emitted only
one outer/inner loop; rectangular fill already subtracted a wall-count
allowance from its available rectangle. That caused the discrepancy.

Ordering evaluates four serpentine entries per region, minimizing entry
plus internal travel. It also moves closed-loop seams to existing vertices
and chooses nearby hole contours. This is a deterministic local heuristic,
not a globally shortest tour. It preserves the generated raster strokes
and contour edges; the inset change deliberately changes the usable fill
region.

`settings.travelHopHeight` adds explicit travel between disconnected paths (`0` for no
lift). A positive value lifts above preceding print geometry, crosses, and
descends. It is shared with the other operations; see
[travel](../../../../docs/authoring/travel.md). Without this setting, legacy
unplanned gaps remain, and exporters warn about them.

## Solid top/bottom layers, infill density, and a centered bore

Rectangular geometry only. `solidBottomLayers`/`solidTopLayers` force that
many layers at each end to full density (`spacing === beadWidth`)
regardless of `infillDensity` elsewhere — the usual "solid caps over
sparse infill" pattern. `infillDensity` is a rough single-layer coverage
model (`beadWidth / spacing`) for this rectilinear pattern specifically —
general infill-density math, not evidence specific to this project or
measured against a real print's actual strength or dimensional accuracy.

`boreDiameter`/`boreDepth` cut a centered cylindrical bore into the top
face — distinct from `innerDiameter`'s full-through annulus, which only
applies to circular/annular geometry and can't express a partial-depth
hole. The bore gets its own `wallCount` inner-perimeter walls and clips
the raster fill around it, on every affected layer regardless of that
layer's solid/sparse classification: a hole open at the top face has to
stay open through solid top layers too, not get bridged over.

A blind bore's floor — where the cavity ends and solid material resumes
below it — is a top-facing surface in exactly the same sense the part's
own outer top is (open void above, solid material below), so it gets the
same `solidTopLayers` count of full-density layers, counting downward
from the floor instead of from the part's top. A through-hole
(`boreDepth` equal to the part's full height) has no floor and gets no
extra cap.

**Known limitation, not yet built:** this floor-cap treatment is wired
specifically to `boreDiameter`/`boreDepth`, not a general "detect every
internal top/bottom-facing surface" system — the kind of thing
`ROADMAP.md`'s "sparse-to-solid interface layers" entry describes as not
yet built. A future second internal void from a different operation
wouldn't get this automatically; this fix covers the bore case this
operation itself creates, not the general problem.

## Inputs, outputs, and evidence

See `manifest.json`. This operation's generator (`generator.mjs`) has no
dependencies and is deterministic: identical `parameters` and `settings`
always produce byte-identical output — see `../../../../tests/golden/` for
the fixture this is checked against.

Its `maturity` is `experimental`: the generator is tested and internally
consistent, but this exact manifest/generator revision has not yet been
run on physical hardware. See `../../../../docs/authoring/evidence-labels.md`.
