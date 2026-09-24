---
name: advanced-vase-wall
description: Vase walls patterned with repeated tiles or authored paths on a sleeve, with optional smooth mesh fitting.
---

# Advanced vase mode

Use for tiled or authored patterns and fitted mesh sleeves. For a conventional
continuous spiral, choose [standard vase mode](../vase-wall/SKILL.md).
The two manuals share the existing `skills.vase-wall` recipe and slicer;
`advanced-vase-wall` is a discovery/manual ID, not a separate recipe key.

Use for an open single-wall vessel or tube. The selected solid or closed sleeve
is a reference envelope; vase-wall deposits the wall and leaves the interior and
roof open. A modeled bore is unnecessary. A base is a separate full-fill choice.
A looping tile can resemble a gyroid; it is a self-crossing toolpath, not an
implicit gyroid solid. The pattern may leave openings between deposited strokes.

**Terms.** A **sleeve** is a surface periodic in one direction, closing on a seam,
and open in the other: the side of a tube. Paths are laid out on it; it is
never deposited. A **tile** is one continuous curve drawn in one cell of the
sleeve's unwrapped strip. A **course** is one full circuit of tiles. The
**pattern** is the whole arrangement: courses of a repeated tile, or authored
paths. People say "pattern" for the tile too; changing the tile changes the
pattern. Read "bigger", "denser" or "tilted" by which one they mean: tile size
and `tiltDeg` belong to the tile, `cellsPerTurn` and `courseRiseMm` to the pattern.

## Workflow

Use the [shared print tools](../../core/print/USAGE.md) for import, recipe changes, generation, Studio review
and delivery. Enable `skills.vase-wall` and select an optional full-fill base.
For a base, set a positive `zStartMm` aligned to the process layer grid. Set
`zEndMm` explicitly when the upper geometry is unsuitable; generation never
shortens a requested wall.

### Mesh input workflow

For an imported mesh, prepare a fitted sleeve before generation:

```sh
node skills/vase-wall/scripts/prepare-mesh.mjs Prints/PART --options mesh-vase-options.json
```

Example `mesh-vase-options.json` for a dense, wide-loop fit:

```json
{
  "loop": {"widthCells": 2.6, "depthMm": 4.8, "samples": 64},
  "cellsPerTurn": 36,
  "tiltDeg": 0,
  "endTransition": "level",
  "meshSleeve": {
    "fidelity": 0.5,
    "detailToleranceMm": 0.2,
    "offsetTightness": 0,
    "contactSide": "inside",
    "circumferentialControls": 12,
    "heightControls": 6
  }
}
```

Omitting `repeats` on a newly selected tile derives a complete course count for
the detected interval; omitting `courseRiseMm` uses the process layer height.
The helper derives a base from the process settings unless `baseHeightMm` is
specified. These are example shape choices, not universal print settings.

The preparation command detects one dominant outer sleeve, chooses an explicit
usable height interval, preserves the source mesh, and writes a normal recipe
revision. `--expected-revision REV` protects a caller's revision. Preparation
does not generate a program or grant approval. Existing tile/repeat choices are
retained unless explicitly replaced; conflicting producers and regional plans
must be changed through the ordinary recipe tools.

Use `composition.regions` for a same-part stack: assign full-fill to a base or
cap, vase-wall to the intervening wall, and later skills to their own material
regions. The [shared lifecycle](../../core/print/README.md) carries geometry, operation dependencies, machine
checks, Studio review and the exact delivered machine bytes.

## Input geometry: normally a solid

The normal input is a validated closed mesh or an untrimmed closed spline shell
with one outer section throughout the selected interval. One bore is allowed.
Concave sections are supported while every requested inward or outward contour
remains one closed loop. Multiple islands, split/collapsed contours, arbitrary
trimmed CAD faces and open uncapped mesh surfaces are unsupported.

### Settings

| Setting | Meaning |
|---|---|
| `zStartMm`, `zEndMm` | Wall interval above the selected component base; `zEndMm: null` uses the geometry top. |
| `endTransition` | `level` adds complete flat pattern courses at both ends; `spiral` retains the authored rising ending. Plain spirals use a level rim by default. |
| `pattern` | `null` for a plain spiral, one regular repeated `tile`, or advanced authored paths. |
| `pathMode` | `continuous` requires connected deposition; `segmented` permits explicit travel between authored gaps. |
| `sampleStepMm`, `toleranceMm` | Emitted segment and contour subdivision limits. |
| `boundaryToleranceMm`, `minFeatureMm` | Centerline standoff/section allowance and smallest sampled feature. |

Section, mapping and path construction take the points the authored pattern and
tolerances require; there is no construction budget to exhaust. Memory scales
with the emitted program and is bounded only by the Node heap.

`meshSleeve` enables a smooth periodic cubic fit over changing-Z mesh sections:
`fidelity` is continuous from 0 to 1, `contactSide` is `inside` or `outside`,
`circumferentialControls` and `heightControls` control the fitted reference, and
`detailToleranceMm` controls sampled mesh contact. Fit resolution and contact
fidelity are separate. The default fit is 12 by 6 independent controls (72;
90 stored with periodic seam duplicates); supported ranges are 8–48 circumferential and
4–32 height controls.

`meshSleeve.offsetTightness` is independent of mesh fidelity. It defaults to `0` for a
fitted sleeve. At zero, the loose offset preserves the fitted NURBS control
count, degrees, knots and weights. At one, queries use the exact unit-normal
offset. Intermediate values blend the offset positions at query time; they do
not refit or add control points. The loose endpoint is an actual same-structure
NURBS patch; intermediate values are functional evaluators. Loose distance is
an approximate standoff and its direction-length range is reported. At sampled
over-curvature, local control offsets are reduced to preserve one smooth sleeve;
the maximum depth reduction is reported. This preserves the same control layout,
but not the full requested offset everywhere. The [shared offset contract](../../core/geom/README.md#loose-and-tight-spline-offsets)
defines the sampled regularity check and its global self-intersection limits.
This limiting is separate from source-mesh contact and does not remove source folds.

## Sleeve patterns

### One tile, a regular tiler, then sleeve mapping

Author one tile in the regular, unwrapped perimeter/height strip: a
continuous curve in one cell, with points `[cell fraction, local height mm]`.
The first and last cell fractions must be 0 and 1, with equal height, offset
and bead height so tiled joins meet exactly. `offsetMm` is signed depth and
`beadHeightMm` is deposited bead height; each accepts a scalar or one value per
point. Interior cell fractions may go outside 0–1 to overlap adjacent cells.
The mapper then queries actual host
sections at sampled Z and flow-maps the strip to normalized perimeter phase.
Tile points are not world XYZ.

One regular course is one complete circuit around the sleeve. The tiler repeats
the authored tile across the fixed `cellsPerTurn`, applies `courseRiseMm`,
and repeats the requested number of complete courses. A smaller perimeter makes
each fixed cell narrower; tile depth remains an independent millimetre value
and is not rescaled with cell width. The tile is deposited; the strip and
sleeve are not extra material.

Continuous mode requires endpoints to meet between pattern paths and repeat
boundaries. It adds no guide wall, connector, ring, hidden travel or automatic
support solver. Segmented mode is the explicit alternative when travel across
gaps is intended.

For a reusable loop, `skills/vase-wall/scripts/tile.mjs` provides
`loopTile({widthCells, depthMm, samples, beadHeightMm, exterior})`; place that
tile in a pattern with `cellsPerTurn`, `courseRiseMm`, `repeats` and `tiltDeg`.
The mesh preparation helper accepts the same loop through its `--options` JSON,
or accepts a complete `pattern` for an authored layout.

`widthCells` controls how far loops overlap neighboring cells; increase it for
more crossings. `tiltDeg` rotates tile depth and local height before adding
the course rise. `exterior` accepts `smooth`, `scalloped` or `both-scalloped`;
mesh preparation chooses the first for inside contact and the second for outside
contact unless overridden. For native geometry, set the same pattern through
normal recipe adjustment. [irregular-demo.mjs](../vase-wall/scripts/irregular-demo.mjs)
provides a reproducible irregular native sleeve example.

Advanced `pattern: {paths, advance, repeats}` accepts explicit strokes using
the same point/depth/bead-height fields, with perimeter phase measured in turns.
`advance: [turns, riseMm]` translates successive repeats. Prefer a single tile
when that expresses the requested shape.

With the default `endTransition: level`, the wall has a complete flat pattern
course at its starting height, the requested body courses, and a complete flat
pattern course at its ending height. Boundary transitions taper nominal bead
height to fill the remaining gap without doubling the boundary bead. Level
patterns publish only their actual final deposited footprint for later regions;
they do not publish a filled guide surface. `spiral` preserves authored endings
and publishes no flat rim.
Legacy recipes that omit `endTransition` retain `spiral`; set `level` explicitly
when updating one to flat ends.

## Mesh fitting and continuous fidelity

### Mesh contact and limits

Mesh fidelity is unilateral contact applied after smooth sleeve mapping. The
fitted reference remains the mapping foundation. At full fidelity (aka "hi-fi"),
`fidelity: 1`, only points on
the forbidden side are compressed toward the selected mesh boundary; the backs
of loops retain their smooth mapped shape. Intermediate fidelity blends the
smooth and constrained positions. Fidelity 0 skips contact and retains only the
smooth mapped loops. Inside contact pulls protruding fronts inward; outside
contact pushes intruding fronts outward. Allowed-side points stay unchanged.
Contact constrains path centers; the bead can extend past that limit by its
half width. Contact is evaluated around the actual fitted
centerline using bounded polar unfolding and fixed 16,384-sample profiles.
Profiles must make one counterclockwise turn with positive, bounded radial
progression. Folds that cannot be unfolded within `detailToleranceMm` fail.
Short intervals across a horizontal 3D ledge may use sampled source-distance
checks and bounded transition subdivision. These checks cover queried sections
and transitions only; they do not certify every unsampled height, global mesh
error, or physical contact.

The source mesh remains authoritative for contact queries. Small detached detail
may be excluded under the [sleeve detector's section-area threshold](../../core/geom/README.md#mesh-sleeves)
(0.1% by default); significant branches, islands, multiple bores or separated
usable height intervals fail. The fitted
sleeve and contact preparation use bounded caches and report fit residuals,
selected topology, contact displacement, sampled limits and construction counts.
Sharp corners, unsampled features, overhang behavior, swept-head clearance and
physical bead overlap still require Studio and maker judgment.

Use a machine profile that supports XYZ extrusion and the required nonplanar
motion. The nominal angle and slope reports are software checks, not clearance
ratings. Dobot relay output stops at segment boundaries and does not establish
continuous robot motion or calibrated variable flow. No physical vase print has
been validated; software generation, review and export do not approve hardware.

### Quality and generation cost

Choose fit control counts for the smooth envelope, `fidelity` for the strength of
one-sided contact, and `detailToleranceMm` for its sampled detail allowance.
The helper defaults to fidelity 1 and detail tolerance 0.05 mm; these can be much
more expensive or reject folds that a looser allowance accepts. Fidelity 0
isolates smooth mapping cost; a middle fidelity with a coarser explicit detail
tolerance is a useful preview choice. Final path chord tolerance remains separate.

Use Studio's generation progress and reports before changing quality settings.
Changing a tolerance changes the numerical allowance and the point count that
follows from it. Nothing permits silently trimming a wall.
Reuse current checked output through the shared lifecycle instead of generating
duplicate jobs. [Prepared contact](../../core/geom/README.md#prepared-mesh-contact)
owns the numerical limits; [the devlog](../../DEVLOG.md) holds measured examples.
