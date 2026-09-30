---
name: advanced-vase-wall
description: Guidance for explicit repeated Trace paths mapped onto a fitted sleeve.
metadata:
  saam-kind: guidance
---

# Advanced vase mode

Use for authored repeating patterns and fitted mesh sleeves. For a conventional
continuous spiral, choose [standard vase mode](../vase-wall/SKILL.md).
Sleeve assignments lower plain spirals to Slice and patterns to Trace with a
sleeve fitting/morphing extension. This is guidance, not another deposition skill.

Use for an open single-wall vessel or tube. The selected solid or closed sleeve
is a reference envelope; vase-wall deposits the wall and leaves the interior and
roof open. A modeled bore is unnecessary. A base is a separate slice assignment.
A looping tile can resemble a gyroid; it is a self-crossing toolpath, not an
implicit gyroid solid. The pattern may leave openings between deposited strokes.

**Terms.** A **sleeve** is a reference surface periodic in one direction and
open in the other. A **tile** means the explicit authored paths being repeated;
it is not another input representation. A **course** is one repetition of those
paths. `pattern` always has `{paths, advance, repeats}`.

## Workflow

Use the [shared print tools](../../core/print/USAGE.md) for import, recipe changes, generation, Studio review
and delivery. Add a sleeve assignment; keep an ordinary assignment for a base.
For a base, set a positive `zStartMm` aligned to the process layer grid. Set
`zEndMm` explicitly when the upper geometry is unsuitable; generation never
shortens a requested wall.

### Mesh input workflow

For an imported mesh, prepare a fitted sleeve before generation:

```sh
node skills/vase-wall/scripts/prepare-mesh.mjs Prints/PART --options mesh-vase-options.json
```

Example `mesh-vase-options.json`:

```json
{
  "pattern": {
    "paths": [{"points": [[0,0],[0.25,0.05],[0.5,0.1],[0.75,0.15],[1,0.2]], "beadHeightMm": 0.2}],
    "advance": [1,0.2],
    "repeats": 20
  },
  "endTransition": "level",
  "meshSleeve": {"fidelity": 0.5, "detailToleranceMm": 0.2}
}
```

Author the complete paths and repetition count explicitly. Omitting `pattern`
preserves an existing pattern, or selects a plain spiral on a new wall.
The helper derives a base from the process settings unless `baseHeightMm` is
specified.

The preparation command detects one dominant outer sleeve, chooses an explicit
usable height interval, preserves the source mesh, and writes a normal recipe
revision. `--expected-revision REV` protects a caller's revision. Preparation
does not generate a program or grant approval. Existing path/repeat choices are
retained unless explicitly replaced; conflicting assignments
must be changed through the ordinary recipe tools.

Use sleeve `zStartMm`/`zEndMm` for a same-part stack: the wall's band
(ordinary slices own the base and cap), with other assignments for later work.
The [shared lifecycle](../../core/print/README.md) carries geometry, operation dependencies, machine
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
| `pattern` | `null` for a plain spiral, otherwise `{paths, advance, repeats}`. |
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
90 stored with periodic seam duplicates); minimums are 8 circumferential and 4 height controls.

Fitted sleeves use native horizontal NURBS section offsets with resolved
crossings. Perimeter correspondence follows the retained contour; a split or
collapsed offset rejects. These are loose offsets with controlled sampling,
separate from source-mesh contact. The former `meshSleeve.offsetTightness`
interpolation is removed because it could restore unresolved crossings.

## Sleeve patterns

Author `pattern: {paths, advance, repeats}`. Each path has `points` as
[unwrapped perimeter turns, height mm], `beadHeightMm`, and optional
`offsetMm` signed depth. Height/depth may be scalars or one value per point.
These coordinates are not world XYZ. `advance: [turns, riseMm]` translates
successive repeats. The explicit paths are the tile; there is no separate
cell-layout, tilt or loop-preset input. Bake those geometric choices into the
points. [loop-path.mjs](../vase-wall/scripts/loop-path.mjs) is an example
geometry helper returning explicit points, used by the
[irregular demo](../vase-wall/scripts/irregular-demo.mjs).

The mapper queries actual sleeve sections at sampled Z and maps normalized
perimeter phase onto them. A smaller perimeter narrows phase intervals;
depth remains in millimetres. Only the authored paths deposit material.
Continuous mode requires joined path and repeat endpoints; segmented mode
allows explicit travel between gaps. No connector or guide wall is invented.

Legacy recipes with a `tile` field require explicit bundle migration, which
expands the old layout into equivalent paths and invalidates generation.
Loading never performs that conversion silently.

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

SAAMpath retains the explicit spatial paths. Export checks the selected
representation; slope reports do not establish clearance. Dobot relay output stops at segment boundaries and does not establish
continuous robot motion or calibrated variable flow. The user reports advanced
vase walls demonstrated in physical prints (2026-09-24); software generation,
review and export do not approve hardware.

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
