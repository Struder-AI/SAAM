---
name: wave-overhangs
description: Experiment with continuous wave passes on curved bivariate spline slices, including flat slices. Grow from explicitly assigned supported seeds with physical surface spacing. Reject slices requiring disconnected passes; hole-branch continuity remains incomplete. Single regular spline charts; physical printing remains unvalidated.
---

# Wave overhangs on spline slices

Use when an overhanging region can grow laterally from existing deposited
material. Successive extrusion fronts attach to the preceding front; they do
not require backing under every point. This generalizes the published planar
wave-overhang idea to intrinsic offsets on bivariate spline surfaces. It is an
experimental process: spacing, speed, cooling, anchorage and thermal warping
need judgment and physical trials. A generated toolpath is software evidence.

Use the ordinary [print tools](../../core/print/USAGE.md) and
[maker workflow](../../MAKERS.md). Enable `skills.wave-overhangs`, assign `slices`,
then use the same plan review, generation, Studio playback and delivery.
CLI and MCP adjustment accept these settings; the catalog exposes this manual.
There is no Grasshopper dependency or additional approval stage.

## Assign the slice and its seed

Each slice has `id`, `reason`, `surface`, `domainUv`, `seedUv`, `afterParts`
and `beforeParts`. IDs are unique lowercase names. Describe why the seed is
supported and which material this slice owns in `reason`.

- `surface`: either `{part: null, patch: "top"}` selecting a native spline patch
  (use the component name in an assembly), or an independent reference with
  `degreeU`, `degreeV`, rectangular `controlPoints`, and optional full
  `knotsU`/`knotsV`. XYZ or XYZW control points are accepted; weights are positive.
  Degrees are 1–5, below the number of controls. Default knots are clamped uniform.
  Independent reference XY coordinates are relative to print placement, Z is
  above the bed. Native patches retain their component placement.
- `domainUv`: closed material loops in that chart: CCW outer loops, CW holes.
  This is the allowed **centerline** region, including its seed. Account for
  half the physical bead width when choosing a part's exterior boundary.
- `seedUv`: the already deposited portion of the same slice. Its intersection
  with `domainUv` is the propagation seed; it is not extruded again. Match its
  outward edge to the deposited anchor. Disconnected islands need separate
  slice assignments. The tool does not infer support from CAD.
- `afterParts`: complete these components before this slice begins. For a
  single part use `[null]`. `[]` means support is already present externally;
  describe it in `reason`. Component names bind existing deposition operations.
- `beforeParts`: delay these components until this slice finishes. Use `[]`
  if there is no successor. A component cannot be both predecessor and
  successor of an atomic slice; split its material into appropriate components.

Slices execute in array order. A successful slice is one atomic operation and
one uninterrupted extrusion stroke, with cooling only after the complete slice.
Adjacent fronts alternate direction and connect by a short curve on the spline,
wholly inside `domainUv`. Its sampled length is limited to the larger of bead
width and wave spacing, plus `toleranceMm`. Stationary perimeter pieces are not
extra extrusion strokes. There is no special perpendicular glue-jog strategy.

Generation rejects a slice requiring separate passes instead of silently adding
travels. Holes can split and merge the propagated fronts; continuous deposition
through those branches is **not yet implemented**. The reference slicer's branch
restarts have not been authorized as an exception to this continuity requirement.

Assign wave material outside other skills' deposition, using component or
regional height selection for the other skills. Wave slices are global explicit
surface assignments, not entries in `composition.regions`. The tool does not
automatically remove intersecting infill, generate arbitrary curved slice stacks,
or publish a material-top query for `lowerSurfaceFrom`. Dependencies alone are
not a proof of geometric contact or compatible material ownership.

## Process settings

| Setting | Default | Meaning |
|---|---:|---|
| `lineSpacingMm` | 0.3 | Distance advanced along the surface between fronts. |
| `beadHeightMm` | 0.2 | Nominal extrusion thickness; area is this times `process.lineWidthMm`. |
| `speedMmS` | 5 | Wave extrusion speed, subject to shared flow/feed limits. |
| `fanPercent` | 100 | Cooling during wave operations. |
| `toleranceMm` | 0.01 | Local integration/chord and terminal residual sampling tolerance. |
| `sampleStepMm` | 0.5 | Maximum XYZ chord length during surface construction and output refinement. |
| `propagationStepMm` | 0.1 | Maximum internal advance before re-clipping to the allowed region. |
| `maxWaves` | 1000 | Maximum fronts per slice. |
| `maxPoints` | 200000 | Maximum emitted surface samples per slice. |
| `maxEvaluations` | 2000000 | Aggregate surface evaluation budget per slice. |

Spacing and bead width are separate because lateral attachment usually needs
overlap. Choose them together; no material-specific adhesion rule is imposed.
The defaults are development starting values, not a calibrated printer preset.
Shared temperatures, retraction, layer cooling, travel and flow settings still
apply. The skill uses the machine's declared nonplanar capability and slope limit;
it emits XYZ paths with the machine's existing nozzle-orientation convention.
It does not solve surface-following robot orientation.
Studio uses its curved-surface line display: exported moves do not retain the
across-path normal required for a volumetric bead frame. This also avoids
turning rounded extrusion quanta on very short moves into spurious wide ribbons.

## Scope and recovery

Each slice stays on one regular, injective C2 NURBS patch. Single-span low-degree
patches are supported. Hole masks are respected during propagation; a mask is
not a guarantee that its fronts can form one continuous pass. Periodic seam
traversal, singularities, folds, multiple-chart stitching,
and arbitrary CAD trimming/intersection are outside this implementation.

The surface-distance construction and obstacle interaction are sampled numerical
approximations, not a globally certified geodesic solver. Tight curvature and
small obstacles need refinement comparisons. Terminal residual regions that
touch the grown material and whose sampled physical bounding-box diagonal is
within `toleranceMm` are retained as `residualsUv` in the wave report. The report
includes their maximum sampled diameter; these are not relabeled as deposited
material or a physical coverage guarantee. Long rounding strips can also remain
when the entire residual fits within a small expansion of reached material,
scaled using sampled native derivatives to the physical
tolerance. `residualRoundingBandUv` records that diagnostic band's width; the
actual sampled diameter is still reported. This check does not advance a front
or emit the rim strips. Larger unreachable regions fail
generation with a seed/region recovery message. Budget errors name the setting
to increase and do not save a successful partial program.
Collapsed closed contours or caps returning to the same domain edge are excluded
when their sampled width is at most `toleranceMm / 4`; their UV geometry and width
remain in `sliverContours`. Boundary coverage is not certified: the final front
may end within one spacing of the domain boundary, without a perimeter cap.

For a domain error, correct its UV bounds or select a larger valid chart. For
unreachable material, inspect holes and disconnected islands and assign support
where needed. If a machine slope limit is exceeded, revise the slice or select
an appropriate configured machine. Review front order, starts/stops and actual
machine commands in Studio before a physical trial.

## Reproduce the development example

From the repository root:

```sh
node skills/wave-overhangs/scripts/example.mjs Prints/wave-overhangs-demo
node studio/server.mjs Prints/wave-overhangs-demo
```

The example creates a new unapproved bundle: a 5 × 5 × 1 mm box supports a
saddle-shaped overhang extending another 5 mm. Existing destinations are refused.
All settings are in its plan. The earlier hole example is a regression for
rejection under the continuous-slice requirement, not a supported print recipe.
The preview is for development and cannot be delivered as an approved job.

For a much larger canopy extending on all four sides:

```sh
node skills/wave-overhangs/scripts/canopy-example.mjs Prints/wave-canopy-demo
node studio/server.mjs Prints/wave-canopy-demo
```

This recipe uses a 24.4 × 24.4 × 10 mm box with the default 0.4 mm bead and a
C2 bicubic surface with a flat central attachment span and waves outside it.
The 24 mm seed follows the top perimeter centerline, allowing bead overlap at
the first front. The rounded outline is about
33 mm of surface distance beyond the box on every side, about 90 mm overall.
The outline follows wave growth, so the last full ring can finish before the
rim. Preparing this larger outline and its toolpath takes longer than the
small saddle example. It uses the same uninterrupted-slice requirement.

[Implementation and provenance](DEVELOP.md) records the numerical method,
research attribution, license findings and verification scope.
