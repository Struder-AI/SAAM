# Regions, offsets and intersections

Shared planar and surface region operations, topology and material ownership.
Read the relevant operation contract below and the [geometry query boundary](../geom/README.md#geometry-query-boundary)
when changing its inputs. [Composition](../path/README.md) owns operation ordering
and travel across those regions.

## Deposition stroke footprints

[strokeRegion](./stroke.mjs) sweeps 2D open or explicitly closed polylines by a
positive bead width using the shared Clipper2 kernel, round joins and round caps.
The returned nonzero-winding region unions crossings while preserving unfilled
spaces. It is a nominal XY bead footprint, not a measured deposited surface or
support guarantee. Level pattern rims use only final-course segments with positive
extrusion; they never substitute a filled sleeve. Coordinate grid
and arc-tolerance options remain separate, as for closed region offsets.

## Shared offset functions

**Planar:** [offsetRegion](./offset.mjs) accepts closed 2D loops in mm
and a signed distance: positive expands material, negative erodes it. Pass the
whole region together, including CCW outer/island loops and CW holes. Nonzero
winding determines material; loop order and seams do not assign ownership.
The `region2d.mjs` compatibility export is an alias to this exact function. Slices,
draped-skin, vase-wall and shared rim coverage/travel all use it.
Draped-skin uses an XY footprint inset.

Offsets return closed material polygons: an inset yields remaining material,
not a stroke band on both sides of a boundary.

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

Surface cladding uses native 3D differential offsets through the
shared surface/section functions. Those are distinct from closed planar polygon
offsetting and remain there. Native mesh/spline sectioning and scanline stroke
construction likewise keep their appropriate geometry algorithms; universal
Clipper2 integration does not mean flattening those operations into polygons.

`perimeterLoops` in [perimeters.mjs](./perimeters.mjs) supplies slice loops. It retains a single central closed track when
an outer/hole pair meets and material erosion loses that hole, without changing
region erosion or fill masks. General medial-axis, open centerline and
variable-width gap fill are unsupported.

**Surface, experimental:** [offsetSurfaceRegion](./surface-offset.mjs)
takes `(patch, loopsUv, deltaMm, options)` and returns `{loopsUv, loops, report}`;
`loops` holds corresponding XYZ points. The construction is experimental SAAM
code; no Rhino output comparison or equivalence is established.

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
global error bound), `maxStepMm: 0.5` and `precisionUv: 1e-10`. There is no
evaluation budget: the requested tolerance and step decide how much integration
and subdivision the patch needs, and the report gives the actual evaluation,
integration and subdivision counts with experimental status. Integration halves
its step until the step would stop advancing, which is reported as an unresolved
tolerance rather than a spent budget; swept-strip subdivision and disk sectors
likewise divide until their parameter is one representable step wide. The caller must
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
[developer maps](../../scripts/bench/region-reference.md#offset-verification-and-provenance).

## Shared planar intersections

[intersect, union and difference](./intersection.mjs) take two closed
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

Operations are synchronous and need no network at runtime.

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

Existing imports through [boolean.mjs](./boolean.mjs) alias this tool:
slices, skin reservations and common construction assignments, including
vase/cap transitions. Planar offsets and experimental surface-offset swept-band
cleanup use this same kernel. Mesh/spline sectioning and sampled level sets
retain their separate geometry-construction roles.
Slice fill's bead-coverage expansion uses the existing 0.001 mm `TOLERANCE.chord`
arc target. This construction avoids artificial corner gaps without deleting
material or changing deposition strokes; the
[construction correction](../../DEVLOG.md#2026-09-09--intersection-construction-correction)
records the original failure. Runtime identity hashes exact JS/WASM bytes.

Verification scope, reference regeneration and provenance are in the
[developer maps](../../scripts/bench/region-reference.md#intersection-verification-and-provenance).

## Layer regions and several solids

[section](section.mjs) extracts planar and curved regions through one dispatch
for native shells, meshes, chart prisms, assemblies and Boolean operands. Its
loops retain the supporting chart: XY/plane coordinates are millimetres, native
patch coordinates remain UV. Both use the same winding and Boolean topology;
physical offsets retain the appropriate planar or surface metric.

Section each Boolean operand and combine its regions without building a B-rep.
Supports, Slice, terminal-boundary queries and geometry tools use this operation.
Material masks, fill patterns and actual deposited contact retain Toolpath policy.

## Material ownership and surface contact

`plan.slices.assignments` owns surface, stack and material selection.
[allocateChartClaims](ownership.mjs) rejects competing positive material claims;
a default owner retains the remainder after explicit regions and reservations.
Shared ownership and connected mixed-family overlap are deferred to [0.3.0](../../plans/0.3.0.md).
Diagnostics identify assignments/components. Planar polygon contact uses the
shared `TOLERANCE.point` (`1e-6` mm), not bead dimensions; spline section evidence
also accounts for `TOLERANCE.chord` (`1e-3` mm). Bounds and control-hull separating
directions can prove disjointness, never overlap. Boundary-interval probes catch
thin claims between print layers. Uncertifiable curved, rotated or concave pairs
report that exclusivity cannot be established; touching is not universally certified.
Matching reference charts compare regions/depth directly. See the
[slice manual](../../skills/slice/SKILL.md); assembly components are not implicitly unioned.
Prepared text exposes `base` and `text/<feature-id>` selections, prefixed by the
component ID in an assembly. [Geometry selections](../geom/selections.mjs)
resolves these with their component placement without changing saved geometry.

[assignmentPlan](../print/assignment-process.mjs) resolves filament defaults then
assignment process overrides. Explicit stack gaps govern slice-family geometry;
process values supply deposition defaults.

[reservation.mjs](./reservation.mjs) removes temporary process cavities from
owned material. A plastic-weld reservation supplies a
footprint, `regionAt(z)` and a solid envelope `solidRegionAt(z)`. Height-field
slices evaluate reservations in world space before returning chart regions.
Reservations are rebuilt from the recipe; they do not claim deposited coverage.
[Plastic weld](../../skills/plastic-weld/SKILL.md) owns cavity completion and
operation dependencies.

Skin survey, curve mapping and local gaps are shared stages in
[roof-region.mjs](./roof-region.mjs), [layer-strokes.mjs](./layer-strokes.mjs)
and [surface-curves.mjs](./surface-curves.mjs). Seeded fronts use
[seeded-fronts.mjs](./seeded-fronts.mjs) before the same mapping/deposition stages.
Mapping preserves surface normals and checks physical sample spacing and chord
error. Only actual exporters enforce machine orientation compatibility.

A skin's `supportFrom` selects a finalized source and prerequisites.
Experimental `plan.experimental.substrateAdaptation` defaults OFF: use nominal
reference gaps without final-bead queries. ON selects nominal predecessor courses
per chart column and measures actual bead gaps; missing required substrate and
invalid contact rejects; exporters enforce machine limits. This changes volume, not authored slice XYZ.
3D-printing support assignment is a separate judgment. Absent named sources and
dependency cycles remain invalid in either mode.

[Finalization](../print/finalize.mjs) applies modulation before dependent
construction and republishes boundaries from final strokes.
[deposited-curves.mjs](../path/deposited-curves.mjs) supplies bead membership and
contact height from positive-volume segments, their widths and local normals.
Sparse rims, open strands and holes remain sparse; a native shell or nominal
reserve cannot substitute for deposited coverage. This is a planned bead model,
not measured material or a physical support guarantee. Raised sleeves and rims
currently reject modulated foundations whose contact reconstruction is unsupported.

Topology and contact are sampled; features between samples can be missed.
Single-valued height fields exclude arbitrary undercuts, and no swept-head
clearance model is implied. The synthetic
[stack fixture](../tests/fixtures/regional-stack.mjs) combines slab owners,
a sleeve, cap, body and wavy skin through this pipeline. Fixture execution and
machine-path checks do not authorize hardware.
