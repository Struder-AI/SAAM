---
name: wave-overhangs
description: Experimental seeded fronts on ordinary owned spline slice families.
---

# Wave overhangs

Use the [slice skill](../slice/SKILL.md) when a region can grow laterally from
an authored seed. Fronts attach to preceding fronts; backing beneath every
point is not required. This is an experimental process: lateral attachment,
cooling and thermal warping need judgment and physical trials.

`frontAssignment({id,...options})` in
[shared constructions](../../core/print/surface-constructions.mjs) expands to
an ordinary assignment: a surface-domain owned volume, `fillOrder:{kind:'fronts',...}`,
shared process overrides and dependencies. Persist that expanded record in
`plan.slices.assignments`; legacy `construction:'fronts'` requires migration.
There is no separate wave producer or extra approval stage.

## Author the region and seed

- `surface:{kind:'patch',part:null,patch:'top'}` selects a native patch.
  `surface:{kind:'spline',patch,offsetMm:0}` supplies a named control net.
  XYZ coordinates precede print/component placement.
- `domainUv` supplies closed chart loops: CCW outer boundaries, CW holes.
  The preset turns these into the owned volume; shared ownership clips overlap.
- `seedUv` identifies the already reached chart region; it is not extruded again.
  Match its edge to the intended anchor. Omit it to derive a seed from finalized
  predecessor beads. Disconnected components may require separate assignments.
- `afterParts`, `beforeParts` and `after` become ordinary dependencies. For a
  single solid, `[null]` selects its producers. Dependencies establish order,
  not physical adhesion or automatic support.
- `reason` becomes the assignment description. Record the intended attachment.

The common scheduler obeys dependencies and ownership, not array order alone.
Adjacent fronts alternate and join with a short curve on the reference inside
the region. Its length is limited to max(bead width, wave spacing) plus tolerance.
Generation rejects separate passes: branch restarts are not implemented. Holes
can split propagation, so a valid mask does not guarantee one continuous pass.

| Preset option | Default | Meaning |
|---|---:|---|
| `layers` | 1 | Number of translated reference courses. |
| `beadHeightMm` | 0.2 | Target whole-reference mean normal gap. |
| `lineSpacingMm` | 0.3 | Physical distance between fronts. |
| `speedMmS` | 5 | Shared deposition speed. |
| `fanPercent` | 100 | Machine must support the requested fan setting. |
| `toleranceMm` | 0.01 | Integration, chord and terminal residual tolerance. |
| `sampleStepMm` | 0.5 | Physical mapping/refinement step. |
| `propagationStepMm` | 0.1 | Internal advance before clipping. |

Whole-reference area-weighted normals determine default translation direction;
the mean projected gap calibrates its magnitude. Actual local gaps set bead
volume. Geometry supplies frames; downstream machine adaptation chooses fixed
or surface-following nozzle orientation. Flow, feed and slope limits apply.
Spacing and bead width remain separate process choices; no adhesion percentage
is enforced. Defaults are development values, not calibrated machine settings.

## Numerical scope

Each front region uses a regular injective spline chart. Singularities, folds,
multiple-chart stitching and general CAD trimming are outside this technique.
Physical offsets and obstacle handling are sampled numerical approximations.
Fronts run until material is reached or progress stops; no point/time cap silently
truncates them. Unreachable material reports its seed/region cause.

Reports preserve terminal `residualsUv`, physical residual diameter and rounding
bands rather than relabeling them deposited material. Contours narrower than
`toleranceMm/4` can be classified as slivers. The last front can stop within one
spacing of the boundary; there is no implicit perimeter cap. Refine narrow or
high-curvature geometry and inspect starts/stops in Studio.

[example.mjs](scripts/example.mjs) authors a small saddle beyond a box;
[canopy-example.mjs](scripts/canopy-example.mjs) authors a larger surrounding
canopy. Both create unapproved bundles through normal review. Their earlier
hole case demonstrates the continuity rejection, not a supported recipe.
[Implementation and provenance](BUILDER.md) records method and attribution.
