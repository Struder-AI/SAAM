---
name: gridfinity
description: gridfinity
metadata:
  saam-kind: task
---

# Gridfinity

Create parametric open bins, solid blanks for custom inserts, and baseplates.
This is geometry preparation: the result is a closed material mesh with its
editable construction recipe. Use the existing [print workflow](../../core/print/USAGE.md)
and [maker interaction](../../MAKERS.md) for setup, Studio review and delivery.
The short frontmatter is intentional: shared discovery contains only the name.

## Create and edit

MCP exposes one tool, `gridfinity`. Create an unapproved print:

```json
{
  "printId": "organizers/small-bin",
  "action": "create",
  "machineId": "ultimaker-s5",
  "parameters": {
    "kind": "bin",
    "xUnits": 2,
    "yUnits": 1,
    "heightUnits": 3,
    "compartmentsX": 2
  }
}
```

The CLI accepts the same parameters object in a JSON file:

```sh
node skills/gridfinity/scripts/cli.mjs create Prints/small-bin parameters.json --machine ultimaker-s5
node studio/server.mjs Prints/small-bin
```

Read the current revision with `get_print` or the shared CLI `check` command.
To edit, call `gridfinity` with `action: "update"`, `printId`, `expectedRevision`
and a partial `parameters` object. Omitted parameters remain as saved. Omit
`machineId` on updates. For an assembly, supply `part` with the component id.

```sh
node skills/gridfinity/scripts/cli.mjs update Prints/small-bin changes.json --revision REVISION
```

Use `--part ID` to select an assembly component. The skill updates existing
Gridfinity geometry only; create another print to change between bin, blank and
baseplate. Wrong fields, incompatible settings, stale revisions, mesh failures
and machine-bound violations are rejected before saving the edited plan.
An existing print is never overwritten by `create`.

Dimension edits rebuild from the parameters and invalidate geometry and combined
settings/toolpath confirmations through the common lifecycle. Use this tool to edit the recipe;
direct changes to its baked mesh or parameters through `adjust_print` are rejected
unless supplied as a complete newly compiled geometry record.

## Parameters

All coordinates are millimetres. Counts are integers. Unsupported parameters
are rejected, including fields that apply to another kind.

| Common setting | Default | Meaning / supported range |
|---|---|---|
| `kind` | `bin` | `bin`, `blank`, `baseplate`. |
| `xUnits`, `yUnits` | 1, 1 | 1–8 cells per direction, on fixed 42 mm centres. The selected machine must accommodate the placed result. |
| `toleranceMm` | 0.03 | 0.005–0.1 mm maximum chord deviation for the constructed circular arcs, before float mesh conversion. This does not change mating clearance. |

| Bin setting | Default | Meaning / supported range |
|---|---|---|
| `heightUnits` | 3 | 2–20; nominal shoulder height is `7 * heightUnits` above the foot bottom. |
| `wallMm` | 1.2 | 0.8–2.5 mm side and divider thickness. The stacking profile remains fixed. |
| `floorMm` | 2.25 | 1–5 mm above the 4.75 mm foot; default cavity floor is at Z = 7 mm. At least 3.8 mm must remain below the nominal shoulder. |
| `compartmentsX`, `compartmentsY` | 1, 1 | 1–16 equally spaced compartments per direction, each at least 4 mm clear. Dividers end at the shoulder. |
| `stackingLip` | `true` | Supported rim and mating recess, adding 3.8 mm to nominal height. `false` gives a plain open rim at nominal height. |
| `magnetHoles` | `false` | Four downward-facing 6.5 mm diameter, 2.4 mm deep pockets per cell on 26 mm centres. Sized as clearance pockets for nominal 6 × 2 mm magnets; retention is not guaranteed. |

Blank settings are `heightUnits` (default 1, range 1–20) and `magnetHoles`
(default `false`). Blanks retain the feet and a solid body up to nominal height;
they have no cavities or stacking rim.

Baseplates accept `floorMm` (default 1.2, range 0–5). This is the solid backing
under the sockets. Zero creates an open frame. Overall plate height is
`floorMm + 4.75`. Baseplates have no magnet pockets in this version.

## Dimensions and fit

Bin/blank footprints are `42 * units - 0.5` in each direction. Their local
minimum X/Y is 0.25; cell centres are `(21 + 42*i, 21 + 42*j)`. Plates occupy
the full `42 * units` footprint starting at zero. All geometry begins at Z = 0.
New prints propose placement X/Y = 20 mm and reuse remembered machine setup.
Adjust placement with the shared tools if needed; large grids can exceed a
machine's usable bed even though the generator accepts their cell counts.

The [published dimensional constants](https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/main/src/core/standard.scad)
provide the foot: section widths 35.6, 37.2, 37.2, 41.5 mm at Z = 0, 0.8, 2.6,
4.75 mm, with radii 0.8, 1.6, 1.6, 3.75 mm. Rounded corner centres remain fixed.
The stacking recess has 0.7 mm lower bevel, 1.8 mm vertical section and 1.9 mm
upper bevel. Its theoretical height is 4.4 mm; this implementation truncates
the upper 0.6 mm to retain a 0.6 mm rim, giving the stated 3.8 mm addition.
The underside of the lip joins the ordinary wall with a sloped support.

The [reference baseplate socket](https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/main/src/core/gridfinity-baseplate.scad)
uses widths 36.3, 37.7, 37.7, 42 mm at heights 0.35, 1.05, 2.85, 5 mm above
the backing. SAAM trims the plate at 4.75 mm to retain a web between cells
instead of a zero-width top edge. A positive backing stops the recess at its
top; zero backing opens it through the underside.

These dimensions target conventional Gridfinity mating geometry. Physical fit,
magnet retention and stack stability have not been tested. Dimensional variants
exist; compare the intended mating part and print a small fit sample before a
large organizer. No printer shrink compensation is applied automatically.

## Composition with SAAM

Creation proposes [planar-infill](../planar-infill/SKILL.md) at its existing
20% density and two perimeters, with [full-fill](../full-fill/SKILL.md) in
`solid-surfaces` mode and three top/bottom layers. The cavity is actual missing
material, so solid top masks close the floor and wall tops without capping the
open bin. Inspect the toolpath around thin walls, dividers, foot joins and pockets.
These settings are editable proposals, not a validated printing recipe.

The geometry uses ordinary shared mesh queries, material regions, operation
composition, machine adapters and exact-byte review/delivery. It introduces no
deposition skill or exporter. Whole-body full-fill is also available. Regional
assignments and mixed assemblies use the existing component interfaces; a
compiled record from `compileGridfinity` can be assigned as a part's geometry
in a complete plan. Assembly transforms act after local construction.

Use [text](../text/SKILL.md) for lettering on the floor, walls or a blank.
For example, a plain reference plane at Z = 7 reaches the default bin floor;
position the lettering inside the selected compartment. Existing text features
are rebuilt after a Gridfinity edit and retained with their font bytes. Their
reference coordinates remain unchanged: move them explicitly when resizing or
changing floor height. Failed lettering rebuilds leave the saved print unchanged.
Removing all text restores the underlying Gridfinity record.

For underside lettering, keep the outline within one foot's flat bottom rather
than spanning the gaps between feet. Its reference plane is Z = 0, with the
normal directed downward so a recess cuts upward into the foot. A shallow
0.4 mm recess is a starting point; check the remaining material and first-layer
paths. Keep the letters clear of the foot bevels and optional magnet pockets.
Use the text skill's [circular underside layout](../text/SKILL.md#circular-underside-lettering)
for a ring. The actual deformed glyph outlines, including stroke expansion,
determine clearance; the baseline radius alone does not.

For a custom upper body, put a Gridfinity blank and the authored body into a
shared assembly, then select printing skills by component. A one-unit-high blank
ends at Z = 7 mm; place a supported body on that foundation and align the
deposition interface with the layer grid. The assembly does not automatically
union intersecting components or remove duplicate deposition, so assign distinct
material extents and check their contact and operation order.

A vase body can publish its exterior to explicit
[finished-surface cladding](../pipe-cladding/SKILL.md#finished-surface-composition).
Select the body for both vase-wall and cladding, print the blank with full-fill,
and keep the cladding away from the mating foot. Continuous vase extrusion applies
to the wall operation; the base and cladding transitions retain their own travel.
The body still needs supported sections and a valid cladding chart. This skill
does not author an arbitrary twisting body or remove another skill's geometry,
surface-mapping or machine limits. DENSO cladding requires its configured robot
and external rotary.

Vase-wall and draped-skin retain their geometry restrictions. Multiple feet,
cavities, dividers and stacking ledges do not form a single continuous vase or
single accessible roof. No automatic reassignment to those patterns is made.
Review bridges above pockets and between feet, and assign supports explicitly
when appropriate using the existing support skill. No hardware execution occurs.

## Implementation and verification

[gridfinity.mjs](scripts/gridfinity.mjs) owns dimensional construction and
parameter validation. Rounded rectangular rings form indexed convex lofts;
the existing shared Manifold boundary performs unions and differences. Arcs
are inscribed polygons with a common segment count derived from a 4 mm maximum
radius. Boolean output passes SAAM's existing closed-mesh validation. The mesh
and parameters are hashed together by [record.mjs](scripts/record.mjs); this
detects stale recipe/mesh pairs, not maliciously forged records. Reopening and
slicing use the saved mesh without recompiling the parametric construction.

[bundle.mjs](scripts/bundle.mjs) owns preparation through shared lifecycle calls.
CLI and MCP call it directly. These modules participate in the bundle runtime
identity so changed construction code invalidates old generation identity.
No additional numerical library, imported CAD application or external generator
is required; the pinned `manifold-3d` dependency is already present.

The [skill tests](tests/gridfinity.test.mjs) and
[access tests](tests/access.test.mjs) are available with:

```sh
node --test skills/gridfinity/tests/*.test.mjs
```

Tests cover dimensional sections, cavities, mating intersections, parameter
errors, text composition, assemblies, CLI/MCP access and the shared review/export
lifecycle. Synthetic approvals remain confined to temporary test bundles.
These are software checks; no physical print has been validated. Label ramps,
screw holes, scoops, half-grid variants and arbitrary object-shaped insert
cutouts are not implemented. The shared 100000-triangle and intersection-check
budgets still apply; refine or simplify explicitly when a construction exceeds
them.

Dated implementation checks and Studio observations are in the
[development record](references/development-record.md).
