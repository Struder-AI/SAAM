---
name: heat-set-inserts
description: Add catalog-sized heat-set insert bores with four local wall loops and ribs that tie those loops to the surrounding infill, an optional lead-in chamfer, and blind or through-hole depth from either flat exterior face. Uses shared planar fill, infill, assemblies, and material regions. Includes SPIROL Series 19/29, CNC Kitchen, and one McMaster-Carr selection, covering metric M2–M10 and imperial 2-56–1/2"-13; insertion faces must be flat and normal to Z.
metadata:
  saam-kind: task
---

# Heat-set inserts

Prepare holes for heat/ultrasonic inserts in a closed part. The initial
[catalog](CATALOG.md) covers 60 unheaded SPIROL Series 19/29 short/long selections
(M2–M8, 2-56–5/16-18), 25 CNC Kitchen selections (M2–M10, 2-56–3/8-16), and one
McMaster-Carr selection (1/2"-13) — the largest fractional size either verified
source publishes. Neither source publishes an M12 heat-set-for-plastic insert, so
none is included. These are receiving-hole dimensions, not thread diameters or
negative copies of the metal knurl. Additional families can be added to
[catalog.mjs](scripts/catalog.mjs) with manufacturer provenance.

**Anti-spin/pull-out treatment applies to every insert**: four local wall loops
surround the bore, and ribs run from those loops out into the host to the exterior
walls, so a low-perimeter, sparse-infill host cannot let the whole hole break away
from the infill. The loops and ribs ignore the part's own perimeter and infill
settings. Where the catalog publishes a minimum wall thickness
(`minWallThicknessMm`), at least that much host material must surround the bore;
move the hole, enlarge the part or choose a smaller insert if it does not.

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
    "finLengthMm": 10
  }
}
```

`positionMm` is the mouth center in component coordinates, on the flat exterior
face the insert is pressed in from. By default (`insertionSide: "top"`) the bore
points down Z from that face; `insertionSide: "bottom"` bores up Z instead, from
the host's flat lowest exterior face — ask which face a through-hole is actually
being pressed in from before choosing this, since the chamfer (if any) and the
rib start and the solid floor both key off that face, not the geometric top. For an assembly,
add `part` with the component ID. Edit with the same feature ID and only changed
fields. Remove with `{"remove":"mount"}` (plus `part` for an assembly). Geometry
changes use the normal revision and approval invalidation workflow. Show the
updated geometry, settings, and exact toolpath in Studio through the shared tools.

| Field | Default and meaning |
|---|---|
| `id` | `insert`; unique within its feature group |
| `insertId` | `spirol-29-m3-long`; catalog selection |
| `positionMm` | `[15,15,12]`; propose a suitable position for the actual part |
| `insertionSide` | `top`; or `bottom` to bore up from the host's flat lowest face instead |
| `throughHole` | `false`; `true` needs only the insert length (no floor), and must reach the opposite exterior face |
| `depthMm` | `null`: insert length plus two thread pitches (blind) or exactly the insert length (through); explicit depth must fit the insert |
| `diameterAdjustmentMm` | `0`; signed printer/material hole calibration, ±1 mm |
| `chamferDepthMm` | `0` (no chamfer); 0–5 mm lead-in bevel at the insertion mouth only — see the note below before enabling it |
| `chamferAngleDeg` | `45`; bevel angle from the bore axis when `chamferDepthMm` is set |
| `finCount` | `null`: one rib per 2 mm of bore perimeter, rounded up (13 for an 8 mm hole); or an integer 2–64 |
| `finLengthMm` | `10`; rib length beyond the loops. A rib stops early at the exterior perimeters, another hole or earlier reinforcement |
| `finAngleDeg` | `0`; rotates the rib pattern around the bore |

The request can also set `toleranceMm` (default 0.01, maximum 0.1) for compiled
hole geometry. Dimensions and settings remain editable; regeneration does not
make a physical fit claim.

**Chamfer note**: sources disagree. A small 0.5 mm × 45° lead-in is a commonly
cited way to help center an insert before heat is applied ([Markforged](https://markforged.com/resources/blog/heat-set-inserts),
[Meshra](https://meshra.ai/blog/heat-set-inserts-3d-printing)); CNC Kitchen's own
guidance is that FDM holes should stay straight with no chamfer at all ([Tips &
Tricks for Heat-Set Inserts](https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts)).
The default is `0` (no chamfer, matching the straight-hole recommendation and
every existing example); set `chamferDepthMm` explicitly when a maker asks for
one or reports alignment trouble.

## Deposition and composition

Each bore layer has **four contiguous loops**, independent of global perimeter
count and spacing factor. Actual section offsets follow the compiled hole.
The outer three are plain rings. The fourth is one continuous closed path that
also carries the ribs: at each rib position it leaves the ring, runs straight
out and straight back as two touching beads (twice the line width), and rejoins
the ring, so the ribs are long tendrils of the last perimeter with no separate
starts or stops. Ribs are spaced at most 2 mm apart along the bore perimeter,
so larger holes get more of them. Each is `finLengthMm` (10 mm) beyond the loops
and is shortened where it would meet the exterior perimeters, another hole or
earlier reinforcement, ending against that wall to tie the hole into it. Ribs
have the same length at every layer and run the full bore length, but only
through layers the infill leaves sparse: with solid surfaces they begin at the
last solid layer below the insertion skin, and any solid layer prints the last
loop as a plain ring. Sparse infill is kept out of the bore and loops only; its
lines run straight over the ribs, so the two overlap and lock together. A
**blind** hole's closed end gets solid layers (the surface top/bottom layer count)
at least as wide as the ribs, so ribs never end over sparse infill; a through-hole
has none. Ordinary exterior walls retain their own settings. Select full-fill or
planar-infill with solid surface layers for the insertion zone.

This is a local detail in the shared planar producer, with shared layer heights,
bead volumes, material ownership, travel, composition, machine output, and Studio.
It works with native meshes or supported spline hosts compiled through the shared
solid kernel, named assembly parts, and planar material-region assignments.
Lettering applied over the result preserves the hole details. Other skills can
occupy other compatible regions/components; inserting a hole does not make a
vase or nonplanar-only region acquire planar loops automatically.

The current bore axis is Z and the insertion face is flat. Reorient side-entry
parts before preparing them. `insertionSide: "bottom"` still requires that flat,
Z-normal face to be the host's actual lowest exterior point; a part with a
lower feature elsewhere is not supported. Blind floors require remaining host
material; `throughHole` instead requires the bore to reach the opposite exterior
face, with no floor. The four loops need enough room inside the ordinary
exterior walls, and, where the catalog entry publishes one, the manufacturer's
minimum wall thickness must surround the bore; the tool reports insufficient
room or conflicting reservations so placement, host size, or process choices can
be revised. Ribs are shortened, not rejected, when they meet a wall. Intersecting
reinforced holes are not merged automatically. Manufacturer dimensions are a
starting point; printed fit and installed strength require physical evidence.

## Reproducible Studio example

```sh
node skills/heat-set-inserts/scripts/demo.mjs Prints/development/heat-set-example
node studio/server.mjs Prints/development/heat-set-example
```

The command refuses an existing bundle. It creates a 54 × 32 × 12 mm block with
an M3 Series 29 long hole and a 4-40 Series 19 short hole, two ordinary perimeter
loops, 15% infill and solid top/bottom surfaces. It generates a development
toolpath without approvals. Review a middle bore layer to see the four loops and
ribs before the solid top covers them.
