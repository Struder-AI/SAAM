---
name: line-network
description: Experimental. Sparse planar frames and trusses from explicit centerline polylines, with per-layer reinforcement strokes; fills no enclosed area.
---

# Line network

Use a `construction: "curves"` assignment in `plan.slices.assignments` for sparse
frames, trusses and line text. Each supplied centerline receives one bead. This
record is Trace input in the target architecture; this manual describes the
current assignment schema.

Each assignment has `id`, `construction`, `filament: null`, `after: []`,
`repeat: null` and `curves`. Each curve has `closed` and finite XYZ `points`;
XY is relative to plan placement. Use separate assignments for independent
grids. `repeat: {count, translation: [x,y,z]}` repeats one grid; optional curve
`courses` selects its zero-based repetitions. Author the initial Z explicitly.
Curves may override `beadWidthMm`, `heightMm`, `speedMmS`, `flowMultiplier` and
`role`; defaults come from process. Bounds include half the bead width in XY.

Shared placement and deposition preserve the grid and supplied seam.
No solid or fill is inferred. Junction reinforcement,
routing and physical welding remain design and print-validation responsibilities.
