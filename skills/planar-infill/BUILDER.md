# Planar-infill implementation

Sparse and solid composition, construction and scoped regression evidence.
The [skill manual](SKILL.md) owns user settings and limits.

## Planar-infill design

[Planar-infill](SKILL.md) supplies walls and rectilinear,
grid, triangles, concentric or gyroid interiors. Full-fill `mode: solid-surfaces` supplies
local top/bottom solid masks by comparing neighboring sections. Sparse/solid
interiors are complementary; walls have one owner and each layer's supporting
operations precede the next. The shared region booleans handle coincident
sections and collinear edges. Drape reservation clips both planar patterns.

Zero infill density emits no sparse interior strokes for any pattern while
preserving planar walls and selected solid masks. Positive density remains
limited to 0.01–1. A hollow vessel can use positive perimeters, bottom solid
layers and zero top layers, including supported concave sections. It has ordinary
layer seams and travels; vase-wall's continuous-stroke and single-inset-loop
requirements do not apply. Solid masks on changing sections retain their existing behavior.
Software checks cover zero-infill walls/base, open tops, flat depositing moves
and interpreted S5/H2D output on both mesh and spline geometry.

The 20-layer box regression verifies three solid bottom/top layers, fourteen
sparse layers, and one set of walls per layer across both backends/machines.
A sloping roof regression checks local solid regions. Bridge optimization remains
unimplemented; solid beads above sparse infill are
an approximate deposition model, not validated physical bridges.

The infill callback returns open/closed interior strokes to the same full-fill
producer; closed concentric interiors retain fill ownership. Solid-surface
settings, masks, drape reservations and consumed lower surfaces are unchanged.
The level-set contour joiner indexes segment starts spatially,
preserving its distance tolerance, tie order and closed-loop output. The
[gyroid measurement](../../DEVLOG.md#2026-09-10--gyroid-contour-construction-measurement)
records the bounded construction cost and density calibration. The manual owns
pattern limits; benchmark current inputs for current timing claims.
