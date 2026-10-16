# Gridfinity: development

[gridfinity.mjs](scripts/gridfinity.mjs) owns dimensions and parameters; shared
[Geometry construction](../../core/geom/README.md#geometry-query-boundary) owns exact
rounded profiles, lofts, Booleans and derived output. Records retain parameters
and ordinary `solid` geometry; legacy meshes remain readable. Reopening/slicing
uses the saved solid. [edit.mjs](scripts/edit.mjs) returns recipe values for the
[Bundle lifecycle](../../core/print/extension-edits.mjs); assembly placement follows local construction.

## Dimensions

The [published constants](https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/main/src/core/standard.scad)
give the foot: section widths 35.6, 37.2, 37.2, 41.5 mm at Z = 0, 0.8, 2.6,
4.75 mm, with radii 0.8, 1.6, 1.6, 3.75 mm. The stacking recess has a 0.7 mm lower
bevel, 1.8 mm vertical section and 1.9 mm upper bevel; its theoretical 4.4 mm is
truncated by 0.6 mm to keep a 0.6 mm rim, giving the 3.8 mm addition, and the
lip's underside joins the wall with a sloped support. The
[reference socket](https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/main/src/core/gridfinity-baseplate.scad)
uses widths 36.3, 37.7, 37.7, 42 mm at 0.35, 1.05, 2.85, 5 mm above the backing;
SAAM trims the plate at 4.75 mm to keep a web between cells.

## Verification

`node --test skills/gridfinity/tests/*.test.mjs` covers sections, cavities,
mating intersections, parameter errors, text composition, assemblies,
access and the review/export lifecycle in temporary bundles. No physical print is validated. Label ramps, screw holes, scoops,
half-grid variants and object-shaped insert cutouts are not implemented. The
only refusal is a subdivision the solid kernel cannot address. Dated checks are
in the [development record](references/development-record.md).
