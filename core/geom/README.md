# Geometry and numerical contracts

## Geometry execution

[execution.mjs](execution.mjs) owns Geometry worker lifecycle, communication, memory policy,
cancellation, deadlines, progress and errors. Named capabilities hide this machinery from clients.
One bootstrap serves supervision and leased calculations, reusing an idle calculation. Supervision stays responsive.
Boolean owns fuzzy matching and perturbations; execution enforces caller deadlines and cancellation. Construction has no elapsed-time refusal.
Progress callback errors cancel work. Geometry chunks await their matching acknowledgement.
Async calls settle after calculation stops, including cancellation and worker allocation failures.
Callers own scratch directories and publication; calculations may write only their supplied staging
file. Payloads pass directly to calculation ports. No geometry is simplified for memory or transport.
[Regions](../region/README.md) documents offsets/intersections; [composition](../path/README.md) consumes them.

## Planar line/region clipping

[clipLineToRegion](curve-region.mjs) clips `origin + t * direction` through closed XY loops,
retaining source parameters. Direction must be finite/nonzero; ordered `range` defaults to the
whole line, with a singleton querying point membership. `fillRule` is `nonzero` (default) or `evenodd`.
It returns ordered `spans: [[t0,t1],…]` and `contacts: [[t0,t1],…]`. Half-open spans retain crossing
subdivisions. Contacts merge overlapping input-boundary points/collinear intervals; tangency adds no
span and collinearity no winding crossing. Normalize cancelling/overlapping loops first when the
combined material boundary is required. Repeating the closing vertex is optional.
Loops accept UV/XY vertices or connected ordinary `points`/`nurbs` curves ([schema](../../GEOMETRY.md#spline-surfaces)).
Lines use the edge sweep; rational curves use native span roots and winding. Trim sections refine
their ends against native curve/plane intersections. Polygon-only operations derive chord-controlled
views; sewing restores surviving source-curve intervals. Knots, weights and control points remain authority.
Wing uses even-odd spans; infill uses nonzero spans; travel interpolates retained source parameters.
Deposition keeps its top/bottom asymmetry. No exact-predicate guarantee is added; general polygon
clipping and offset topology stay in [Clipper2](../region/intersection.mjs).

## Geometry interoperability for skill authors

Hosts supply the [canonical CAD operations](operations.mjs). Geometry owns construction, queries,
conversion and native lifetime; extensions own feature decisions. `buildGeometry` prepares numerical values.

### Shared numerical foundations

Shared Geometry methods preserve provenance, preconditions, topology and precision; in-house kernels need evidence.
Design references: [Rhino events](https://developer.rhino3d.com/api/rhinoscript/surface_and_polysurface_methods/surfacesurfaceintersection.htm) and [OCCT interferences](https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html); no kernel code was copied.

### Native Boolean construction
The [canonical operations](operations.mjs) own backend selection. Authored unions with
provably disjoint interiors retain native operands. Operations on native boundaries trim
them; composed/mixed operands retain queries. Sections and containment accept either form;
Clipper2 handles UV regions. `BOOLEAN_TOLERANCE_MM` in [dimensions](../dimensions.mjs)
is the single 0.005 mm setting: chord images use a quarter, sewing half; roots stay finer.
Rational coefficient proofs handle basis changes and partial/periodic coincidence;
local chart proofs bound fuzzy matches. General intersections audit control hulls beyond
0.4 mm starting seeds, using interval exclusion, contraction and root-graph certificates.
Sub-resolution closures are counted. Coplanar projection keeps native boundaries;
support planes separate rotated contacts; point/edge contacts retain material sectors.
Geometry automatically tries original construction, fuzzy matching at a quarter tolerance,
then growing translations from the original operands after numerical failures. Interruptible workers continue until completion or cancellation.
Success reports fuzzy accuracy or each actual displacement in notes; jiggles can exceed the default tolerance.
Exhausted recovery returns its failures. General trimmed normal offsets remain unsupported.
Mesh/mixed sections also retain operands. Explicit output tessellates native boundaries;
nonempty checks derive a mesh only when construction has not already proved presence.
[Regressions](../tests/surface-boolean.test.mjs), [authored examples](../../scripts/bench/boolean-examples/)
and [benchmarks](../../scripts/bench/surface-boolean.mjs) save correctness/timing evidence.

### Precision belongs to a quantity and an operation

Tolerance classes and values belong to [Dimensions and tolerances](../README.md#dimensions-and-tolerances).
Within Geometry, keep separate budgets for coordinate quantization (Clipper2 grids, a planar offset's
`precisionMm`: kernel arithmetic; use a local origin), shape approximation (chord error from the source
curve, independent of coordinate storage; coverage expansion and its predicates must agree), sampling
steps (not a certified surface-error bound) and predicate slack (rounding guards only). A determinant of two
length vectors is in mm²; UV tolerances map to millimetres through surface derivatives and can differ
in U and V; a normal dot product is dimensionless.

Point removal preserves starts, volume, gaps, widths and pose; quantize each output
field once. `cleanPlanarLoop` removes numerical seams, not process detail. Compare
elapsed time, point counts and geometric change on the same independent references;
fix physical-invariant failures rather than loosening checks. [Formats](../print/README.md#formats)
owns written XYZ behavior.

### Geometry query boundary

Plane sections accept `side:'negative'|'positive'` for one-sided limits along their normal, propagated through Boolean operands; outside-side extrema are empty. Default sections retain their existing numerical displacement. Curved sections do not accept this option.

[section](../region/section.mjs) retains native topology and diagnostics; [sliceStack](slice.mjs) supplies references for [material allocation](../region/README.md).

| Operation | Current consumers and contract |
|---|---|
| [surfaceIsoCurve](surface-curves.mjs) | Shell closure, conforming tessellation and sleeve offsets use ordinary rational curves retaining knots, weights, native domain and source surface coordinates. |
| [surfaceCurveImages](surface-curve-image.mjs) | Given a numerical patch and an ordinary UV `points`/`nurbs` curve, return `{nurbs,uvNurbs}` pieces split at native knot crossings. Bernstein composition retains exact rational images; extensions use them for matching ruled walls, and trim sections use them for curve/plane roots. |
| [evaluateSurface / mappedSurface](surface-evaluation.mjs), [surfaceDerivatives](surface-derivatives.mjs), [surfaceReferenceRecord / prepareSurfaceReference](surface-record.mjs) | Native units, derivatives and chart identity survive numerical serialization. References retain original factory inputs; preparation reuses their evaluators, including [contact charts](contact-chart.mjs). Out-of-domain and singular samples retain their errors. |
| [prepareNumericalCurve / numericalCurveAt / numericalCurveRange](curve-query.mjs) | Native NURBS, polylines and points share conservative position, tangent, speed, chord-error and convergent arc-length bounds. Geometry also supplies direction/full-frame cones. [Construction sampling](curve-sampling.mjs) uses probes, preserving observed crossings and breaks; unsampled crossings remain unknown. |
| [constructGeometry / constructSolids / materialPresence](solid-operations.mjs) | One pipeline accepts ordinary geometry or box/cylinder/loft/translate/Boolean/mapped-extrusion requests. `constructGeometry` returns `{geometry,empty,notes}` retaining serializable source solids; `constructSolids` explicitly derives meshes or null. Root assemblies retain parts; Boolean operands resolve placed physical unions. Presence uses construction proofs or an explicit mesh query. Opaque numerical inputs support mesh output only. |
| [loftProfiles / roundedRectangleProfile / transformGeometry](solid-profiles.mjs) | Corresponding closed NURBS profiles yield rational side surfaces and radial caps with explicit or averaged centers; caps require a star-shaped region about those centers. Rounded rectangles retain exact arcs. Rigid transforms apply to physical solids, leaving feature recipes with their authors. Concave polygon lofts retain [triangulated caps](loft.mjs). |
| [revolvedProfile](revolved-profile.mjs) | `{positionMm, axis, profile:[[axialMm,radiusMm],…]}` yields ordinary rational spline geometry. Increasing axial positions and positive radii define cylindrical/conical intervals and end caps; heat-set and weld choose their dimensions. |
| [closeMeshPatchToPlane](mesh-patch-solid.mjs) | An indexed mesh plus selected `triangleIndices`, horizontal `planeZMm` and vertical `offsetMm` becomes `{solid, notes}`, a closed manufacturing mesh. Retains roof triangulation, holes and disconnected patches; vertical or degenerate faces and faces reaching the plane are skipped and noted. Folds, point-only joins and overlapping projections retain ordinary mesh errors; no selection, trimming, process policy or native lifetime in callers. Standard support consumes this operation. |
| [prepareContourSleeve](sleeve/contour-sleeve.mjs) | Given explicit section heights, pitch, standoff, offset, tolerances and fit mode, construct contour correspondence and a Slice stack. Extensions choose those values; Geometry checks and maps the sections. |
| [resolveGeometrySelections](build.mjs) | Resolves whole solids, components, material partitions and replacement volumes in an offset frame; synchronously reuses numerical source builds within a batch; Toolpath retains assignment and ownership policy. |
| [resolveMaterialGeometry](build.mjs) | Builds an ordered batch of authored geometry, sharing immutable source builds. Numerical construction recursively unions placed assembly components for material queries; ordinary construction/selections retain their assembly representation. Unsupported shapes and invalid shells/meshes retain construction errors; an empty intersection has flat bounds. No recipe placement or Bundle mutation. |
| [prepareSolidDistance / solidDistance](solid-distance.mjs) | Preparation builds material, tessellates at `toleranceMm`, admits the mesh and returns `{prepared,report:{toleranceMm,triangles,representation}}`, preserving tessellation errors and native Boolean disposal. Synchronous queries traverse every triangle without a radius limit; `signed` uses containment only above `1e-12` mm. Toolpath owns field composition, report keys, channels and sampling policy. |
| [prepareBlobField / evaluateBlobField](blob-field.mjs) | Preparation turns finite weighted points or a periodic bump lattice into a plain record once; queries sample that record. Finite sources retain optional gradients and ordered accumulation; unrepresentable bucket coordinates use an ordered direct sum. Toolpath owns composition and sampling. |
| [widenPlanarStrokes](stroke-topology.mjs) | Widens coplanar XYZ strokes in an explicit unit frame with round joins/caps, a fixed 0.001 mm grid and caller-supplied radius/arc tolerance. Returns closed XYZ loops; Toolpath retains bead count, pitch and width policy. |
| [intersectPatches](surface-intersection.mjs) | Section boundaries retain corresponding parameters on both native surfaces. |
| [extractLevelSet](level-set.mjs) | Sampled scalar fields yield bounded high-side region loops (default) or genuine `{points,closed}` contours (`output: 'curves'`). Roof reservations and chart predicates use regions; gyroid uses curves. |

Level extraction retains high-side equality, ordered ambiguous-cell pairing, sentinel refinement,
chart endpoint matching and point cleanup at print resolution. Only regions add domain edges; curves
can end there. Uniform high/low fields yield no curves and domain/empty regions. `levelSetCoverage`
classifies without extraction. Sampling may miss detail; field/deposition choices remain caller policy.

Geodesic offsets keep their C2/domain limits; roofs/sleeves retain explicit creases.
Manufacturing geometry is authoritative; display retains its identity. Geometry owns
[containment and ray queries](extruded-segments.mjs); Toolpath interprets contacts.

Indexed meshes live once in recipe geometry; display uses those manufacturing arrays.
Geometry owns derived views and worker preparation reuse. Mixed assemblies retain
spline recipes; spline native 3DM data remains stored. Older native mesh assets
remain readable through Bundle's geometry descriptor hydration.
STL import accepts ASCII and binary with explicit mm/inch units, indexes exact
shared vertices, records translation onto the bed, and retains `geometry/source.stl`
and its hash. File changes invalidate review. STL does not supply semantic CAD
faces, so Studio selects the imported component as a whole. ASCII STL uses the
line-oriented format: the `solid` header ends before facet records, and `endsolid`
closes the file. Leading whitespace, CRLF and a closing solid name are accepted.

`core/geom/mesh.mjs` rejects invalid indices, nonfinite coordinates and repeated
triangles. It counts, without refusing, nonadjacent triangles that cross or touch within
the rounding guard (`contacts`) and, in `topology`, open, nonmanifold and inconsistently
wound edges, sheets meeting at a vertex, unused vertices and slivers (a sliver keeps its
raw normal). It does not repair geometry. Checks are
controlled by a configurable memory estimate and a spatial hierarchy. The number
of candidate pairs tested is whatever the mesh's own overlapping bounds and
shared vertices produce; there is no work allowance on it. Adjacent
facets sharing vertices are excluded from the intersection pass, so this is not
a complete solid-kernel validity proof. [Mesh repair](#explicit-mesh-repair) also
reports adjacent faces folded onto each other. Normals at equal-height creases use the steeper facet. Drape requires a continuous accessible roof; discontinuities or sampled
segments above its angle limit are rejected. Sampling and bead-width limits remain.

Equivalent mesh/spline fixtures and mixed assemblies exercise shared skills,
regions, machine checks and exact-byte S5 export delivery. Add equivalent backend tests for each general skill.

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

[Curve ribbons](./curve-ribbon.mjs) accept curves only:
`prepareRibbon({curve, closed, vertical:[0,0,1]}).ribbon(depth)` offsets across the
projected tangent and preserves height along any reference direction. A fold is
cut at its closing crossing within half a turn, or only its backwards interval.
Closed seams use three copies; distant crossings stay. `foldCuts` returns these
intervals to other callers. Reversals use 32 samples per knot span.

`prepareSleeveContours` in [sleeve-frame.mjs](sleeve/sleeve-frame.mjs) offsets horizontal native NURBS
isocurves of periodic patches whose V chart reproduces actual Z. Crossings
resolve before chord-controlled sampling and perimeter correspondence.
`at(phase,zMm,depth)` follows one retained closed contour; split/collapse rejects.
The caller chooses centerline offset; optional fitted mesh contact is unilateral.

### Geometry contract

The **spline backend** accepts a shell of untrimmed bivariate spline
patches. Mesh input uses the [shared geometry interface](#geometry-interoperability-for-skill-authors).
Every spline face is
a full rectangular (u,v) patch, which is what makes sectioning tractable without
a kernel: a face's section is the zero contour of a scalar function over the
whole domain, with no trim classification. That restriction is not cosmetic.
rhino3dm is a geometry and file library, not a modelling kernel: it exposes no
booleans, no brep meshing and no surface intersection, its `BrepTrim` carries
topology indices with no parameter-space curve, and `BrepFace.loops` is unbound
in this build. A trimmed face therefore cannot be classified, and is rejected.

Closure is measured numerically: each patch boundary is matched to another by
closest point rather than by parameter, since a ruled surface reparameterises its
source iso-curve; a pole closes by itself. An open shell builds, saves, shows and
slices what closes on each layer; [target tessellation](./tessellate.mjs) names
its open edges to solid operations.

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

A plane through a saddle of the surface (where the contour self-touches) or flush
with a whole face is ambiguous; like other slicers, SAAM displaces it by up to 10 um,
re-cuts and reports the displacement. A section that still does not close, or meets
an open or nonmanifold mesh edge, joins gaps up to the caller's `gapMm` (the line
width), keeps every closed loop and lists the gaps and left-out pieces in `open`.

## Mesh sleeves

Geometry owns [sleeve fitting, contour mapping and contact](sleeve/contour-sleeve.mjs);
the [advanced-vase extension](../../skills/advanced-vase-wall/DEVELOPER.md) chooses
the authored range, fit mode and Trace pattern.
`prepareContourSleeve` receives that explicit range, spacing, offset, standoff,
fit mode and tolerances; it returns a boundary family, continuous mapping and
query report. Section topology, offset collapse and contact error fail there.

## Text and solid modifiers

The [text skill](../../skills/text/SKILL.md) retains editable features and ordinary solids.
Geometry preserves spline/Boolean sources, combining their sections directly; mesh/mixed
output uses [Manifold](solid.mjs), and planar outlines use [Clipper2](../region/intersection.mjs).
Mapped extrusion currently requires a mesh; surrounding native operands remain authored geometry.

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

[Target tessellation](./tessellate.mjs) samples closed spline shells, matches differently parameterized shared boundaries geometrically and propagates mesh orientation.
Its dyadic grid doubles, with no triangle budget, until sampled chord deviation meets tolerance; once a doubling no longer lowers it, the closer grid is kept with a note.
Shared boundary samples weld on a rounding-guard grid; the default approximation target is 0.02 mm. Manifold's float32 mesh boundary also makes precision depend on coordinate magnitude.
Input solids require positive material volume. Ordinary native spline slicing introduces no conversion.

Text, Gridfinity and heat-set records retain their editable inputs and an ordinary
`solid`. Reopening uses that source without rerunning feature compilation; legacy
vertices/triangles remain readable and contribute physical meshes to composition.
Meshes are derived for display or an
operation requiring them, never substituted for the saved construction.
Text edits rebuild through [the preparation entry](../../skills/text/scripts/text.mjs),
then ordinary Bundle publication invalidates the program; assembly identity/placement stays.

Text `materialParts` retain ordinary solids named `base` and `text/<feature-id>`.
Raised additions exclude existing material; later cuts affect every partition.
Empty partitions are omitted; an uncut base uses `geometry:null` to select its source.
`standalone:true` keeps the base only as a reference. Missing partitions reject.
[Selections](selections.mjs) prefixes names within assemblies; the full retained
solid remains the default. [Material ownership](../region/README.md#material-ownership-and-surface-contact)
owns assignment policy; changing assignments leaves saved geometry intact.

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
Spline solids intersect planes ([sectioning](#sectioning-untrimmed-spline-shells))
and vertical lines ([field.mjs](field.mjs)). Native Booleans retain trimmed surfaces
([construction](#native-boolean-construction)); mixed operands retain section composition.
General edited-3DM import and full Rhino computation remain deferred. rhino3dm is
a geometry/file library, separate from the native construction implementation.

## Explicit mesh repair

The [mesh-tools manual](../../skills/mesh-tools/BUILDER.md) owns command use and
review of changes. [The repair entry](../print/repair-stl.mjs) preserves the
source, normalizes close vertices, and repairs the solid when cleanup alone does not
yield a valid mesh. Studio and agent imports
attempt it for recognized defects, then present geometry for review. Invalid
formats retain their diagnostics; repair never fills holes without explicit bounds,
and imports pass their own (`IMPORT_HOLE_DIAMETER_MM`, `IMPORT_HOLE_EDGES` in
[import-stl.mjs](./import-stl.mjs)).

[Source admission](./mesh-source.mjs) and explicit repair share `prepareMesh` in
[mesh-repair.mjs](./mesh-repair.mjs): units resolve to millimetres first, then one
[bounded coordinate weld](./mesh-vertices.mjs) precedes solid repair and publication checks.
Unchanged admitted geometry retains its exact source arrays. Cleanup removes degenerate faces
and unused vertices, keeps coincident faces in their net orientation (an opposed
pair cancels), and stitches complete boundary chains within print resolution.
`mergeToleranceMm` sets the effective weld to the greater of it and print resolution,
measured against original coordinates. Reports retain requested/effective distances,
displacement and removed-source provenance. An empty result becomes spatial geometry
without a solid; exact zero-facet STL carries explicit repair's empty output.
[Solid repair](./mesh-repair.mjs) orients faces across
two-face edges (each component keeps the orientation of most of its area), refuses
unorientable edges, fills holes within both explicit bounds and refuses any other open
edge, reverses an inside-out solid and replaces a self-crossing
surface by its solid's boundary ([reconstruction](./mesh-autorefine.mjs)). Opposed
sheets within print resolution close: faces near each seeded opposed pair's fitted
plane join it, regions that share a vertex or a seeded pair become one sheet, and
every vertex of a sheet moves onto that sheet's one plane, whose points on its lattice
are exact doubles, so each seeded pair ends exactly coplanar and cancels. Exact
arrangement splits faces along every crossing; a face stays where the winding number
is positive on one side only. New points round to the rounding guard, except that a
point constructed in a sheet's plane rounds on that plane's lattice, as closing places
the vertices it moves, so sheets stay exact planes through every rounding pass (and
pairs of faces on one sheet are coplanar without orientation tests); source points stay.
Rounding that still crosses after six passes keeps its surface and reports it. Cleanup then
removes slivers (triangles below the rounding guard) with three local edits: a flip of a flat
corner's long edge, a split that puts a point on that edge beneath the corner and collapses the
corner into it, and a collapse of a short edge or of vertex pairs closer than print resolution,
closest first, into the end that stays (a source vertex, else a sheet vertex). Each face carries
how far it may lie from the surface before cleanup; an edit adds its own distance (a collapse
the smaller of the edge length and twice a flat star's distance from its plane) and stays below
print resolution at that place. An edit keeps the manifold and adds no contact (crossing or
rounding-guard). Rounds repeat around the last round's edits until nothing changes. Pairs and
slivers that stay are reported. Reports give the closing, cancelled area, the
merge and inward/outward shells before and after (fewer inward shells: cavities opened).

Hole filling follows each hole's boundary from face to face around each vertex, as a
halfedge mesh links borders, and splits a boundary that meets a vertex twice, so
holes touching at a vertex fill apart. A hole fills only when its edge count is at
most `maxHoleEdges` and its boundary's bounding-box diagonal at most
`maxHoleDiameterMm`; other holes, and edges that cannot be oriented alike, stay open and are
reported, and reconstruction then does not run. Each hole is triangulated without new vertices by Liepa's dynamic programme
(P. Liepa, "Filling Holes in Meshes", SGP 2003) with the weight CGAL's
`triangulate_hole` uses: the largest dihedral angle between adjacent faces, then
area. A patch never repeats an existing edge and uses slivers only when no fill avoids them,
then the shortest; sliver cleanup removes them (a flat crack zips this way) and a patch
that crosses the surface is resolved by reconstruction. Time grows as
the cube of a hole's edge count (about 0.4 s at 500 edges, 3.5 s at 1,000, 28 s at
2,000 on the development machine) and memory as its square (about 170 MB at 2,000).
Reports give `holesFilled` and `holeTrianglesAdded`.

Final checks use shared mesh topology checks and reimport of the exact decimal ASCII
STL; remaining contacts and topology are reported in `remaining`. Reports count unchanged/changed/new
faces and sample at most 10,000 vertices/centroids per direction, without claiming
a certified surface-error bound. Identical geometry needs no sampling. The optional
sampled-distance limit rejects measured excess; geometry still needs review.

### Memory, files and progress

[File decoding](./stl-file.mjs) reads ASCII and binary STL in 64 KiB blocks and
drives the same incremental parser as complete-buffer decoding. Format validation,
unit scaling, finite-coordinate checks, exact indexing and capacity checks therefore
have one owner. The wrapper computes the source hash and reports progress while
reading; the parser retains only indexed geometry, an 84-byte format prefix and
the current record/token remainder. The public import
and repair file entries accept paths so callers need not allocate the entire
source buffer. Output STL is written in bounded text chunks. Repair temporary
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
the arrangement and the final result still require memory. Neither repair nor
downstream bundle serialization is out-of-core; a mesh larger than the machine can
hold fails on the allocation that actually failed, not on a prediction.

Repair runs in a worker thread, including hole filling. Async repair accepts `signal`,
`progress` and `onGeometry`. Countable stages report completed/total and percentage
within that stage; reconstruction stages report entry only. Elapsed time never
refuses a repair; cancellation terminates the worker. No global percentage is inferred.
After final validation, `onGeometry` receives at most 4,096 full-quality triangles
per chunk, with local vertices/indices, first-triangle offset and completion
percentage. Each callback is awaited, allowing the consumer to release a chunk
before requesting more. There is no lower-quality display proxy. Studio import uses the shared progress and cancellation lifecycle.

Repair uses the shared [Geometry execution](#geometry-execution) lifecycle. Transferred bytes
retain their actual offset and length; allocation errors include source context.

### Mesh compatibility development boundary

Mesh import, cleanup, repair, memory handling, progress, generic regression tests
and owning documentation are shared core work intended for the remote repository.
The dataset loop, comparison runners, downloaded evaluation builds, trial profiles,
benchmarks and raw reports remain under ignored `.local`. Production code does
not depend on those experiments. Test models are disposable; supplied originals
are preserved. Temporary inspection adapters use existing Studio interfaces.
