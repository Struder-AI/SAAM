# Regions, offsets and intersections

Shared planar and surface region operations, topology and material ownership.
Read the relevant operation contract below and the [geometry query boundary](../geom/README.md#geometry-query-boundary)
when changing its inputs. [Composition](../path/README.md) owns operation ordering
and travel across those regions.

## Shared offset functions

**Planar:** [offsetRegion](offset.mjs) accepts closed 2D loops in mm
and a signed distance: positive expands material, negative erodes it. Pass the
whole region together, including CCW outer/island loops and CW holes. Nonzero
winding determines material; loop order and seams do not assign ownership.
The `region2d.mjs` compatibility export is an alias to this exact function. Full-fill,
planar-infill, draped-skin, vase-wall, shared rim coverage/travel and the bounded
wedge all use it. The wedge retains its eight-point section generator and nearby-travel
policy while using shared boundary insets. Draped-skin uses an XY footprint inset.

The [adapter](clipper.mjs) uses the same pinned Clipper2 C++/WASM
[kernel](clipper2.mjs) as general booleans. There is one initialized
WASM instance, with bulk integer-coordinate transfer and shared native-memory
ownership. All skills use this boundary for closed planar offsets, including
supports, pipe substrate, material regions and comb travel. There is no Clipper 6
runtime dependency or fallback. Input normalization
and polygon inflation use Clipper2, with nonzero winding and upstream topology
construction. Inflation already unions its output internally; do not add a
second output-normalization union. SAAM selects **closed material
polygons**: an inset yields remaining material, rather than a stroke band on
both sides of a boundary. Point-touching components, holes and collapse retain
regression coverage; their construction is owned by the shared kernel.

Options are `join: 'round' | 'square' | 'miter'` (round by default),
`miterLimit: 2`, `arcToleranceMm: 0.02` and `precisionMm: 1e-5`. This 0.00001 mm
offset grid retains guard digits below the section chord tolerance while avoiding
unneeded coordinate precision.
C# reference cases explicitly retain their `1e-9` grid; general Clipper2 booleans
also retain their separate `1e-9` default. Arc tolerance is the upstream polygonal
approximation target. Integer precision is distinct
from surface/section chord tolerance. A deterministic local origin reduces
coordinate magnitude; range checks leave headroom for bounded miters. Invalid
numbers/options or excessive range raise; genuine collapse returns `[]`.
There is no per-point standoff sweep or arbitrary small-area pruning in the
offset. Reference tests account for integer quantization. Skill authors
must not import Clipper directly. General `intersect`/`difference`/`union` use
the [Clipper2 tool](#shared-planar-intersections), re-exported from
`core/region/boolean.mjs`. Both bundle adapters hash the shared kernel and exact
WASM/JS dependency bytes; the public CLI/MCP and review workflow are unchanged.

Rimming and surface cladding use native 3D differential offsets through the
shared surface/section functions. Those are distinct from closed planar polygon
offsetting and remain there. Native mesh/spline sectioning and scanline stroke
construction likewise keep their appropriate geometry algorithms; universal
Clipper2 integration does not mean flattening those operations into polygons.

`perimeterLoops` in [perimeters.mjs](perimeters.mjs) is the shared
deposition-contour wrapper used by full-fill and planar-infill. It retains a
single central closed track when an outer/hole pair meets and material erosion
loses that hole. A surviving hole must still contain the original hole; tiny
quantization rings do not suppress central-track recovery merely by matching
the original hole count. Candidate fronts use the existing 0.001 mm chord target and
are compared within the sum of their two chord tolerances. Only their boundary
band is replaced; disconnected/nested islands and other holes remain accounted
for. Polygonal approximation and integer rounding can leave small material
remnants where ideal curved fronts coincide; these remain in `offsetRegion`'s
result. Recovery changes deposition contours without changing region erosion, fill
masks, machine output interfaces or approval workflow. General medial-axis,
open centerline and variable-width gap fill remain unimplemented.

**Surface, experimental:** [offsetSurfaceRegion](surface-offset.mjs)
takes `(patch, loopsUv, deltaMm, options)` and returns `{loopsUv, loops, report}`;
`loops` holds corresponding XYZ points. It constructs geodesic boundary strips
and round corner sectors using native NURBS first/second derivatives and an
adaptive Runge-Kutta integrator. The shared Clipper2 union/difference and winding
implementation combines the swept bands with the source material and resolves
holes, nesting and collapse. The distance construction is **new SAAM code**,
not copied Rhino source. RhinoCommon's public `OffsetOnSurface` wrapper calls
a native modelling routine whose implementation is not in the public source.
No Rhino output fixture has been supplied or run; do not claim Rhino equivalence.

The surface function retains UV throughout and caches surface evaluations; it
performs **zero inverse mappings** and no global flatten/warp round trips.
Constructing new points and emitting XYZ still requires surface evaluation.
Scope is closed UV polyline regions on **one regular, injective C2 NURBS patch**,
with the required offset-side sweeps remaining inside its domain. Low-degree
single-span planes/cylinders are supported too. Poles, singular tangents,
internal knots below C2 continuity and domain escape raise. Trimmed/multiple
patches, periodic seams, folded parameterizations and mesh-surface offsets are
not implemented. Large offsets reaching geodesic caustics/cut loci and arbitrary
high-curvature surfaces are not validated; no general global distance-error
guarantee is claimed. This function is available for development, with no current
skill silently switched to it and no new maker geometry/plan/approval route.

Options: `toleranceMm: 0.01` (local integration/chord target, not a certified
global error bound), `maxStepMm: 0.5`, `precisionUv: 1e-10`,
`maxEvaluations: 250000`. The report gives actual evaluation/integration and
subdivision counts, the budget, and experimental status. Budget exhaustion
identifies the setting to raise and returns no partial result. The caller must
provide valid patch geometry and the stated chart preconditions; there is no
expensive whole-surface injectivity or clearance validation in each call.

Development checks compare 90 nested/neck/star/island/collapse cases, inward and
outward with all three joins, against the **unmodified Clipper2 C# kernel** at
the pinned upstream revision. The reference uses the same material-region
normalization, integer grid and polygon offset options; its fixture records
source/input hashes and provenance. Historical Clipper 6 coordinates remain in
their original fixture, rather than being relabeled as Clipper2 results. Round
arc segmentation can differ between kernel versions. Surface checks cover flat nesting/collapse,
an inclined plane with rescaled UV, an independently unrolled rational cylinder,
and refinement of nested regions on a doubly curved quadratic surface. These
are software tests, not universal correctness or physical print validation.

```sh
node --test core/tests/offset.test.mjs core/tests/surface-offset.test.mjs
node scripts/bench/offsets.mjs > .local/offset-timings.json
```

To regenerate the independent Clipper2 reference, fetch the revision listed in
[planar intersection provenance](#shared-planar-intersections) into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node --input-type=module -e "import fs from 'node:fs'; import {offsetFixtures} from './scripts/bench/offset-fixtures.mjs'; fs.mkdirSync('.local/clipper2-offset-reference',{recursive:true}); fs.writeFileSync('.local/clipper2-offset-reference/inputs.json',JSON.stringify(offsetFixtures));"
dotnet build scripts/bench/clipper2-offset-reference.csproj --artifacts-path .local/clipper2-offset-reference/artifacts
dotnet .local/clipper2-offset-reference/artifacts/bin/clipper2-offset-reference/debug/clipper2-offset-reference.dll .local/clipper2-offset-reference/inputs.json > .local/clipper2-offset-reference/expected.json
node scripts/bench/check-clipper2-offset-reference.mjs .local/clipper2-offset-reference/expected.json --record
```

The checker records the independent C# output after comparison with WASM; it
does not manufacture expected coordinates from the production adapter.
Normal `npm ci`/`npm test` needs neither .NET, a network fetch nor Rhino desktop.
The current kernel carries the upstream Boost Software License 1.0.
Historical plugin C# provenance and its runner remain in
`core/tests/fixtures/clipper-reference.json` and
`scripts/bench/clipper-reference.cs`; they describe the superseded Clipper 6
comparison. The original surface investigation references the public
[Rhino wrapper](https://github.com/mcneel/rhino3dm/blob/main/src/dotnet/opennurbs/opennurbs_curve.cs).

Historical costs and diagnostic outcomes are in the
[devlog](../../DEVLOG.md#2026-09-09--clipper-6-and-surface-offset-measurements).
The benchmark runner reports cold time, warm samples, source/output hashes and
usage; measure the current kernel before making a current performance claim.

## Shared planar intersections

[intersect, union and difference](intersection.mjs) take two closed
2D material regions in millimeters and return closed loops. Current callers need
layer masks, wall/interior coverage and material reservation. Outer/island loops
are CCW, holes CW, with nonzero winding; overlapping material is counted once.
Empty material is `[]`; boundary-only point/edge contact has no material area.
`clipOpenPaths(paths, region)` additionally clips open 2D polylines to a closed
region using the same Clipper2 kernel, precision and allocation lifetime. Gyroid
infill needs this to retain curved strokes while splitting at holes and solid
masks. Open paths preserve point sequence; they are not rotated or closed by the
closed-loop canonicalizer. There is no XOR, contact-event API, UV surface adapter, mesh booleans,
NURBS intersections or backend-selection framework. Use Clipper2; consider CGAL
only if tests show an unmet requirement.

The adapter uses pinned `clipper2-wasm@0.4.0`, C++ Clipper2 2.0.1 compiled to
WebAssembly, with upstream `Clipper64`, `NonZero`, `PreserveCollinear=false`.
Intersection, winding and topology construction stay intact. Unused upstream
functions are not exposed by SAAM; the packaged Z build uses zero/unused Z.
The shared [kernel module](clipper2.mjs) initializes once for offsets
and booleans together; operations remain synchronous.
Allocated WASM objects are released on success/failure. Normal installation and
tests need no compiler or Rhino desktop; operations need no network at runtime.

Conversion shares the offset adapter's local origin/grid and canonical ordering,
using one origin for both operands. `precisionMm` defaults to `1e-9`; the range
bound is less than `2^50` grid units. Invalid numbers, non-2D points, invalid
precision or excessive spans raise. Kernel failure raises without partial output.
The booleans have no epsilon midpoint classifier, handwritten intersection
construction, endpoint stitching or small-area pruning. Integer rounding still
allows sub-grid features to collapse; JS decoding cannot recover precision lost
in the inputs. This is a precision-grid contract, not exact arithmetic or a
guarantee about unsampled spline/mesh detail.

Existing imports through [boolean.mjs](boolean.mjs) alias this tool:
full-fill, planar-infill, draped reservations and regional composition, including
vase/cap transitions. Planar offsets and experimental surface-offset swept-band
cleanup use this same kernel. Mesh/spline sectioning and sampled level sets
retain their separate geometry-construction roles.
Full-fill's bead-coverage expansion uses the existing 0.001 mm `TOLERANCE.chord`
arc target. This construction avoids artificial corner gaps without deleting
material or changing deposition strokes; the
[construction correction](../../DEVLOG.md#2026-09-09--intersection-construction-correction)
records the original failure. Runtime identity hashes exact JS/WASM bytes.

Tests include the captured 60-vertex STL failure, analytic nesting, contacts,
slivers, nearly parallel crossings through coincidence, translation/scaling,
repeated operations and 200 seeded rectangle-set cases checked by independent
cell classification. Another 138 star/nesting/contact/sliver/STL cases match the
unmodified upstream C# results exactly in coordinates and topology. Agreement
checks integration; it is not an independent proof of the upstream algorithm.
The original 1078-triangle STL passes every offset/solid-mask diagnostic layer.

```sh
node --test core/tests/intersection.test.mjs
node scripts/bench/intersections.mjs
node scripts/bench/diagnose-regions.mjs .local/slicing-rhino/rhino-standard.stl .local/intersection-diagnostics
```

Reference provenance: [WASM source](https://github.com/ErikSom/Clipper2-WASM/tree/3c244f3edd0adae6c851460fc409c15f3d235395),
[Clipper2 source](https://github.com/AngusJohnson/Clipper2/tree/642390d0d515cfb645d2ec4d95d218e28be645f4),
Boost Software License 1.0. Installed WASM SHA-256:
`429e866b4d7813cabfa7d31e6650825343109fb7d7a1702c533e8597573449ec`.
To regenerate the saved reference, fetch that Clipper2 revision into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node scripts/bench/intersections.mjs --inputs .local/intersection-inputs.json
dotnet build scripts/bench/intersection-reference.csproj --artifacts-path .local/intersection-reference-artifacts
dotnet .local/intersection-reference-artifacts/bin/intersection-reference/debug/intersection-reference.dll .local/intersection-inputs.json > .local/intersection-reference-output.json
node scripts/bench/intersections.mjs --reference .local/intersection-reference-output.json --record
```

The [devlog](../../DEVLOG.md#2026-09-09--intersection-and-twisted-fixture-measurements)
preserves the initial kernel timings and public-workflow observations. Current
benchmark output records CPU, Node, samples and source/output hashes; differences
in draped coverage limit comparisons between backends.

## Layer regions and several solids

`core/region/` does the planar work: shared Clipper2 offsets for perimeters and
coverage, scanline fill, and shared Clipper2 region boolean operations.
See [shared offsets](#shared-offset-functions) for the construction boundary.

Booleans are how several solids are meant to combine: section each solid on its
own and combine the layers, rather than building a boolean B-rep. A slicer only
needs the result one layer at a time, so surface-surface intersection curves and
tolerance-consistent shell stitching are never posed. The same operation
reserves material under a top surface, by intersecting a section with the level
set of the reserve height. The [shared planar intersection tool](#shared-planar-intersections)
owns these combinations. Sectioning and sampled level-set extraction remain separate
constructions; this is not a general curve/surface intersection engine.

The region layer is implemented and tested. Assemblies select separate
components for fill instances and a roof for draping. Automatic solid union and
overlap resolution in a plan remain deferred; an assembly is not a boolean union.

## Material regions and shared interfaces

`composition.regions` assigns skills to regions of native geometry. An empty
array retains the original whole-component recipe. Each assignment carries
`id`, `part` (null for a single component), `zStartMm`, nullable `zEndMm`,
`skills` and nullable `lowerSurfaceFrom`. Heights are relative
to the component's minimum Z. The skill map selects the skills and holds partial
setting overrides; it resolves against the other settings locked in that plan.
It supersedes global enabled flags. Regions own selection and height bounds;
overrides cannot independently change those fields.

`core/print/regions.mjs` resolves those assignments through the existing skill
generators. Full-fill can own separate base and cap regions; planar-infill and
full-fill solid-surfaces can share complementary material in another region.
Assignments retain their component layer grid and dependencies. Conflicting
ownership, unassigned height boundaries, unknown references and cycles are rejected.
Bridging over hollow or sparse material is a process choice assessed in the
recipe and Studio, without a permission flag or automated span-support gate.
Studio projects these assignments into display-only material-intent bands during
geometry review so a closed target does not conceal a consequential planned
hollow or recess. Explicit cavities remain properties of native geometry;
perimeter-only, sparse and empty bands remain process-plan properties and do not
alter the geometry artifact or its approval identity.
The retired `supportPolicy` field is accepted but ignored in older recipes;
new recipes omit it. Where a drape crosses a void, its initial volume uses the
assigned supporting components' layer grid, as in whole-component composition;
this is a bead-volume approximation, not a claim of deposited material in the void.

`lowerSurfaceFrom` consumes a preceding region's published material top. It can
bound horizontal full fill above a nonflat draped surface without changing those
paths into curved layers. The producer supplies a footprint, surface query,
sampled field and operation dependencies. The selected consumer geometry supplies
the other boundaries. A referenced surface must cover the requested region;
unknown areas are rejected instead of silently omitted. Published sparse or rim
support is distinguished from area support. Native components can describe the
intermediate roof and enclosing upper volume of the same manufactured part.

`core/region/reservation.mjs` clips only material inside a roof's actual footprint,
preserving other components. It also clips sections above consumed surfaces and
subdivides horizontal strokes to integrate their locally changing initial bead
gap. Sampling is bounded by spatial step, observed interpolation error and point
budgets; it is not a proof about arbitrary features between samples. The process
still approximates bead shape and overlap. Surface boundaries must be representable
as supported single-valued height fields; arbitrary undercuts and swept-head
clearance are outside this contract.

The synthetic [regional stack fixture](../tests/fixtures/regional-stack.mjs)
exercises base, vase wall, cap, sparse/solid body, wavy draped roof, and horizontal
full fill above the roof through the shared pipeline. Regional settings, surface
references and runtime helpers participate in the existing approval hashes;
they introduce no new approval or artifact format. Studio shows effective regional
settings, surface references and the material-intent review projection. Tests and
fixture calibration never authorize hardware.
