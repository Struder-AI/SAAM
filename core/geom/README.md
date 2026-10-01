# Geometry and numerical contracts

## Repair worker and native process boundary

`core/print/mesh-repair-job.mjs` owns a worker per repair/import, running inline when already in that worker.
It settles after worker termination, allowing scratch cleanup. Progress callback errors abort;
geometry callbacks acknowledge matching message IDs before work continues. Abort rejects pending
acknowledgements; missing results and results arriving after cancellation cannot become success.
`mesh-repair-worker.mjs` transfers repaired bytes and closes its message port on completion or failure.
The native executable uses files, stderr progress and stdout reports. [Native repair](./native/README.md)
owns build instructions, limits and provenance, including geometry-owned C++, CMake, dependency hashes
and licenses outside the JavaScript scanner. Keep those resources consistent with the wrapper protocol.
[Regions](../region/README.md) documents offsets/intersections; [composition](../path/README.md) consumes them.

## Planar line/region clipping

[clipLineToRegion](curve-region.mjs) clips `origin + t * direction` through closed XY loops,
retaining source parameters. Direction must be finite/nonzero; ordered `range` defaults to the
whole line, with a singleton querying point membership. `fillRule` is `nonzero` (default) or `evenodd`.
It returns ordered `spans: [[t0,t1],…]` and `contacts: [[t0,t1],…]`. Half-open spans retain crossing
subdivisions. Contacts merge overlapping input-boundary points/collinear intervals; tangency adds no
span and collinearity no winding crossing. Normalize cancelling/overlapping loops first when the
combined material boundary is required. Repeating the closing vertex is optional.
Wing uses even-odd spans; infill uses nonzero spans and its minimum stroke length. Travel uses spans
and contacts against its existing expanded footprint, interpolates height in source parameters,
and uses singleton queries for vertical moves. Deposition retains its top/bottom boundary asymmetry.
This floating-point sweep adds no epsilon, snapping, spline clipping or exact-predicate guarantee.
Travel's offset retains Clipper precision, but clipped endpoints no longer use its grid. General
polyline clipping stays in [Clipper2](../region/intersection.mjs) for its topology/grid semantics.

## Geometry interoperability for skill authors

Heat-set and text retain editable feature recipes. Heat-set [slice assignments](../../skills/heat-set-inserts/scripts/slices.mjs)
own local deposition volumes; the [manual](../../skills/heat-set-inserts/SKILL.md) owns feature constraints.
Skills share geometry queries with the explicit numerical and representation limits below.

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
Runtime checks must earn their cost under [the existing guidance](../../BUILDERS.md#avoid-check-spirals).
Numerical integration/subdivision needed to construct a result to its requested
tolerance is algorithm work; an additional independent verification pass needs
its own justification. Preserve parameter/point correspondence and cache useful
evaluations instead of repeatedly flattening and inverse-projecting geometry.

### Precision belongs to a quantity and an operation

Choose precision by quantity, units, construction stage and consumer. More decimals do not establish
accuracy; coordinate grids, chord error, parameter increments and volume allowances need separate budgets.

| Dimension | Current examples | Developer guidance |
|---|---|---|
| Coordinate quantization, mm | Planar offset `precisionMm`; Clipper2 boolean grid `1e-9` mm | This rounds coordinates for kernel arithmetic. Use a local origin and account for repeated conversions. A grid step does not bound all later outline displacement or remove excess contour vertices. Measure the actual kernel cost before keeping extreme precision. |
| Shape approximation, mm | Native section chord `0.001` mm; offset arcs `0.02` mm; coverage arcs `0.001` mm | Bound perpendicular deviation from the source curve independently of coordinate storage. Sample long, nearly straight spans economically; preserve cumulative curvature and topology. Coverage expansion and its consuming predicates must agree about approximation error. |
| Sampling distance and feature size, mm | Surface stroke steps `0.2` mm; rim sampling `0.5` mm and error `0.01` mm | A step size is not a certified surface-error bound. Report mesh repair shape changes separately from numerical precision. |
| Coincidence/predicate slack, mm or derived units | Point `1e-6` mm, plane `1e-7` mm; mesh separation `1e-9` mm | Keep numerical degeneracy handling separate from intentional shape simplification. A determinant from two length vectors has units mm²; compare to an area quantity or normalize it to distance/relative conditioning. Do not use a length tolerance as an area cutoff. |
| Solver parameters and angles | `TOLERANCE.parameter=1e-9` in native UV parameter units; surface `precisionUv=1e-10`; angles in degrees/radians | UV precision maps to physical displacement through surface derivatives and can differ in U and V. A normal dot product is dimensionless. Neither uses an XYZ millimetre tolerance. Record units at conversions and use scale-aware conditioning for singularity decisions. |
| Machine command quantization | S5/H2D XYZ and filament E currently five decimals; feed three decimals in mm/min; dwell integer milliseconds; Dobot ten decimals and RC8A eight | XYZ, filament length, volume, feed, time and pose need independent error budgets even when a formatter currently shares digits. Relative-E rounding can accumulate per move; absolute E has different accumulation. Reconcile final endpoints, length, volume and duration when removing or coalescing points. |
| Display approximation | Studio bead tessellation, float buffers and distance-based detail | Display budgets are visual only. They must not alter the saved program, geometry identity, deposition volume or machine checks. Printed-looking colors and shading do not establish geometric accuracy. |

Short segments can cross rounding boundaries; length alone cannot predict their disappearance.
When removing points, preserve/recompute subsequent starts, volume integrals, gaps, widths and pose.
Simplify before dependent data where practical. `cleanPlanarLoop` removes numerical seams using plane
tolerance; it is not process-resolution simplification. Quantize each output field once and reuse it
for text, flow and modal state instead of repeated formatting/parsing.

For ordinary FFF experiments, start with micrometre grids and hundredths-of-a-millimetre deviation,
then measure against feature size, bead dimensions, material interfaces and actual output. These are
not new defaults or permission to erase narrow regions; predicates may need tighter precision than contours.
The [external inspection](../../DEVLOG.md#2026-09-11--external-precision-reference-inspection) separates these
budgets but establishes neither effective user settings nor speed. Deviation limits can retain short segments.

Measure elapsed time, point counts and geometric change on the same recipe. Include affected translated/scaled
geometry, corners, holes, thin walls, repeated operations and variable extrusion. Compare areas in mm² and
distances in mm against independent references; fix physical-invariant failures rather than loosening checks.
This is development guidance, not a runtime sweep or approval gate. The [precision history](../../DEVLOG.md#br-040--dimension-aware-precision-audit-and-developer-guidance)
records corrections/follow-ups; the [provenance audit](../../DEVLOG.md#2026-09-14--build-request-provenance-audit)
does not authorize every finding. [Formats](../print/README.md#formats) specifies current XYZ behavior.

### Geometry query boundary

[section](../region/section.mjs) returns a solid's oriented loops on a plane,
patch or height chart, with nudge/edge diagnostics. Planar and curved sections
share Boolean topology, holes and disconnected components. [sliceFamily](slice.mjs)
stacks cutting surfaces; [slices](../print/slices.mjs) owns material allocation.
[query](query.mjs) supplies top/containment queries on native shells and meshes.

Geometry outputs are ordinary values and evaluations of those values:

| Operation | Current consumers and contract |
|---|---|
| [surfaceIsoCurve](surface-curves.mjs) | Shell closure, conforming tessellation and sleeve offsets use ordinary rational curves retaining knots, weights, native domain and source surface coordinates. |
| [evaluateSurface / mappedSurface](surface-evaluation.mjs) | Trace, text, Slice mapping and surface deposition share point/normal/derivative evaluation. Affine selection retains native UV and derivative units; sleeve phase is periodic arc length, height charts use world XY. |
| [sampleCurveIntervals](curve-sampling.mjs) | Trace, sleeve contours and surface deposition share physical chord/step refinement while retaining source parameters and explicit breaks. |
| [constructSolids](solid-operations.mjs) | Heat-set, text and gridfinity submit construction/translation/Boolean requests; Geometry owns conversion, mapped-extrusion refinement and native disposal. Results are manufacturing meshes (null for empty material). Feature rules and editable records remain with extensions. |
| [planarRegionLayers](planar-region-layers.mjs) | Given a height range, numeric process, authored `regionsAt(z)` polygons, optional shells and XY clearance, return merged planar Slice layers and family. Geometry checks shell intersections at the sampled layer heights and throws on a positive clearance overlap; it never invents source regions. |
| [resolveGeometrySelections](build.mjs) | Resolves whole solids, components, material partitions and replacement volumes in an offset frame; owns runtime loading and reuses source builds within a batch. Async path generation requests these values; Toolpath retains assignment and ownership policy. |
| [intersectPatches](surface-intersection.mjs) | Section boundaries retain corresponding parameters on both native surfaces. |
| [extractLevelSet](level-set.mjs) | Sampled scalar fields yield bounded high-side region loops (default) or genuine `{points,closed}` contours (`output: 'curves'`). Roof reservations and chart predicates use regions; gyroid uses curves. |

Level extraction retains high-side equality, ordered ambiguous-cell pairing, sentinel refinement,
`1e-7` chart endpoint matching and `TOLERANCE.point` cleanup. Only regions add domain edges; curves
can end there. Uniform high/low fields yield no curves and domain/empty regions. `levelSetCoverage`
classifies without extraction. Sampling may miss detail; field/deposition choices remain caller policy.

Geodesic region offsets retain their C2/domain limits; piecewise roofs/sleeves
keep explicit crease transitions. No trimmed-surface capability is introduced.
Native geometry and explicit manufacturing meshes remain authoritative; display
approximations never replace them. Saved/native/display artifacts retain their
existing geometry identity. Deposited-material contact remains in Toolpath.

Native mesh assets use `geometry/model.mesh.json` with `saam-native-geometry/1`,
millimeter indexed triangles, original source provenance and shape parameters.
Mixed assemblies retain spline recipes for spline components. Existing spline
bundles continue using `geometry/model.3dm`.
STL import accepts ASCII and binary with explicit mm/inch units, indexes exact
shared vertices, records translation onto the bed, and retains `geometry/source.stl`
and its hash. File changes invalidate review. STL does not supply semantic CAD
faces, so Studio selects the imported component as a whole. ASCII STL uses the
line-oriented format: the `solid` header ends before facet records, and `endsolid`
closes the file. Leading whitespace, CRLF and a closing solid name are accepted.

`core/geom/mesh.mjs` rejects invalid indices/nonfinite coordinates, degenerate or
duplicate triangles, open edges, inconsistent winding, nonmanifold vertices and
intersecting nonadjacent triangles. It does not repair geometry. Checks are
controlled by a configurable memory estimate and a spatial hierarchy. The number
of candidate pairs tested is whatever the mesh's own overlapping bounds and
shared vertices produce; there is no work allowance on it. Adjacent
facets sharing vertices are excluded from the intersection pass, so this is not
a complete solid-kernel validity proof. Explicit [mesh repair](#explicit-mesh-repair)
adds an adjacent-contact check to its own output validation. Mesh sections preserve holes/islands and
report nudged boundary cuts. Normals at equal-height creases use the steeper
facet. Drape requires a continuous accessible roof; discontinuities or sampled
segments above its angle limit are rejected. Sampling and bead-width limits remain.

Equivalent mesh/spline fixtures and mixed assemblies exercise shared skills,
regions, machine checks, native-file integrity, approvals and exact-byte S5
export delivery. Add equivalent backend tests for each general skill.

### Prepared contour mapping

[Contour correspondence](./contour-path.mjs) assigns normalized arc length from a
fixed projected seam to a closed polygon; it does not require a star-shaped or
convex section. [Prepared contour families](./prepared-contours.mjs) reuse that
correspondence over height and signed offset before repeated tiles are mapped.
The caller supplies the exact section/offset query and a separate millimetre
mapping-error allowance. Bilinear cells interpolate both height and offset;
they never change the source mesh, curve or pattern.

Each cell checks edge quarter-points and nine interior points against the exact
query, targeting half the reserved allowance to leave margin between samples.
At each check, a sweep of the union of all contour parameter breakpoints
finds the maximum discrepancy around the entire perimeter: between breakpoints
the discrepancy is linear. Height/offset checks remain sampled, so this is not
a certified global error bound for arbitrary geometry or hidden topology
changes. Failing cells refine locally up to eight subdivisions, then use the
exact query. Invalid off-path samples cause refinement; an invalid requested
query retains the source diagnostic. Consumers must reserve the mapping
allowance inside their overall path tolerance and preserve topology/range
checks at the source query.

`at(u,z,offset)` maps a point. `curveAt(z,offset)` exposes the identical mapping
through `at(u)`, `knots()` and lazy `breakpoints()` for contour consumers. The
breakpoint grid includes the seam at both 0 and 1. Prepared maps belong to one
fixed geometry/query instance and must be rebuilt after its inputs change.
Four height slabs are retained, each with at most 512 cell entries and 512
source-query cache entries. A successful cell retains four source contours;
failed cells retain no contours. Memory therefore depends on bounded contour
complexity and these fixed caches, not the total printed height or tile count.

The mesh section query separately caches edge connectivity in eight vertex-height
bands. Coordinates are still interpolated on the original triangle edges at
each requested cut, including the existing boundary nudge. This exact reuse
preserves holes, contour order and section bytes; it is independent of the
optional approximate contour preparation.

### Loose and tight spline offsets

A loose offset moves control points only: control count, degrees, knots,
domains and weights (including periodic duplicates) are kept, and no control is
added or refitted. Input controls remain unchanged.

[surface-offset.mjs](./surface-offset.mjs) has two separate operations
([D-041](../../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface)):
`prepareSurfaceRibbon({patch, periodicU, periodicV})` displaces a patch
horizontally, along the plan-view projection of its unit normal, with Z kept
exactly (the direction net has no Z); `prepareSurfaceOffset` displaces it along
its unit normal. The direction net is collocated: the direction patch, with the
patch's own basis and weights, equals the unit direction times the rational
weight at every Greville point, found by two small square solves (along U, then
V). The moved patch is therefore exact there (to about 1e-15 mm; under 1 µm
between on a 16-control r 10 cylinder at 2 mm). Periodic seam duplicates share
one direction; nonperiodic outer Greville values are clamped to the domain.
Each returns `at(u, v, depth)` (the loose patch's point), `exactAt(u, v,
depth)` (the source point moved the depth along the unit direction there),
`offsetPatch(depth)` and `report()`. Nothing limits depth: past a curvature
radius the loose patch folds, and folds are for trimmed-surface records to cut.
A consumer's tightness blends `at` toward `exactAt`.

`trimmed(depth, {toleranceMm = 0.01})` returns the moved patch as a
[trimmed-surface](./trimmed-surface.mjs) record, `{kind: 'trimmed-surface',
version: 1, patch, periodicU, periodicV, boundary}`: chains in the curve-offset
format in the patch's (u,v), material left of travel. The domain edges are part
of the boundary (a counterclockwise rectangle; periodic U: a +U loop at the
bottom edge and a −U loop at the top; periodic V: −V at the low U edge, +V at
the high), and fold holes run clockwise, unwrapped across a seam. A **sleeve's
ribbon** (every U isocurve at one Z: control Z constant along U, weights
separable) has its folds trimmed exactly per level: each U isocurve of the
moved patch is the curve ribbon of the source's, cut by `foldCuts`
(curve-ribbon.mjs), with levels refined in V until cut ends are within the
tolerance of linear and a fold's start and end height within it. A hole that
meets a V edge runs along it; folds that merge or split between levels are
rejected, naming the height. Any other patch, and every surface offset, is
checked for orientation reversal against the source, (M_u × M_v)·(S_u × S_v) ≤ 0,
at 8 × 8 samples per knot span, and rejected naming the first fold found
(provisional ruling pending the owner). Self-intersections between distant
parts are not resolved.

[Curve offsets](./curve-offset.mjs) resolve collisions as a region offset does
([D-041](../../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface)).
`prepareCurveOffsets({curves: [{curve, closed}], patch})` takes curve records
from `referenceCurve` lying in one XY plane, or in a patch's (u,v) with depth in
millimetres to first order; `offset(depth)` returns chains of pieces. Each curve
moves loosely: control directions are collocated at Greville parameters, so
lines and circular arcs move exactly, and at a kink the vertex moves to where
the adjoining pieces meet. The moved curves are cut where they cross
([curve-ops.mjs](./curve-ops.mjs)), and a piece is kept when it runs with its
source and the winding is at least one on its left and at most zero on its
right. Where a curve meets itself or another end to end (a closed curve's seam,
a smooth joint) the contact is judged by arc length within the crossing
tolerance, since Newton is only linear there. Where the exact offset has an
inversion cusp the loose curve can turn through a small loop instead (a
**curl**: one self-crossing, no other crossing on it, entered running with the
source and left against it); a curl bounds nothing whatever its winding.
Closed curves follow the region convention: material left of travel,
positive depth grows it. An open curve's offset is one-sided and keeps only what
is at least the depth from every source curve. Pieces past a patch's edges are
trimmed off; control counts change only where pieces are cut. With `periodicU`
or `periodicV` (a seam), curves lie in the unwrapped chart and may cross the
seam; a closed curve may end whole periods from its start, wrapping the seam
(a +U loop has its material above it). Crossings and winding count every
whole-period copy; each chain continues itself and reports its `wraps`. Loose accuracy depends on the control net: a turn
spanning few controls lands short (a 4-control U offset 2 mm outward is 0.84 mm
from its bottom).

[Ribbons](./curve-ribbon.mjs) displace a 3D curve horizontally with Z kept:
`prepareCurveRibbon({curve, closed}).ribbon(depth)`. Where the displaced curve
runs backwards in plan view, the fold is cut at the plan-view crossing that
closes it within half a turn of the source, leaving a small Z step; when nothing
closes it, only the backwards part is cut. A closed curve's fold may straddle its
seam (the search runs on three copies). `foldCuts(moved, source, closed)`
returns the cut intervals for other callers. Crossings between distant parts stay.
Reversals are found from 32 samples per knot span.

`prepareSleeveContours` in `sleeve-frame.mjs` offsets horizontal native NURBS
isocurves of periodic patches whose V chart reproduces actual Z. Crossings
resolve before chord-controlled sampling and perimeter correspondence.
`at(phase,zMm,depth)` follows one retained closed contour; split/collapse rejects.
Vase mapping adds nominal half-bead depth, then applies unilateral mesh contact.

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

## Mesh sleeves

Sleeve fitting, mapping and contact belong to the
[advanced-vase extension](../../skills/advanced-vase-wall/DEVELOPER.md).

## Text and solid modifiers

The [text geometry skill](../../skills/text/SKILL.md) adds font-derived material,
removes it, or retains it as a standalone solid. Planar glyph outlines use the
existing Clipper2 union through [shared intersections](../region/intersection.mjs).
The [solid boundary](./solid.mjs) uses pinned `manifold-3d@3.5.3` C++/WASM for 3D
union and difference. Its internal 3D intersections are separate from planar
Clipper2; the two backends serve different representations. No existing planar
consumer is switched to Manifold.

[Font outline extraction](./text-outline.mjs) uses pinned `fontkit@2.0.4` for glyph
selection, positioning and vector paths. Bezier subdivision bounds control-point
distance to each chord in flat millimetres, and ends only on that tolerance or on
a parameter interval too small to halve again, which is reported as such. The original font bytes, hash, text,
layout and variation settings are retained. Flat baseline deformation is followed
by planar normalization before extrusion, avoiding cap diagonals that cross newly
curved letter boundaries. The volume is subdivided, then mapped to the reference
surface along its normal. Mid-edge and triangle-centroid deviations drive further
subdivision; these samples are not a global error certificate. Refinement repeats
while the deviation keeps falling, and a pass that no longer reduces it reports a
reference that cannot be resolved rather than spending a fixed pass count. Reversed reference
normals retain outward solid winding.

Explicit `outlineOffsetMm` uses the existing shared planar offset before layout
to thicken or thin strokes. This changes the geometry; it is never inferred from
bead width at generation. A curved-roof regression demonstrates that thin 6 mm
Abel C/U outlines disappear with a 0.4 mm bead (0.2 mm first-perimeter inset),
and verifies deposition above the source roof for all five letters after
0.15 mm outline expansion.

[Reference surfaces](./reference-surface.mjs) accept an independent open rational
B-spline control net, a plane, or a named original-part patch. A flat rectangle
maps explicitly to a UV rectangle; local scale/distortion belongs to that mapping.
They do not become printable material. Rigid glyph mode places each glyph on its
local tangent plane. `kind: top` instead uses the shared [top-surface query](./query.mjs)
on the retained original spline or mesh: layout XY stays in physical millimetres,
with the highest surface height and normal at that column. Missing roof columns
fail. It creates no sampled copy of the surface; folds, ridges and discontinuous
normals retain the query and text-mapping limitations.

[Shared text layout](./text-layout.mjs) composes straight, Bezier and circular
baselines with placement, rotation and mirroring before surface mapping. Circle
advance is exact XY arc length at its radius; glyph Y follows the left normal,
and centre-crossing layouts fail. It retains font spacing without stretching a
word to fill the circle. Bezier arc length uses a subdivided chord table with
continuous curve/tangent evaluation; it is approximate. Existing UV references
and saved compiled meshes retain their semantics.

[Target tessellation](./tessellate.mjs) samples supported closed spline shells,
matches shared boundaries geometrically despite different parameterizations,
and propagates mesh orientation. Its dyadic grid refines against sampled chord
deviation and rejects unmatched seams or shared mesh-validation failures. The
grid keeps doubling until that deviation meets the requested tolerance; there is
no triangle budget, and a doubling that no longer lowers the deviation is
reported as a tolerance this shell cannot reach. The
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

Text records save digest-bound `materialParts`: `base` and
`text/<feature-id>`. Raised additions exclude existing material; later recessed
cuts subtract from every partition. Empty partitions are omitted. An uncut base
uses `geometry: null` to retain the original native geometry and its queries;
other partitions store their resulting mesh. Their boolean construction uses the
same tessellation approximation as the final solid. `standalone: true` retains
the source only as a reference and exposes no base material or base preparation
details; it is the one optional field, present only on a reference body. A record
without `materialParts` is rejected, not read as a whole solid.

[Geometry selections](./selections.mjs) exposes these partitions to regional
consumers, prefixing their names with the assembly component id where present.
The final merged mesh remains the default whole-solid selection and review model.
Changing the selected material or toolpath skill leaves the geometry record
unchanged. The [region contract](../region/README.md#material-ownership-and-surface-contact)
owns assignment and overlap rules.

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
Spline solids intersect planes exactly ([sectioning](#sectioning-untrimmed-spline-shells))
and vertical lines ([field.mjs](field.mjs)); booleans of them are combined one
layer at a time ([boolean-solid.mjs](boolean-solid.mjs)). General edited-3DM
import, surface-surface intersection curves and full Rhino computation remain
deferred. rhino3dm is a geometry/file library, not the
complete Rhino computation engine.

## Explicit mesh repair

The [mesh-tools manual](../../skills/mesh-tools/BUILDER.md) owns command use and
review of changes. [The repair entry](../print/repair-stl.mjs) preserves the
source, runs exact cleanup, and uses the [native CGAL adapter](./mesh-native.mjs)
when cleanup alone does not yield a valid mesh. Studio, CLI and agent imports
attempt it for recognized defects, then present geometry for review. Invalid
formats retain their diagnostics; repair never fills holes without explicit bounds.

[Cleanup](./mesh-repair.mjs) merges identical coordinates and removes duplicate,
degenerate and unused elements. Collapsed faces can leave a long boundary edge
opposite a complete collinear chain. Cleanup subdivides the surviving face at
those existing vertices, preserving positions and winding with a 1e-9 mm
line-distance tolerance. It does not guess between branches or fill actual holes.

The native backend orients the soup, stitches compatible borders, and applies
CGAL 6.2.1 local patch repair with smoothing disabled and genus preservation
requested. It can split vertices to represent manifold patches, but that does
not guarantee a valid closed solid. Optional hole filling needs both an edge-count
limit and a physical bounding-box diagonal limit. Failed repair, remaining open
boundaries or detected intersections produce no accepted output. See the
[native build and license reference](./native/README.md).

Final checks use shared mesh topology/intersection checks, adjacent-contact checks
and reimport of the exact decimal ASCII STL. Contact tolerance is 1e-9 mm;
this is not an exact-arithmetic validity proof. The report counts unchanged source
faces and changed/new faces and samples vertices and triangle centroids in both
directions. Samples are deterministic and bounded to 10,000 per direction. They
are not a certified maximum surface error. Identical face geometry is recognized
exactly without distance sampling. An optional sampled-distance limit rejects
excessive measured changes; it does not certify unsampled regions. Geometry still
needs review, and successful processing creates no manufacturing approval.

### Memory, files and progress

[File decoding](./stl-file.mjs) reads ASCII and binary STL in 64 KiB blocks and
drives the same incremental parser as complete-buffer decoding. Format validation,
unit scaling, finite-coordinate checks, exact indexing and capacity checks therefore
have one owner. The wrapper computes the source hash and reports progress while
reading; the parser retains only indexed geometry, an 84-byte format prefix and
the current record/token remainder. The public import
and repair file entries accept paths so callers need not allocate the entire
source buffer. Output STL is written in bounded text chunks. Native temporary
files are private to each request and deleted on success, failure or cancellation;
file results are staged and validated before publishing a new destination.

The shared validator uses packed edge incidence, a triangle AABB hierarchy, and
compact normals. Cached identity is a streaming SHA-256 digest; derived cache data
is capped at 32 MiB. Public normals and edge maps materialize lazily. The former
fixed face-count gate is gone, and so is the working-set estimate that used to
refuse a mesh before any of it was read: no stage rejects geometry because a
predicted size looked large. What remains is index capacity, a representational
limit of the indexed arrays (at most 0x7ffffffe vertices and 0x3ffffffe
triangles). A real allocation failure is reported as it happens, naming the stage
and the mesh size, and never changes geometry. When the Node heap itself is
exhausted inside the repair worker the supervisor reports that the mesh exceeded
available memory rather than an anonymous worker failure. The source indexed mesh,
CGAL mesh and final result still require memory. Neither native repair nor
downstream bundle serialization is out-of-core; a mesh larger than the machine can
hold fails on the allocation that actually failed, not on a prediction.

Repair runs in a worker thread, with CGAL in a child process. Async repair accepts `signal`, `progress` and `onGeometry`.
Countable stages report completed/total and percentage within that stage. CGAL
patch work is indeterminate; no fabricated global percentage is reported.
Elapsed time never refuses a repair. The child process ends when it finishes,
when it fails, or when the caller cancels through `signal`; nothing kills it for
running long, because the pinned helper reports only when it enters a stage and
its self-intersection and hole-triangulation work can run for a long time in one
stage. Silence is therefore not evidence of a stalled child, and no interval of
silence is treated as one. The helper's stdout report is a single line of counts;
anything larger is rejected as output that did not come from this helper.
After final validation, `onGeometry` receives at most 4,096 full-quality triangles
per chunk, with local vertices/indices, first-triangle offset and completion
percentage. Each callback is awaited, allowing the consumer to release a chunk
before requesting more. There is no lower-quality display proxy. Studio import uses the shared progress and cancellation lifecycle.

The [repair job](../print/mesh-repair-job.mjs) supervises the
[worker](../print/mesh-repair-worker.mjs). Geometry messages carry IDs;
the worker waits for the matching acknowledgment before continuing. Callback
failure sends an error acknowledgment and requests abort. Abort rejects and clears
pending geometry acknowledgments. The supervisor settles once, removes its abort
listener, prefers a consumer callback error when present, and rejects worker exit
without a result. Transferred repaired bytes are reconstructed with their actual
offset and length. These message/lifetime rules are authored contracts; native
worker wiring is not fully resolved by the map extractor.

### Mesh compatibility development boundary

Mesh import, cleanup, repair, memory handling, progress, generic regression tests
and owning documentation are shared core work intended for the remote repository.
The dataset loop, comparison runners, downloaded evaluation builds, trial profiles,
benchmarks and raw reports remain under ignored `.local`. Production code does
not depend on those experiments. Test models are disposable; supplied originals
are preserved. Temporary inspection adapters use existing Studio interfaces.
