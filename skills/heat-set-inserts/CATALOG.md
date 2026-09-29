# Heat-set insert choices

The 60 packaged profiles are unheaded SPIROL Series 19/29 inserts for straight
holes. Select the actual series, thread and length; thread size alone is ambiguous.

## Size and profile choices

Set `insertId` to `spirol-SERIES-THREAD-LENGTH`: SERIES is `19` or `29`, LENGTH
is `short` or `long`, and THREAD is lowercase with `/` replaced by `_`:
`spirol-29-m3-long`, `spirol-19-1_4-20-short`. All dimensions below are mm.

| Threads | Short length | Long length | Hole diameter | Pilot diameter | Series 19 short outer | Long / Series 29 outer |
|---|---:|---:|---:|---:|---:|---:|
| M2, 2-56 | 3.18 | 3.99 | 3.20 | 3.12 | 3.58 | 3.63 |
| M2.5, M3, 4-40 | 3.56 | 5.74 | 3.99 | 3.91 | 4.62 | 4.75 |
| M3.5, 6-32 | 3.81 | 7.14 | 4.78 | 4.70 | 5.41 | 5.54 |
| M4, 8-32 | 4.70 | 8.15 | 5.61 | 5.54 | 6.25 | 6.38 |
| M5, 10-24, 10-32 | 6.35 | 9.53 | 6.40 | 6.32 | 7.04 | 7.16 |
| M6, 1/4-20 | 7.92 | 12.70 | 8.00 | 7.92 | 8.64 | 8.76 |
| M8, 5/16-18 | — | 12.70 | 9.58 | 9.50 | — | 10.34 |

Minimum recommended blind depth is length plus two pitches. Metric pitches for
M2/M2.5/M3/M3.5/M4/M5/M6/M8 are 0.4/0.45/0.5/0.6/0.7/0.8/1/1.25 mm;
for inch threads use 25.4 divided by threads per inch. Outer means overknurl,
not host-hole diameter; profiles do not model knurls, threads or counterbores.

## Source and interpretation

[SPIROL design guide](https://www.spirol.com/assets/files/ins-threaded-inserts-design-guide-us.pdf)
printed pages 8/9 (dimensions) and 5 (blind depth) back [catalog.mjs](scripts/catalog.mjs).
The implementation retains printed millimeter conversions and provenance, including
for inch threads. These nominal plastic-host dimensions require printer/material
fit verification, especially for filled plastics. Other brands, headed inserts
and tapered profiles need separately verified dimensions; they are not interchangeable.
