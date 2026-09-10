# Interim Layer-Filling Baseline

## Robot-confirmed calibration

- Temperature: `211`.
- Robot print speed: `3`.
- Layer rise: approximately `0.70 mm`.
- Measured wall/bead width: approximately `0.83 mm`.
- Solid line spacing: `0.780 mm`.
- Struder display: `0.4 mm/second`, uncalibrated reference only.
- Small CP values around `1.0-1.5` improve continuity while retaining square
  geometry. Large CP values round corners unacceptably.

Increasing line spacing deposits less material per unit area. Decreasing line
spacing deposits more. The earlier `0.658 mm` spacing was over-extruded;
`0.780 mm` produced the best observed solid-fill density.

## Wall overlap

- Robot-confirmed: `0.780 mm` lines only barely touched the perimeter without
  additional overlap.
- Experimental solid-fill overlap: `0.2075 mm`, equal to 25% of the measured
  `0.83 mm` line width.
- Experimental sparse-fill overlap: `0.1245 mm`, equal to 15%.
- For equal-width perimeter and infill beads, physical overlap is not a
  centerline extension. If the perimeter centerline is `p`, bead width is
  `b`, and requested overlap is `o`, terminate the infill centerline at
  `p - b + o` toward the interior. With `b = 0.83` and `o = 0.2075`, the
  solid-infill endpoint is `0.6225 mm` inside the perimeter centerline.

## Durable planning rules

- Print prioritized outer perimeters before the fill.
- Decompose layers with holes or openings into connected regions.
- Finish left, between-feature, and right regions separately.
- Cross a feature boundary once when practical.
- Avoid one obstacle detour per intersecting scanline.
- Multiple circular wall contours can be one continuous Archimedean spiral.
- After a short-stroke edge region, continue into the uninterrupted band from
  the current side. A rapid return across the part caused repeatable long
  controller pauses in both X and rotated-Y fill.
- Build alternating layers from one U/V plan and rotate its mapping.
- Use a fast linear transition from the perimeter to the first raster
  endpoint when the Struder must remain on; a print-speed transition deposits
  an unwanted diagonal line.
- For the regular-hex convention whose first vertex is at `rotation + 30°`,
  side-parallel raster families are `rotation + 30°`, `rotation + 90°`, and
  `rotation + 150°`. The `0°/60°/120°` families are edge normals.

## Interim limitation

Large solid parts currently lose bed adhesion before further path refinements
can be evaluated reliably. Treat adhesion as the active test constraint. The
latest removal of the region-to-band rapid return is experimental and awaits a
meaningful retest after adhesion improves.

Prefer tests with smaller footprints, discontinuous contact, narrow walls,
bridges, towers, or isolated calibration coupons until adhesion is no longer
the limiting factor.
