// SPIROL's published straight-hole dimensions, not thread-size heuristics.
// See ../CATALOG.md for scope, units, provenance and installation assumptions.
const guideUrl = 'https://www.spirol.com/assets/files/ins-threaded-inserts-design-guide-us.pdf';

// The guide gives inch nominal dimensions with rounded millimeter conversions.
// Preserve its printed millimeter values consistently for both thread systems.
// Columns: thread choices [name, pitch mm], Series 19 short A, long A (also
// Series 29 A), pilot P, short L (null when unavailable), long L, hole D.
const dimensionRows = [
  [[['M2', 0.4], ['2-56', 25.4 / 56]], 3.58, 3.63, 3.12, 3.18, 3.99, 3.20],
  [[['M2.5', 0.45], ['M3', 0.5], ['4-40', 25.4 / 40]], 4.62, 4.75, 3.91, 3.56, 5.74, 3.99],
  [[['M3.5', 0.6], ['6-32', 25.4 / 32]], 5.41, 5.54, 4.70, 3.81, 7.14, 4.78],
  [[['M4', 0.7], ['8-32', 25.4 / 32]], 6.25, 6.38, 5.54, 4.70, 8.15, 5.61],
  [[['M5', 0.8], ['10-24', 25.4 / 24], ['10-32', 25.4 / 32]], 7.04, 7.16, 6.32, 6.35, 9.53, 6.40],
  [[['M6', 1.0], ['1/4-20', 25.4 / 20]], 8.64, 8.76, 7.92, 7.92, 12.70, 8.00],
  [[['M8', 1.25], ['5/16-18', 25.4 / 18]], null, 10.34, 9.50, null, 12.70, 9.58],
];

/** Standard unheaded SPIROL 19/29 heat/ultrasonic inserts: 60 selections. */
export const INSERT_CATALOG = ['19', '29'].flatMap(series =>
  dimensionRows.flatMap(([threads, shortA, longA, pilot, shortL, longL, hole]) =>
    threads.flatMap(([thread, threadPitchMm]) =>
      [['short', shortL], ['long', longL]]
        .filter(([, lengthMm]) => lengthMm !== null)
        .map(([variant, lengthMm]) => ({
          id: `spirol-${series}-${thread.toLowerCase().replaceAll('/', '_')}-${variant}`,
          manufacturer: 'SPIROL',
          series,
          thread,
          variant,
          threadPitchMm,
          lengthMm,
          holeDiameterMm: hole,
          outerDiameterMm: series === '19' && variant === 'short' ? shortA : longA,
          pilotDiameterMm: pilot,
          bottomClearanceMm: 2 * threadPitchMm,
          holeProfile: 'straight',
          dimensionBasis: 'published-millimeter-conversion',
          source: {
            url: guideUrl,
            page: series === '19' ? 8 : 9,
            table: `Series ${series} dimensional data`,
            depthRulePage: 5,
          },
        })),
    ),
  ),
);
