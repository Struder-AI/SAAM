// Manufacturer catalogs are independent verified data sources, not
// interpolated or converted between each other. See ../CATALOG.md for scope,
// units and provenance.
const spirolGuideUrl = 'https://www.spirol.com/assets/files/ins-threaded-inserts-design-guide-us.pdf';

// The guide gives inch nominal dimensions with rounded millimeter conversions.
// Preserve its printed millimeter values consistently for both thread systems.
// Columns: thread choices [name, pitch mm], Series 19 short A, long A (also
// Series 29 A), pilot P, short L (null when unavailable), long L, hole D.
const spirolRows = [
  [[['M2', 0.4], ['2-56', 25.4 / 56]], 3.58, 3.63, 3.12, 3.18, 3.99, 3.20],
  [[['M2.5', 0.45], ['M3', 0.5], ['4-40', 25.4 / 40]], 4.62, 4.75, 3.91, 3.56, 5.74, 3.99],
  [[['M3.5', 0.6], ['6-32', 25.4 / 32]], 5.41, 5.54, 4.70, 3.81, 7.14, 4.78],
  [[['M4', 0.7], ['8-32', 25.4 / 32]], 6.25, 6.38, 5.54, 4.70, 8.15, 5.61],
  [[['M5', 0.8], ['10-24', 25.4 / 24], ['10-32', 25.4 / 32]], 7.04, 7.16, 6.32, 6.35, 9.53, 6.40],
  [[['M6', 1.0], ['1/4-20', 25.4 / 20]], 8.64, 8.76, 7.92, 7.92, 12.70, 8.00],
  [[['M8', 1.25], ['5/16-18', 25.4 / 18]], null, 10.34, 9.50, null, 12.70, 9.58],
];

/** Standard unheaded SPIROL 19/29 heat/ultrasonic inserts: 60 selections. */
const spirolCatalog = ['19', '29'].flatMap(series =>
  spirolRows.flatMap(([threads, shortA, longA, pilot, shortL, longL, hole]) =>
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
          minWallThicknessMm: null,
          holeProfile: 'straight',
          dimensionBasis: 'published-millimeter-conversion',
          source: {
            url: spirolGuideUrl,
            page: series === '19' ? 8 : 9,
            table: `Series ${series} dimensional data`,
            depthRulePage: 5,
          },
        })),
    ),
  ),
);

const cncKitchenPosterUrl = 'https://cdn.shopify.com/s/files/1/0654/4821/4767/files/Poster_Dimensions-Guidlines.pdf';

// CNC Kitchen "Dimensions & Design Guidelines" poster (cnckitchen.store/pages/insert-cad-models),
// retrieved 2026-09-17. Columns: thread, pitch mm, installed length L, insert
// (knurl) diameter D1, recommended hole diameter D2, minimum wall thickness W.
// The poster gives one profile per manufacturer part (no short/long series
// split like SPIROL); some threads have more than one stocked length.
const cncKitchenRows = [
  ['M2', 0.4, 3.0, 3.6, 3.2, 1.3],
  ['M2.5', 0.45, 4.0, 4.6, 4.0, 1.6],
  ['M3', 0.5, 5.7, 4.6, 4.0, 1.6],
  ['M3', 0.5, 3.0, 4.6, 4.0, 1.6],
  ['M3', 0.5, 4.0, 5.0, 4.4, 1.6, 'voron'],
  ['M4', 0.7, 8.1, 6.3, 5.7, 2.1],
  ['M4', 0.7, 4.0, 6.3, 5.7, 2.1],
  ['M5', 0.8, 9.5, 7.1, 6.5, 2.6],
  ['M5', 0.8, 5.8, 7.1, 6.5, 2.6],
  ['M6', 1.0, 12.7, 8.7, 8.1, 3.3],
  ['M8', 1.25, 12.7, 10.2, 9.7, 4.5],
  ['M10', 1.5, 12.7, 12.6, 12.0, 6.0],
  ['2-56', 25.4 / 56, 3.2, 3.6, 3.2, 1.3],
  ['4-40', 25.4 / 40, 5.7, 4.6, 4.0, 1.6],
  ['4-40', 25.4 / 40, 3.6, 4.6, 4.0, 1.6],
  ['6-32', 25.4 / 32, 7.1, 5.4, 4.8, 1.8],
  ['6-32', 25.4 / 32, 3.8, 5.4, 4.8, 1.8],
  ['8-32', 25.4 / 32, 8.2, 6.3, 5.7, 2.1],
  ['8-32', 25.4 / 32, 4.7, 6.3, 5.7, 2.1],
  ['10-24', 25.4 / 24, 9.5, 7.1, 6.5, 2.6],
  ['10-32', 25.4 / 32, 9.5, 7.1, 6.5, 2.6],
  ['1/4-20', 25.4 / 20, 12.7, 8.7, 8.1, 3.3],
  ['1/4-20', 25.4 / 20, 6.4, 8.7, 8.1, 3.3],
  ['5/16-18', 25.4 / 18, 12.7, 10.2, 9.7, 4.5],
  ['3/8-16', 25.4 / 16, 12.7, 12.5, 12.0, 6.0],
];

/** CNC Kitchen's own "Original" heat-set inserts: 24 published selections. */
const cncKitchenCatalog = cncKitchenRows.map(([thread, threadPitchMm, lengthMm, outerDiameterMm, holeDiameterMm, minWallThicknessMm, note]) => ({
  id: `cnckitchen-${thread.toLowerCase().replaceAll('/', '_')}-${lengthMm}${note ? `-${note}` : ''}`,
  manufacturer: 'CNC Kitchen',
  thread,
  threadPitchMm,
  lengthMm,
  holeDiameterMm,
  outerDiameterMm,
  pilotDiameterMm: null,
  bottomClearanceMm: 2 * threadPitchMm,
  minWallThicknessMm,
  holeProfile: 'straight',
  dimensionBasis: 'published-millimeter',
  note,
  source: {
    url: cncKitchenPosterUrl,
    table: 'Metric inserts / UN inserts',
    retrieved: '2026-09-17',
  },
}));

// A single verified McMaster-Carr selection filling the largest fractional
// size (1/2"-13) neither SPIROL nor CNC Kitchen publish. McMaster's own metric
// heat-set-for-plastic line tops out at M10 (confirmed against its live thread-
// size filters on 2026-09-17); it does not offer M12, so M12 is not included
// here pending a verified source. Dimensions are McMaster's own published spec
// for part 94459A743 (Standard/Knurled, Brass): installed length 0.625 in,
// drill/recommended hole 5/8 in, minimum material thickness 0.655 in.
const mcmasterCatalog = [
  {
    id: 'mcmaster-1_2-13',
    manufacturer: 'McMaster-Carr',
    partNumber: '94459A743',
    thread: '1/2-13',
    threadPitchMm: 25.4 / 13,
    lengthMm: 15.875,
    holeDiameterMm: 15.875,
    outerDiameterMm: null,
    pilotDiameterMm: null,
    bottomClearanceMm: 2 * (25.4 / 13),
    minWallThicknessMm: 16.64,
    holeProfile: 'straight',
    dimensionBasis: 'published-millimeter-conversion',
    source: {
      url: 'https://www.mcmaster.com/94459A743/',
      table: 'Heat-Set Threaded Inserts for Plastic, Standard, Brass, 1/2"-13',
      retrieved: '2026-09-17',
    },
  },
];

export const INSERT_CATALOG = [...spirolCatalog, ...cncKitchenCatalog, ...mcmasterCatalog];
