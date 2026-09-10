# Prime-path geometry

## Current StruderBot defaults

| Parameter | Default |
|---|---:|
| Minimum deposited purge length | 100 mm |
| Clear gap from finished part edge | 5 mm |
| Measured bead width | 0.83 mm |
| Serpentine lane pitch | 4 mm |
| Semicircular turn radius | 2 mm |
| Bed-edge safety margin | 3 mm |
| Purge motion speed | normal print speed |

These are process defaults for the current fixed-feed StruderBot, not generic
printing standards. The 100 mm requirement is operator-selected and remains to
be validated physically.

Conventional slicers use skirts or startup prime lines before the model to
stabilize flow. This printer needs a longer compact version because it has no
purge/wipe station and cannot reliably retract between disconnected paths.

## Clearance

For bead width `w` and desired clear edge gap `g`, place the nearest serpentine
body centerline this far from the finished part edge:

`centerline_offset = g + w / 2`

With the current values, that is `5 + 0.83 / 2 = 5.415 mm`.

Apply the same bead-radius allowance at the printable bed boundary. Validate
the full semicircle, not merely its endpoints.

The deliberate final connector crosses this gap once and terminates at the
model entry. It may not cross another purge segment or touch the model anywhere
else.

## Length

For an odd-lane serpentine with `n` straight strokes of length `s`, tangent
semicircular turns of radius `r`, and a final connector of length `c`:

`path_length = n*s + (n - 1)*pi*r + c`

Therefore:

`required_stroke = (minimum_length - (n - 1)*pi*r - c) / n`

Always calculate the actual connector and final path length. Do not count the
robot approach before `PenOn()`.

Use odd lane counts so the path can begin at the remote end and finish on the
nearest lane at the chosen model-entry end. Try 3 lanes first, then 5, 7, and so
on only if required by the available bed geometry.

## Tangent semicircular turns

The lane pitch must equal twice the turn radius for a simple tangent
semicircle. With 4 mm pitch, use 2 mm radius.

For vertical lanes separated in positive X, an upper turn from `(x, y_hi)` to
`(x + 2r, y_hi)` uses:

- start: `(x, y_hi)`
- midpoint: `(x + r, y_hi + r)`
- end: `(x + 2r, y_hi)`

The corresponding lower turn uses midpoint `(x + r, y_lo - r)`.
Rotate these formulas for left/right/top/bottom placement.

## Side selection

Evaluate all four sides of the complete part envelope. Prefer the side that:

1. fits the whole deposited bead, turns, and safety margin on the bed;
2. permits at least 100 mm without shrinking the clear gap;
3. gives the shortest unobstructed connector to the first model point; and
4. keeps the approach and purge visible to the operator when choices remain.

If no side fits, stop and redesign the part placement or purge layout. Do not
silently invade the part, cross an existing segment, or shorten the purge.

## Tool-state sequence

The required sequence is:

`safe approach -> purge start -> PenOn/startup delay -> purge -> connector -> model -> final pre-shutoff -> PenOff -> lift`

There must be no dwell or extrusion-state transition between purge and model.
