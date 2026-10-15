# Hole transition examples

Each JSON file is a `create_bundle` input without `bundleId`, expanded through
the extension into ordinary geometry and Slice records. No runtime feature is needed.

| Recipe | Construction and software evidence |
|---|---|
| [Stepped](stepped.json) | 16×16×8mm host, R5 counterbore to Z4 and R2 bore; 0.2mm layers. Three fill operations at Z4.2/4.4/4.6, then the round bore. |
| [Tilted stepped](tilted-stepped.json) | Same host rotated 30° about X and raised 8mm, plane normal `[0,-0.5,0.8660254]`, oblique translation `[0.1,-0.5,0.8660254]`. Three directed bridge courses. A construction example, not a bed-ready orientation. |
| [Planar wave](wave.json) | The same planar shoulder, annular UV domain, supported outer-rim seed. One inward pass, seven fronts, no terminal residual region. |
| [Curved wave](curved-wave.json) | Saddle shoulder `Z=4+0.025XY`, reference 0.2mm above it, oblique translation `[0.15,0,1]`. One inward pass; calibrated mean-normal gap. Reports one terminal residual with sampled diameter 0.1284mm, retained as unfilled. |

All four construct software paths; the curved wave retains the stated residual limitation. This establishes neither physical
attachment nor machine reachability; tilted/curved paths need a suitable machine.
Wave reports retain numerical slivers and any residuals; inspect the final bore edge.
The [original stepped STEP and provenance](../../hole-supports/references/README.md)
own the exemplar. The extension's manual owns settings and the public application route.
