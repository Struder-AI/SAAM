---
name: gridfinity
description: gridfinity
metadata:
  saam-kind: geometry
---

# Gridfinity

Create parametric open bins, solid blanks for custom inserts, and baseplates: a
closed material mesh with its editable construction recipe. Setup, Studio review
and delivery follow the usual [print tools](../../core/print/USAGE.md). The short
frontmatter is intentional: shared discovery contains only the name.

## Create and edit

The `gridfinity` tool creates an unapproved print:

```json
{
  "bundleId": "organizers/small-bin", "action": "create", "machineId": "ultimaker-s5",
  "parameters": {"kind": "bin", "xUnits": 2, "yUnits": 1, "heightUnits": 3, "compartmentsX": 2}
}
```

To edit, call it with `action: "update"`, `bundleId`, `expectedRevision` and a
partial `parameters` object; omitted parameters stay as saved. Omit `machineId`
on updates, and supply `part` with the component id for an assembly. Updates
change existing gridfinity geometry only: create another print to change between
bin, blank and baseplate. Wrong fields, incompatible settings, stale revisions,
mesh failures and machine-bound violations are rejected before saving, and
`create` never overwrites a print. Dimension edits invalidate geometry and
settings/toolpath confirmations; `adjust_recipe` on the baked mesh or parameters
is rejected unless it supplies a complete newly compiled record.

## Parameters

All lengths are millimetres; counts are integers. Fields for another kind are
rejected.

| Common setting | Default | Meaning / supported range |
|---|---|---|
| `kind` | `bin` | `bin`, `blank`, `baseplate`. |
| `xUnits`, `yUnits` | 1, 1 | 1–8 cells per direction on 42 mm centres; the machine must fit the placed result. |
| `toleranceMm` | 0.03 | 0.005–0.1 mm chord deviation of the circular arcs; not a mating clearance. |

| Bin setting | Default | Meaning / supported range |
|---|---|---|
| `heightUnits` | 3 | 2–20; nominal shoulder height is `7 * heightUnits` above the foot bottom. |
| `wallMm` | 1.2 | 0.8–2.5 mm side and divider thickness. |
| `floorMm` | 2.25 | 1–5 mm above the 4.75 mm foot (default cavity floor at Z = 7 mm); at least 3.8 mm must remain below the shoulder. |
| `compartmentsX`, `compartmentsY` | 1, 1 | 1–16 equal compartments per direction, each at least 4 mm clear. |
| `stackingLip` | `true` | Supported rim and mating recess, adding 3.8 mm to nominal height; `false` gives a plain rim. |
| `magnetHoles` | `false` | Four downward 6.5 × 2.4 mm pockets per cell on 26 mm centres for 6 × 2 mm magnets; retention is not guaranteed. |

Blanks take `heightUnits` (default 1, range 1–20) and `magnetHoles`: feet and a
solid body up to nominal height, without cavities or rim. Baseplates take
`floorMm` (default 1.2, range 0–5), the backing under the sockets; zero is an
open frame, and plate height is `floorMm + 4.75`. Baseplates have no magnet pockets.

## Dimensions and fit

Bin and blank footprints are `42 * units - 0.5`, with local minimum X/Y 0.25 and
cell centres at `(21 + 42*i, 21 + 42*j)`; plates occupy the full `42 * units` from
zero. Geometry begins at Z = 0 and new prints propose placement X/Y = 20 mm;
large grids can exceed a machine's bed. The dimensions target conventional
gridfinity mating geometry ([construction](BUILDER.md#dimensions)), but physical
fit, magnet retention and stacking are untested and variants exist: print a small
fit sample before a large organizer. No shrink compensation is applied.

## Composition with SAAM

Creation keeps the default [slice](../slice/SKILL.md) (two loops, 20% fill,
three solid layers top and bottom), so solid layers close the floor and wall tops
without capping the bin. It is an editable proposal, not a validated recipe;
inspect thin walls, dividers, foot joins and pockets. Other slice assignments,
regions and assemblies work as for any mesh.

Use [text](../text/SKILL.md) for lettering on the floor, walls or a blank: a plane
at Z = 7 reaches the default bin floor. Text features are rebuilt after a
gridfinity edit with their fonts, but their coordinates don't move: move them
when resizing or changing floor height. Underside lettering stays within one
foot's flat bottom, on a downward-facing plane at Z = 0, clear of the bevels and
magnet pockets; 0.4 mm recess is a starting point. See
[circular underside lettering](../text/SKILL.md#circular-underside-lettering) for a ring.

For a custom upper body, place a blank and the body in an assembly and select
skills by component. A one-unit blank ends at Z = 7 mm; align the interface with
the layer grid. The assembly doesn't union intersecting components, so give them
distinct extents and check contact and operation order.

Vase-wall and draped-skin keep their restrictions: feet, cavities, dividers and
ledges form no single vase or single roof. Review bridges above pockets and
between feet, and assign supports explicitly when appropriate.

<!-- requires: coordinated-rotary -->
### Cladding a vase body

A vase body can publish its exterior to
[finished-surface cladding](../pipe-cladding/SKILL.md#select-the-sleeve): select
the body for both vase-wall and cladding, slice the blank solid, and
keep the cladding away from the mating foot. The body still needs supported
sections and a valid cladding chart, and cladding needs the configured DENSO
robot with its external rotary.

<!-- layer: script -->
## Command line

The same parameters object, in a JSON file:

```sh
node skills/gridfinity/scripts/cli.mjs create Prints/small-bin parameters.json --machine ultimaker-s5
node skills/gridfinity/scripts/cli.mjs update Prints/small-bin changes.json --revision REVISION [--part ID]
```
