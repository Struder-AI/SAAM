---
name: vase-wall
description: Generate one continuous rising outer wall from supported convex mesh or untrimmed spline sections, with an optional full-fill base and shared machine export and Studio review.
---

# Vase wall

Use for an open, single-wall vessel or tube with a continuous spiral above a
foundation ring. Read [MAKERS.md](../../MAKERS.md); developers also read
[DEVELOP.md](../../DEVELOP.md). This skill adopts the legacy vase-wall concept
through the current shared pipeline. Geometry comes from actual sections of the
selected part, including tapered noncircular shapes; no diameter-only substitute
or separate preview/export workflow is used.

The supported scope is **one convex outer section**, without holes or islands,
throughout the selected height. Each inward-offset section must retain a common
interior point. Concavity, disappearing walls, unsupported topology changes,
large section drift and inadequate bead overlap are rejected. Supported inputs
are validated triangle meshes/STL and the existing closed untrimmed spline
builders. Arbitrary trimmed CAD import remains unsupported. Native geometry
stays unchanged; the recipe prints its outer wall and deliberately leaves the
interior and roof open. Review that distinction with the maker.

Software tests exercise changing-Z mesh and restricted spline sections on S5
and H2D, native geometry/review/exact-byte delivery on S5, and configured Dobot
path export and Lua interpretation. Compatible machine
profiles must declare XYZ extrusion, nonplanar motion and an angle limit. Use
the selected profile's available output through the shared workflow, including
the experimental H2D and configured Dobot outputs. Machine-specific constraints
remain in the machine profile and [developer guide](../../DEVELOP.md#machine-interoperability-design).
No physical vase print has been validated.

Dobot's bounded relay output uses unblended moves that stop at each segment.
Its interpreted material estimate remains separate from SAAMpath's intended
bead volume. A continuous SAAMpath stroke therefore does not establish smooth
robot motion or accurate continuous extrusion on that output; physical behavior
and relay calibration remain unvalidated.

## Tools and workflow

Install with `npm ci` on Node.js 22+. Use the same shell CLI as
[full-fill](../full-fill/SKILL.md):

- `node core/print/cli.mjs init Prints/<name> plan.json --machine <machine-id>`
  stores unapproved geometry and the proposed process plan.
- `node core/print/cli.mjs import-stl Prints/<name> source.stl <mm|inch> [machine-id]`
  preserves source units and geometry before review; adjust the skill selection
  in chat afterward.
- `npm run studio -- Prints/<name>` opens geometry, settings and toolpath review.
- `node core/print/cli.mjs adjust Prints/<name> patch.json` applies chat changes.
- `node core/print/cli.mjs generate Prints/<name>` generates after geometry and
  plan approval. `demo` generates a development preview without approvals.
- `node core/print/cli.mjs check Prints/<name>` verifies the locked recipe and
  saved export. `deliver` copies the exact toolpath-approved bytes.

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
See [shared composition](../../DEVELOP.md#skill-result-composition) and the
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
| `sampleStepMm` | `1` | Maximum emitted segment length, 0.1–5 mm. |
| `toleranceMm` | `0.02` | Centerline standoff and subdivision tolerance, 0.002–0.05 mm and less than one quarter of bead width. |
| `minFeatureMm` | `0.4` | Shared section feature scale; also bounds vertical sampling gaps, 0.05–5 mm. |
| `maxPoints` | `100000` | Hard emitted-point budget, 100–200000; section-query budget is four times this value. |

The shared process locks layer pitch, first-layer thickness, width, speed, flow,
fan and cooling. A sloping or domed roof may yield a collapsing or narrow upper
section; select an explicit lower `zEndMm` when the full height fails. Generation
does not silently truncate the wall, change its topology or introduce support.

## Deposition, composition and limitations

`vaseWallResult({shell, plan, machine, id, after})` returns one atomic operation
containing one stroke. The phase begins on the positive X ray from the first
inset loop's interior average and keeps that origin for every section, independent
of section vertex ordering. There is one flat foundation ring at the first
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
and checks boundary standoff. Adaptive subdivision checks segment length and
midpoint deviation; initial angular steps are at most 1/16 turn. A section one
pitch below checks radial bead overlap; drift must be no greater than bead width
minus tolerance. These are bounded numerical checks, not a proof of all surface
topology between samples or of physical support. Features below the section
sampling scale can be missed. Sharp corners, rectangular bead volume, the
initial thickness ramp and overhang behavior remain approximations.

Cooling slows the entire stroke to satisfy the shortest complete turn's minimum
time. The speed also respects the first-layer target, normal wall target and
the shared flow/axis limits. The fan uses the locked process percentage throughout
the wall. There are no travel moves, retractions or cooling parks between turns.
The composer treats the continuous operation atomically and omits its final
layer-cooling park; normal final retraction and parking remain shared.

Regions order supporting operations before the wall and subsequent regions
after it. A planar cap requires `endTransition: level`, a layer-grid-aligned
boundary and `supportPolicy: bridge-experimental`: the level rim does not fill
the hollow interior or prove that a span will bridge. Sparse body, solid masks,
draped roof and later solid material may follow through the same resolver. A
continuous wall cannot weave turn by turn with other operations. Cross-component
geometric overlap is not automatically resolved. Joins, cooling of other skills
and final parking use whole-plan clearance; there is no swept-head or robot-arm
collision proof. The machine's declared nonplanar angle limit is enforced for
the actual rising segments and is not a measured clearance rating.

Run `node --test skills/vase-wall/tests/vase.test.mjs` for targeted software
checks, then the repository's `npm test` after changes. Synthetic review tests
use temporary bundles and never authorize a real manufacturing job.
