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

// Rounding guards: the slack that absorbs floating-point rounding in a predicate
// or a division, derived from the functional tolerance it protects. A thousandth
// of print resolution (agent-determined, 2026-10-06): float64 rounding at build
// scale (1.1e-13 mm per operation) sits seven orders below it, and it sits three
// orders below every shape judgement, so a guard never decides shape.
export const ROUNDING_MM = PRINT_RESOLUTION_MM / 1000;
// The same guard for dimensionless quantities (cosines, unit vectors, fractions of
// a span): a rounding guard across the build scale.
export const ROUNDING_RELATIVE = ROUNDING_MM / BUILD_SCALE_MM;

// Program resolution: G-code exporters write coordinates and filament length with
// this many decimals (1e-5 mm), 100x below print resolution, so rounding the
// program never changes the print.
export const PROGRAM_DECIMALS = 5;
// One step of program resolution, and the slack for a value that passed through a
// few rounded program numbers (a retraction and its recovery, a written bound).
export const PROGRAM_STEP_MM = 10 ** -PROGRAM_DECIMALS;
export const PROGRAM_SLACK_MM = 10 * PROGRAM_STEP_MM;
