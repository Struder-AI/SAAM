# Triangular Touchback Pattern

`triangular_touchback` is the perimeterless loop-back kernel. Use it when the
operator wants closed triangular cells and explicitly does not want inner or
outer skins.

## Topology

Build one continuous circuit from alternating boundary portions and diagonal
touchbacks:

```text
outer boundary forward
-> diagonal to inner side
-> inner boundary forward
-> retreating diagonal to outer side
-> repeat
```

The forward and retreating diagonals form the closed cell. On circular guides,
boundary portions are concentric arcs; on straight guides they are lines.

Do not add bounding perimeters, independently printed skins, or perimeter
allocation to this kernel. If walls are requested, select `walled_truss` and
read `walled-truss.md`.

## Parameters

- `guide_curve`
- `envelope_width`
- `target_outer_apex_angle`, default `90 degrees`
- `repeat_count`, chosen as a closing integer after envelope resolution
- `layer_phase_rule`; circular guides may use half-repeat A/B alternation, but
  sharp rectangular boxes default to a fixed repeated phase
- `first_pattern_speed`, normal/fast
- `later_pattern_speed`, half of first-pattern speed unless otherwise tested
- optional explicit rounded touchback strategy

## Geometry

Treat the requested width as the complete patterned envelope. Choose the
integer repeat count whose outer diagonal apex is closest to 90 degrees while
closing the guide exactly. Report actual repeat interval and apex angle.

If rounded touchbacks are requested, preserve both diagonals and validate the
rounded couching contact numerically. Do not reuse any fillet or repeat count
from a differently sized envelope.

### Sharp rectangular corners

Do not wrap, round, or continuously bend `triangular_touchback` around a
rectangular corner. Preserve the ordinary straight-side unit cycle and use the
same fixed corner sequence on every layer.

The inner corner is always the three-touch node. Approaching the corner on the
inner boundary, execute this exact ordering:

```text
inner corner
-> previous whole-pitch outer node
-> outer corner
-> inner corner
-> adjacent touching return to outer corner
-> next whole-pitch outer node
-> inner corner
-> next inner node
-> continue the ordinary side cycle
```

The direct `outer corner -> inner corner` stroke and the return
`inner corner -> outer corner` stroke are two adjacent, parallel couching
paths, not one exact retrace. Derive their centerline spacing from the current
touching-line calibration. With the current 0.83 mm bead and 0.78 mm touching
spacing, the pair has about 0.05 mm physical overlap.

Do not create a phase B that exchanges inner and outer roles. The closed-box
corner is not topologically symmetric under that swap without warping or
omitting a cell. Stack the same phase, nodes, arrows, and corner treatment on
every layer unless the operator explicitly requests another experiment.

On every straight side, retain the normal ordered cycle:

```text
outer boundary forward
-> diagonal back to the previous inner node
-> inner boundary forward
-> diagonal back to the same outer node
-> outer boundary forward
```

Choose the integer interval count for each finished side independently. Use one
constant physical pitch on the complete side. Place outer nodes at whole-pitch
positions including both outer corners. Place inner nodes at half-pitch
positions, so the first inner node is the inner corner halfway between the
outer corner and the next outer node. The inner side therefore contains one
fewer pitch interval than the outer side. This makes all cells on that face
congruent and makes the final ordinary diagonal land at the inner corner before
the couched return. Choose the closing integer whose isosceles apex is nearest
90 degrees.

Never place both inner and outer nodes at the same normalized fraction or put
an outer node at half-pitch. Either construction creates unwanted perpendicular
cross-wall strokes and visibly warps the repeated triangles.

**OPERATOR-APPROVED GEOMETRY / EXPERIMENTAL MOTION — 2026-08-31:** for the
100 × 150 mm sharp rectangular test, use five equal X-face intervals and eight
equal Y-face intervals. Repeat this same fixed phase helically on every circuit.
The generated mouse-ear program remains untested until a physical run confirms
corner couching, cell stacking, controller continuity, and adhesion.

Exact congruent closure, exact exterior size, and an independently fixed wall
thickness may be overconstrained. Never hide that mismatch by fractionally
scaling the two boundaries, because that progressively warps the triangles.
Keep the exterior dimension authoritative, derive the congruent inner-node
line from half-pitch, report the resulting wall-envelope deviation, and obtain
operator approval before Lua generation. Do not shorten cells into half-cells,
add a perpendicular cross-wall stroke, or omit either diagonal.

## Layer behavior

- Use a conventional foundation when required for bed adhesion.
- Print the first patterned layer at normal/fast speed.
- Print later patterned layers at half speed unless the operator specifies a
  different tested schedule.
- For sharp rectangular boxes, repeat the same fixed phase on every layer.
  Do not alternate inner/outer corner roles.
- Keep extrusion enabled continuously through the connected model path.

## Robot evidence

- **ROBOT-CONFIRMED / PARTIAL SUCCESS** — The unbounded two-layer triangular
  test connected its intended endpoints.
- **ROBOT-CONFIRMED** — The 60 mm unbounded specimen printed successfully and
  its apexes remained connected.
- **ROBOT-CONFIRMED / DIAGNOSIS** — Sharp reversals caused blobs and slow
  effective motion. `CP=1` did not remove the slowdown.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — The stacked-ring phase connector caused
  a migrating missing-touchback feature. Do not use that connector as a
  default helical strategy.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — Attempts to combine this kernel with
  bounding perimeters produced repeated concentricity, couching-gap, seam, and
  controller-alarm failures. Those bounded artifacts remain historical test
  evidence, not an approved generation method.

## Validation

- Preview the exact commanded primitives after calibration.
- Reject partial final cells and missing retreating diagonals.
- For rectangular boxes, verify the arrow order at all four corners and count
  three visits to every inner corner on every layer.
- Verify that every corner has exactly one adjacent couching pair between its
  inner and outer nodes and that neither member is an exact centerline retrace.
- Reject unsafe `Arc3` geometry and discontinuities.
- Confirm one continuous extrusion window.
- Treat rounded variants as experimental until physically tested.
