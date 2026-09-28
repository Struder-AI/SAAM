# Geometry

You author the part. SAAM has no shape templates: the geometry is whatever you
write, in one of three forms, combined with [booleans](#booleans) when one form
alone won't do. Every toolpath skill slices and follows the result.
Coordinates are millimetres relative to the recipe's `placement`, Z = 0 on the bed.

| Form | Think of it as | Reach for it for |
|---|---|---|
| [Spline surfaces](#spline-surfaces) | A skin of patches stretched over control points | Smooth and curved bodies, exact circles, revolutions, lofts, sleeves, named surfaces for skills to follow |
| [Blob field](#blob-field) | Freely placed points whose smooth falloffs add up; material where the sum passes a threshold | Organic volumes, blends, holes, voids and several bodies from one description ("put a blob here") |
| [Mesh](#mesh) | Flat triangles | Flat faces, sharp edges and chamfers, polyhedra, imported STLs |

## Spline surfaces

`geometry: {shape: "spline", patches: [...]}` is a closed shell of untrimmed NURBS
patches. A patch is `{name, degreeU, degreeV, controlPoints, knotsU?, knotsV?}`:
`controlPoints` is rows along U, each a list of points along V, each `[x,y,z]` or
`[x,y,z,weight]`. Degrees are 1–5 and below the control count. Omitted knots are
clamped uniform; a supplied vector is complete (count + degree + 1 values).
Orientation does not matter.

**What a control net expresses**

- A flat quadrilateral: a degree-1 patch with a 2 × 2 net of its corners.
- Exact conics. A rational quadratic circle is nine points on the unit square's
  corners and midpoints, corner weights √½, with knots `[0,0,0,¼,¼,½,½,¾,¾,1,1,1]`.
- Revolution. Use that circle along U and a profile along V: point `[r·x, r·y, z]`
  with weight `w_circle · w_profile`. A profile that starts and ends on the axis
  closes the solid by itself, poles included; one patch is a sphere or a vase body.
- Extrusions and ruled walls: degree 1 in the direction between two matching curves.
- Lofts and sweeps: each row is one section curve with the same count and degree.
- Periodic sleeves: repeat the first `degree` columns at the end and use uniform
  unclamped knots (for cubic U, `knotsU[i] = i − 3`). With `n` columns spaced on a
  circle, a cubic curve passes inside its controls: control radius
  `R · 6 / (4 + 2·cos(2π/n))` puts it on radius `R` at the knots.
- Creases: separate patches meet at an edge, or a knot repeats `degree` times.
- Local shaping: move interior controls; add rows or columns for more freedom.

**Closure.** Every patch edge must coincide with another edge, with the same
patch's opposite edge (a seam), or collapse to a point (a pole). Sharing boundary
control points and knots between neighbours makes this exact. An open shell is
rejected with the unmatched `patch:edge`.

**Worked forms**

- *Box.* Six degree-1 patches, each the 2 × 2 net of one face's corners. A
  20 × 10 × 5 box's top is `{"name":"top","degreeU":1,"degreeV":1,"controlPoints":[[[0,0,5],[0,10,5]],[[20,0,5],[20,10,5]]]}`;
  `bottom`, `front`, `right`, `back` and `left` follow from the other corners.
- *Block with a shaped top.* The top is an `n × m` net, cubic where it has four or
  more controls, with its points on the Greville abscissae so the footprint stays
  exact: X = run × `[0, ⅓, ⅔, 1]` for four clamped cubic controls,
  `[0, ⅙, ½, ⅚, 1]` for five. Set heights freely. Each side wall is that top's
  boundary row ruled down to Z = 0: the same points, degree and knots along it,
  degree 1 downward. The bottom is one flat 2 × 2 patch.
- *Cylinder.* A side ruled between two copies of the rational circle, and two
  caps, each a row per circle point from the centre (the pole) to the rim, all
  sharing the circle's knots.
- *Tube.* The same with a bore: outer and bore sides, and two flat annular ends
  ruled between the circles.

**Native use.** Slicing sections the patches themselves, not a tessellation.
Patch names are how skills address surfaces: the roof a draped skin follows (a
patch named `bottom` is never draped), the sleeve cladding coats, the slice a
wave grows on, the reference text bends onto. Trimmed faces are not supported;
cut openings with patch layout or a [boolean difference](#booleans).

## Blob field

A field built from freely placed points. Each point has a position, a reach and
a strength, and their smooth contributions add up, like metaballs with spline
falloff: a point adds `strength · K(distance / reach)`, where `K` is the cubic
B-spline, 1 at the point and 0 from one reach outward. Material is where the sum
exceeds the threshold, cut flat at the bed plane Z = 0. Create and rebuild it with
the `blob_field` tool (CLI `blob-field-create` / `blob-field-update`):

```json
{"points": [{"positionMm": [0, 0, 3], "reachMm": 16, "strength": 1},
            {"positionMm": [10, 0, 3], "reachMm": 12, "strength": 1},
            {"positionMm": [5, 0, 6], "reachMm": 6, "strength": -3}],
 "threshold": 0.25, "edgeMm": 0.5}
```

`threshold` defaults to 0.25 and `edgeMm` to the smaller of 0.5 mm and an eighth
of the smallest reach; both are stored in the record. At threshold 0.25:

- A lone point is a ball of radius `reach × 0.36, 0.5, 0.6, 0.69, 0.75` at
  strength 0.5, 1, 2, 4, 8, never beyond its reach. A centre on the bed makes a
  hemisphere; any point below Z = 0 is cut flat there.
- Two strength-1 points with equal reach join with a smooth neck when closer than
  1.2 × reach, and stay separate beyond that.
- A row of strength-1 points reach/2 apart is a smooth rod of radius about
  0.55 × reach, thicker when closer; vary the reach along the row to taper it.
- Negative strength carves. In material summing about 1, a point of strength −3
  empties a ball of radius reach/2; −2 empties 0.43 × reach.

`edgeMm` is the extraction mesh's sampling scale: smaller features can be missed,
and smaller values converge. The field is extracted to a mesh when you create or
rebuild it, and that mesh is what Studio shows and every skill slices.
[blob-field.mjs](core/geom/blob-field.mjs) owns the evaluation.

## Mesh

`geometry: {shape: "mesh", vertices: [[x,y,z],...], triangles: [[i,j,k],...], source: null}`.
The mesh is closed, free of self-intersections, and wound counterclockwise seen
from outside. A prism is its outline at two heights, a fan on each cap and two
triangles per side; a chamfer or bevel is another ring of vertices. Normals are
faceted, so surface-following skills follow the facets.

Existing meshes come from [STL import](core/print/USAGE.md#import-an-stl) or
[thingi10k](skills/thingi10k/SKILL.md); [mesh-tools](skills/mesh-tools/SKILL.md)
repairs a rejected one.

## Booleans

`geometry: {shape: "boolean", operation, operands: [...]}` combines two or more
spline, mesh, blob-field or boolean operands, written in the same coordinates.
`union` joins them, `intersection` keeps what they share, and `difference`
subtracts every later operand from the first: a drilled plate is a box minus a
cylinder.

Each layer sections every operand natively (exact contours for spline patches)
and combines the sections, so spline operands are never tessellated for
printing and no trimmed surface is built. Studio shows a mesh of the combined
solid. Tops work on every boolean, so draped skins, roof text and heat-set
inserts do too. Skills that name a patch (wave overhangs, cladding, text on a
named patch) need a plain spline part.

`combine_geometry` (CLI `combine`) adds an operand to the current geometry, or to
one assembly part, without resending it: `{operation, operand, part?}`. Repeating
the same operation appends to the boolean.

## Assembly

`geometry: {shape: "assembly", parts: [{id, xMm, yMm, zMm, geometry}, ...]}` places
2–20 components of any form. Parts are translated, not rotated. Each is sliced on
its own, so an overlap prints twice; join overlapping bodies with a union instead.
Skills select components by `id`.

## Features and sources

These build on or supply geometry and have their own manuals in the
[skill digest](skills/DIGEST.md): text (font outlines on or beside a part),
heat-set insert bores, Gridfinity bins and baseplates, thingi10k meshes and
mesh repair.

## Checking geometry

`intersect_geometry` (CLI `intersect`) intersects a print, one `part`, or a
`geometry` you are about to write with horizontal planes and vertical lines, in
the geometry's own coordinates:

```json
{"sectionsAtZ": [1, 4.5], "topsAtXY": [[10, 10], [2, 2]], "includeLoops": false}
```

Each section gives its area, islands, holes and loop bounds (`includeLoops` adds
the points; outer loops run counterclockwise, holes clockwise). Each top gives
the highest surface crossing, its normal, slope and surface name, or `zMm: null`
where the line misses the part.

## Writing and checking

Geometry is recipe data: `create_print` and `adjust_print` take it like any setting.
Arrays replace, so send the whole `patches` array, mesh or operand list.
Validation names what failed; `request_review` shows the result in Studio, and
`get_print` with `includeGeometry: true` reads it back. Scripts may compute any of
these for large or repetitive geometry and write the same recipe.
