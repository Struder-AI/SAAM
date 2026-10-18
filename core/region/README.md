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
roof slices, vase-wall and shared rim coverage/travel all use it.
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
the [Clipper2 tool](#shared-planar-intersections) directly through
`core/region/intersection.mjs`; there is no second Boolean import path.

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

One engine owns physical surface offsets for native patches, evaluated charts
and authored sleeve/roof atlases. Boundaries are closed UV polylines or
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

Options: `toleranceMm: 0.01` (physical local approximation target),
`maxStepMm: 0.5` (ray integration step cap), `precisionUv: 1e-10` (topology grid)
and `normalMm: 0`. Native input sampling, simplification and RK4 integration each
use one eighth of the physical budget; strip/corner chords use one quarter.
RK4 step doubling estimates position and continuing-direction error, apportioned
by physical travel. Strips refine at chart/knot breaks and physical chord error,
rather than acquiring a fixed point density from the integration step. Boundary
contacts remain fixed during simplification. UV rounding remains separate.

All topology uses the shared Clipper2 union/difference owner. No inverse mapping,
global flatten/warp, evaluation quota or degree elevation is involved. The report
records actual evaluations, steps, subdivisions, boundary stops, simplification
and collapsed subresolution contours. Construction refines until it meets the
local target or floating-point progress fails. This remains experimental:
arbitrary high curvature, geodesic caustics/cut loci, trimmed multi-patch surfaces
and global distance-error certification are outside its validated contract.
The [wave-overhangs skill](../../skills/wave-overhangs/SKILL.md) and curved Slice
use this owner; planar/projected millimetre regions use `offsetRegion`.

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
closed-loop canonicalizer. Parameter-preserving line spans and boundary contacts
for wing, scanline and travel queries use the separate shared Geometry
[line/region query](../geom/README.md#planar-lineregion-clipping); it explicitly
preserves their parity, winding and boundary policies. There is no XOR, UV surface adapter, mesh booleans,
NURBS intersections or backend-selection framework. Use Clipper2.

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

Slices, skin reservations and construction assignments import this tool directly,
including vase/cap transitions. Planar offsets and surface-offset swept-band
cleanup use this same kernel. Mesh/spline sectioning and sampled level sets
retain their separate geometry-construction roles. Sampled fields use Geometry's
[extractLevelSet](../geom/level-set.mjs): roof/reservation consumers request
bounded regions, while gyroid clips genuine contours to its material mask.
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

[Native Booleans](../geom/README.md#native-boolean-construction) section their constructed
boundary; mixed/mesh Booleans combine operand regions. Toolpath owns material policy.

## Material ownership and surface contact

[prepareMaterialRegions](./shared-material/prepare.mjs) takes ordered native claims and nominal stacks, returning owned layers, adjusted references and findings. Settings stay per region; defaults retain unclaimed material and separate parts.
An explicit `substrate:{origin,normal}` plane clips stack advance in its frame.
Shared cadence/nonplanar transitions require developer-only `plan.experimental.sharedMaterial:true`; normal generation uses ordinary claims/remainder without interlock discovery. See the [maker/builder boundary](../../MAKERS.md#toolpaths).
Text selections are `base` and `text/<feature-id>`, prefixed by assembly component;
[geometry selections](../geom/selections.mjs) applies placement without changing saved geometry.

[assignmentPlan](../print/assignment-process.mjs) resolves filament defaults and assignment overrides.
Stack gaps define layers; process values supply deposition defaults.

[Process sources](../../skills/AUTHORING.md) supply finite Boolean cutters and
ordinary solid-material volumes before Slice resolves ownership. Geometry
sections them on each reference; they do not claim deposited coverage.
[Plastic weld](../../skills/plastic-weld/SKILL.md) declares its cavity/enclosure;
Scheduling owns material prerequisites and nozzle access through the saved path.

Skin survey, curve mapping and local gaps are shared stages in
[roof-region.mjs](./roof-region.mjs), [layer-strokes.mjs](./layer-strokes.mjs)
and [surface-curves.mjs](./surface-curves.mjs). Wave and bridge geometry uses the common printed-edge construction before Trace deposition.
Mapping preserves surface normals and checks physical sample spacing and chord
error. Only actual exporters enforce machine orientation compatibility.

A skin's `supportFrom` selects a finalized source and prerequisites.
Experimental `plan.experimental.substrateAdaptation` defaults OFF: use nominal
reference gaps without final-bead queries. ON selects nominal predecessor slices per chart column and measures actual bead gaps;
missing required substrate rejects; exporters enforce machine limits. A course with no material below keeps its nominal bead, one
running into material deposits nothing there, and `limitations` lists each span. This changes volume, not authored slice XYZ.
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
