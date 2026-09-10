# Patterned Wall Geometry

## Baseline

- Measured bead width: `0.83 mm`
- Nominal layer rise: `0.70 mm`
- Robot print speed: `3`
- Corner/continuous-path baseline: `CP = 1`
- Fixed Struder feed means path-length multiplier is also a first-order
  material-per-guide-length multiplier.

## Local guide frame

For an arc-length guide `C(s)`, unit tangent `T(s)`, and selected unit normal
`N(s)`, construct:

```text
P(s) = C(s) + u(s) T(s) + v(s) N(s)
```

### Sine weave

```text
u(s) = 0
v(s) = A sin(2 pi s / lambda + phase)
envelope width = bead width + 2A
```

This pattern does not intentionally self-cross and is the conservative
patterned-wall baseline.

### Prolate trochoid

Let repeat interval `lambda = 2 pi r` and tracing radius `d`:

```text
theta = s / r + phase
u(s) = -d sin(theta)
v(s) =  d cos(theta)
envelope width = bead width + 2d
```

`d > r` produces loops. `d = r` produces a cycloidal cusp. `d < r` produces a
non-looping curtate wave. Numerically calculate the patterned path length;
do not approximate deposited density from transverse width alone.

## Closed guides

For guide length `L`, choose integer repeat count `n`:

```text
actual repeat interval = L / n
r = L / (2 pi n)
```

Integer `n` closes position, tangent modulation, and phase at the seam.

## First proposed specimen

```text
guide: 40 mm diameter circle
guide length: 125.664 mm
requested envelope: 4.0 mm
bead width: 0.83 mm
d: (4.0 - 0.83) / 2 = 1.585 mm
repeat count: 21 per circuit
actual repeat interval: 5.984 mm
r: 0.952 mm
d > r: true, so loops are prolate and self-crossing
turns: 14
rise per circuit: 0.70 mm
programmed rise: 9.8 mm
phase shift: 0 degrees
```

This is experimental. Inspect crossing heat and material accumulation before
increasing height or decreasing repeat interval.

## First physical trochoid result — 2026-07-31

**ROBOT-CONFIRMED / KNOWN FAILURE**

- The sampled implementation used 16 short linear `MovL` chords per repeat at
  speed 3 and `CP=1`.
- Physical motion was highly staccato. Junction slowdowns and pauses caused
  massive local over-deposition with the fixed-feed Struder, and the operator
  determined that an emergency stop was necessary.
- The intended crossing loops and hollow cells were not expressed physically;
  the nozzle appeared to make a succession of short arcs instead.
- The mathematical condition `d > r` is not sufficient evidence of a usable
  loop wall. Commanded primitive topology, visible crossings, enclosed cells,
  and controller blending must all be validated.
- Do not reuse this dense-polyline implementation. Redesign the experiment as
  an explicit continuous loop chain using a small number of native arcs or
  another robot-proven smooth primitive sequence.
- Sinusoidal-weave feedback is pending and must be classified separately.

## Native loop-chain result — 2026-07-31

**ROBOT-CONFIRMED / PARTIAL SUCCESS**

- Explicit two-`Arc3` loops at `CP=1`, without `SYNC`, moved nicely and formed
  the intended recirculating pattern.
- A portion of the first patterned layer did not adhere; the returning loop
  motion then pulled the strand off the bed.
- The flat-ring implementation showed a visible Z seam at its discrete rising
  phase transition. Future vase-mode tests must increase Z continuously and
  accumulate the phase offset continuously rather than closing each layer.
- Default patterned-wall construction now uses configurable conventional
  spiral/parallel foundation and cap layers around a seamless helical body.
