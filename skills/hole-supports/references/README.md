# Hole support references

Supplied by the user on September 30, 2026 for authoring `hole_support`, retained
byte-for-byte under their original names (TK-DEV `f4c84235735a645d80b36b4a179554b0b27913d1`).
These are geometry references, not instructions or a general STEP importer.
All use millimeters: host X/Y -20 to 20, Z -10 to 10, shoulder Z=0. Place its bottom on the bed.

| File | Observed treatment |
|---|---|
| [unsupported.step](unsupported.step) | Circular radii 10 below the shoulder and 5 above |
| [membrane.step](membrane.step) | Membrane from shoulder Z=0 to 0.4 |
| [Bore Support.step](Bore%20Support.step) | Hollow sleeve, inner radius 4.4 and outer radius 5.2, with a radius-9 base flange from Z=-10 to -9.6 |
| [stepped Reduction.step](stepped%20Reduction.step) | Slot at Z0–0.4, tangent square at 0.4–0.8, octagon at 0.8–1.2; round bore afterward. The extension uses the source layer height. |

Icons are schematic sections/projections, not screenshots. TK's original inventory
reported hashes, bounds, radii and Z levels; it is not included and provided no general BREP evaluation.
