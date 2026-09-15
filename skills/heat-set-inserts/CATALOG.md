# Heat-set insert catalog

The implemented catalog covers SPIROL **Series 19 and 29**, unheaded inserts
for straight holes, in every short/long metric and unified-inch thread selection
listed in the manufacturer's dimensional tables. This is one bounded manufacturer
catalog, not a claim that all insert brands share these dimensions.

## Source and interpretation

[SPIROL Threaded Inserts for Plastics design guide](https://www.spirol.com/assets/files/ins-threaded-inserts-design-guide-us.pdf),
printed pages 8 and 9, owns the dimensions in
[`scripts/catalog.mjs`](scripts/catalog.mjs). Page numbers are the printed page
labels; the PDF includes two opening pages before page 1. Each record retains
its source URL, table and page. The numbers use the guide's published millimeter
conversions, including for inch threads; they are not recalculated from its
rounded inch values.

The 60 selections cover M2, M2.5, M3, M3.5, M4, M5, M6 and M8; and 2-56,
4-40, 6-32, 8-32, 10-24, 10-32, 1/4-20 and 5/16-18. M8 and 5/16-18 have
long versions only. Series 19 short and long inserts have different overknurl
diameters; Series 29 uses the same overknurl diameter for both lengths.

`holeDiameterMm` is the manufacturer's recommended host hole diameter D.
`outerDiameterMm` is the insert's overknurl diameter A, not the hole diameter.
`lengthMm` is insert length L. `pilotDiameterMm` is pilot diameter P.
`bottomClearanceMm` is two thread pitches, following the minimum blind-hole
depth rule on printed page 5: insert length plus two pitches. Inch pitch is
25.4 divided by threads per inch. `holeProfile` is straight; no knurl replicas,
counterbores, or thread geometry are implied.

The catalog stores nominal host dimensions, before any explicit printer-fit
adjustment. The manufacturer's guide addresses plastic hosts and does not
establish a printer/material calibration or the strength of a printed part.
Its hole recommendations require review for filled plastics. Additional
manufacturers, headed inserts and tapered-hole families need their own verified
dimensions before being added.
