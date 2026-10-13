# Heat-set insert choices

The 86 straight-hole profiles comprise 60 SPIROL, 25 CNC Kitchen and one
McMaster-Carr entry. Select the manufacturer, thread and actual length;
thread size alone does not identify an insert. Dimensions below are millimeters.

## Size and profile choices

SPIROL IDs are `spirol-SERIES-THREAD-LENGTH`: SERIES `19`/`29`, LENGTH
`short`/`long`, THREAD lowercase with `/` replaced by `_`. Examples:
`spirol-29-m3-long`, `spirol-19-1_4-20-short`.

| Threads | Short L | Long L | Hole D | Pilot P | Series 19 short outer | Long / Series 29 outer |
|---|---:|---:|---:|---:|---:|---:|
| M2, 2-56 | 3.18 | 3.99 | 3.20 | 3.12 | 3.58 | 3.63 |
| M2.5, M3, 4-40 | 3.56 | 5.74 | 3.99 | 3.91 | 4.62 | 4.75 |
| M3.5, 6-32 | 3.81 | 7.14 | 4.78 | 4.70 | 5.41 | 5.54 |
| M4, 8-32 | 4.70 | 8.15 | 5.61 | 5.54 | 6.25 | 6.38 |
| M5, 10-24, 10-32 | 6.35 | 9.53 | 6.40 | 6.32 | 7.04 | 7.16 |
| M6, 1/4-20 | 7.92 | 12.70 | 8.00 | 7.92 | 8.64 | 8.76 |
| M8, 5/16-18 | — | 12.70 | 9.58 | 9.50 | — | 10.34 |

CNC Kitchen IDs are `cnckitchen-THREAD-LENGTH`, with the same thread escaping
and numeric length without trailing zeros: `cnckitchen-m3-5.7`,
`cnckitchen-1_4-20-6.4`. The VORON variant is `cnckitchen-m3-4-voron`.
Comma-separated lengths below are separate profiles, totaling 25.

| Thread | Lengths L | Insert D1 | Hole D2 | Minimum radial wall W |
|---|---:|---:|---:|---:|
| M2 | 3 | 3.6 | 3.2 | 1.3 |
| M2.5 | 4 | 4.6 | 4.0 | 1.6 |
| M3 | 5.7, 3 | 4.6 | 4.0 | 1.6 |
| M3 VORON | 4 | 5.0 | 4.4 | 1.6 |
| M4 | 8.1, 4 | 6.3 | 5.7 | 2.1 |
| M5 | 9.5, 5.8 | 7.1 | 6.5 | 2.6 |
| M6 | 12.7 | 8.7 | 8.1 | 3.3 |
| M8 | 12.7 | 10.2 | 9.7 | 4.5 |
| M10 | 12.7 | 12.6 | 12.0 | 6.0 |
| 2-56 | 3.2 | 3.6 | 3.2 | 1.3 |
| 4-40 | 5.7, 3.6 | 4.6 | 4.0 | 1.6 |
| 6-32 | 7.1, 3.8 | 5.4 | 4.8 | 1.8 |
| 8-32 | 8.2, 4.7 | 6.3 | 5.7 | 2.1 |
| 10-24 | 9.5 | 7.1 | 6.5 | 2.6 |
| 10-32 | 9.5 | 7.1 | 6.5 | 2.6 |
| 1/4-20 | 12.7, 6.4 | 8.7 | 8.1 | 3.3 |
| 5/16-18 | 12.7 | 10.2 | 9.7 | 4.5 |
| 3/8-16 | 12.7 | 12.5 | 12.0 | 6.0 |

McMaster ID `mcmaster-1_2-13` identifies brass part **94459A743**: thread 1/2-13,
installed length 15.875 (0.625 in), recommended drill 15.875 (5/8 in), maximum
hole 15.9258 (0.627 in). No verified radial wall dimension is available.

## Sources and interpretation

[SPIROL guide](https://www.spirol.com/assets/files/ins-threaded-inserts-design-guide-us.pdf),
printed pages 8/9 and depth rule page 5, owns the unchanged SPIROL dimensions
and their printed millimeter conversions. Blind clearance is two thread pitches.

[CNC Kitchen poster](https://cdn.shopify.com/s/files/1/0654/4821/4767/files/Poster_Dimensions-Guidlines.pdf?v=1751444185),
PDF page 2, owns D1/D2/L/W and **1 mm blind clearance**. TK's 2026-09-17
retrieval remains recorded; the table was rechecked 2026-10-12. The poster's
G1/8-28 fitting thread is outside the selected fastener catalog. Its
[installation guidance](https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts)
normally needs no mouth chamfer; the optional chamfer is a lead-in, not a tapered insert seat.

[McMaster's table](https://www.mcmaster.com/products/94459A170/) confirms the
94459A743 length, drill and maximum hole, rechecked 2026-10-12. TK's historical
0.655 in axial minimum material thickness is retained as `minMaterialThicknessMm`
with its 2026-09-17 basis, currently unverified; it is not a radial wall requirement.
McMaster's blind clearance remains SAAM's two-pitch recommendation.

Outer diameter is overknurl, not host-hole diameter. Radial wall recommendations
are catalog data for design review; current reinforcement does not enforce them.
Inch pitch is 25.4 divided by threads per inch. Geometry models straight bores,
not threads or knurls; fit and strength require printer/material evidence.
