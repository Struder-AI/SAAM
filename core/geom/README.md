# Geometry and numerical contracts

Geometry representations, query semantics, precision, spline sectioning and mesh
repair. [Regions](../region/README.md) owns offsets, intersections and material
regions; [composition](../path/README.md) consumes the resulting skill operations.

## Geometry interoperability for skill authors

Skills consume common geometry queries with explicit supported representations.
The sections below define numerical assumptions, query semantics and the
representation-specific work behind that boundary.

### Shared numerical foundations

Aspire to **numerically robust, established algorithms with measured performance**.
Prefer a pinned, attributable upstream implementation behind one shared SAAM
interface over handwritten approximations or skill-local copies. Preserve the
upstream topology logic, tolerance semantics and required preconditions; an
algorithm's reputation does not automatically transfer to a port or adaptation.
Record source/version, intentional adaptations, supported geometry, precision,
reference comparisons, known failures and measured cost. Claims such as
"proven", "reliable" or "fast" must state the scope and supporting evidence.

All skills must call the shared functions when offsetting or intersecting.
Extend the shared interface when a capability is missing; do not add an inline
copy, fallback kernel or private tolerance variant. Geometry-specific algorithms
can live behind the same boundary with explicit capabilities and limitations.
This aspiration applies to numerical geometry and toolpath operations generally,
not just the two offset functions. It does not authorize replacing unrelated
algorithms or selecting a new general intersection engine.

Use source comparisons, adversarial fixtures, convergence tests and benchmarks
in development. Keep those expensive comparisons out of the production hot path.
Runtime checks must earn their cost under [the existing guidance](../../CONTRIBUTING.md#checks-must-earn-their-place).
Numerical integration/subdivision needed to construct a result to its requested
tolerance is algorithm work; an additional independent verification pass needs
its own justification. Preserve parameter/point correspondence and cache useful
evaluations instead of repeatedly flattening and inverse-projecting geometry.

### Precision belongs to a quantity and an operation

Choose the least expensive precision that preserves the intended process result.
Name the quantity, units, construction stage and consumer before selecting a
tolerance. More decimal places are not evidence of accuracy. A millimetre grid,
a chord-error bound, a parameter increment and an extrusion-volume allowance
are different contracts; do not replace them with one global epsilon.

| Dimension | Current examples | Developer guidance |
|---|---|---|
| Coordinate quantization, mm | Planar offset `precisionMm`; Clipper2 boolean grid `1e-9` mm | This rounds coordinates for kernel arithmetic. Use a local origin and account for repeated conversions. A grid step does not bound all later outline displacement or remove excess contour vertices. Measure the actual kernel cost before keeping extreme precision. |
| Shape approximation, mm | Native section chord `0.001` mm; offset arcs `0.02` mm; coverage arcs `0.001` mm | Bound perpendicular deviation from the source curve independently of coordinate storage. Sample long, nearly straight spans economically; preserve cumulative curvature and topology. Coverage expansion and its consuming predicates must agree about approximation error. |
| Sampling distance and feature size, mm | Surface stroke steps `0.2` mm; rim sampling `0.5` mm and error `0.01` mm; repair's explicit grid spacing | A step size is not a certified surface-error bound. Retain explicit repair resolution and measured shape change. Reducing floating-point decimals cannot undo repair's geometric approximation or reduce its triangle count. |
| Coincidence/predicate slack, mm or derived units | Point `1e-6` mm, plane `1e-7` mm; mesh separation `1e-9` mm | Keep numerical degeneracy handling separate from intentional shape simplification. A determinant from two length vectors has units mm²; compare to an area quantity or normalize it to distance/relative conditioning. Do not use a length tolerance as an area cutoff. |
| Solver parameters and angles | `TOLERANCE.parameter=1e-9` in native UV parameter units; surface `precisionUv=1e-10`; angles in degrees/radians | UV precision maps to physical displacement through surface derivatives and can differ in U and V. A normal dot product is dimensionless. Neither uses an XYZ millimetre tolerance. Record units at conversions and use scale-aware conditioning for singularity decisions. |
| Machine command quantization | S5/H2D XYZ and filament E currently five decimals; feed three decimals in mm/min; dwell integer milliseconds; Dobot ten decimals and RC8 eight | XYZ, filament length, volume, feed, time and pose need independent error budgets even when a formatter currently shares digits. Relative-E rounding can accumulate per move; absolute E has different accumulation. Reconcile final endpoints, length, volume and duration when removing or coalescing points. |
| Display approximation | Studio bead tessellation, float buffers and distance-based detail | Display budgets are visual only. They must not alter the saved program, geometry approval, deposition volume or machine checks. Printed-looking colors and shading do not establish geometric accuracy. |

Construction must respect the downstream representation. A short segment can
cross a coordinate rounding boundary, so distance alone cannot establish that
it will disappear at export. If a point is removed, preserve or recompute the
following segment's start, volume integral, local gap/width and pose metadata;
do not keep values calculated for the old endpoints. Simplify before generating
dependent data where practical. Keep shape simplification distinct from removing
numerical seams; `cleanPlanarLoop` currently uses the plane tolerance and is not
a process-resolution simplifier.
Quantize each output field once and reuse that value for text, flow calculations
and modal state. Do not format coordinates repeatedly or parse freshly formatted
commands just to recover numbers already held by the writer.

For ordinary FFF, begin performance experiments with micrometre coordinate
grids and hundredths-of-a-millimetre curve deviation, then establish the suitable
budget from feature size, line width, layer height, material interfaces and the
actual machine output. These are experiment starting points, not blanket changes
to existing skill defaults or permission to erase narrow regions. A tighter
predicate can be justified even when a coarser contour approximation is adequate.
Do not pay for sub-process detail at every offset and emitted move without
measuring its benefit.

The [external precision reference inspection](../../DEVLOG.md#2026-09-11--external-precision-reference-inspection)
illustrates distinct coordinate, segment-resolution, curve-deviation and
extrusion-area budgets. Its dated values do not establish the user's effective
settings or a speed guarantee. A deviation constraint can limit simplification
even when short segments remain.

During development, measure elapsed time, input/output point counts and geometric
change together on the same recipe. Include translated/scaled geometry, sharp
corners, small holes, thin walls, repeated operations and variable extrusion when
those consumers are affected. Compare areas in mm² and distances in mm; use
independent analytical or reference results rather than only equality to an old
over-precise output. Fix a physical-invariant failure rather than loosening its
assertion to accommodate an unexplained error. This is design/review guidance,
not another runtime precision sweep, validation gate or approval stage.

The [precision audit history](../../DEVLOG.md#br-040--dimension-aware-precision-audit-and-developer-guidance)
records corrections; [open follow-through](../../build_request.md#br-040--precision-audit-follow-through)
covers remaining findings, including collapsed-segment volume and oriented motion. Current XYZ behavior is specified
under [formats](../print/README.md#formats).

### Geometry query boundary

`core/geom/query.mjs` is the skill-facing boundary: `sectionGeometry`, `topAt`
and `sampleTopSurface`, with conservative bounds on the geometry object. It
supports the existing closed untrimmed spline shells and validated indexed
triangle meshes. Full-fill, planar-infill and draped-skin use these queries;
pattern code must not branch on triangle versus spline internals. Declare new
capabilities here and provide a backend implementation or an explicit rejection.
Both backends are supported under [D-021](../../DECISIONS.md#d-021--native-mesh-geometry).
Mesh conversion is not required before SAAMpath generation.

| Representation | Role |
|---|---|
| Spline shell / triangle mesh | Part geometry behind common queries. |
| [Volumetric scalar field](VOXEL.md) | Editable voxel samples or rational B-spline controls; explicitly extracted to the shared manufacturing mesh backend for slicing and Studio. |
| Closed regions with holes | Planar sections, offsets, solid masks and infill clipping. |
| Surface height and normal | Accessible roof sampling for drape; faceted normals stay faceted. |
| Skill operation result | Composable strokes, dependencies, layer references and travel policies. |
| SAAMpath | Machine-independent XYZ motion, deposition and process actions. |
| Output artifact | Machine-specific commands/packaging with a matching interpreter. |

Native mesh assets use `geometry/model.mesh.json` with `saam-native-geometry/1`,
millimeter indexed triangles, original source provenance and shape parameters.
Mixed assemblies retain spline recipes for spline components. Existing spline
bundles continue using `geometry/model.3dm`. New wedges store indexed meshes;
explicit wedge upgrade converts the former four-parameter/3DM recipe and
invalidates all three approvals while preserving old artifacts. No silent migration occurs.
STL import accepts ASCII and binary with explicit mm/inch units, indexes exact
shared vertices, records translation onto the bed, and retains `geometry/source.stl`
and its hash. File changes invalidate review. STL does not supply semantic CAD
faces, so Studio selects the imported component as a whole.

`core/geom/mesh.mjs` rejects invalid indices/nonfinite coordinates, degenerate or
duplicate triangles, open edges, inconsistent winding, nonmanifold vertices and
intersecting nonadjacent triangles. It does not repair geometry. Checks are
bounded to 100000 triangles and two million candidate intersection tests; adjacent
facets sharing vertices are excluded from the intersection pass, so this is not
a complete solid-kernel validity proof. Explicit [mesh repair](#explicit-mesh-repair)
adds an adjacent-contact check to its own output validation. Mesh sections preserve holes/islands and
report nudged boundary cuts. Normals at equal-height creases use the steeper
facet. Drape requires a continuous accessible roof; discontinuities or sampled
segments above its angle limit are rejected. Sampling and bead-width limits remain.

Equivalent mesh/spline fixtures and mixed assemblies exercise shared skills,
regions, machine checks, native-file integrity, approvals and exact-byte S5
export delivery. Add equivalent backend tests for each general skill. The
bounded eight-point wedge remains an explicit geometry/generation exception:
its planar roof is derived directly from validated corner points, with shared
mesh validation, scanline fill, export and review.

### Geometry contract

The **spline backend** accepts a closed shell of untrimmed bivariate spline
patches. Mesh input uses the [shared geometry interface](#geometry-interoperability-for-skill-authors).
Every spline face is
a full rectangular (u,v) patch, which is what makes sectioning tractable without
a kernel: a face's section is the zero contour of a scalar function over the
whole domain, with no trim classification. That restriction is not cosmetic.
rhino3dm is a geometry and file library, not a modelling kernel: it exposes no
booleans, no brep meshing and no surface intersection, its `BrepTrim` carries
topology indices with no parameter-space curve, and `BrepFace.loops` is unbound
in this build. A trimmed face therefore cannot be classified, and is rejected.

Closure is verified numerically: every non-degenerate patch boundary must be
matched by another patch's boundary, compared geometrically by closest point
rather than by parameter, since a ruled surface reparameterises its source
iso-curve. A degenerate boundary (a pole, as at a cap centre) closes by
itself. A trimmed or missing face fails this check.

### Sectioning untrimmed spline shells

For plane (n, d) and surface S(u,v) the section is the zero set of
`g(u,v) = n . S(u,v) - d`. The numerator of that expression is an ordinary
polynomial B-spline whose control coefficients are `w_ij (n . P_ij - d)`, and it
shares the zero set because the rational denominator is positive. Working with
the numerator gives two things: cheap evaluation, and a rigorous gradient bound
from the control net.

Sampling density is then chosen by the function rather than guessed from size. A
grid doubles while any cell could still hide a contour:

- A cell with no sign change is dismissed only when the numerator at its corners
  is farther from zero than the gradient bound allows it to travel inside the
  cell. That part is rigorous.
- A cell that does change sign is trusted by marching squares to hold one simple
  crossing, so its edges are sub-sampled and must show a single crossing each.
  Two crossings on one edge cancel in the corner signs and alias into a missing
  arc; this check is what catches that, and it is a check rather than a proof.

Crossings are refined by bracketed root finds, so contour vertices lie on the
plane rather than being interpolated, and segments are subdivided until the
chord follows the surface within tolerance, with each inserted point projected
back onto the contour. What can still be missed is a component smaller than the
final cell, bounded by `minFeatureMm`, whose default is the bead width.

A plane through a critical point of the surface (a saddle, where the contour
self-touches) or flush with a whole face is genuinely ambiguous. Both are
resolved the way slicers resolve them, by displacing the plane by up to 0.1 um
and re-cutting; the displacement is reported. A section that still will not
close raises rather than returning a part with a gap in it.

## Text and solid modifiers

The [text task skill](../../skills/text/SKILL.md) adds font-derived material,
removes it, or retains it as a standalone solid. Planar glyph outlines use the
existing Clipper2 union through [shared intersections](../region/intersection.mjs).
The [solid boundary](solid.mjs) uses pinned `manifold-3d@3.5.3` C++/WASM for 3D
union and difference. Its internal 3D intersections are separate from planar
Clipper2; the two backends serve different representations. No existing planar
consumer is switched to Manifold.

[Font outline extraction](text-outline.mjs) uses pinned `fontkit@2.0.4` for glyph
selection, positioning and vector paths. Bezier subdivision bounds control-point
distance to each chord in flat millimetres. The original font bytes, hash, text,
layout and variation settings are retained. Flat baseline deformation is followed
by planar normalization before extrusion, avoiding cap diagonals that cross newly
curved letter boundaries. The volume is subdivided, then mapped to the reference
surface along its normal. Mid-edge and triangle-centroid deviations drive further
subdivision; these samples are not a global error certificate. Reversed reference
normals retain outward solid winding.

Explicit `outlineOffsetMm` uses the existing shared planar offset before layout
to thicken or thin strokes. This changes the geometry; it is never inferred from
bead width at generation. A curved-roof regression demonstrates that thin 6 mm
Abel C/U outlines disappear with a 0.4 mm bead (0.2 mm first-perimeter inset),
and verifies deposition above the source roof for all five letters after
0.15 mm outline expansion.

[Reference surfaces](reference-surface.mjs) accept an independent open rational
B-spline control net, a plane, or a named original-part patch. A flat rectangle
maps explicitly to a UV rectangle; local scale/distortion belongs to that mapping.
They do not become printable material. Rigid glyph mode places each glyph on its
local tangent plane. Spline-baseline arc length uses a subdivided Bezier chord
table with continuous curve/tangent evaluation; it is approximate.

[Target tessellation](tessellate.mjs) samples supported closed spline shells,
matches shared boundaries geometrically despite different parameterizations,
and propagates mesh orientation. Its dyadic grid refines against sampled chord
deviation and rejects unmatched seams or shared mesh-validation failures. The
1e-7 mm vertex welding grid is distinct from its 0.02 mm default approximation
target. Manifold's JS mesh boundary stores float32 coordinates, so precision also
depends on coordinate magnitude. Input solids must have positive material volume.
No conversion is introduced into ordinary native spline slicing.

The text result is a `shape: text` recipe inside the existing native mesh bundle:
original base, editable features, quality controls, output vertices/triangles and
a digest binding construction inputs to that output. The actual persisted mesh
is the reviewed and sliced geometry; reopening validates its bytes and descriptor
without rerunning font shaping or booleans. Text edits rebuild through
[the preparation entry](../print/text.mjs), then the normal bundle update invalidates
affected reviews. Text's original STL source hash remains checked. Assembly edits
retain the selected component id and other components' representations.

Upstream contracts: [Fontkit](https://github.com/foliojs/fontkit),
[Manifold](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html).
SAAM tests cover analytical boolean and lettering volumes, counters, curved
target convergence, cylindrical/doubly curved independent references, baseline
layout, normal reversal, rigid/mirrored glyphs, persistence and shared generation.
These do not establish universal font/script support, global mapping injectivity,
or physical printability.

## Rhino geometry

The spline backend uses Rhino and native 3DM files. Imported meshes use
[native indexed geometry](#geometry-interoperability-for-skill-authors), with
the user-confirmed shared interface preserving direct spline slicing.
The bounded wedge retains `skills/wedge-demo/` and its eight-point generator;
do not substitute the shell slicer. New wedges use indexed meshes with six named planar faces, an
axis-aligned rectangular base and vertical sides. The planar roof may slope in
any direction. Their native file is `geometry/model.mesh.json`; the wedge uses
rhino3dm only to verify older 3DM files during explicit upgrade. General edited-3DM import,
spline-surface intersections and full Rhino computation remain deferred.
rhino3dm is a geometry/file library, not the complete Rhino computation engine.

## Explicit mesh repair

The [mesh-tools manual](../../skills/mesh-tools/SKILL.md) owns diagnosis, command
usage, options and review of processing results. [The repair entry](../print/repair-stl.mjs)
owns cleanup/reconstruction and its source-preserving artifacts. It is separate
from ingestion; the normal importer validates supplied geometry. Existing mesh
input checks attach a recovery-manual reference when they reject data, without
adding another validation pass or changing the successful-load path.

At the user's explicit request, these are original JavaScript implementations,
not an adopted upstream repair kernel. [Reconstruction](mesh-repair.mjs)
indexes exact coordinate matches, removes degenerate/duplicate facets and unused
vertices, and returns already-valid geometry without resampling. Otherwise it
requires closed, consistently oriented manifold edges, classifies a padded grid
by signed X-ray crossings, samples source distance near the surface and extracts
the zero surface of a conforming six-tetrahedra subdivision. This handles
intersections between separate shells and folds within a shell without identifying
a special model, plane or repair location. Half-open projected-edge ownership
avoids counting a shared triangle edge twice. Distances at grid vertices have a
minimum magnitude of 0.001 times the grid spacing to avoid nearly zero-area faces.

The selected fill rule interprets the signed crossings as material. Oppositely
wound surfaces can express cavities or cancellation. Reconstruction requires
closed, consistently oriented manifold edges; open or ambiguous incidence is
rejected. Grid spacing controls approximation detail and cost, without certifying
surface error or preservation of topology.

When needed, [quadric edge collapse](mesh-simplify.mjs) reduces the surface
with local link, duplicate-face, orientation and spatial collision checks before
each accepted collapse. Its error metric is accumulated plane residual rather
than Hausdorff distance. Grid and reconstruction budgets bound allocations;
exhaustion or a final result outside import limits fails before output is saved.

Final validation uses shared `makeMesh`, repair-specific checks for overlap beyond
shared vertices/edges, and reimport of the exact decimal ASCII STL. Decimal
coordinates avoid a new float32 rounding step. The spatial predicates use floating
point with 1e-9 mm contact tolerance, not exact arithmetic. Failed validation
produces no repaired artifact. Reported distances sample vertices in both
directions, including source surfaces discarded inside overlaps; they are not a
certified continuous bound.

Tests cover analytical overlapping-box volume convergence, rotated folded
connected surfaces, cavities, holes, disconnected pieces, inverted winding,
fill-rule differences, exact cleanup, ray-edge ownership, adjacent contact,
allocation/topology failures and source-preserving S5/H2D import without approvals.
These are software checks, not universal repair or physical print validation.
The same repaired mesh remains subject to each skill's shape limits, including
vase-wall's single-section/single-inset-loop restriction. Spline geometry is not resampled by this
STL-only operation; all downstream composition and machine contracts remain shared.
