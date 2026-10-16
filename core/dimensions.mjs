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

// Native Boolean accuracy, in mm. This is the one construction setting to tune.
// Curve chords use a quarter of it; boundary matching uses half, leaving room
// for both approximations. Root solving and rounding guards stay finer.
export const BOOLEAN_TOLERANCE_MM = 0.005;

// Rounding guards: the slack that absorbs floating-point rounding in a predicate
// or a division, derived from the functional tolerance it protects. A thousandth
// of print resolution (agent-determined, 2026-10-06): float64 rounding at build
// scale (1.1e-13 mm per operation) sits seven orders below it, and it sits three
// orders below every shape judgement, so a guard never decides shape.
export const ROUNDING_MM = PRINT_RESOLUTION_MM / 1000;
// The same guard for dimensionless quantities (cosines, unit vectors, fractions of
// a span): a rounding guard across the build scale.
export const ROUNDING_RELATIVE = ROUNDING_MM / BUILD_SCALE_MM;
// Float64 spacing at unity; numerical error estimates scale it by operation count.
export const FLOAT64_EPSILON = Number.EPSILON;

// Fine program/geometry resolution: filament length and internal construction
// keep five decimals (1e-5 mm). Written XYZ commands use their approved coarser
// precision below; rates, time and orientation use their own units/effect.
export const PROGRAM_DECIMALS = 5;
// Written XYZ command positions, approved 2026-10-12; filament amounts keep
// five decimals with their rounding remainder. Geometry/admission stay finer.
export const XYZ_PROGRAM_DECIMALS = 3;
// One step of program resolution, and the slack for a value that passed through a
// few rounded program numbers (a retraction and its recovery, a written bound).
export const PROGRAM_STEP_MM = 10 ** -PROGRAM_DECIMALS;
export const PROGRAM_SLACK_MM = 10 * PROGRAM_STEP_MM;
