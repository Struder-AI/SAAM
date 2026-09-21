---
name: line-network
description: Print sparse planar frames and trusses directly from explicit centerline polylines, including layer-specific reinforcement strokes, without filling their enclosing area.
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

## Networks on their own nozzle, above a base

A network may name its own nozzle with `tool: {index, core, nozzleMm, color}` (`color` is an optional `#RRGGBB` for
that nozzle's filament in the exported package; on the H2D, index 0 is the left nozzle and 1 the right) and a `baseMm`, the height its first course starts above the bed. The nozzle is checked
as if the whole print used it, with the network's process, so that nozzle's own bead-width and layer limits
apply: a 0.35 mm bead is allowed on a 0.4 mm nozzle and refused on a 0.6 mm one. Courses above a base use the
network's layer height throughout and the planar speed, and lettering can sit on material another nozzle laid
down. A network's strokes are held to the reach of its own nozzle, not the recipe's placeholder shape.

When any network names a nozzle, every operation names one; the composer keeps one nozzle's work together
within a height, and the path records a `tool` action (`fromTool`, `toTool`, and the lift and entry position the
machine's change sequence uses) where the nozzle changes, followed by prime strokes on the machine's purge pad and
heater actions that bring the next nozzle up to temperature in time. **A job that changes nozzles can be exported only
when the machine declares a validated nozzle-change sequence and both nozzles have the same diameter.** The H2D
declares one for 0.4 and 0.6 mm nozzles ([the output contract](../../maps/reference/bambu.md#nozzle-changes-and-mixed-nozzle-diameters));
mixed diameters are refused at export. Keep the part clear of the purge pad at the back of the bed (a job that comes
within 3 mm of it is refused). No such print has been made yet; the first must be supervised.
