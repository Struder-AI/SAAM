---
name: advanced-vase-wall
description: Extension that fits a sleeve, repeats authored patterns and calls Trace.
metadata:
  saam-kind: extension
---

# Advanced vase mode

Use for authored repeating patterns. This package depends on
[standard vase](../vase-wall/SKILL.md) for sleeve preparation and shared wall
constraints; its [script](scripts/runtime.mjs) maps patterns and calls Trace.
The mesh helper below can also prepare a plain fitted wall, which subsequently
generates through standard vase without this package.

The envelope supplies no material; only pattern strokes deposit. A looping
pattern can resemble a gyroid while remaining a self-crossing toolpath with gaps.

A **tile** is the explicit authored paths; a **course** is one repetition.

## Workflow

Use the [shared print tools](../../core/print/USAGE.md). A sleeve assignment with
`pattern` selects this extension; a null pattern selects standard spiral Slice.
Keep an ordinary Slice assignment for a base and align positive `zStartMm` to
the process layer grid. Set `zEndMm` when the upper geometry is unsuitable;
generation never shortens a requested wall.

### Mesh input workflow

For an imported mesh, [call this extension](../../core/print/USAGE.md#command-line)
with a preparation request before generation:

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
The helper derives a base unless `baseHeightMm` is specified.

Preparation proposes one usable sleeve interval and updates the recipe without
changing the source mesh or generating a program. Change conflicting assignments
through ordinary recipe tools.

For stacks, sleeve bounds claim the wall band; ordinary slices own the base/cap.
Use the [shared lifecycle](../../core/print/README.md) for generation and review.

## Input geometry: normally a solid

[Standard vase's input requirements](../vase-wall/SKILL.md#input-geometry-normally-a-solid)
apply. For outside contact, every outward contour must also remain one closed loop.

### Settings

| Setting | Meaning |
|---|---|
| `zStartMm`, `zEndMm` | Wall interval above the selected component base; `zEndMm: null` uses the geometry top. |
| `endTransition` | `level` adds complete flat pattern courses at both ends; `spiral` retains the authored rising ending. Plain spirals use a level rim by default. |
| `pattern` | `null` for a plain spiral, otherwise a [turns or sized pattern](#sleeve-patterns). |
| `pathMode` | `continuous` requires connected deposition; `segmented` permits explicit travel between authored gaps. |
| `sampleStepMm`, `toleranceMm` | Emitted segment and contour subdivision limits. |
| `boundaryToleranceMm`, `minFeatureMm` | Centerline standoff/section allowance and smallest sampled feature. |

Construction takes the points the pattern and tolerances require, with no
budget to exhaust; memory scales with the emitted program, bounded by the Node heap.

`meshSleeve` enables a smooth periodic cubic fit over changing-Z mesh sections:
`fidelity` is continuous from 0 to 1, `contactSide` is `inside` or `outside`,
`circumferentialControls` and `heightControls` control the fitted reference, and
`detailToleranceMm` controls sampled mesh contact. Fit resolution and contact
fidelity are separate. The default fit is 12 by 6 independent controls (72;
90 stored with periodic seam duplicates); minimums are 8 circumferential and 4 height controls.

Fitted sleeves use native horizontal NURBS section offsets with resolved
crossings; perimeter correspondence follows the retained contour, and a split or
collapsed offset rejects. These loose offsets are separate from source-mesh contact.

## Sleeve patterns

Each path has `points` in sleeve coordinates (not world XYZ), `beadHeightMm`
and optional signed depth `offsetMm`, scalars or one value per point. Bake
cell layout, tilt and loops into the points; there is no other tile input.

- **Turns** `{paths, advance, repeats}`: points are [unwrapped perimeter turns,
  height mm]; `advance: [turns, riseMm]` translates each repeat, so tiles
  stretch with the perimeter. The [irregular loop sleeve](examples/irregular-loop-sleeve.json)
  bakes 20 loops per turn into one path around a waisted, offset mesh host.
- **Sized** `{paths, tileWidthMm, riseMm, turns}`: points are [arc mm from the
  course start, which is 0; height mm above the turn, which rises `riseMm`].
  Each turn holds the whole number of courses nearest its centerline perimeter
  at mid-turn, evenly spaced from the seam, so tiles keep their width within
  half a tile. A turn whose count changes shifts its courses against the turn
  below by up to half a tile, most opposite the seam; heights and joins are
  unchanged. The report's `sizedCourses` lists each change. The
  [flared loops](examples/flared-sized-loops.json) grow from 15 to 30 per turn.

The mapper maps normalized perimeter phase onto actual sleeve sections at
sampled Z; depth stays in millimetres. Only the authored paths deposit, and
the minimum layer time applies to each repeat. Continuous mode requires joined
path and repeat endpoints (a sized tile ends `tileWidthMm` after it starts);
segmented mode allows explicit travel between gaps. No connector or guide wall is invented.

A legacy `tile` field needs explicit bundle migration, which expands it into
equivalent turns paths and invalidates generation; loading never converts silently.

With the default `endTransition: level`, a complete flat pattern course (turn,
for a sized pattern) sits at the starting and ending heights around the body.
Boundary transitions taper nominal bead height to fill the remaining gap without
doubling the boundary bead. Level patterns publish only their actual final
deposited footprint for later regions, not a filled guide surface; `spiral`
preserves authored endings and publishes no flat rim. Legacy recipes that omit
`endTransition` retain `spiral`; set `level` explicitly when updating one.

## Mesh fitting and continuous fidelity

### Mesh contact and limits

Mesh fidelity is unilateral contact applied after smooth sleeve mapping; the
fitted reference remains the mapping foundation. At full fidelity ("hi-fi",
`fidelity: 1`) only points on the forbidden side are compressed toward the
selected mesh boundary; the backs of loops keep their smooth mapped shape.
Intermediate fidelity blends smooth and constrained positions; fidelity 0 skips
contact. Inside contact pulls protruding fronts inward; outside contact pushes
intruding fronts outward. Contact constrains path centers; the bead can extend
past that limit by its half width. Contact is evaluated around the actual fitted
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

### Script interface

`advancedVaseResult({shell, assignment, process, ...})` returns operations,
the reference family, optional terminal boundary and a report without file writes.
The caller supplies finalized foundation strands; Trace resolves whole-pattern
crossings, joins and taper before ordinary composition and export.
