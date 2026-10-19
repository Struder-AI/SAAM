# Geometry

Geometry holds solids, curves and points, in millimetres relative to recipe XY `placement`, with Z = 0 on the bed. [MAKERS](MAKERS.md#geometry) guides solid construction; [booleans](#booleans) combine solids.
`{shape:"spatial",solid:null,curves:[],points:[]}` also represents geometry-only and empty drafts; `solid` can hold any ordinary solid/assembly. Curves are `{id,visible,closed,points|nurbs|uv}`; points are `{id,visible,point:XYZ}`. IDs are unique and stable.
Trace/Inject recipe entries reference these IDs as `geometry:"id"` and retain deposition settings. Existing inline authoring inputs are separated when saved; old bundles remain readable without rewriting on open. XYZ/NURBS curves and points display; recipe-derived UV curves stay hidden until toolpath generation.

## Spline surfaces

`geometry: {shape: "spline", patches: [...]}` retains patches `{name, degreeU, degreeV, controlPoints, knotsU?, knotsV?, trimLoops?, normalSide?}`.
`controlPoints` has rows along U and points along V: `[x,y,z]` or `[x,y,z,weight]`.
Curves and surface axes use degree 2 or 3; straight/ruled geometry may use degree 1. Add spans for detail. Knots default to clamped uniform; supplied vectors are complete (count + degree + 1).
Each `trimLoops` entry is a UV polyline or `{curves:[{points:UV[]}|{nurbs:{degree,knots,controlPoints,weights?}},…]}`.
Curves join into closed loops inside the knot domain: outer loops counterclockwise, holes clockwise; no crossings or touching.
Trimmed shells use outward `normalSide: 1` (default) or `-1` for reversed `du × dv`; untrimmed shells infer orientation.

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

**Closure.** Trim boundaries, or rectangular edges when no trims are supplied,
must pair with neighbouring faces, a seam or a collapsed pole. Core sews shared
boundaries and reports gaps. Open shells save and show; each layer slices what closes.
[Booleans](#booleans) need closed solids.

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
- *A surface.* One patch saves and shows as it is. To print it as a sheet, add a copy
  offset along its normal and degree-1 strips ruling their edges.

**Named patches.** Skills select surfaces by name. Sections and containment use
surfaces and trims; Studio derives triangles. SAAM's 3DM stores supporting surfaces
and verified SAAM UV curve metadata, not a Rhino trimmed Brep. Sampling remains derived from the retained curves.

## Blob field

Freely placed points, each with a position, a reach and a strength, whose smooth
contributions add up like metaballs: a point adds `strength · K(distance / reach)`,
where `K` is the cubic B-spline, 1 at the point and 0 from one reach outward.
Material is where the sum exceeds the threshold, cut flat at Z = 0. Create and
rebuild it with the `blob_field` tool:

```json
{"points": [{"positionMm": [0, 0, 3], "reachMm": 16, "strength": 1},
            {"positionMm": [10, 0, 3], "reachMm": 12, "strength": 1},
            {"positionMm": [5, 0, 6], "reachMm": 6, "strength": -3}],
 "threshold": 0.25, "edgeMm": 0.5}
```

`threshold` defaults to 0.25 and `edgeMm` to the smaller of 0.5 mm and an eighth
of the smallest reach. At threshold 0.25:

- A lone point is a ball of radius `reach × 0.36, 0.5, 0.6, 0.69, 0.75` at
  strength 0.5, 1, 2, 4, 8, never beyond its reach; below Z = 0 it is cut flat.
- Two strength-1 points with equal reach join with a smooth neck when closer than
  1.2 × reach, and stay separate beyond that.
- A row of strength-1 points reach/2 apart is a smooth rod of radius about
  0.55 × reach, thicker when closer; vary the reach along the row to taper it.
- Negative strength carves. In material summing about 1, a point of strength −3
  empties a ball of radius reach/2; −2 empties 0.43 × reach.

`edgeMm` is the sampling scale of the mesh Studio shows and every skill slices:
smaller features can be missed, and smaller values converge.

## Mesh

`geometry: {shape: "mesh", vertices: [[x,y,z],...], triangles: [[i,j,k],...], source: null}`.
The mesh is closed, free of self-intersections, and wound counterclockwise seen
from outside. A prism is its outline at two heights, a fan on each cap and two
triangles per side; a chamfer or bevel is another ring of vertices. Normals are
faceted, so surface-following skills follow the facets. Existing meshes come
from [STL import](core/print/USAGE.md#import-an-stl) or
[thingi10k](skills/thingi10k/SKILL.md). Import automatically attempts repair for
recognized defects and reports cancellable progress.

## Booleans

`geometry: {shape: "boolean", operation, operands: [...]}` combines spline, mesh,
blob-field, gridfinity or Boolean solids in the same coordinates. `union` joins,
`intersection` keeps shared material, and `difference` subtracts later operands.
Closed spline operands use [native surface construction](core/geom/README.md#native-boolean-construction), with automatic recovery reported in notes.
Mesh/mixed inputs combine sections; empty results stay empty. [Named faces](core/geom/reference-surface.mjs) retain source charts through cuts, bounded by surviving regions and holes.
`displayOperand` selects a zero-based preview operand; manufacturing uses the full Boolean. Choices nest.
`combine_geometry`: `{operation, operand, part?}` adds to the print or one component;
Repeats append; display-selected solids stay nested. Apply text/heat-set metadata afterward.

## Assembly

`geometry: {shape: "assembly", parts: [{id, xMm, yMm, zMm, geometry}, ...]}` places
one or more non-assembly components. Parts are translated, not rotated. Each is sliced on
its own, so an overlap prints twice; join overlapping bodies with a union instead.
Skills select components by `id`.

## Checking geometry

`intersect_geometry` intersects a print, one `part`, or a `geometry` you are about
to write, in the geometry's own coordinates:

```json
{"sectionsAtZ": [1, 4.5], "topsAtXY": [[10, 10], [2, 2]], "includeLoops": false}
```

Each section gives its area, islands, holes and loop bounds (`includeLoops` adds
the points; outer loops run counterclockwise, holes clockwise). Each top gives
the highest surface crossing, its normal, slope and surface name, or `zMm: null`
where the line misses the part.

<!-- requires: nonplanar -->
### Surface regions

Each entry of `surfaces` is a control net (`degreeU`, `degreeV`, `controlPoints`,
optional knots and `offsetMm` to shift it, as a stacked curved slice) and gives
the region of that surface inside the part as loops in the surface's own (u,v).

## Writing geometry

Geometry is recipe data that `create_bundle` and `adjust_recipe` take whole: send the entire
`patches` array, mesh or operand list. `request_review` shows it in Studio; `get_bundle` with `includeGeometry: true` reads it back.

## Computing geometry with scripts

Scripts compute inputs for the [print tools](core/print/USAGE.md#command-line);
SAAM constructs and publishes them ([boundaries](MAKERS.md#working-boundaries)).
[Shared Geometry construction](core/geom/README.md#geometry-query-boundary) retains
native profiles/solids and derives meshes when needed. Windows imports use `file:///` URLs.
