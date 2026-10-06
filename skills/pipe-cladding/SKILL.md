---
name: pipe-cladding
description: Extension for experimental axial or helical Slice coatings on periodic surface references.
metadata:
  saam-kind: extension
---

# Surface cladding with Slice

Cladding is ordinary Slice over a selected surface and a normal-depth band.
Author its substrate with any geometry/deposition combination that supplies the
selected finished boundary. No machine is required to construct the SAAMpath.

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

The four 0.2 mm courses alternate axial tracks and circumferential helices.
`directions:["forward","reverse"]` alternates helical winding. A longer list
repeats in order. `spacingFactor` changes track pitch without changing bead
width. `fromMm` and `toMm` select the owned normal-depth interval; overlapping
owners reject before deposition; touching intervals are allowed.

`part` selects an assembly component. A null contact source consumes its
available finalized producers; an assignment ID selects one. Source operation
prerequisites are retained. Geometry edits update the reference; the recipe does
not freeze a mesh or baked machine path. Legacy `construction:'cladding'` records
require explicit migration to these ordinary Slice fields.

## Select a surface

- Native spline: the selected named patch and increasing `uvBounds` use its own
  parameters. `normalSide` is 1 or -1. The U seam must agree in position/normal.
- Mesh strip: `{kind:'mesh-strip',rows:[[...],...],periodicU:true,normalSide:1}`.
  Rows contain native vertex indices along V; successive rows progress in U,
  with a duplicate final seam row. Every cell matches two native triangles.
  Reordering or replacing mesh vertices requires revising this explicit chart.

Physical cells use a rectangular chart. Open charts support axial and
circumferential rows; helices require periodic U. This does not unwrap arbitrary
meshes or certify global geodesic coverage. Fill and course variation are shared
Slice settings, independent of the normal stack.

The source must actually deposit the selected boundary. A vase's unfinished
spiral only supplies its completed side height; patterns publish their real
strokes, never an implicit filled guide wall. Sparse gaps remain gaps.

## Contact and pose

`experimental.substrateAdaptation` defaults off: the nominal chart and source
prerequisites determine the family. When enabled, the chart follows finalized
beads, including modulation, and missing required contact rejects. It adds no
support or gap-fill material.

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
