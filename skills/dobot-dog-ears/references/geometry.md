# Dog-ear and breakaway-skirt geometry

## Research basis

OrcaSlicer describes mouse ears as local brim extensions placed near corners
and sharp features to improve adhesion while using less material than a full
brim. Its preparation tool exposes a head-diameter parameter. Its brim
documentation also identifies a brim-object gap as the removability-versus-
adhesion control.

Prusa documents skirts as pre-model outlines used to stabilize extrusion and
check first-layer adhesion. PrusaSlicer exposes both skirt distance and brim
separation, demonstrating that there is no single universal “breakaway” value:
profiles and intended attachment differ.

Sources:

- https://github.com/OrcaSlicer/OrcaSlicer/wiki/others_settings_brim
- https://www.orcaslicer.com/wiki/print_prepare/prepare_brim_ears_painting.html
- https://help.prusa3d.com/article/skirt-and-brim_133969
- https://github.com/prusa3d/PrusaSlicer/blob/master/src/libslic3r/PrintConfig.cpp

## Current StruderBot defaults

| Parameter | Value | Status |
|---|---:|---|
| Ear diameter | 25.00 mm | experimental revision after failed 15 mm ears |
| Ear radius | 12.50 mm | derived |
| Ear center | exact finished corner | operator-selected rule |
| Ear layers | 1 | proposed default |
| Ear-only speed | 4.50 mm/s | experimental low-mass setting |
| Estimated ear bead width | 0.553 mm | calculated, not robot-confirmed |
| Ear fill spacing | 1.80 mm | experimental sparse spacing |
| Measured bead width | 0.83 mm | robot-confirmed process value |
| Support-to-part clear gap | 1.00 mm | operator-selected revision |
| Part contacts per ear | 3 | apex plus two side tangencies |

The earlier 15 mm solid ear with a 0.20 mm gap is a robot-observed adhesion and
separation failure under the current goopy first-layer condition. The proposed
25 mm sparse revision spreads less total hot material over a larger footprint.

Using inverse feed-per-length as a provisional estimate:

`estimated_width = 0.83 * 3.0 / 4.5 = 0.553 mm`

With 1.80 mm spacing, new deposited material per projected area is
approximately `(3.0*0.78)/(4.5*1.80) = 0.289` of the former solid process.
Area increases by `(25/15)^2 = 2.778`, so estimated total material per ear is
about `0.289*2.778 = 0.802`, or 80% of the failed ear. This is a process
estimate, not a measured bead model.

## Offset formulas

Let:

- `w` = deposited bead width;
- `g` = desired clear gap from the finished part edge;
- `r` = ear radius.

The skirt centerline offset from the finished part edge is:

`skirt_centerline_offset = g + w / 2`

When the part bead is 0.83 mm, the proposed ear bead is 0.553 mm, and the
required physical gap is 1.00 mm, centerline separation is:

`1.00 + (0.83 + 0.553)/2 = 1.6915 mm`

Because the first part perimeter is centered 0.415 mm inside the finished
edge, the support centerline lies about `1.2765 mm` outside that edge.

The corresponding centerline distance from an outer part-perimeter centerline
located `w/2` inside the finished edge is:

`part_perimeter_to_skirt_centerline = w + g = 1.03 mm`

For an axis-aligned rectangular corner, a skirt line at offset `o` intersects a
radius-`r` dog ear at distance:

`d = sqrt(r^2 - o^2)`

from the corner along the adjoining side. Clip the skirt inside the filled ear,
then extend the surviving span by the selected tie-in amount. Reject the
geometry if `o >= r`.

## Ownership and connection

Boolean ownership is nominal and evaluated before toolpath expansion:

- `part_region = finished_part_footprint`
- `ear_region = union(corner_discs) minus part_region`
- `skirt_region = offset_contour(part_region, g + w/2) clipped outside ear fill`

The part wins every circle/part overlap. Ordinary support lines remain outside
the one-millimeter clear zone. At each ear, exactly three V-shaped two-leg jogs
cross the gap and touch the first perimeter at a single apex point: two at the
circle/side tangencies and one at the exterior corner apex. Do not backtrack a
single bridge line, because the reversal would create a fixed-feed blob.

Connect the prime, ears, skirt spans, and part as one ordered deposited path.
For a rectangular part, alternate ear and side-span around the boundary and
finish at the part-entry corner. This preserves the fixed-feed Struder rule
without travel scars or intermediate extrusion restarts.
