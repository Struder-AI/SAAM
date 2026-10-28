# Regions, offsets and intersections

Shared planar and surface region operations, topology and material ownership.
Read the relevant operation contract below and the [geometry query boundary](../geom/README.md#geometry-query-boundary)
when changing its inputs. [Composition](../path/README.md) owns operation ordering
and travel across those regions.

## Shared offset functions

**Planar:** [offsetRegion](./offset.mjs) accepts closed 2D loops in mm
and a signed distance: positive expands material, negative erodes it. Pass the
whole region together, including CCW outer/island loops and CW holes. Nonzero
winding determines material; loop order and seams do not assign ownership.
The `region2d.mjs` compatibility export is an alias to this exact function. Slices,
native slices, vase-wall and shared rim coverage/travel all use it.

Offsets return closed material polygons; an inset yields remaining material.

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
the [Clipper2 tool](#shared-planar-intersections) directly through
`core/region/intersection.mjs`; there is no second Boolean import path.

Native surface offsets, sections and scanlines retain their geometry kernels;
shared Clipper2 topology does not flatten their physical measurements.

`perimeterLoops` in [perimeters.mjs](./perimeters.mjs) supplies slice loops. It retains a single central closed track when
an outer/hole pair meets and material erosion loses that hole, without changing
region erosion or fill masks. General medial-axis, open centerline and
variable-width gap fill are unsupported.

**Surface, experimental:** [offsetSurfaceRegion](./surface-offset.mjs)
takes `(patch, loopsUv, deltaMm, options)` and returns `{loopsUv, loops, report}`;
`loops` holds corresponding XYZ points. No Rhino output comparison or equivalence is established.

One engine owns physical surface offsets for native patches, evaluated charts
and authored sleeve atlases. Boundaries are closed UV polylines or
`{curve}` native NURBS records in chart coordinates; native curves are sampled
by physical chord error before the same topology stage. Inputs retain their
controls, weights and degree; results are derived UV/XYZ loops. Open centerline
buffers use `strokeSurfaceRegion` through that same engine. The former loose,
first-order native surface-curve route is removed.

Smooth charts must be regular and injective, with C2 internal knots; low-degree
single spans are supported. Atlases preserve authored creases, holes and seams.
Erosion rays stop at chart edges for every representation. Outward growth takes
optional `constraintLoopsUv`, intersected with the chart domain; each ray stops
at its first boundary crossing, including holes. Without a constraint, outward
smooth-chart domain escape raises. Invalid authored inputs still raise; no
whole-surface injectivity or clearance pass runs on every call.

Options: `toleranceMm: 0.01` (physical target), optional `maxStepMm` (ray cap,
default the offset distance), `precisionUv: 1e-10` and `normalMm: 0`. Native input
sampling, simplification, RK4 integration and mapped ray chords each use one eighth
of the budget; strip/corner chords use one quarter. RK4 estimates position and
continuing-direction error; adaptive steps are independent of deposition sampling.
Strips refine at chart/knot breaks and physical chord error. Boundary contacts
stay fixed; full-ray deviation bounds tangent normalization. UV rounding is separate.

Topology uses shared Clipper2 union/difference; no inverse mapping, global
flattening, evaluation quota or degree elevation. Reports count evaluations,
steps, subdivisions, boundary stops, simplification and collapsed contours.
Construction refines to the local target or fails at floating-point stagnation.
Arbitrary high curvature, caustics/cut loci, trimmed multi-patch surfaces and
global distance-error certification remain outside the validated contract.

[parallelSliceRows](surface-operations.mjs) supplies rectilinear/grid/triangle
fill with physical spacing: seed the heading once, then advance both fronts
through this offset owner and clip to the owned region. Proven affine charts
use exact line translation, including degree-elevated planar control nets.
Fixed chart-edge strips and stopped fan sectors do not grow; front refinement
measures physical deviation from its UV chord. Deposition owns XYZ chord sampling.
[Wave](../../skills/wave-overhangs/SKILL.md), curved Slice walls and rows share
this engine; projected millimetre regions use `offsetRegion`.

Verification scope, reference regeneration and provenance are in the
[region verification reference](../../scripts/bench/region-reference.md#offset-verification-and-provenance).

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
closed-loop canonicalizer. Parameter-preserving line spans and boundary contacts
for wing, scanline and travel queries use the separate shared Geometry
[line/region query](../geom/README.md#planar-lineregion-clipping); it explicitly
preserves their parity, winding and boundary policies. There is no XOR, UV surface adapter, mesh booleans,
NURBS intersections or backend-selection framework. Use Clipper2.

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

Slices, skin reservations and construction assignments import this tool directly,
including vase/cap transitions. Planar offsets and surface-offset swept-band
cleanup use this same kernel. Mesh/spline sectioning and sampled level sets
retain their separate geometry-construction roles. Sampled fields use Geometry's
[extractLevelSet](../geom/level-set.mjs): sampled chart predicates request
bounded regions, while gyroid clips genuine contours to its material mask.
Slice fill's bead-coverage expansion uses the existing 0.001 mm `TOLERANCE.chord`
arc target. This construction avoids artificial corner gaps without deleting
material or changing deposition strokes; the
[construction correction](../../DEVLOG.md#2026-09-09--intersection-construction-correction)
records the original failure. Runtime identity hashes exact JS/WASM bytes.

Verification scope, reference regeneration and provenance are in the
[region verification reference](../../scripts/bench/region-reference.md#intersection-verification-and-provenance).

## Layer regions and several solids

[section](section.mjs) extracts planar and curved regions through one dispatch
for native shells, meshes, chart prisms, assemblies and Boolean operands. Its
loops retain the supporting chart: XY/plane coordinates are millimetres, native
patch coordinates remain UV. Both use the same winding and Boolean topology;
physical offsets retain the appropriate planar or surface metric.

[Native Booleans](../geom/README.md#native-boolean-construction) section their constructed
boundary; mixed/mesh Booleans combine operand regions. Toolpath owns material policy.

## Material ownership and surface contact

[prepareMaterialRegions](./material-regions.mjs) takes ordered native claims and nominal stacks, returning owned layers and findings. An explicit claim owns the material inside it; a default owner keeps what no explicit claim covers. Settings stay per region; defaults retain unclaimed material and separate parts.
An explicit `substrate:{origin,normal}` plane clips stack advance in its frame.
SAAM has no overlap distribution between claims; see the [maker/builder boundary](../../MAKERS.md#toolpaths).
Text selections are `base` and `text/<feature-id>`, prefixed by assembly component;
[geometry selections](../geom/selections.mjs) applies placement without changing saved geometry.

[assignmentPlan](../print/assignment-process.mjs) resolves filament defaults and assignment overrides.
Stack gaps define layers; process values supply deposition defaults.

[Process sources](../../skills/AUTHORING.md) supply finite Boolean cutters and
ordinary solid-material volumes before Slice resolves ownership. Geometry
sections them on each reference; they do not claim deposited coverage.
[Plastic weld](../../skills/plastic-weld/SKILL.md) declares its cavity/enclosure;
Scheduling owns material prerequisites and nozzle access through the saved path.

Slice maps prepared native regions with [layer-strokes.mjs](./layer-strokes.mjs)
and [surface-curves.mjs](./surface-curves.mjs). Geometry owns finite offset
neighborhoods and local frames; completion prerequisites remain symbolic.
Wave and bridge construction uses selected geometric edges before Trace.

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
a sleeve, cap and body through this pipeline. Fixture execution and
machine-path checks do not authorize hardware.
