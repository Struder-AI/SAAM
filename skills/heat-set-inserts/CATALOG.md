# Heat-set insert catalog

The implemented catalog covers three verified manufacturer sources: SPIROL
Series 19/29, CNC Kitchen's own line, and one McMaster-Carr selection. All
published entries are straight-hole (`holeProfile: 'straight'`); tapered-body
insert families (for example McMaster's 94180A series) need their own verified
hole-taper dimensions before being added — the independent `chamferDepthMm`/
`chamferAngleDeg` feature settings ([SKILL.md](SKILL.md)) cover a lead-in bevel
at the mouth only, not a bore that tapers to match a tapered insert body.

## SPIROL Series 19/29

[SPIROL Threaded Inserts for Plastics design guide](https://www.spirol.com/assets/files/ins-threaded-inserts-design-guide-us.pdf),
printed pages 8 and 9, owns these dimensions. Page numbers are the printed page
labels; the PDF includes two opening pages before page 1. Each record retains
its source URL, table and page. The numbers use the guide's published millimeter
conversions, including for inch threads; they are not recalculated from its
rounded inch values.

The 60 selections cover M2, M2.5, M3, M3.5, M4, M5, M6 and M8; and 2-56,
4-40, 6-32, 8-32, 10-24, 10-32, 1/4-20 and 5/16-18. M8 and 5/16-18 have
long versions only. Series 19 short and long inserts have different overknurl
diameters; Series 29 uses the same overknurl diameter for both lengths. SPIROL's
guide does not publish a minimum-wall-thickness figure, so `minWallThicknessMm`
is `null` for every SPIROL entry.

## CNC Kitchen

CNC Kitchen's own "Dimensions & Design Guidelines" poster (retrieved 2026-09-17
from [cnckitchen.store/pages/insert-cad-models](https://cnckitchen.store/pages/insert-cad-models))
owns these 25 selections: M2, M2.5, M3 (three lengths, including the M3×4mm
"VORON" variant), M4, M5, M6, M8 and M10 metric; 2-56, 4-40, 6-32, 8-32, 10-24,
10-32, 1/4-20, 5/16-18 and 3/8-16 imperial (UN/UNC/UNF). The poster's own G1/8-28
pipe-thread row is a fitting thread, not a fastener size, and is not included.
CNC Kitchen's own blog additionally states that FDM holes for their inserts
should be **straight, with no chamfer** — see the chamfer note in
[SKILL.md](SKILL.md). CNC Kitchen's metric range tops out at M10; it does not
publish an M12 heat-set-for-plastic insert.

## McMaster-Carr

One verified selection, part **94459A743** ("Heat-Set Threaded Inserts for
Plastic, Standard, Brass, 1/2"-13, 0.625" Installed Length"), retrieved
2026-09-17 from [mcmaster.com](https://www.mcmaster.com/94459A743/). This is
the largest fractional size published by either verified source (CNC Kitchen
tops out at 3/8"-16). McMaster's own metric heat-set-for-plastic line was
checked against its live thread-size filters on the same date and tops out at
M10 — it does not offer M12 either, so **no source in this catalog publishes
an M12 heat-set insert**, and none is included pending one.

## Shared fields and interpretation

`holeDiameterMm` is the manufacturer's recommended host hole diameter D (for
McMaster, its published drill/recommended-hole size). `outerDiameterMm` is the
insert's overknurl diameter, when the source publishes one distinctly from the
hole diameter; `null` otherwise (McMaster's 1/2"-13 listing). `lengthMm` is
insert length L. `pilotDiameterMm` is pilot diameter P, when published (SPIROL
only). `bottomClearanceMm` is two thread pitches, the blind-hole depth rule
(insert length plus two pitches); through-holes use exactly the insert length
instead, per CNC Kitchen's own design guidance that through-holes "do not need
to be longer than the insert." Inch pitch is 25.4 divided by threads per inch.
`minWallThicknessMm` is the manufacturer's published minimum surrounding-wall
figure, when available (CNC Kitchen and McMaster); at least this much host
material must surround the bore ([SKILL.md](SKILL.md)), checked at generation time.

The catalog stores nominal host dimensions, before any explicit printer-fit
adjustment. None of these sources establish a printer/material calibration or
the strength of a printed part; their hole recommendations require review for
filled or reinforced plastics. Additional manufacturers, headed inserts and
tapered-hole families need their own verified dimensions before being added.
