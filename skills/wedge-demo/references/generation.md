# Wedge generation

## Eight points and a planar roof

The source is an unordered set of eight XYZ points in millimeters. Group by XY:
there must be exactly four corner pairs forming an axis-aligned rectangle,
with a common base Z and one higher point per corner. Translate minimum XY
and base Z to local zero; machine placement is applied afterward.

The roof is `z = c + a*x + b*y`. Three corners determine its coefficients;
the fourth must agree within 1e-7 mm. Its total slope is
`s = hypot(a,b)`, angle `atan(s)`, and vertical normal component
`cosine = 1/sqrt(1+s*s)`. Positive and negative slopes along either axis,
diagonal slopes and a horizontal roof all use this calculation. The total angle,
rather than either component separately, must satisfy the skill/machine limit.

Native storage is `geometry/model.mesh.json` using `saam-native-geometry/1`,
millimeter indexed triangles: eight vertices, twelve consistently wound triangles.
Each pair of triangles belongs to one of six named faces. Shared mesh validation
checks closure and topology. Reopening recreates the mesh from the source points
and checks native bytes, bounds, face identities, roof coefficients and display
data. The descriptor and native bytes bind geometry review. Rhino is needed only
to verify an older 3DM during explicit upgrade; no new wedge writes a 3DM.

## Horizontal substrate

For N skins of normal thickness t, reserve vertical height `N*t/cosine`
below the roof. The body roof is `coreC + a*x + b*y` where
`coreC = c - N*t/cosine`. Horizontal courses start at `firstLayerMm`
and advance by `layerMm`.

Each section is the rectangle intersected with the half-plane below the body
roof. This can yield triangular, rectangular or pentagonal courses. For the
perimeter centerline, inset the rectangle by half a bead width and shift the
roof half-plane inward by that same horizontal distance along its gradient.
Inset another bead width for the fill region. Shared scanline fill makes
parallel Y strokes connected inside this convex region. Reverse the complete
course and its perimeter winding on successive layers. Courses with no finite
area after insetting are omitted.

This remains a bounded solid-fill recipe. Bead overlaps, rounded bead ends and
tiny final courses are approximations, not exact material solids. Tests compare
deposition volume against the analytic prismatoid volume, which is footprint
area times mean corner height.

## Inclined skins and transition

Roof strokes follow the horizontal gradient direction `(a,b)/s`, using +X
for a horizontal roof. Project the rectangle onto the perpendicular direction,
divide its span into equally spaced rows no wider than the bead width, and clip
each row to the inset rectangular footprint. Directions alternate uphill/downhill
across emitted strokes, including layer boundaries. Alternate skins reverse row
order. Inner skins also clip where their plane reaches first-layer height;
every requested skin must retain at least one printable stroke.

The kth skin follows `z = coreC + k*t/cosine + a*x + b*y`. The first skin's
substrate height at (x,y) is the highest emitted flat layer no higher than
`coreC + a*x + b*y - beadWidth*s/2`, or zero below the first body course.
The downhill bead-edge offset preserves the bounded staircase transition model.

Split first-skin strokes at every substrate step and into segments no longer
than 0.5 mm. The midpoint gap is the average gap between step boundaries.
Volume is `3D segment length * row spacing * vertical gap * cosine`;
strokes follow steepest ascent, so row spacing is also the transverse surface
spacing. Later skins have constant normal thickness t. No physical adhesion,
pressure or surface-quality result is implied by this volume approximation.

## Travel, speed and export

Nearby starts within the locked comb distance move directly at their current
height; longer transitions retract, lift to the maximum height of all eight
corners plus `liftMm`, traverse, descend and recover. Cooling and finish use
that same height. The profile has no print-head collision model.

Print speed targets are validated against machine XY feeds. Generated moves
are capped by material flow and the locked Z speed, with retraction and cooling
dwell kept as separate settings. Segments shorter than 1e-4 mm are omitted to
avoid collapse at the export coordinate resolution.

The shared lifecycle generates SAAMpath and the machine-declared export,
interprets that exact export, and checks coordinates and deposited volumes
before toolpath review. Studio estimates commanded motion and dwell time,
excluding acceleration, heating and firmware service routines.

## Upgrading older bundles

The public `upgrade` command verifies the old native file and its recipe,
converts run/width/base/angle to eight points, writes a native mesh, and
invalidates both confirmations. Old 3DM, export and delivery bytes remain
untouched. A mesh bundle with unchanged geometry retains its geometry approval
when only generator/machine settings are upgraded. No upgrade creates job approval.
