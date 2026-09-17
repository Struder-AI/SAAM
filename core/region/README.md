# Regions, offsets and intersections

Shared planar and surface region operations, topology and material ownership.
Read the relevant operation contract below and the [geometry query boundary](../geom/README.md#geometry-query-boundary)
when changing its inputs. [Composition](../path/README.md) owns operation ordering
and travel across those regions.

## Deposition stroke footprints

[strokeRegion](stroke.mjs) sweeps 2D open or explicitly closed polylines by a
positive bead width using the shared Clipper2 kernel, round joins and round caps.
The returned nonzero-winding region unions crossings while preserving unfilled
spaces. It is a nominal XY bead footprint, not a measured deposited surface or
support guarantee. Level motif rims use only final-course segments with positive
extrusion; they never substitute the filled reference sleeve. Coordinate grid
and arc-tolerance options remain separate, as for closed region offsets.

## Shared offset functions

**Planar:** [offsetRegion](offset.mjs) accepts closed 2D loops in mm
and a signed distance: positive expands material, negative erodes it. Pass the
whole region together, including CCW outer/island loops and CW holes. Nonzero
winding determines material; loop order and seams do not assign ownership.
The `region2d.mjs` compatibility export is an alias to this exact function. Full-fill,
planar-infill, draped-skin, vase-wall, shared rim coverage/travel and the bounded
wedge all use it. The wedge retains its eight-point section generator and nearby-travel
policy while using shared boundary insets. Draped-skin uses an XY footprint inset.

Offsets return closed material polygons: an inset yields remaining material,
not a stroke band on both sides of a boundary. Kernel implementation is in the
[developer bin](../../DEVELOPER-CONTEXT.md#regions--planar-offset-kernel).

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

`perimeterLoops` in [perimeters.mjs](perimeters.mjs) supplies deposition contours
for full-fill and planar-infill. It retains a single central closed track when
an outer/hole pair meets and material erosion loses that hole, without changing
region erosion or fill masks. General medial-axis, open centerline and
variable-width gap fill are unsupported. Construction details live in the
[developer bin](../../DEVELOPER-CONTEXT.md#regions--perimeter-recovery).

**Surface, experimental:** [offsetSurfaceRegion](surface-offset.mjs)
takes `(patch, loopsUv, deltaMm, options)` and returns `{loopsUv, loops, report}`;
`loops` holds corresponding XYZ points. The construction is experimental SAAM
code; no Rhino output comparison or equivalence is established. See the
[construction context](../../DEVELOPER-CONTEXT.md#regions--surface-offset-construction).

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
guarantee is claimed. The experimental [wave-overhangs skill](../../skills/wave-overhangs/SKILL.md)
uses this function explicitly; other skills retain their existing offset metrics.

Options: `toleranceMm: 0.01` (local integration/chord target, not a certified
global error bound), `maxStepMm: 0.5`, `precisionUv: 1e-10`,
`maxEvaluations: 250000`. The report gives actual evaluation/integration and
subdivision counts, the budget, and experimental status. Budget exhaustion
identifies the setting to raise and returns no partial result. The caller must
provide valid patch geometry and the stated chart preconditions; there is no
expensive whole-surface injectivity or clearance validation in each call.

Optional `constraintLoopsUv` clips outward growth to an allowed UV material
region and the patch domain. Each integrated ray stops at its first boundary
crossing; a later re-entry does not seed material across a hole. Boundary-tangent
rays retain their allowed extent. Boundary-starting rays may project small drift
onto that same boundary, keeping front endpoints attached. Clipper2 simplification
between advances removes redundant segments; its UV tolerance is scaled using
sampled native derivatives, and boundary contacts remain fixed. `simplificationUv`
records that parameter-space tolerance; it is a local approximation rather than
a certified global surface-distance bound. The report adds `boundaryStops`. Constrained
strip/corner construction uses the local sampling tolerance near discontinuous
stopped rays; it is not exact obstacle-geodesic distance. Wave propagation uses
small repeated advances and reports terminal residuals. Without this option,
the original domain-escape error and unconstrained offset behavior remain.

Verification scope, reference regeneration and provenance are in the
[developer bin](../../DEVELOPER-CONTEXT.md#regions--offset-verification-and-provenance).

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

Operations are synchronous and need no network at runtime. Shared kernel
initialization and allocation details live in the
[developer bin](../../DEVELOPER-CONTEXT.md#regions--intersection-kernel).

Conversion shares the offset adapter's local origin/grid and canonical ordering,
using one origin for both operands. `precisionMm` defaults to `1e-9`; the range
bound is less than `2^50` grid units. Invalid numbers, non-2D points, invalid
precision or excessive spans raise. Kernel failure raises without partial output.
An optional finite `origin: [x,y]` fixes the quantization lattice across repeated
operations. Constrained surface growth anchors its UV grid to the chart bounds;
ordinary planar callers retain the automatic common local origin.
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

Verification scope, reference regeneration and provenance are in the
[developer bin](../../DEVELOPER-CONTEXT.md#regions--intersection-verification-and-provenance).

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

### Temporary process cavities

A native shell can carry generation-local `processReservations`. Each entry
supplies a `footprint` and `regionAt(z)` through the existing reservation clipper.
Planar walls and interiors subtract that region, including precomputed solid
masks. An optional `solidRegionAt(z)` assigns an enclosing solid mask through
planar-infill's existing complementary full-fill producer. The same material
cannot also receive sparse deposition. These callbacks are reconstructed from
the locked recipe; they are not a new persisted geometry or artifact format.

A `completion: {z, region, operationId}` declares the material surface supplied
when the process finishes. Regional surface publication includes completed
material and passes the operation dependency to consumers. An unfinished cavity
crossing a `lowerSurfaceFrom` boundary still exposes its deeper floor; use
contiguous flat bands for such a crossing, or complete the cavity at the consumed
interface. Publication describes planned material, not measured cavity filling.
[Plastic weld](../../skills/plastic-weld/SKILL.md) implements this contract.

`composition.regions` assigns skills to regions of native geometry. An empty
array retains the original whole-component recipe. Each assignment carries
`id`, `part` (null for a whole single component), `zStartMm`, nullable `zEndMm`,
`skills` and nullable `lowerSurfaceFrom`. Heights are relative
to the component's minimum Z. The skill map selects the skills and holds partial
setting overrides; it resolves against the other settings locked in that plan.
It supersedes global enabled flags. Regions own selection and height bounds;
overrides cannot independently change those fields.

Prepared text exposes `base` and `text/<feature-id>` material selections; in an
assembly prefix these with `<component-id>/`. Whole-component selectors retain
their existing meaning. [Geometry selections](../geom/selections.mjs) resolves
each selection with its component placement. Height bounds are relative to the
selected material's minimum Z. Disjoint partitions may share height ranges;
whole/partition or repeated-partition overlap needs the same explicit consumed
lower-surface relationship as overlapping whole-component assignments. Selection
is a process choice and does not change geometry approval. The
[text manual](../../skills/text/SKILL.md#material-selections-and-printing-patterns)
owns creation and editing of these prepared partitions.

`core/print/regions.mjs` resolves those assignments through the existing skill
generators. Full-fill can own separate base and cap regions; planar-infill and
full-fill solid-surfaces can share complementary material in another region.
Assignments retain their component layer grid and dependencies. Conflicting
ownership, unassigned height boundaries, unknown references and cycles are rejected.
Bridging over hollow or sparse material is a process choice assessed in the
recipe and Studio, without a permission flag or automated span-support gate.
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

A draped-only consumer can occupy a thin curved component above that surface,
including a raised-text material selection. Its local first-bead gap replaces the planar
consumer's global start-height requirement; valleys outside its footprint do not
constrain its minimum Z. The nominal skin reserve is not a deposited boundary:
support slightly above it produces a thinner first bead. Each sampled stroke
must have a finite supporting height and a positive gap to its first skin.
The normal skin spacing and the top geometry still determine the remaining
layers. Missing support and deposition into already finished material fail.

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
settings and surface references. Tests and fixture calibration never authorize hardware.
