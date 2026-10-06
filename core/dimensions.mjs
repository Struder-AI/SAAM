// The dimensions SAAM works at and the tolerance classes derived from them, in mm.
// core/README.md#dimensions-and-tolerances owns the reasoning; every tolerance in
// SAAM is one of these classes or derived from the print's own line width or layer
// height, and names which.

// Machine reach bounds every coordinate: beds up to 350 mm, the Denso arm 500 mm.
export const BUILD_SCALE_MM = 1000;

// Print resolution: geometry differences below this cannot change a print. It is
// 10x below the best machine repeatability (about 0.01 mm), 60x below the thinnest
// layer (0.06 mm) and 400x below the narrowest line (0.4 mm). Shape judgements
// (coincident, touching, thin, closed) use it.
export const PRINT_RESOLUTION_MM = 1e-3;

// Numeric conditioning: float64 safety at build scale. One ulp at 1000 mm is
// 1.1e-13 mm, so this leaves about 1e4 ulps for accumulated rounding. Robustness
// only (degeneracy guards, certifying a predicate); never to judge shape.
export const NUMERIC_MM = 1e-9;
// The same conditioning for dimensionless quantities: cosines, unit vectors,
// fractions of a span.
export const NUMERIC_RELATIVE = NUMERIC_MM / BUILD_SCALE_MM;

// Program resolution: G-code exporters write coordinates and filament length with
// this many decimals (1e-5 mm), 100x below print resolution, so rounding the
// program never changes the print.
export const PROGRAM_DECIMALS = 5;
// One step of program resolution, and the slack for a value that passed through a
// few rounded program numbers (a retraction and its recovery, a written bound).
export const PROGRAM_STEP_MM = 10 ** -PROGRAM_DECIMALS;
export const PROGRAM_SLACK_MM = 10 * PROGRAM_STEP_MM;
