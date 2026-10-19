// The four independent accuracy controls. Edit here and restart SAAM.
// Derived quantities below and process-relative budgets at their callers preserve
// the default behavior; core/README.md#dimensions-and-tolerances owns the units.
export const TOLERANCE_POLICY = Object.freeze({
  printResolutionMm: 1e-3,
  constructionMm: 0.01,
  programDecimals: 5,
  roundingMm: 1e-6
});

export const PRINT_RESOLUTION_MM = TOLERANCE_POLICY.printResolutionMm;
export const CONSTRUCTION_TOLERANCE_MM = TOLERANCE_POLICY.constructionMm;
export const PROGRAM_DECIMALS = TOLERANCE_POLICY.programDecimals;
export const ROUNDING_MM = TOLERANCE_POLICY.roundingMm;

// A physical reference span (beds <=350 mm, arm reach 500 mm), not an accuracy.
export const BUILD_SCALE_MM = 1000;
// Native Booleans get half the construction budget; their chords and boundary
// matching subdivide this again at the kernel boundary.
export const BOOLEAN_TOLERANCE_MM = CONSTRUCTION_TOLERANCE_MM / 2;
// Shared construction bins: ordinary chords, coarse/display chords and loose contact.
export const CHORD_TOLERANCE_MM = 2 * CONSTRUCTION_TOLERANCE_MM;
export const FEATURE_TOLERANCE_MM = 3 * CONSTRUCTION_TOLERANCE_MM;
export const COARSE_CHORD_TOLERANCE_MM = 5 * CONSTRUCTION_TOLERANCE_MM;
export const CONTACT_TOLERANCE_MM = 10 * CONSTRUCTION_TOLERANCE_MM;
export const ROUNDING_RELATIVE = ROUNDING_MM / BUILD_SCALE_MM;
export const FLOAT64_EPSILON = Number.EPSILON; // float64 format fact
export const PROGRAM_STEP_MM = 10 ** -PROGRAM_DECIMALS;
export const PROGRAM_SLACK_MM = 10 * PROGRAM_STEP_MM;
// XYZ writes two fewer decimals than filament/internal geometry (3 versus 5).
export const XYZ_PROGRAM_DECIMALS = Math.max(0, PROGRAM_DECIMALS - 2);

export const TOLERANCE = Object.freeze({
  chord: PRINT_RESOLUTION_MM,
  constructionFraction: CONSTRUCTION_TOLERANCE_MM / 1, // native unit-length reference
  unitFraction: PRINT_RESOLUTION_MM / 1, // dimensionless budget across a 1 mm reference
  parameter: PROGRAM_STEP_MM / BUILD_SCALE_MM,
  domainFraction: PRINT_RESOLUTION_MM / BUILD_SCALE_MM
});

// Changing any control invalidates future generation through the existing source
// identity. Saved programs retain their exact bytes.
export const GENERATION_PARAMETERS = TOLERANCE_POLICY;
