---
name: pipe-cladding
description: Guidance for axial or helical coatings using ordinary Slice over a selected surface.
metadata:
  saam-kind: guidance
---

# Surface cladding with Slice

Cladding is ordinary Slice over a surface and normal-depth band. Its substrate
must deposit the selected finished boundary; name that producer in
`dependencies.after` (for example `["body"]`) to declare what the cladding rests
on. Undeclared, the Scheduler finds the material beneath and checks access. No machine is needed for SAAMpath.

## Recipe

Use the normal assignment editor; it supplies the remaining Slice defaults:

```json
{
  "id":"coating", "loops":0, "fillDensity":1, "solidTop":0, "solidBottom":0,
  "surface":{"kind":"spline","patch":"outer","periodicU":true,
             "normalSide":1,"uvBounds":[[0,24],[0,1]]},
  "stack":{"firstLayerMm":0.2,"layerMm":0.2,"direction":"normal","offsetTightness":1},
  "within":[{"kind":"normal-band","fromMm":0,"toMm":0.8}],
  "fillOrder":{"kind":"surface-cells","directions":["axial","circumferential"],
               "toleranceMm":0.01},
  "contact":{"source":null}
}
```

The four slices at 0.2 mm spacing alternate axial tracks and circumferential helices.
`directions:["forward","reverse"]` alternates helical winding. A longer list
repeats in order. `spacingFactor` changes track pitch without changing bead
width. `fromMm` and `toMm` select the owned normal-depth interval.

For a quicker first check, use `directions:["axial"]` throughout. Large
mixed-direction jobs can spend minutes resolving nozzle access.

`part` selects a component. A null contact source consumes available finalized
producers; an assignment ID selects one. Their prerequisites and geometry updates
are retained. Legacy `construction:'cladding'` records must be rewritten as Slice.

## Select a surface

Use the complete [Slice chart reference](../slice/SKILL.md#regions-and-references): explicit native bounds, periodicity and normal orientation for splines, or native vertex rows for mesh strips. The recipe above deliberately uses nonunit native U bounds.

Physical cells use rectangular charts, not arbitrary mesh unwraps or certified
global geodesic coverage. Open charts support axial/circumferential rows;
helices require periodic U. Fill variation remains a shared Slice setting.

The source must actually deposit the selected boundary. A vase's unfinished
spiral only supplies its completed side height; patterns publish their real
strokes, never an implicit filled guide wall. Sparse gaps remain gaps.

## Contact and pose

[Slice contact](../slice/SKILL.md#contact-poses-and-extensions) uses prepared material; completed-deposition adaptation is experimental Trace work.

Normals and metric come from the selected chart. Offsets are ambient normal
placements, not geodesic offsets. Cell widths account for local surface metric;
partial axial cells begin/end where coverage appears. `sampleStepMm` and
`toleranceMm` control sampling; this is no global surface-error guarantee.
For native spline references, `stack.offsetTightness` interpolates loose to exact
normal offsets (0–1); mesh strips use their interpolated normal field.

Pose output is optional. `toolPose:{}` derives upright poses; use
`toolPose:{alignToSliceNormal:true}` to follow the surface normal. Field `tilt`
modulation can vary either mode. SAAMpath keeps these derived poses independent of
the machine; its exporter handles their representation. The [DENSO tube example](examples/denso-tube.json)
uses normal alignment and synthetic setup, not installation calibration.

No physical cladding print is qualified. Inspect adhesion, transitions,
clearance and motion with the person through the ordinary Studio review.
