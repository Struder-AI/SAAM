---
name: line-network
description: Sparse planar frames and trusses from explicit centerline polylines, with per-layer reinforcement strokes; fills no enclosed area.
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
