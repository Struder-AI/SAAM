---
name: heat-set-inserts
description: Bores for SPIROL Series 19/29 heat-set inserts, metric and imperial, with three hole perimeters and a continuous fourth star perimeter on flat top or bottom insertion faces.
metadata:
  saam-kind: geometry
---

# Heat-set inserts

Prepare heat/ultrasonic insert seats in a closed part, including seats connected to existing through-holes. The initial
[catalog](CATALOG.md) covers 60 unheaded SPIROL Series 19/29 short/long selections,
M2–M8 and 2-56–5/16-18 where offered. These are receiving-hole dimensions, not
thread diameters or negative copies of the metal knurl. Additional families can
be added to [catalog.mjs](scripts/catalog.mjs) with manufacturer provenance.

Use the [standard parameter policy](../../MAKERS.md#standard-parameter-policy).
Existing feature edits retain omitted settings; a new named hole inherits the
previous hole's insert and fin choices in that component. Placement uses its
explicit value or the stated example default, never an invented remembered
position. Cross-print reuse uses actual saved recipe/conversation evidence.

## Public tools

Start with an existing [print bundle](../../core/print/USAGE.md). MCP
`heat_set_catalog` lists the catalog. `apply_heat_set` accepts `printId`, the
current `expectedRevision`, and `request`. The local equivalent is:

```sh
node core/print/cli.mjs heat-set Prints/my-part insert-request.json
```

```json
{
  "feature": {
    "id": "mount",
    "insertId": "spirol-29-m3-long",
    "positionMm": [15, 15, 12],
    "finCount": 12,
    "finLengthFactor": 2
  }
}
```

`positionMm` is the mouth center in component coordinates; `entry: "top"` (default) points the bore down
Z and `entry: "bottom"` points it up Z from the flat insertion face. For an assembly, add `part` with the component
ID. Edit with the same feature ID and only changed fields. Remove with
`{"remove":"mount"}` (plus `part` for an assembly). Geometry changes use the
normal revision and approval invalidation workflow. Show the updated geometry,
settings, and exact toolpath in Studio through the shared tools.

| Field | Default and meaning |
|---|---|
| `id` | `insert`; unique within its feature group |
| `insertId` | `spirol-29-m3-long`; catalog selection |
| `positionMm` | `[15,15,12]`; propose a suitable position for the actual part |
| `entry` | `"top"`; use `"bottom"` for installation from the underside |
| `depthMm` | `null`: insert length plus two thread pitches; explicit depth must fit the insert |
| `diameterAdjustmentMm` | `0`; signed printer/material hole calibration, ±1 mm |
| `finCount` | `12`; 2–24 out-and-back radial excursions in the fourth perimeter |
| `finLengthMm` | `null`; optional explicit ray length measured outward from the fourth perimeter |
| `finLengthFactor` | `2`; ray length as a multiple of receiving-hole diameter when `finLengthMm` is null |
| `finWidthMm` | Retained for saved recipes; the star uses the normal process line width, not a filled rib width |
| `finAngleDeg` | `0`; rotates the fin pattern around the bore |

The request can also set `toleranceMm` (default 0.01, maximum 0.1) for compiled
hole geometry. Dimensions and settings remain editable; regeneration does not
make a physical fit claim.

## Deposition and composition

Each non-solid infill layer within the insert length has **three normal hole perimeters**, then **one
continuous fourth perimeter with 12 out-and-back radial excursions**. The path
follows the fourth offset contour, travels outward along each ray and back to
its departure point, then continues around the hole. This is one closed extrusion
stroke, not separate ribs, scanline-filled gussets, or a fourth print layer.

Solid bottom/top regions, standalone full-fill and 100% infill receive circular
perimeters without rays. The normal solid-surface masks determine where a star
can run; rays never enter a solid-filled region. Reinforcement ends at the
catalog insert length from its insertion face, even when the receiving hole
extends deeper for clearance. Within each hole, the perimeter closest to the
bore prints first, followed by successive outward loops and the fourth star.
The producer preserves this order rather than nearest-path reordering.

Ray length defaults to twice the receiving-hole diameter, measured from the
fourth perimeter. It is constant through the insert length; there is no triangular
height taper. `finLengthMm` overrides the diameter multiplier when supplied.
Ray count and rotation remain editable. The outward and return legs retrace the
same centerline, depositing on both passes as requested.

Rays cross ordinary infill and other stars without clipping or reserving away
the crossing infill. Only the four circular wall bands exclude ordinary fill.
Each ray turns back at the first solid boundary (the exterior or another hole),
with half a bead of clearance for its centerline. Infill and other stars do not
shorten it. The part is not automatically
widened or its holes moved to accommodate the star.

This is a local detail in the shared planar producer, with shared layer heights,
bead volumes, material ownership, travel, composition, machine output, and Studio.
It works with native meshes or supported spline hosts compiled through the shared
solid kernel, named assembly parts, and planar material-region assignments.
Lettering applied over the result preserves the hole details. Other skills can
occupy other compatible regions/components; inserting a hole does not make a
vase or nonplanar-only region acquire six planar loops automatically.

The bore axis is Z with explicit top or bottom entry. Both insertion faces must
be flat; side-entry and inclined axes are not yet implemented. The seat must end
inside the host's height bounds; an existing smaller through-bore may continue
beyond it. For seats spanning touching assembly components, use one joined host
so one feature owns the full seat and its reinforcement. The pattern makes no installed-strength guarantee. Manufacturer dimensions are a starting point; printed fit and
installed strength require physical evidence.

## Reproducible Studio example

```sh
node skills/heat-set-inserts/scripts/demo.mjs Prints/development/heat-set-example
node studio/server.mjs Prints/development/heat-set-example
```

The command refuses an existing bundle. It creates a 54 × 32 × 12 mm block with
an M3 Series 29 long hole and a 4-40 Series 19 short hole, two ordinary perimeter
loops, 15% infill and solid top/bottom surfaces. It generates a development
toolpath without approvals. Review a middle bore layer to see the three loops and
continuous star perimeter before the solid top covers them.
