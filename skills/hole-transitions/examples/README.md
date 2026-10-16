# Hole transition examples

Each JSON is a `create_bundle` input without `bundleId`: one complete part and one
technique, expressed as ordinary geometry, Slice and optional Trace. Review independently.

| Recipe | Construction and software evidence |
|---|---|
| [Stepped](stepped.json) | 16×16×8mm host, R5 recess to Z4 and R2 bore. Explicitly ordered bridges at Z4.2/4.4/4.6 in 0/90/45° directions, interleaved outer frames, then round-bore walls at Z4.8. |
| [Tilted stepped](tilted-stepped.json) | Same host rotated 30° about X and raised 8mm, plane normal `[0,-0.5,0.8660254]`, oblique translation `[0.1,-0.5,0.8660254]`. Three directed bridge courses. A construction example, not a bed-ready orientation. |
| [Planar wave](wave.json) | Same host; two printed Trace anchor rings at Z4.2 precede the inward wave. Visually accepted 2026-10-16; retains the bore and reported unresolved front residue. |
| [Curved wave](curved-wave.json) | Saddle shoulder `Z=4+0.025XY`, reference 0.2mm above it, oblique translation `[0.15,0,1]`. One inward pass; calibrated mean-normal gap. Reports one terminal residual with sampled diameter 0.1284mm, retained as unfilled. |

Inspect strand order, final bore contact and wave residuals. These software examples are physically unqualified; tilted/curved paths need a suitable machine.
The [hole guidance](../../hole-supports/SKILL.md) links the other singleton techniques; [original STEP provenance](../../hole-supports/references/README.md) owns the exemplar. The extension manual owns settings and application.
