---
name: heat-set-inserts
description: Add catalog-sized heat-set insert bores with six local wall loops and radial fins connecting their sleeves to the insertion face. Uses shared planar fill, infill, assemblies, and material regions. Includes SPIROL Series 19/29 metric and imperial inserts; insertion faces must be flat and face up in the build orientation.
metadata:
  saam-kind: task
---

# Heat-set inserts

Prepare blind holes for heat/ultrasonic inserts in a closed part. The initial
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
    "finCount": 6,
    "finLengthMm": 4,
    "finWidthMm": 0.8
  }
}
```

`positionMm` is the mouth center in component coordinates; the bore points down
Z from its flat insertion face. For an assembly, add `part` with the component
ID. Edit with the same feature ID and only changed fields. Remove with
`{"remove":"mount"}` (plus `part` for an assembly). Geometry changes use the
normal revision and approval invalidation workflow. Show the updated geometry,
settings, and exact toolpath in Studio through the shared tools.

| Field | Default and meaning |
|---|---|
| `id` | `insert`; unique within its feature group |
| `insertId` | `spirol-29-m3-long`; catalog selection |
| `positionMm` | `[15,15,12]`; propose a suitable position for the actual part |
| `depthMm` | `null`: insert length plus two thread pitches; explicit depth must fit the insert |
| `diameterAdjustmentMm` | `0`; signed printer/material hole calibration, ±1 mm |
| `finCount` | `6`; 2–24 radial ribs |
| `finLengthMm` | `4`; maximum extension beyond the sleeve, at the insertion face |
| `finWidthMm` | `0.8` at the outer tip, twice that at the sleeve joint; nominal width rounded to at least one whole bead |
| `finAngleDeg` | `0`; rotates the fin pattern around the bore |

The request can also set `toleranceMm` (default 0.01, maximum 0.1) for compiled
hole geometry. Dimensions and settings remain editable; regeneration does not
make a physical fit claim.

## Deposition and composition

Each bore layer has **six contiguous loops**, independent of global perimeter
count and spacing factor. Actual section offsets follow the compiled hole.
The radial fins are triangular gussets in vertical section: zero radial reach
at the bore floor, growing linearly to `finLengthMm` at the front insertion face.
Their thickness tapers from twice `finWidthMm` at the sleeve joint to
`finWidthMm` at the outer tip. Layers with less than one bead of radial reach
retain the sleeve alone. Normal solid top layers supply the front face.
Shared scanline fill follows each tapered layer footprint. Fins overlap the sleeve to
weld to it. Shared fill reserves their material, preventing a second interior
deposition pass through the sleeve or fins. Ordinary exterior walls retain their
own settings. Select full-fill or planar-infill with solid surface layers for
the insertion zone.

This is a local detail in the shared planar producer, with shared layer heights,
bead volumes, material ownership, travel, composition, machine output, and Studio.
It works with native meshes or supported spline hosts compiled through the shared
solid kernel, named assembly parts, and planar material-region assignments.
Lettering applied over the result preserves the hole details. Other skills can
occupy other compatible regions/components; inserting a hole does not make a
vase or nonplanar-only region acquire six planar loops automatically.

The current bore axis is Z and the insertion face is flat. Reorient side-entry
parts before preparing them. Blind floors require remaining host material. Six
complete loops and the fins need enough room inside the ordinary exterior walls;
the tool reports insufficient room or conflicting reservations so placement,
fin length, host size, or process choices can be revised. Intersecting reinforced
holes and fins are not merged automatically. Manufacturer dimensions are a
starting point; printed fit and installed strength require physical evidence.

## Reproducible Studio example

```sh
node skills/heat-set-inserts/scripts/demo.mjs Prints/development/heat-set-example
node studio/server.mjs Prints/development/heat-set-example
```

The command refuses an existing bundle. It creates a 54 × 32 × 12 mm block with
an M3 Series 29 long hole and a 4-40 Series 19 short hole, two ordinary perimeter
loops, 15% infill and solid top/bottom surfaces. It generates a development
toolpath without approvals. Review a middle bore layer to see the six loops and
fins before the solid top covers them.
