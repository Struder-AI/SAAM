# Geometry

You author the part. SAAM has no shape templates: the geometry is whatever you
write, in one of three forms, and every toolpath skill slices and follows it.
Coordinates are millimetres relative to the recipe's `placement`, Z = 0 on the bed.

| Form | Think of it as | Reach for it for |
|---|---|---|
| [Spline surfaces](#spline-surfaces) | A skin of patches stretched over control points | Smooth and curved bodies, exact circles, revolutions, lofts, sleeves, named surfaces for skills to follow |
| [Spline field](#spline-field) | A smooth scalar value through a box; material wherever it exceeds a threshold | Organic volumes, blends, holes, voids and several bodies from one description |
| [Mesh](#mesh) | Flat triangles | Flat faces, sharp edges and chamfers, polyhedra, imported STLs |

A part can mix forms as an [assembly](#assembly).

## Spline surfaces

`geometry: {shape: "spline", patches: [...]}` is a closed shell of untrimmed NURBS
patches. A patch is `{name, degreeU, degreeV, controlPoints, knotsU?, knotsV?}`:
`controlPoints` is rows along U, each a list of points along V, each `[x,y,z]` or
`[x,y,z,weight]`. Degrees are 1–5 and below the control count. Omitted knots are
clamped uniform; a supplied vector is complete (count + degree + 1 values).

**What a control net expresses**

- Exact conics. A rational quadratic circle is nine points on the unit square's
  corners and midpoints, corner weights √½, with knots `[0,0,0,¼,¼,½,½,¾,¾,1,1,1]`.
- Revolution. Use that circle along U and a profile along V: point `[r·x, r·y, z]`
  with weight `w_circle · w_profile`. A profile that starts and ends on the axis
  closes the solid by itself, poles included; one patch is a sphere or a vase body.
- Extrusions and ruled walls: degree 1 in the direction between two matching curves.
- Lofts and sweeps: each row is one section curve with the same count and degree.
- Periodic sleeves: repeat the first `degree` columns at the end and use uniform
  unclamped knots (for cubic U, `knotsU[i] = i − 3`).
- Creases: separate patches meet at an edge, or a knot repeats `degree` times.
- Local shaping: move interior controls; add rows or columns for more freedom.

**Closure.** Every patch edge must coincide with another edge, with the same
patch's opposite edge (a seam), or collapse to a point (a pole). Sharing boundary
control points and knots between neighbours makes this exact. An open shell is
rejected with the unmatched `patch:edge`.

**Native use.** Slicing sections the patches themselves, not a tessellation.
Patch names are how skills address surfaces: the roof a draped skin follows, the
sleeve cladding coats, the slice a wave grows on, the reference text bends onto.
Trimmed faces are not supported; cut openings with patch layout, a field or a mesh.

## Spline field

A trivariate B-spline scalar over an axis-aligned box. Material is where
`value > isoValue`, clipped to the box, so holes, voids and separate islands need
no change of structure. Create and edit it with the `spline_field` tool (CLI
`spline-field-create` / `spline-field-update`):

```json
{"field": {"schema": "saam-spline-field/1", "originMm": [0,0,0], "sizeMm": [24,24,6],
  "counts": [6,6,3], "degrees": [2,2,1], "knots": [[...],[...],[...]],
  "values": [...], "weights": null, "isoValue": 0},
 "extraction": {"edgeMm": 0.5}}
```

`values` has one entry per control, X fastest: index `x + nx·(y + ny·z)`. Knots are
clamped vectors on `[0,1]`.

**What a field expresses**

- Shapes as signed values: positive inside, negative outside, roughly the distance
  to the surface, so a sphere is `R − |p − c|` sampled at the controls.
- Combinations, one control value at a time: union is `max`, intersection `min`,
  subtraction `min(a, −b)`; a smooth minimum or maximum blends them.
- Shells and lattices, as bands of value around a surface.
- Flat, bed-flush faces wherever material meets the box, since the box clips it.

**Controls.** You set values, not positions. Each control sits at a fixed point in
the box given by its knots (the Greville abscissae). Place and size the box
anywhere, bunch controls with non-uniform knots, or refine locally with the
hierarchical `/2` schema. Degree 1 values are samples at lattice nodes; higher
degrees are smooth coefficients, not values at the nodes.

**Extraction.** `edgeMm` is the mesh sampling scale for slicing and review. Features
below it can be missed, and smaller values converge. The result slices as a mesh.
The [field contract](core/geom/SPLINE-FIELD.md) owns evaluation, refinement and
extraction limits; [spline-field-demo.mjs](scripts/spline-field-demo.mjs) builds a
lobed ring.

## Mesh

`geometry: {shape: "mesh", vertices: [[x,y,z],...], triangles: [[i,j,k],...], source: null}`.
The mesh is closed, free of self-intersections, and wound counterclockwise seen
from outside. A prism is its outline at two heights, a fan on each cap and two
triangles per side; a chamfer or bevel is another ring of vertices. Normals are
faceted, so surface-following skills follow the facets.

Existing meshes come from [STL import](core/print/USAGE.md#import-an-stl) or
[thingi10k](skills/thingi10k/SKILL.md); [mesh-tools](skills/mesh-tools/SKILL.md)
repairs a rejected one.

## Assembly

`geometry: {shape: "assembly", parts: [{id, xMm, yMm, zMm, geometry}, ...]}` places
2–20 components of any form. Parts are translated, not rotated. Each is sliced on
its own, so parts should touch rather than overlap; an overlap prints twice. Skills
select components by `id`.

## Features and sources

These build on or supply geometry and have their own manuals in the
[skill digest](skills/DIGEST.md): text (font outlines on or beside a part),
heat-set insert bores, Gridfinity bins and baseplates, thingi10k meshes and
mesh repair.

## Writing and checking

Geometry is recipe data: `create_print` and `adjust_print` take it like any setting.
Arrays replace, so send the whole `patches` array or the whole mesh. Validation
names what failed; `request_review` shows the result in Studio, and `get_print`
with `includeGeometry: true` reads it back. Scripts may compute any of these for
large or repetitive geometry and write the same recipe;
[spline-solid.mjs](core/geom/spline-solid.mjs) has block and tube helpers.
