---
name: vase-wall
description: Print a hollow vase from an ordinary solid model, using a continuous spiral or repeating motifs warped around its contours. Overlapping tilted loops can preserve the guide's exterior or create a scalloped finish. Continuous vase mode has no travel; explicit segmented mode permits gaps.
---

# Vase wall

Use for an open, single-wall vessel or tube with a continuous spiral above a
foundation ring. For maker work, read [MAKERS.md](../../MAKERS.md). For development,
start with the [developer orientation](../../DEVELOP.md) and follow its
task-specific references. This skill adopts the legacy vase-wall concept
through the current shared pipeline. Geometry comes from actual sections of the
selected part, including tapered noncircular shapes; no diameter-only substitute
or separate preview/export workflow is used.

## Input geometry: normally a solid

**Use an ordinary solid model for vase mode. No modeled hole is necessary.**
The solid supplies the exterior guide; the recipe prints the wall and leaves
the interior hollow. A base is a separate recipe choice, and the roof stays
open. Do not hollow the CAD model merely to request a vase-mode print. A closed
sleeve is also supported when one is already supplied, but it is not the normal
prerequisite. This distinction applies equally to plain spirals and motifs.

Both plain spirals and motifs require a solid or closed sleeve with **one outer
section** throughout the selected height. A sleeve may have one bore; only its
outer wall is printed. Multiple islands or bores are unsupported. Concave sections are supported while
each inward offset remains one closed contour. Disappearing walls and split
offsets are rejected. Traversal uses arc length and does not need a common
interior point. Supported inputs
are validated triangle meshes/STL and the existing closed untrimmed spline
builders. Arbitrary trimmed CAD import remains unsupported. Native geometry
stays unchanged; the recipe prints its outer wall and deliberately leaves the
interior and roof open. Review that distinction with the maker.

A [sleeve pattern](#sleeve-patterns) describes a motif in perimeter/height
coordinates, with optional contour offsets, and repeats it around this required host. The motif may be an open
zigzag, a looping stroke or several strokes; the host still determines the wall.
**Vase mode always means continuous extrusion** throughout its deposited path.
In patterned mode, **the host is only a reference: only motif strokes print**.
No wall, foundation ring, rising lead-in or guide-following connector is added. **Segmented paths** explicitly permits travel across
mapped gaps. Both use the same composer and stored `vase-wall` skill ID.

Software tests exercise changing-Z mesh and restricted spline sections on S5
and H2D, native geometry/review/exact-byte delivery on S5, and configured Dobot
path export and Lua interpretation. Compatible machine
profiles must declare XYZ extrusion and nonplanar motion. Plain spirals also use
the profile's angle limit; patterned tilt is an agent/maker recipe judgment. Use
the selected profile's available output through the shared workflow, including
the experimental H2D and configured Dobot outputs. Machine-specific constraints
remain in the machine profile and [developer guide](../../core/export/README.md#machine-interoperability-design).
No physical vase print has been validated.

Dobot's bounded relay output uses unblended moves that stop at each segment.
Its interpreted material estimate remains separate from SAAMpath's intended
bead volume. A continuous SAAMpath stroke therefore does not establish smooth
robot motion or accurate continuous extrusion on that output; physical behavior
and relay calibration remain unvalidated.

## Tools and workflow

Use the [shared print tools](../../core/print/USAGE.md) for shell creation, STL
import, recipe adjustment, review and delivery. After import, select the vase
wall and its intended base in the proposed recipe.

For the simple recipe with no explicit regions, set `skills.vase-wall.enabled`
to `true` and select only its wall and optional base. For a tube without a solid base, disable full-fill and
set `zStartMm: 0`. For a vessel with a base, enable full-fill in `body` mode and
set an explicit positive vase `zStartMm`, such as `0.6` with 0.2 mm first and
subsequent layers. Full-fill then stops at 0.6 mm and the first wall ring is at
0.8 mm. The base height must align with that component's full-fill layer grid.
The agent proposes these settings; the maker need not edit JSON.

For same-part combinations, use shared `composition.regions` assignments. A
region selects a component, height bounds and a map of skills with local setting
overrides. Assign full-fill to the base and cap, vase-wall to the intervening
wall, and other skills to their subsequent material regions. Region selection
supersedes the global enabled flags; global settings remain inherited defaults.
See [shared composition](../../core/path/README.md#skill-result-composition) and the
[synthetic full-stack fixture](../../core/tests/fixtures/regional-stack.mjs).
That software fixture includes all six requested stages and uses invented Dobot
configuration solely for testing; it must not be run on hardware.

## Locked settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select vase-wall. |
| `part` | `null` | Required component ID in an assembly; null for a single part. |
| `zStartMm` | `0` | Base top, measured above the selected component's minimum Z. A positive value requires full-fill on that component. |
| `zEndMm` | `null` | Wall top above component minimum Z; null uses the geometry's maximum Z. |
| `endTransition` | `spiral` | Keep the sloping rim, or `level` to finish a planar material boundary. |
| `pattern` | `null` | Plain spiral, or a repeatable motif mapped to actual sleeve sections. |
| `pathMode` | `continuous` | Continuous vase extrusion, or explicit `segmented` paths that permit travel across gaps. |
| `sampleStepMm` | `1` | Maximum emitted segment length, 0.1–5 mm. |
| `toleranceMm` | `0.02` | Contour subdivision tolerance, 0.002–0.05 mm; midpoint deviation is limited to half this value. |
| `boundaryToleranceMm` | `0.02` | Sampled centerline standoff and section-nudge allowance, 0.002–0.05 mm and less than one quarter of bead width; offset arc tolerance is one quarter of this value. Independent of contour subdivision. |
| `minFeatureMm` | `0.4` | Shared section feature scale; also bounds vertical sampling gaps, 0.05–5 mm. |
| `maxPoints` | `100000` | Compute allowance: any safe integer of at least 100, with no preset 200000-point ceiling. Section-query allowance is four times this value, capped at the safe-integer limit. |

On exhaustion, the error names the wall/region, used and allowed count, Z reached,
and the exact setting to increase with a suggested larger value. Raise that
setting through the normal chat adjustment (for example 100000 to 200000 or
400000); keep geometry, pitch and contour quality unless the maker wants them
changed. Larger allowances may need more memory and time. A larger budget does
not change the resulting path when both budgets suffice. Successful reports
include both usage and allowance. Never deliver a partial wall after exhaustion.

Older recipes without `boundaryToleranceMm` retain their previous numerical
boundary allowance when normalized, including regional tolerance overrides.
New recipes lock contour and boundary tolerances separately; changing contour
tolerance does not change the offset or standoff acceptance threshold.

The shared process locks layer pitch, first-layer thickness, width, speed, flow,
fan and cooling. A sloping or domed roof may yield a collapsing or narrow upper
section; select an explicit lower `zEndMm` when the full height fails. Generation
does not silently truncate the wall, change its topology or introduce support.

## Deposition, composition and limitations

For section-derived walls, `vaseWallResult({shell, plan, machine, id, after})`
returns one atomic operation containing one stroke. Phase measures normalized
arc length along the inset contour. The first seam is the point of maximum X,
breaking ties with minimum Y. A fixed anchor at that seam's Y coordinate, one
bead width beyond the geometry's maximum X, is projected onto later contours.
The anchor stays outside expanding sections, preventing an interior anchor from
switching between opposite sides of a corner. Equal-distance ties use
coordinates, independent of cyclic section vertex ordering.
This is bounded contour correspondence, not feature matching:
abruptly changing nearest seams or contour lengths can require finer sampling
or fail the subdivision limit. There is one flat foundation ring at the first
layer height (or one normal layer above the base). Its connected helical turn
then rises continuously at exactly `layerMm` per revolution. The first rising
turn's deposited thickness ramps from zero to the normal pitch to fill the gap
above the flat ring without doubling that ring's material. Later turns use
normal pitch. `spiral` may finish on a partial turn, leaving a sloped rim.
`level` continues for one turn at the final height; its thickness fills the
remaining gap above the previous turn and tapers to zero. This works at partial
turn endings too and does not double the last wall bead. It publishes only a
level annular rim as material support.

Every sampled point queries its actual Z section, offsets by half the bead width,
and checks boundary standoff. Repeated mesh cuts use a generation-local Z index
to skip triangles outside the section; they preserve the direct cut's ordering,
vertex nudges and topology checks. Spline inputs keep the shared spline sectioner.
Vase offsets use the shared Clipper2 tool with a **0.00001 mm integer grid**,
independent of contour and boundary tolerances. This is also the shared planar
offset default; coordinate precision does not specify curve deviation. Source
sections and their insets must each remain one outer loop. Collapse and sampled
boundary standoff remain checked. The report includes offset precision.
Adaptive subdivision checks segment length and
midpoint deviation; initial angular steps are at most 1/16 turn. Generation does
not query a second section one pitch below or reject turn-to-turn radial drift.
The agent reasons about sensible wall geometry and pitch with the maker; Studio
review covers the intended overhangs and wall contact. The retained checks are
bounded numerical checks, not a proof of all surface topology between samples
or of physical support. Features below the section
sampling scale can be missed. Sharp corners, rectangular bead volume, the
initial thickness ramp and overhang behavior remain approximations.

Cooling slows the entire stroke to satisfy the shortest complete turn's minimum
time. The speed also respects the first-layer target, normal wall target and
the shared flow/axis limits. The fan uses the locked process percentage throughout
the wall. There are no travel moves, retractions or cooling parks between turns.
The composer treats the continuous operation atomically and omits its final
layer-cooling park; normal final retraction and parking remain shared.

Regions order supporting operations before the wall and subsequent regions
after it. For a planar cap, the agent selects `endTransition: level` and a
layer-grid-aligned boundary while proposing the recipe. Leaving `spiral` is a
recipe mismatch for this flat interface: the final turn leaves different rim
heights around the perimeter. The level rim does not fill the hollow interior.
Choose cap direction and wall contact using the maker's printing judgment;
there is no bridge permission policy. Sparse body, solid masks,
draped roof and later solid material may follow through the same resolver. A
continuous wall cannot weave turn by turn with other operations. Cross-component
geometric overlap is not automatically resolved. Joins, cooling of other skills
and final parking clear the highest deposited material plus `liftMm`
(default 1 mm; zero allowed); there is no swept-head or robot-arm
collision proof. The plain spiral's declared nonplanar angle limit is not a
measured clearance rating. Patterns report maximum slope without a tilt gate.

`node --test skills/vase-wall/tests/vase.test.mjs` provides targeted software
coverage. Synthetic review tests use temporary bundles and never authorize a
real manufacturing job.

## Sleeve patterns

The required host is selected through the ordinary native geometry, component
and regional settings. A solid supplies its outer wall; a closed annular sleeve
supplies its exterior while retaining its bore. Input still uses the existing
validated closed mesh and untrimmed spline representations. Uncapped open mesh
surfaces are not an additional import format. Concave outer sections are allowed
when the half-bead inset remains one closed contour. Sleeve material must have
room for the selected bead width.

`pattern` contains `paths`, `advance` and `repeats`. Each path contains `points`
and `beadHeightMm`, with optional `offsetMm`. Points are **[unwrapped perimeter turns, height in mm]**.
One turn means the entire inset contour at that point's actual height. The height
is above the starting print height, one first/normal layer above the selected
base. That height reference does not create a foundation ring. Coordinates are mapped through the shared native section query,
arc-length seam convention and half-bead inward offset. They are never world XYZ
or an independent shape inside a bounding box. Translation, taper and changes to
the host therefore change the generated pattern.

`offsetMm` is a signed scalar or one value per point, interpolated along the
motif. Zero follows the normal vase centerline; negative values extend inward
and positive values extend outward. Each sample uses a parallel contour at its
actual Z, retaining normalized perimeter phase. This warps the motif around the
host instead of positioning independent world-space circles. For loops whose
finished exterior should match the input, keep the outermost offset at zero and
place the loops inward. Offset contours must remain one closed outer loop.
Triangle seams are simplified from a consistent geometric extreme before and
after offset-grid rounding, each pass using at most one quarter of the smaller
contour/boundary tolerance. This keeps
numerical seams from creating false offset holes or islands; the offset grid
itself remains unchanged.

### Motifs, host shape and exterior finish

A **motif** is the small repeated curve, such as a loop or zigzag. The **pattern**
describes its placement and connections along the rising vase path; a saved
pattern path can contain an entire course of motifs.

Mapping queries the actual host section at every sampled Z, including local
descents in a tilted motif. A wavy or tapered host therefore changes the path
within each motif and between courses. Perimeter coordinates preserve a fraction
of the contour length, not an exact physical motif width. Offset depth remains
in millimeters and is horizontal, relative to the actual-Z contour; this is not
a normal projection onto a three-dimensional surface. The mapper does not lock
each course onto the one below, automatically resize motifs, or solve contact.

Choose a smaller motif when the host's bends or radius changes would distort a
large one undesirably. Judge tilt and inter-course drift with the maker; exact
registration with the previous course is not required. A split/collapsed offset
still prevents that contour construction, rather than silently shrinking it.

For an exterior matching the supplied solid, keep the motif's outermost offset
at zero and extend its lobes inward. For a **scalloped exterior**, put lobes
outside the guide and keep connectors closer to the guide. The solid is then a
reference surface: the intended printed bumps extend beyond it. This is a motif
and recipe choice, not a second slicer or a separate preview shape.

For **both edges scalloped**, center the continuous looping motif across the
guide. Signed offsets span both sides of zero. Put the circumferential advance
inside the looping curve itself, so it needs no separate connecting ring.
The guide represents the middle of the patterned wall in this arrangement.

Overlapping, nearly horizontal circles can decorate the usual rising vase path:
their tangential progress is expressed in perimeter turns, their inward depth
in `offsetMm`, and their gentle tilt in height. The reference spiral positions
the loops but does not become an additional extruded path. Overlap and
tilt are recipe judgments; generation does not solve exact inter-course contact
or impose an extra pattern-tilt limit.

```json
{
  "pattern": {
    "paths": [{
      "points": [[0, 0], [0.25, 0.12], [0.5, 0.08], [0.75, 0.19], [1, 0.2]],
      "beadHeightMm": 0.2
    }],
    "advance": [1, 0.2],
    "repeats": 20
  },
  "pathMode": "continuous",
  "endTransition": "spiral"
}
```

This open zigzag wraps around the host once per repetition, advancing 0.2 mm.
`advance` translates each repetition in the same turn/mm coordinates; its rise
must be positive. The first motif point has nonnegative height and may have a
nonzero contour offset. The shared approach goes directly to it without printing
a guide ring or lead-in. Supplied path order and direction remain
fixed. Every segment is deposition; no implicit closing edge or travel is added
to a motif. Fractional-turn repeats, backward perimeter progress and local
height descents are allowed. Curves may be supplied as sampled motif polylines.

In continuous mode, endpoints must meet after mapping, both between paths and
between repetitions, including matching contour offsets. Perimeter values differing by an integer turn describe
the same sleeve point at the same height. Endpoint matching does not erase a
full-turn deposition segment: intermediate mapped samples retain its complete
course. If endpoints do not meet, revise the motif or explicitly use `segmented`.
The shared composer then handles gap travel above material already deposited.
Approach and final departure remain shared in both modes.

`beadHeightMm` is a nonnegative constant or one value per motif point, linearly
interpolated. Volume uses mapped 3D segment length × nominal bead width × mean
bead height. There is no inferred material beneath the motif and no foundation
volume ramp. Nominal bead height,
motif rise and any intentional overlaps remain process choices. Self-crossing
or overlapping motifs need an authored contact/clearance assessment; this is
not a strength, support or collision solver.

Adaptive sampling checks the mapped shape, including quarter points and at most
1/16 turn per initial interval to avoid aliasing a complete revolution. All
contour and boundary tolerances remain active. `maxPoints` and the shared section
budget bound the work. Motif section and offset caches are bounded independently
of print length; section-query usage counts actual cache misses. Maximum slope includes both rising and descending segments
and is reported for judgment, without a pattern-tilt gate. Every motif
sample must remain within the selected sleeve height; excessive repeats fail
without truncation. Each mapped path is slowed to its minimum cooling duration;
continuous mode inserts no cooling parks inside the pattern. An authored pattern
has no automatic level ending and publishes no assumed filled rim or finished
side surface for downstream consumers.

Old recipes with `paths: null` normalize to the plain spiral. The mistaken
standalone XYZ-path mode is retired: non-null old `paths` is rejected with an
instruction to recreate the motif, never silently reinterpreted. Existing private
examples of that mode are historical and are not valid current sleeve recipes.

Use the same CLI/MCP creation, adjustment, Studio review and exact-byte delivery.
Studio shows the host mapping, repeats, advance, motif endpoints and continuity.
Tests in [paths.test.mjs](tests/paths.test.mjs) cover host dependence, convex and
concave solids/sleeves, periodic seams, motif-only volume, travel, limits,
translated regions and S5/H2D/configured Dobot output.

[path-demo.mjs](scripts/path-demo.mjs) creates a development preview on a native
28 mm outside / 24 mm inside diameter sleeve. An eight-tooth zigzag repeats for
50 revolutions with 0.2 mm rise per revolution. Segmented mode adds an explicit
phase gap between revolutions. No human approval or physical result is implied.

```sh
node skills/vase-wall/scripts/path-demo.mjs Prints/development/continuous-sleeve-zigzag
node skills/vase-wall/scripts/path-demo.mjs Prints/development/segmented-sleeve-zigzag segmented
node studio/server.mjs Prints/development/continuous-sleeve-zigzag
```

[loop-demo.mjs](scripts/loop-demo.mjs) creates 20 overlapping, gently tilted
loops per course, advancing continuously through the looping curve. The loops extend 4.8 mm inward and preserve
the 28 mm outside diameter. Twenty-four courses advance 0.2 mm per revolution;
only the motif is deposited, without an added wall, ring or separate connector.
Top view exposes the overlapping loops, while 3D view shows the stacked wall.
The input is a capped solid, with no bore. The example uses nominal bead heights
rather than an inter-loop contact solver. The `scalloped` variant points the
lobes outward. The `wavy` variant uses a solid with two axial waves, 0.6 mm radial
variation, and smaller motifs: nominal 3.2 mm tangential width, 2.4 mm depth and
32 loops per course over 36 courses. Its changing contours can shift and distort
the motifs between courses.

```sh
node skills/vase-wall/scripts/loop-demo.mjs Prints/development/tilted-loop-vase
node studio/server.mjs Prints/development/tilted-loop-vase
node skills/vase-wall/scripts/loop-demo.mjs Prints/development/scalloped-loop-vase scalloped
node skills/vase-wall/scripts/loop-demo.mjs Prints/development/wavy-scalloped-loop-vase wavy
node skills/vase-wall/scripts/loop-demo.mjs Prints/development/both-scalloped-loop-vase both-scalloped
```
