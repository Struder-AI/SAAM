# Walled Truss Pattern

Use `walled_truss` when a thick patterned wall needs one or more independent
inner and outer skins. Fill the remaining envelope with one continuous
alternating zig-zag; do not add the retreating edge that closes each triangle.

## Parameters

- `guide_curve`: centerline of the requested wall.
- `total_envelope`: deposited width including every skin and the truss core.
- `inner_wall_count`, `outer_wall_count`: independently requested counts.
- `line_spacing`: default `0.78 mm` until recalibrated.
- `bead_width`: measured `0.83 mm` reference.
- `target_outer_apex_angle`: default `90 degrees`.
- `turn_radius`: default `2.0 mm` at inner and outer zig-zag vertices.
- `tie_in_overlap`: default `50%` of measured bead width (`0.415 mm` for the
  current `0.83 mm` bead), providing cooling-contraction allowance.
- `phase_rule`: shift by half one repeat on every neighboring layer.
- `first_pattern_speed`: normal/fast pattern speed.
- `later_pattern_speed`: half of first-pattern speed.
- `pattern_multiplicity`: `single` or `double`; require the operator to choose
  when intent is unclear.

## Single and double patterns

Treat pattern multiplicity as a first-order option for every zig-zag/truss
variant.

- `single`: repeat one fitted zig-zag geometry on every layer. Print every
  infill move at normal pattern speed because every feature is supported and
  refreshed on every layer.
- `double`: alternate complementary A/B zig-zags. Place every B boundary vertex
  exactly halfway between the corresponding neighboring A boundary vertices.
  Print every infill move at half normal pattern speed because each phase is
  deposited only on every other layer. Keep perimeter speed unchanged.
- Do not infer `double` merely from alternating layers; encode multiplicity
  explicitly in parameters and previews.
- For open straight walls, use `double` when both opposing corner conditions
  must be supported across the two-layer cycle. A single phase can privilege
  only one corner condition unless its fitted parity happens to satisfy both.
- For closed rectangular boxes, a single phase can support all four corners by
  using one shared 45-degree spoke from each outer corner to its corresponding
  inner corner. Do not retrace that spoke for both adjacent sides. `double`
  remains available to increase truss density. On phase B, omit the phase-A
  corner spokes. Phase-shift the boundary vertices by half a local repeat, then
  connect the ends of adjacent side patterns across the phase-A corner-spoke
  footprint. The phase-B connector must cross/tie into the supported spoke
  below; it need not land on either corner vertex.

## Derive geometry from scratch

Recalculate every dependent value whenever guide size, envelope, spacing, wall
count, turn radius, or overlap changes:

```text
requested deposited envelope
-> allocate inner and outer skin centerlines at line_spacing
-> derive remaining truss boundary curves
-> reject non-positive or turn-radius-incompatible core width
-> evaluate closed integer repeat counts
-> construct 2 mm tangent turnarounds with requested wall overlap
-> select the count whose executed outer apex is closest to 90 degrees
-> generate both layer phases from the same canonical moves
```

Treat the envelope as inclusive of skins. Never reuse a repeat count from a
different perimeter allocation.

## Path topology

For each repeat, traverse:

```text
outer turnaround tangent to outer truss boundary
-> straight diagonal to inner turnaround
-> inner turnaround tangent to inner truss boundary
-> straight diagonal to the next outer turnaround
```

This is one zig-zag circuit. It is not a closed triangular cell: there is no
second retreating diagonal and no loop-back feature.

Print requested outer and inner skin circuits as separate but continuously
connected contours. Alternate contour order by layer:

```text
layer A: outer skin(s) -> zig-zag -> inner skin(s)
layer B: inner skin(s) -> zig-zag -> outer skin(s)
```

Keep the Struder enabled through the complete connected path and between
layers. Use deliberate printed seam transitions; never cycle extrusion.

## Tangent wall tie-in

Each 2 mm turnaround must be tangent to its two adjacent diagonal legs. Extend
the virtual sharp zig-zag vertex until the reconstructed controller arc reaches
into the neighboring skin by `tie_in_overlap`.

Use deposited centerline separation:

```text
desired centerline separation = bead_width - tie_in_overlap
```

The current robot-requested baseline is `0.83 - 0.415 = 0.415 mm`. Validate the minimum distance
from every reconstructed turn arc to its neighboring skin. Do not infer contact
from ideal work-coordinate geometry alone.

If the 2 mm arc cannot fit while remaining tangent and meeting the wall
overlap, increase the core width or change the repeat count. Never silently
reduce the radius.

## Repeat selection and layer behavior

Evaluate integer counts that close the guide. Calculate outer apex angle from
the extended virtual diagonal intersection required by the 2 mm tangent arc,
not from an unrounded nominal zig-zag. Choose the feasible count closest to 90
degrees and report its actual angle and repeat interval.

- In `single` mode, print all zig-zag diagonals and turns at normal pattern
  speed and repeat the same geometry every layer.
- In `double` mode, print all A and B zig-zag diagonals and turns at exactly
  half normal pattern speed. Alternate A/B by layer; advance the traversal seam
  forward rather than reversing to an earlier seam.
- Keep skins at their normal requested boundary speed.

## Open straight-segment walled truss

For a straight bounded wall, treat the operator's dimensions as the finished
deposited exterior by default and treat that rectangle as one closed
perimeter with two long boundary runs and two end caps. The truss crosses
between the two long runs. It must begin at one inside corner and terminate at
either far inside corner; never leave a partial final leg.

Define:

```text
L = usable inside-corner-to-inside-corner truss length
H_touch = separation between the required long-wall tie-in targets
n = integer diagonal-leg count
d = L / n
r = requested or automatically selected tangent-turn radius
```

Do not use total outside rectangle length as `L` without subtracting the end
boundary allocation. Derive `L` after perimeter count, bead width, end caps,
and tie-in overlap are finalized.

For each integer `n`, reconstruct the tangent turns instead of evaluating the
unrounded sharp zig-zag. The turnaround arc, not its discarded virtual vertex,
must reach the wall tie-in target. Numerically solve the virtual-apex separation
`H_virtual`:

```text
beta = 2 atan(d / H_virtual)              # included virtual apex angle
q = r * (csc(beta / 2) - 1)              # virtual extension per boundary
H_virtual = H_touch + 2q
delta = 180 degrees - beta                # executed direction change
tangent_setback = r * tan(delta / 2)
diagonal_length = hypot(d, H_virtual)
straight_remainder = diagonal_length - 2*tangent_setback
arc_chord = 2r sin(delta / 2)
```

Reject a candidate if the fixed-point solution does not converge, the tangent
arcs overlap, `straight_remainder` is less than one measured bead width, the
arc chord is less than one measured bead width, or reconstructed controller
geometry fails the standard `Arc3` gates. Among feasible integer counts, choose
the one whose reconstructed `beta` is closest to 90 degrees. Odd `n` ends at
the opposite far corner; even `n` ends at the same-side far corner. Both are
valid unless the object imposes a side preference.

### Automatically scaled straight-wall turnaround

Use an explicitly requested radius when feasible. Otherwise start with:

```text
preferred_radius = min(2.0 mm, 0.30 * H_touch)
```

Search integer leg counts and validate the reconstructed tangent geometry. If
no count is feasible, reduce radius while reporting the actual value; never
reduce it silently. Stop and reject the geometry before `arc_chord` falls below
one bead width or controller-coordinate arc validation fails. Do not replace an
infeasible native arc with dense short `MovL` segments.

For a requested finished exterior length of 30 mm, finished width of 5 mm, one
0.83 mm perimeter bead, 0.415 mm overlap, and requested 1 mm turns:

```text
L = 30.00 - 2(0.83) = 28.34 mm
H_touch = 5.00 - 0.83 - 2(0.415) = 3.34 mm
n = 7 diagonal legs
d = 28.34 / 7 = 4.0486 mm
H_virtual = 4.2339 mm
reconstructed apex angle beta = 87.44 degrees
straight remainder per diagonal = 3.77 mm
arc chord = 1.445 mm
```

This is the closest feasible reconstructed apex to 90 degrees for that example.
Layer A starts at the upper-left tie-in and ends at the lower-right tie-in;
Layer B reverses phase, starts lower-left, and ends upper-right. A requested
height is likewise a finished exterior height; derive layer count and actual
rise schedule to land as closely as the calibrated layer-rise process permits,
and report any unavoidable quantization before generating Lua.

## Validation gates

- Reconstruct every `Arc3` after `P()` calibration.
- Reject non-tangent joins, missed wall overlap, self-intersections, and
  envelope excursions.
- Reject near-collinear `Arc3` triples, tiny chords, extreme reconstructed
  radii, unsafe sweeps, and discontinuities.
- Verify the integer circuit closes without a partial final zig-zag.
- Preview skin order, zig-zag direction, phase A/B, wall tie-ins, and seam
  transitions from the exact Lua move list.

## Robot evidence

- **ROBOT-CONFIRMED / KNOWN FAILURE** — A bounded loop-back-triangle approach
  repeatedly produced concentricity errors, separated couching vertices, and
  unsafe seam arcs. Keep that topology out of this kernel.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — `0.05 mm` wall overlap did not attach
  the tangent turnarounds reliably to the skins.
- **ROBOT-CONFIRMED / SUCCESSFUL ENDPOINT — 2026-08-04** — The 60 mm guide
  diameter, 8 mm inclusive envelope ring printed successfully with one inner
  and one outer skin, 8 closed repeats, 2 mm tangent turns, `0.415 mm` overlap
  (50% of the measured bead), an `89.18 degree` executed outer apex, and a
  forward half-repeat seam advance. Preserve this as the scaled reference.
- **EXPERIMENTAL** — The 80 mm OD, 56 mm ID, 12 mm envelope, 80 mm tall cup
  combines a nine-layer closed base with 106 walled-truss layers. It passes
  software validation but has not been physically tested.

Scale new geometry from scratch; robot confirmation of the reference ring does
not validate a changed diameter, envelope, repeat count, height, or base.
