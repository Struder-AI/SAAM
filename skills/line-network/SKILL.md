---
name: line-network
description: Experimental. Sparse planar frames and trusses from explicit centerline polylines, with per-layer reinforcement strokes; fills no enclosed area.
---

# Line network

Prints explicit planar centerline networks as one deposited bead per supplied
polyline. Use it for sparse frames, trusses, wire-like panels and other designs
whose intended geometry is the path itself rather than a filled solid.

`networks` contains independent named groups. Each group is printed as a unit on
each layer. A stroke has `closed` and finite 2D `points`; closed strokes are
closed by the generator. An optional `layers` array selects the zero-based
courses that receive that stroke. Without it, the stroke repeats on every
course. Global `layers` sets the course count at the ordinary planar layer
pitch. Bead width, layer heights, speed and flow come from `process`. Placed
centerlines, widened by half a bead, must stay inside the selected tool's
bounds; generation rejects a network that leaves them.

This is an explicit experimental path skill. The supplied centerlines own the
result; it does not infer junction reinforcement, Euler routing or structural
adequacy. Intersections must overlap geometrically, and physical welding between
crossing beads remains a print-validation responsibility.

## Networks on their own layer grids

A network may carry its own `layers` (course count) and `process`, with any of
`firstLayerMm`, `layerMm`, `lineWidthMm`, `planarSpeedMmS` and `firstLayerSpeedMmS`,
so one print can hold fine and thick lines. Its override is validated as if the whole
print used it, so machine, layer and width limits apply to that network unchanged; a
network without one uses the plan process. A stroke's `layers` count against its own
network's course count.

Courses print by ascending deposition height. Where courses of different networks
share a height, the finer layer goes first, so a thick line's single course follows the
several fine courses beneath it. Heights that coincide across grids are treated as
equal (to a millionth of a millimetre). Each course's `layer` is the height's place among
all course heights in the print, the same for every network. The minimum layer time
applies to each distinct height, so a print with many close heights waits at each of them
unless `minimumLayerSeconds` is lowered.

## A network does not choose its own nozzle

A single `line-network` selection always prints on `plan.setup.tool`, whatever process it uses per network
(see above). There is no per-network `tool` field: an item is `{id, strokes}`, plus the optional `layers` and
`process` above. That was tried and retired; it does not compose with how the rest of SAAM assigns nozzles
and filaments (`core/machine/filaments.mjs`, `core/export/bambu.md`).

To print on two nozzles or two colours, use two **composition regions**, each its own `line-network` selection
(see [the print composition reference](../../core/print/USAGE.md) for the general mechanism). Give the job an
`assembly` geometry with one placeholder part per region — line-network does not consume its part's actual
shape, only its own strokes, so a plain flat box big enough to hold them is enough. Each region names its own
`filament` (into `plan.setup.bambu.filaments`, which is where the nozzle and colour actually come from), a
`zStartMm`/`zEndMm` span, and `skills: {'line-network': {layers, networks}}`. A region may not combine
`line-network` with another region skill. A region that starts above its part's own base needs either
`lowerSurfaceFrom` (an earlier region on a different part, ending exactly where this one starts) or to share
its part with a region that ends there; each region's own course numbering is folded into the job's shared
layer index automatically, so heights never collide between regions in the exported metadata.

Nozzle switching and same-nozzle colour changes are otherwise ordinary: the H2D's proven contract
([`core/export/bambu.md`](../../core/export/bambu.md)) decides what a job may do, same as for any other
skill placed in regions. See `skills/line-text/scripts/panel.mjs`'s `panelPatch` for a complete worked example
(a background region and a lettering region, different nozzles, different colours, the lettering starting
where the background ends), and `core/tests/line-network-regions.test.mjs` for the mechanism's own tests.
