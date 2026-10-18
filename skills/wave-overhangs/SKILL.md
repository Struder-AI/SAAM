---
name: wave-overhangs
description: Guidance for laterally growing overhangs using ordinary Slice seeded-front fill.
metadata:
  saam-kind: guidance
---

# Seeded-front fill

Use [Slice](../slice/SKILL.md) with `fillOrder:{kind:'fronts',...}` to grow a region
laterally from an existing seed. There is no wave extension or separate producer.
Lateral adhesion, cooling and thermal warping remain experimental.

## Author the region and seed

Select a native patch or independent spline reference. A `within` surface-domain
volume selects closed chart loops: CCW outer boundaries and CW holes. The stack
sets layer count and normal gaps. Ordinary Slice settings control material,
speed, width, fan and optional derived tool poses.

`fillOrder.seedUv` is the already reached region; it is not extruded again.
Match its boundary to the printed basing edge. A manufactured `substrate`
reference declares that edge's readiness. A selected solid exterior uses its
required slice/stack completions. Artificial references leave prerequisites empty for scheduler placement.
Geometry references alone do not establish manufacturing readiness.
Omitting the seed requests derivation from prepared predecessor material.

```json
{"id":"canopy","loops":0,"fillDensity":1,"solidTop":0,"solidBottom":0,
 "surface":{"kind":"patch","patch":"canopy","offsetMm":0},
 "stack":{"firstLayerMm":0.2,"layerMm":0.2},
 "within":[{"kind":"surface-domain","loopsUv":[[[0,0],[1,0],[1,1],[0,1]]],
            "fromLayer":-1,"toLayer":0}],
 "fillOrder":{"kind":"fronts","seedUv":[[[0,0],[0.1,0],[0.1,1],[0,1]]],
              "lineSpacingMm":0.3,"propagationStepMm":0.1,"toleranceMm":0.01}}
```

Use the normal Slice editor to fill remaining defaults. Chart coordinates belong
to the selected surface; inspect the seed's physical attachment. Later slices
require their immediate predecessor. Within a slice, a split makes both children
require their shared prefix; a merge requires every contributing branch.
Independent branches remain unchained. These are core construction requirements.

Front construction joins adjacent waves with a short in-domain curve, bounded
by max(bead width, spacing) plus tolerance. Each causal pass is atomic. Scheduling
handles interleaving and travel intent; Export realizes selected-machine moves.

## Numerical scope

The method uses one regular injective chart. Folds, singularities and multi-chart
stitching are outside its scope. Physical offsets and obstacle handling are sampled;
`sampleStepMm`, `propagationStepMm` and `toleranceMm` control that approximation.
Spacing and bead width are independent; no adhesion percentage is enforced.

Unreachable material reports its seed/region cause. Reports retain residual UV
regions, physical residual diameter and rounding bands. A final front can stop
within one spacing of the boundary; no implicit perimeter cap is deposited.

The [saddle](examples/box-saddle.json) and [canopy](examples/box-canopy.json) examples
are ordinary Slice recipes. [Implementation and provenance](DEVELOPER.md) records
the core algorithm and research attribution. Retired `construction:'fronts'`
records migrate to ordinary Slice.
