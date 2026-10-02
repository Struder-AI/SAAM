# Advanced vase: sleeve fitting and contact

[Geometry's mesh-sleeve.mjs](../../core/geom/sleeve/mesh-sleeve.mjs) exposes `fitMeshSleeve(mesh, options)` for an already validated
triangle mesh. A **sleeve** here is the open side surface of a vase-like
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
explicitly in the authored recipe and derive a complete course count for it.
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
| `circumferentialControls`, `heightControls` | Independent fit resolution, defaults 12 and 6; each needs at least 4 controls. More controls permit finer detail. |
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
Mesh conformance belongs after the regular pattern has been mapped onto this smooth
reference: callers retain the original source query for directional contact.
Do not stretch every pattern point between the smooth and detailed surfaces or
interpret the sleeve as a filled material boundary.

Focused regressions cover periodic position and tangent continuity, second
derivative agreement, suppression of fine flutes, leaning envelopes, translated
parts, hollow sleeves, preserved small pores/islands and explicit rejection of
significant disconnected sections. Authoring regressions retain flat caps and
exclude only collapsed poles, and reject separated height intervals. These establish the tested software scope,
not physical support or machine clearance.

### Prepared mesh contact

[Geometry's directional-contour.mjs](../../core/geom/sleeve/directional-contour.mjs) unfolds one-turn section contours into ordered polar
profiles within the selected planar correspondence allowance. Larger folds
reject, as does a source whose radial variation needs more angular room than the
one turn an unfolded profile has. The fixed sample count per profile has a floor,
not a ceiling: a contour whose sampling error exceeds the detail tolerance says so
and can be sampled more finely. [prepared-radial-contact.mjs](../../core/geom/sleeve/prepared-radial-contact.mjs) uses 16,384 fixed
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

