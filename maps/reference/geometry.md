# Geometry and numerical contracts

## Implementation responsibilities

The geometry map separates queries, preparation and supporting numerical work.
Use its subpages to reach these responsibilities; `--inventory` includes native
source, dependency declarations and remaining helpers with their maintenance owner.

| Map page | Responsibility and constraints |
|---|---|
| `3i_numerics` | NURBS evaluation, XY projection, bracketed roots, numerical seam cleanup and contour parameterization. Units and tolerance dimensions follow the precision contract below; these helpers do not choose printing resolution. |
| `3j_mesh` | Indexed mesh validation, compact edge incidence and vertex fans, spatial candidate queries, bounded nearest distance, index capacity and streamed STL input. Spatial acceleration does not expand the validity guarantees below. A distance query returns infinity when no surface lies within its supplied search bound. |
| `3k_construct` | Closed native shell/pipe construction, solid mesh operations and explicit tessellation for solid modifiers. Viewer proxies remain separate from the compiled mesh used by a solid modifier. |
| `3l_surfaces` | Selected surface charts, independent text references, curvature-weighted offsets, sleeve contact/frames and support references. An open reference surface is distinct from a printable closed solid. |
| `3m_text` | Font outlines, layout and compiled-record validation. Pattern tools remain in the text skill; shared geometry compilation and identity belong here. |

Simple vector operations and local predicates remain implementation helpers under
these responsibilities. Their source and discovered consumers are available through
the inventory and `--evidence`; ownership does not label every helper as explained.
Algorithm guarantees, budgets and rejection behavior are specified in the sections
below. [Geometry tests](testing.md#test-registry) include equivalent backend cases,
numeric limits, source integrity and supported skill consumers.

## Repair worker and native process boundary

`core/print/mesh-repair-job.mjs` owns one Node worker per repair or repairing
import (`importOrRepairSTLBundle`, mode `import`); each of these entries runs the
job when called on the main thread and works inline inside the worker. The job
settles only after terminating its worker, so a caller can safely remove the
directory it was writing. Progress callback
errors abort work; a geometry callback must acknowledge its matching message ID
before the worker continues. Abort rejects pending acknowledgements. A worker exit
without a result is an error, and a result received after caller cancellation does
not become a success. `mesh-repair-worker.mjs` transfers repaired byte storage and
closes its message port after result or failure.

The native adapter uses files and an explicit executable, with progress on stderr
and a result report on stdout. [Native repair](native-repair.md) owns its build,
algorithm limits and provenance. `mesh-repair.cpp`, CMake configuration, dependency
hashes and license notices are geometry-owned resources despite being outside the
JavaScript relationship extractor. Change them with the wrapper protocol in view.

Geometry representations, query semantics, precision, spline sectioning and mesh
repair. [Regions](regions.md) owns offsets, intersections and material
regions; [composition](motion.md) consumes the resulting skill operations.

## Geometry interoperability for skill authors

Compiled heat-set and text geometry retains editable feature recipes. The
builder attaches optional `planarDetails` to geometry with local deposition
requirements. `translated(dx,dy,dz)` preserves them under placement;
`at(region,z,{widthMm,perimeters,pitchMm})` supplies local wall/fin strokes,
material regions, fill exclusions, an interior boundary and a wall-ownership
predicate. The [shared planar producer](../../skills/full-fill/scripts/fill.mjs)
consumes those details, including through sparse/solid partners and regional
composition. This in-memory interface adds no file, exporter or scheduler.
The [heat-set manual](../../skills/heat-set-inserts/SKILL.md) owns its constraints.

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
Runtime checks must earn their cost under [the existing guidance](../../BUILDERS.md#avoid-check-spirals).
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
| Sampling distance and feature size, mm | Surface stroke steps `0.2` mm; rim sampling `0.5` mm and error `0.01` mm | A step size is not a certified surface-error bound. Report mesh repair shape changes separately from numerical precision. |
| Coincidence/predicate slack, mm or derived units | Point `1e-6` mm, plane `1e-7` mm; mesh separation `1e-9` mm | Keep numerical degeneracy handling separate from intentional shape simplification. A determinant from two length vectors has units mm²; compare to an area quantity or normalize it to distance/relative conditioning. Do not use a length tolerance as an area cutoff. |
| Solver parameters and angles | `TOLERANCE.parameter=1e-9` in native UV parameter units; surface `precisionUv=1e-10`; angles in degrees/radians | UV precision maps to physical displacement through surface derivatives and can differ in U and V. A normal dot product is dimensionless. Neither uses an XYZ millimetre tolerance. Record units at conversions and use scale-aware conditioning for singularity decisions. |
| Machine command quantization | S5/H2D XYZ and filament E currently five decimals; feed three decimals in mm/min; dwell integer milliseconds; Dobot ten decimals and RC8 eight | XYZ, filament length, volume, feed, time and pose need independent error budgets even when a formatter currently shares digits. Relative-E rounding can accumulate per move; absolute E has different accumulation. Reconcile final endpoints, length, volume and duration when removing or coalescing points. |
| Display approximation | Studio bead tessellation, float buffers and distance-based detail | Display budgets are visual only. They must not alter the saved program, geometry identity, deposition volume or machine checks. Printed-looking colors and shading do not establish geometric accuracy. |

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
records corrections and proposed follow-ups, including collapsed-segment volume
and oriented motion. The [provenance audit](../../DEVLOG.md#2026-09-14--build-request-provenance-audit)
distinguishes the completed audit from approval to implement all its findings.
Current XYZ behavior is specified under [formats](lifecycle.md#formats).

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
| Closed regions with holes | Planar sections, offsets, solid masks and infill clipping. |
| Surface height and normal | Accessible roof sampling for drape; faceted normals stay faceted. |
| Skill operation result | Composable strokes, dependencies, layer references and travel policies. |
| SAAMpath | Machine-independent XYZ motion, deposition and process actions. |
| Output artifact | Machine-specific commands/packaging with a matching interpreter. |

Native mesh assets use `geometry/model.mesh.json` with `saam-native-geometry/1`,
millimeter indexed triangles, original source provenance and shape parameters.
Mixed assemblies retain spline recipes for spline components. Existing spline
bundles continue using `geometry/model.3dm`.
STL import accepts ASCII and binary with explicit mm/inch units, indexes exact
shared vertices, records translation onto the bed, and retains `geometry/source.stl`
and its hash. File changes invalidate review. STL does not supply semantic CAD
faces, so Studio selects the imported component as a whole.

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

[Contour correspondence](../../core/geom/contour-path.mjs) assigns normalized arc length from a
fixed projected seam to a closed polygon; it does not require a star-shaped or
convex section. [Prepared contour families](../../core/geom/prepared-contours.mjs) reuse that
correspondence over height and signed offset before repeated motifs are mapped.
The caller supplies the exact section/offset query and a separate millimetre
mapping-error allowance. Bilinear cells interpolate both height and offset;
they never change the source mesh, curve or motif.

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
complexity and these fixed caches, not the total printed height or motif count.

The mesh section query separately caches edge connectivity in eight vertex-height
bands. Coordinates are still interpolated on the original triangle edges at
each requested cut, including the existing boundary nudge. This exact reuse
preserves holes, contour order and section bytes; it is independent of the
optional approximate contour preparation.

### Loose and tight spline offsets

`prepareSurfaceOffsets` in `surface-offset.mjs` accepts a NURBS patch,
`mode: 'normal' | 'horizontal' | 'projected-normal'`, and explicit periodic U/V
flags. It builds a direction control net from unit reference normals at the
Greville parameters. Nonperiodic outer Greville values are clamped to the active
domain. Horizontal mode uses the clockwise XY perpendicular to the U tangent;
normal mode uses the full surface normal. Projected-normal mode normalizes the
XY projection of the full normal, retaining planar rimming's direction on
charts whose U tangent rises in Z.

`at(u, v, depth, tightness = 0)` evaluates the offset continuum. Zero uses the
loose control field with local depth limiting at over-curvature; one uses
the unit reference normal at the query. Intermediate values blend these positions.
Reference parameters are retained across depths without reparameterization.
This setting is independent of subsequent mesh-contact fidelity.

`offsetPatch(depth)` returns the loose NURBS patch, preserving control counts,
degrees, knots, domains and weights, including periodic duplicates. Tightness
above zero uses a functional evaluator; it is not claimed to be an exact
same-size NURBS offset. No control points are added or refitted. Adaptive path
samples are separate from the control net. Input controls remain unchanged.

[Local curvature limiting](../../core/geom/offset-curvature.mjs) retains one smooth patch rather
than trimming away loops or splitting its topology. At knot quarter-span samples,
the oriented surface area must retain at least 5% of its reference value throughout
the displacement from the source to the loose offset. The area is quadratic in
that displacement, so checking its first limiting root also catches offsets that
would pass through two reversals and end with a positive Jacobian. Failing samples
reduce the depths of their supporting controls together; periodic duplicate
controls share reductions. Passes repeat until every sample clears the area
floor; since each incomplete pass shrinks at least one depth, the only explicit
failure is a pass that no longer changes any depth at all. Safe offsets retain
their original control displacements.

Preparation is reused per reference; at most 128 limited depth patches are cached.
Reports expose sample count, area floor, limited-patch construction count, maximum
control-depth reduction, unscaled direction lengths and queried tightness. Loose
depth is approximate, and limiting can reduce it further. This sampled local
regularity check does not certify unsampled folds, global self-intersections or
clearance. Exact normal offsets and blends toward them can still fold. The
depth-independent `frameAt` exposes the original field; consumers requiring the
limited geometry use `at` or `offsetPatch`.

`prepareLooseSleeveOffsets` in `sleeve-frame.mjs` specializes this API for
periodic U and a V chart linear in actual Z. Its `at(u, zMm, depth, tightness)`
preserves authored Z. Vase mapping adds the signed nominal half-bead offset
to motif depth, evaluates the field, then applies unilateral mesh contact.
A loose half-bead offset gives approximate standoff.

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

## Mesh reference sleeves

`mesh-sleeve.mjs` exposes `fitMeshSleeve(mesh, options)` for an already validated
triangle mesh. A **reference sleeve** is the open side surface of a vase-like
envelope, with its top and bottom caps excluded. It is independent of material
coverage: fitting a solid, or the outer side of a hollow vessel, does not fill its
interior or create another printed wall. The source geometry is unchanged.

`detectMeshSleeveInterval(mesh, {marginMm, toleranceMm, sampleCount,
maxSecondaryAreaFraction, zMinMm, zMaxMm})` is an **authoring-time proposal** for
usable sleeve bounds. It scans 25 heights by default, retains valid end sections
exactly, and proposes an inward cut only when an end section collapses. The first
inward proposal and cap-bracket refinement use `marginMm` (default 0.4 mm; callers
should derive it from their chosen bead width/layer pitch). Branches, significant
islands and separated usable height intervals are rejected. This sampled scan
does not certify every intermediate section; the fitter/source queries keep
checking newly encountered heights. The returned `rangeMm` is absolute Z;
`report` includes the source range, excluded bottom/top heights, margin, sample
count, source section count and secondary-feature areas. Set the accepted range
explicitly in the authored recipe and derive a complete motif count for it.
Never call this detector to silently shorten an already requested/generated
path. A valid flat-ended cylinder therefore loses no height, whereas a mesh with
collapsed extreme caps receives an explicit cap-exclusion proposal.

The detector uses horizontal source sections over a selected `zMinMm`–`zMaxMm`
interval. One dominant outer contour is required at each queried height. Small
secondary islands may account for at most `maxSecondaryAreaFraction` of its area
(default 0.001, or 0.1%); set zero to reject every secondary island. All source
loops remain available. Reported maximum secondary area/count and pore area make
that reference-envelope reduction explicit. A hole above that area fraction is
a bore; at most one substantial bore is supported. A base may close the bore at
lower heights. Multiple significant islands, branches or bores, and collapsed
tips, fail with the height of the unsupported section. Choose a suitable sleeve
interval or different geometry instead of treating those failures as mesh repair.
This is section-based detection, not a global topological classification proof.

The fit is an actual nonrational bicubic tensor-product B-spline, periodic around
the perimeter and clamped in height. Source rings are sampled at a stable +X seam
and normalized arc length. Uniform product-grid observations are fit in X and Y
by separable least squares; the control net uses Greville abscissae to preserve
Z exactly. `nurbs.mjs` owns the basis/evaluation algorithms. The bounded dense
solver in `least-squares.mjs` implements Householder QR (Golub and Van Loan,
*Matrix Computations*, 4th ed., §5.2), factors each sampling matrix once, and
rejects rank-deficient inputs. This is an original implementation of that
standard algorithm, not a vendored solver or a new geometry kernel. It avoids
the squared condition number of normal equations. The test checks affine
recovery and residual orthogonality independently of the fitted mesh.

| Option | Meaning and default |
|---|---|
| `circumferentialControls`, `heightControls` | Independent fit resolution; defaults 12 and 6. Fewer controls smooth local texture; increasing them permits more detail in the underlying estimate. Both accept 4–64. |
| `circumferentialSamples`, `heightSamples` | Uniform observation grid, defaults 96 and 25. At least twice as many circumferential samples as controls, and at least as many height samples as controls, are required. These are fit samples, not a certified mesh-error bound. |
| `toleranceMm` | Bounded chord deviation for polyline sections of the fitted polynomial spline, default 0.02 mm. It is independent of fit residual and source-mesh detail. |

The number of points in a complete fitted section follows from `toleranceMm` and
the fitted second-derivative bound; there is no separate allowance on it, and
`report.sectionSegments` gives the count actually used.

The result contains `patch` (the existing shared NURBS patch representation),
`pointAt(u,z)` (periodic U, actual millimetre Z), `sectionAt(z)` (a smooth outer
reference loop), and `sourceSectionAt(z)` (original cut loops, selected `outer`,
enclosed `holes`, significant `bores`, `secondaryOuters` and a contour query).
`rangeMm` gives the fitted interval. Source and fitted sections each retain at
most 64 cached heights. Newly constructed fitted polylines are normalized through
shared Clipper2 to reject detected self-crossings, reversals and collapse.
Every height uses the same uniform U grid. For this unit-weight periodic cubic,
the maximum norm of its second-derivative control vectors bounds the XY second
derivative at every height. A grid interval of length `h` has linear chord
error at most `M*h*h/8`. `sectionSegments` and `sectionChordBoundMm` report this
construction. Fixed parameter samples avoid vertex-selection changes between
adjacent rings. The sampled topology checks remain construction checks, not a
continuous surface-validity certificate or a bound on source-mesh fit error.

`report` distinguishes sampled RMS/maximum **fit residual** from section chord
tolerance, source classification and ignored reference details. The source query
continues to check each newly requested height, so an unsupported feature between
fit observations fails when encountered rather than silently becoming printable.
Mesh conformance belongs after the regular motif has been mapped onto this smooth
reference: callers retain the original source query for directional contact.
Do not stretch every motif point between the smooth and detailed surfaces or
interpret the reference sleeve as a filled material boundary.

Focused regressions cover periodic position and tangent continuity, second
derivative agreement, suppression of fine flutes, leaning envelopes, translated
parts, hollow sleeves, preserved small pores/islands and explicit rejection of
significant disconnected sections. Authoring regressions retain flat caps and
exclude only collapsed poles, and reject separated height intervals. These establish the tested software scope,
not physical support or machine clearance.

### Prepared mesh contact

`directional-contour.mjs` unfolds one-turn section contours into ordered polar
profiles within the selected planar correspondence allowance. Larger folds
reject, as does a source whose radial variation needs more angular room than the
one turn an unfolded profile has. The fixed sample count per profile has a floor,
not a ceiling: a contour whose sampling error exceeds the detail tolerance says so
and can be sampled more finely. `prepared-radial-contact.mjs` uses 16,384 fixed
samples per profile by default and
interpolates their ordered correspondence across height. At sampled validation
heights, the actual profile certificate is deducted before allocating the
remaining detail tolerance to interpolation. This avoids an unnecessarily
fixed five-percent interpolation budget. Height slabs are halved as long as Z can
be halved, with no profile-count or mesh-distance-query budget; a slab that still
misses its interpolation tolerance at one representable height is a step in the
source that no mesh transition confirmed.

Narrow horizontal ledges can use radial transitions checked against the original
triangles through `mesh-distance.mjs` and the shared triangle hierarchy. Checks
sample quarter and midpoint heights and adapt angular subdivisions. Their
reported errors do not establish a global mesh Hausdorff bound or cover every
unsampled height. Contact constrains path centers; the deposited bead may extend
past the boundary by its half width. Neither the smooth reference nor its contact
boundary is an additional deposited wall.

## Text and solid modifiers

The [text task skill](../../skills/text/SKILL.md) adds font-derived material,
removes it, or retains it as a standalone solid. Planar glyph outlines use the
existing Clipper2 union through [shared intersections](../../core/region/intersection.mjs).
The [solid boundary](../../core/geom/solid.mjs) uses pinned `manifold-3d@3.5.3` C++/WASM for 3D
union and difference. Its internal 3D intersections are separate from planar
Clipper2; the two backends serve different representations. No existing planar
consumer is switched to Manifold.

[Font outline extraction](../../core/geom/text-outline.mjs) uses pinned `fontkit@2.0.4` for glyph
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

[Reference surfaces](../../core/geom/reference-surface.mjs) accept an independent open rational
B-spline control net, a plane, or a named original-part patch. A flat rectangle
maps explicitly to a UV rectangle; local scale/distortion belongs to that mapping.
They do not become printable material. Rigid glyph mode places each glyph on its
local tangent plane. `kind: top` instead uses the shared [top-surface query](../../core/geom/query.mjs)
on the retained original spline or mesh: layout XY stays in physical millimetres,
with the highest surface height and normal at that column. Missing roof columns
fail. It creates no sampled copy of the surface; folds, ridges and discontinuous
normals retain the query and text-mapping limitations.

[Shared text layout](../../core/geom/text-layout.mjs) composes straight, Bezier and circular
baselines with placement, rotation and mirroring before surface mapping. Circle
advance is exact XY arc length at its radius; glyph Y follows the left normal,
and centre-crossing layouts fail. It retains font spacing without stretching a
word to fill the circle. Bezier arc length uses a subdivided chord table with
continuous curve/tangent evaluation; it is approximate. Existing UV references
and saved compiled meshes retain their semantics.

[Target tessellation](../../core/geom/tessellate.mjs) samples supported closed spline shells,
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
[the preparation entry](../../core/print/text.mjs), then the normal bundle update invalidates
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

[Geometry selections](../../core/geom/selections.mjs) exposes these partitions to regional
consumers, prefixing their names with the assembly component id where present.
The final merged mesh remains the default whole-solid selection and review model.
Changing the selected material or printing pattern leaves the geometry record
unchanged. The [region contract](regions.md#material-regions-and-shared-interfaces)
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
General edited-3DM import, spline-surface intersections and full Rhino
computation remain deferred. rhino3dm is a geometry/file library, not the
complete Rhino computation engine.

## Explicit mesh repair

The [mesh-tools manual](../../skills/mesh-tools/SKILL.md) owns command use and
review of changes. [The repair entry](../../core/print/repair-stl.mjs) preserves the
source, runs exact cleanup, and uses the [native CGAL adapter](../../core/geom/mesh-native.mjs)
when cleanup alone does not yield a valid mesh. Import validates supplied geometry;
repair is a separate preparation operation. Studio's file-picker importer invokes
it automatically for recognized mesh defects, then requires review and confirmation
of the repaired geometry; shared CLI/MCP import keeps strict validation.

[Cleanup](../../core/geom/mesh-repair.mjs) merges identical coordinates and removes duplicate,
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
[native build and license reference](native-repair.md).

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

[File decoding](../../core/geom/stl-file.mjs) reads ASCII and binary STL in 64 KiB blocks, computes
the source hash while reading and indexes facets immediately. The public import
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
before requesting more. There is no lower-quality display proxy. Studio's consumer
is owned separately and has not been changed by this mesh task.

The [repair job](../../core/print/mesh-repair-job.mjs) supervises the
[worker](../../core/print/mesh-repair-worker.mjs). Geometry messages carry IDs;
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


## Changing numerical foundations

Sources: [tolerance.mjs](../../core/geom/tolerance.mjs), [nurbs.mjs](../../core/geom/nurbs.mjs), [field.mjs](../../core/geom/field.mjs), [polyline.mjs](../../core/geom/polyline.mjs), [surface-derivatives.mjs](../../core/geom/surface-derivatives.mjs), [least-squares.mjs](../../core/geom/least-squares.mjs).

**Contract.** Geometry uses millimetres, explicit parameter domains and quantity-specific tolerances. Rational evaluation works in homogeneous coordinates; differential frames require a regular surface metric. XY field inversion searches bounded spline spans and selects the highest upward-facing hit for a top query. Polyline cleanup bounds displacement against the original chain and preserves backtracking by default. Least squares uses reusable Householder QR on finite overdetermined matrices, without forming normal equations.

**Failures.** Reject degenerate normals, singular charts, invalid domains and rank-deficient solves. A missed field inversion is not a zero-height surface. Sampled roots, closure and chord bounds are numerical approximations, not analytic or manufacturing guarantees; do not apply coordinate tolerance to volume, time or angular quantities.

**Change together.** Review sectioning, chart consumers, offsets, prepared contours and text/mesh fitting whenever changing evaluation or tolerance defaults. Preserve rational weights, seam conventions, derivative scaling and the public query contract.

**Verification.** Exercise rational and polynomial surfaces, singular frames, non-unit domains, multiple XY hits, rank deficiency and closed-loop backtracking; compare geometry with quantity-appropriate tolerances. Checks: [geometry.test.mjs](../../core/tests/geometry.test.mjs), [contour-cleanup.test.mjs](../../core/tests/contour-cleanup.test.mjs), [loose-surface-offset.test.mjs](../../core/tests/loose-surface-offset.test.mjs).


## Changing geometry queries and shell sections

Sources: [query.mjs](../../core/geom/query.mjs), [shell.mjs](../../core/geom/shell.mjs), [section.mjs](../../core/geom/section.mjs).

**Contract.** The geometry query boundary dispatches mesh and spline representations through common section, bounds and surface behavior. Spline shells contain closed collections of untrimmed rectangular patches; sampled edge matching validates closure. Horizontal sectioning produces connected planar loops with the orientation and tolerances expected by region operations. Backend-specific acceleration must stay behind this boundary.

**Failures.** Reject unsupported trimmed/open shell construction and unjoinable or invalid sections; absence of an intersection is distinct from malformed geometry. Sampled closure does not prove exact watertightness. Never silently reinterpret a mesh-only or spline-only capability.

**Change together.** Coordinate constructors/import, query adapters, section caches, region loop normalization and every skill consuming sections. Maintain units, placement and loop topology across both representations.

**Verification.** Compare equivalent mesh/spline shapes, boundary heights, multiple loops/holes, empty sections and unsupported shells; verify downstream region and skill interoperability. Checks: [geometry.test.mjs](../../core/tests/geometry.test.mjs), [mesh.test.mjs](../../core/tests/mesh.test.mjs), [interoperability.test.mjs](../../core/tests/interoperability.test.mjs).


## Changing mesh topology and spatial queries

Sources: [mesh.mjs](../../core/geom/mesh.mjs), [mesh-topology.mjs](../../core/geom/mesh-topology.mjs), [mesh-spatial.mjs](../../core/geom/mesh-spatial.mjs), [triangle-bvh.mjs](../../core/geom/triangle-bvh.mjs), [mesh-capacity.mjs](../../core/geom/mesh-capacity.mjs), [stl-file.mjs](../../core/geom/stl-file.mjs).

**Contract.** Indexed mesh geometry retains actual triangle connectivity. Topology checks distinguish shared adjacency from improper contact; spatial queries use bounded triangle acceleration without replacing the source mesh. STL parsing accepts the supported binary/text forms and normalizes into this representation. Mesh size is never predicted and refused: the only size check is index capacity, the representational limit of the indexed arrays, and memory is reported only when an allocation genuinely fails.

**Failures.** Malformed STL, invalid indices/nonfinite coordinates, nonmanifold or intersecting geometry and index-capacity overflow fail with useful diagnostics. An allocation that fails is reported with its stage and the mesh size (`MESH_MEMORY_EXHAUSTED`); do not reintroduce a working-set estimate that refuses a mesh before reading it. Shared vertices/edges must not be falsely reported as collisions, nor may real coplanar overlap be suppressed as adjacency. No automatic simplification is implied.

**Change together.** Review import and repair boundaries, sectioning, BVH consumers, mesh-distance/contact queries and viewer proxy construction. Keep strict source validation distinct from permissive display welding.

**Verification.** Use closed, open, nonmanifold, coplanar and self-intersecting fixtures; test adjacency exclusions, large binary input and index-capacity rejection, and confirm that a mesh whose working set would once have been refused now imports. Checks: [mesh.test.mjs](../../core/tests/mesh.test.mjs), [mesh-boundary.test.mjs](../../core/tests/mesh-boundary.test.mjs), [mesh-large.test.mjs](../../core/tests/mesh-large.test.mjs).


## Changing generated geometry and persistence

Sources: [shapes.mjs](../../core/geom/shapes.mjs), [cylinder.mjs](../../core/geom/cylinder.mjs), [spline-tube.mjs](../../core/geom/spline-tube.mjs), [tessellate.mjs](../../core/geom/tessellate.mjs), [geometry.mjs](../../core/print/geometry.mjs).

**Contract.** Constructors create the declared solid/shell backend from a validated recipe. Spline tubes combine a periodic cubic exterior with a rational bore and bounded control-net dimensions. tessellateShell explicitly converts a supported closed spline shell into a mesh for solid modifiers, refining until its geometric tolerance is met; ordinary spline slicing stays native. This is distinct from the coarse viewer proxy. Print geometry stores named surfaces or meshes in 3DM and reopens the bytes to verify their identity and closure against the descriptor. Recipe, file and rounded control-net hashes serve different identity checks.

**Failures.** Reject invalid dimensions, unsupported recipes and malformed control nets; a tessellation tolerance is not a print-process tolerance or a license to change shape. Stored geometry must remain tied to the recipe that produced it.

**Change together.** Update plan validation, shell construction, geometry hashing, preview/import consumers and bounds checks together when adding a shape or persisted field. Preserve the distinction between design coordinates and placement on the machine.

**Verification.** Exercise dimensions/bounds, seams and bore closure, serialization round trips, mesh/spline equivalence and regeneration after recipe changes. Checks: [geometry.test.mjs](../../core/tests/geometry.test.mjs), [pipeline.test.mjs](../../core/tests/pipeline.test.mjs), [text-layout.test.mjs](../../core/tests/text-layout.test.mjs).


## Changing contour correspondence and prepared contact

Sources: [contour-path.mjs](../../core/geom/contour-path.mjs), [directional-contour.mjs](../../core/geom/directional-contour.mjs), [prepared-contours.mjs](../../core/geom/prepared-contours.mjs), [prepared-radial-contact.mjs](../../core/geom/prepared-radial-contact.mjs).

**Contract.** Prepared mappings amortize repeated section/contact queries while retaining their geometry identity and precision settings. Contour coordinates follow arc length and a projected seam anchored to the first section; equal-distance choices must not depend on arbitrary vertex ordering. Directional/radial queries expose their supported correspondence and contact domains rather than substituting nearest-point guesses.

**Failures.** Collapsed/underspecified loops, ambiguous or unsupported correspondence and unavailable contact must reject or return the documented miss. A prepared result cannot be reused after its geometry, placement or preparation options change.

**Change together.** Keep contour seams, section normalization, sleeve/cladding consumers, contact tolerances and cache keys aligned. Preparation is a reusable geometric operation, not permission to cache mutable workflow state.

**Verification.** Test reordered loop vertices, seam crossings, changing section shapes, contact misses and repeated prepared/unprepared queries for matching results. Checks: [prepared-contours.test.mjs](../../core/tests/prepared-contours.test.mjs), [directional-contour.test.mjs](../../core/tests/directional-contour.test.mjs), [prepared-radial-contact.test.mjs](../../core/tests/prepared-radial-contact.test.mjs).


## Changing spline offset construction

Sources: [surface-offset.mjs](../../core/geom/surface-offset.mjs), [offset-curvature.mjs](../../core/geom/offset-curvature.mjs).

**Contract.** Spline offsets distinguish loose control-net construction from tight fitted approximation. The selected tightness policy, differential normals and curvature information determine the offset representation and its validation. Offset distance, fitting error and output tessellation are separate quantities; preserve the authored surface domain and seam behavior.

**Failures.** Singular charts, invalid distances/options and unsatisfied construction/fitting constraints must surface as failures. Neither a sampled offset nor a fitted surface establishes global absence of folds or collisions.

**Change together.** Review derivative evaluation, least-squares fitting, reference charts and cladding tightness settings together. Do not move process-specific defaults into generic geometry primitives.

**Verification.** Compare loose/tight endpoints, curved and rational surfaces, seams, offset direction and failure behavior near singular geometry; check downstream cladding correspondence. Checks: [loose-surface-offset.test.mjs](../../core/tests/loose-surface-offset.test.mjs), [surface-offset.test.mjs](../../core/tests/surface-offset.test.mjs), [cladding-offset-tightness.test.mjs](../../core/tests/cladding-offset-tightness.test.mjs).


## Changing mesh sleeves and contact frames

Sources: [mesh-sleeve.mjs](../../core/geom/mesh-sleeve.mjs), [sleeve-frame.mjs](../../core/geom/sleeve-frame.mjs), [sleeve-contact.mjs](../../core/geom/sleeve-contact.mjs), [mesh-distance.mjs](../../core/geom/mesh-distance.mjs).

**Contract.** Sleeve construction provides a continuous parameterized reference around supported meshes. Frames and contact queries share the sleeve seam, orientation and distance conventions; distance queries use the original triangle surface and its acceleration. A sleeve is a reference construction for deposition, not a repaired replacement for the input solid.

**Failures.** Unsupported topology, degenerate frames, failed contact and insufficient coverage must remain explicit. Nearest-distance magnitude alone cannot determine a usable deposition normal or certify collision clearance.

**Change together.** Coordinate mesh validation/BVH, prepared radial contact, chart selection and cladding consumers. Changes to seam orientation or frame continuity affect every operation that maps sleeve parameters to material.

**Verification.** Exercise asymmetric meshes, seams, translated geometry, contact misses and frame continuity; compare distance/contact answers against direct triangle cases. Checks: [mesh-sleeve.test.mjs](../../core/tests/mesh-sleeve.test.mjs), [sleeve-frame.test.mjs](../../core/tests/sleeve-frame.test.mjs), [sleeve-contact.test.mjs](../../core/tests/sleeve-contact.test.mjs), [mesh-distance.test.mjs](../../core/tests/mesh-distance.test.mjs).


## Changing selected reference and support charts

Sources: [surface-region.mjs](../../core/geom/surface-region.mjs), [reference-surface.mjs](../../core/geom/reference-surface.mjs), [support-surface.mjs](../../core/geom/support-surface.mjs), [selections.mjs](../../core/geom/selections.mjs).

**Contract.** Selections name explicit surfaces/regions rather than infer user intent from nearby geometry. Reference surfaces can be independent planes/splines or declared part/top surfaces. Surface-region charts normalize UV while scaling derivatives, and mesh-strip charts retain triangle connectivity with interpolated normals. Support surfaces are bounded open tensor splines with the documented degree and monotonic-height restrictions; exact control-net contents key the small cache.

**Failures.** Reject unknown fields, invalid knots/weights/domains, singular planes, invalid mesh strips and top-query misses. Mesh charts do not promise a general inverse map. Open reference/support surfaces are not closed solids; periodic seams require matching position and normal.

**Change together.** Keep selection schema, plan hashes, geometry queries, region offset consumers and published finished surfaces consistent. Distinguish independent reference geometry from evidence that material has been deposited.

**Verification.** Test strict selection validation, non-unit domains, periodic seams, support height boundaries, part/top misses and changed control-net cache behavior. Checks: [surface-cladding.test.mjs](../../core/tests/surface-cladding.test.mjs), [reservation-surface.test.mjs](../../core/tests/reservation-surface.test.mjs), [regions.test.mjs](../../core/tests/regions.test.mjs).


## Changing text and solid feature geometry

Sources: [solid.mjs](../../core/geom/solid.mjs), [text-outline.mjs](../../core/geom/text-outline.mjs), [text-layout.mjs](../../core/geom/text-layout.mjs), [text-record.mjs](../../core/geom/text-record.mjs), [text.mjs](../../core/print/text.mjs), [heat-set.mjs](../../core/print/heat-set.mjs).

**Contract.** Text outlines and layout become explicit solid features and compiled geometry records; material parts distinguish base and text features where supported. The compiled hash covers canonical record content excluding the hash itself. Print text/heat-set helpers update the declared recipe and regeneration inputs through the normal geometry/plan boundary.

**Failures.** Reject malformed records, unsupported fields, invalid feature geometry and inconsistent compiled identity. A recipe or mesh change requires rebuilding its compiled record; cached display geometry cannot stand in for that rebuild.

**Change together.** Coordinate font/outline interpretation, layout units, solid operations, plan validation, material assignment and geometry review invalidation. Keep feature intent in the recipe and generated topology in the compiled record.

The shared solid kernel initializes once. Mesh input passes through float32
Manifold coordinates and must enclose positive volume with outward winding.
Solid conversion rejects kernel errors/empty output; add/subtract are the supported
binary operations. Callers own and delete returned native solids, including
intermediates on failure. The kernel addresses 32-bit WebAssembly memory, so it
publishes the largest triangle count it can hold; that capacity, not a chosen
triangle budget, is what refuses an impossible subdivision. An aborted kernel
instance is discarded so the next caller builds a fresh one, and releasing solids
of a discarded instance must not replace the failure that discarded it. This lifetime boundary is separate from JavaScript mesh
objects and the explicitly tessellated target's geometric error budget.

**Verification.** Exercise layout/holes, feature placement, deterministic record hashes, changed recipes, invalid solids and generation using the resulting geometry. Checks: [text-layout.test.mjs](../../core/tests/text-layout.test.mjs), [geometry.test.mjs](../../core/tests/geometry.test.mjs), [pipeline.test.mjs](../../core/tests/pipeline.test.mjs).


## Changing explicit mesh repair and native execution

Sources: [mesh-native.mjs](../../core/geom/mesh-native.mjs), [mesh-repair.mjs](../../core/geom/mesh-repair.mjs), [mesh-repair.cpp](../../core/geom/native/mesh-repair.cpp), [repair-stl.mjs](../../core/print/repair-stl.mjs), [mesh-repair-job.mjs](../../core/print/mesh-repair-job.mjs), [mesh-repair-worker.mjs](../../core/print/mesh-repair-worker.mjs).

**Contract.** Repair is an explicit operation with retained input, output and report. JavaScript validates requests; a worker owns the native child process and progress, and lets it run until it finishes, fails or is cancelled; the pinned CGAL executable performs the configured topology/repair stages. The executable must match the checked source/build manifest. [Native build and stages](native-repair.md) owns toolchain, artifact location and repair limits. Hole closing obeys both configured limits; zero limits disable it.

**Failures.** Missing/stale native builds are setup failures, not permission to download or search arbitrary executables. Cancellation/worker failure must terminate the child, reject the operation and preserve the original input. Cancellation is the only way a running child is stopped from JavaScript; do not reintroduce an elapsed-time limit, and do not treat silence as a stall unless the helper first learns to report while it works. A repaired mesh still crosses strict validation; successful software repair does not approve a manufactured part.

**Change together.** Review the C++ argument/progress protocol, manifest source hash, JS stage parsing, worker cancellation, report schema and Studio import cleanup together. Changing native code requires rebuilding the pinned helper before interpreting repair results.

**Verification.** Check actual defect classes, disabled/bounded hole repair, stale build detection, progress, native failure and cancellation cleanup. Verify the retained report identifies what changed and strict re-import succeeds only for valid output. Checks: [mesh-repair.test.mjs](../../core/tests/mesh-repair.test.mjs), [studio-import.test.mjs](../../core/tests/studio-import.test.mjs).


## Changing STL normalization

Sources: [import-stl.mjs](../../core/print/import-stl.mjs).

**Contract.** STL import reads an explicit file, resolves units under the supported import policy, normalizes geometry/placement and writes a print recipe with identity tied to the resulting source. Strict geometry validation remains the default; `importOrRepairSTLBundle` falls back to explicit repair into the new bundle's `repair/` folder only for recognized geometry defects (hole closing disabled), then imports the repaired millimetre STL. The Studio import coordinator is its caller and owns the reserved directory.

**Failures.** Reject malformed files, unsupported units, invalid meshes and unavailable geometry. No mesh is refused for its size; only index capacity and a real allocation failure stop an import. Never treat a setup or memory error as an invitation to repair or silently simplify.

**Change together.** Coordinate STL parsing, mesh validation, recipe schema, source-file retention and Studio reserved-directory rollback. Imported geometry starts without human approval.

**Verification.** Exercise binary/text input, millimetre/inch conversion, strict failures, large inputs and the recipe generated from valid source. Checks: [studio-import.test.mjs](../../core/tests/studio-import.test.mjs), [mesh.test.mjs](../../core/tests/mesh.test.mjs), [mesh-large.test.mjs](../../core/tests/mesh-large.test.mjs).
