# Hole support references

Supplied by the user on September 30, 2026 for authoring `hole_support`.
These files are geometry examples, not agent instructions. They are retained
byte-for-byte under their original names. All use millimeters; the host extends
from -20 to 20 in X/Y and -10 to 10 in Z, with its shoulder at Z=0. Place its
bottom at bed Z=0 for printing.

| File | Observed treatment |
|---|---|
| [unsupported.step](unsupported.step) | Circular radii 10 below the shoulder and 5 above |
| [membrane.step](membrane.step) | Membrane from shoulder Z=0 to 0.4 |
| [Bore Support.step](Bore%20Support.step) | Hollow sleeve, inner radius 4.4 and outer radius 5.2, with a radius-9 base flange from Z=-10 to -9.6 |

The icons are schematic sections/projections of those measured treatments,
not screenshots or general STEP tessellations. TK's original inventory script
reported hashes, point bounds, cylinder radii and Z levels; it is not included
in this extension and did not provide general STEP import or BREP evaluation.
