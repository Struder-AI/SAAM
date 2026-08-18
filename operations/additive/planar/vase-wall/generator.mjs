// Deterministic single-wall spiral ("vase mode") generator: one
// continuous helical wall rising from a base diameter to a top diameter,
// radius and Z both varying linearly together. No dependencies; a pure
// function of (parameters, settings).
//
// This is an ordinary planar (XY) ring, the same family as
// layer-filling's own "Outer perimeter" — it just never resets Z back to
// a constant between passes, and its radius is allowed to change per
// revolution instead of staying fixed. It is not a heightfield surface
// like non-planar-cladding (Z is not a function of X/Y position within a
// pass) and does not need coordinated-xyz-motion — planar-motion is all
// this requires. `layer` increments once per full revolution purely so
// the workbench's build-progress slider has something to scrub through;
// the physical motion this describes never actually stops or restarts
// between revolutions.

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
// `+ 0` normalizes a rounded -0 to 0 — see layer-filling's `point()` for
// why this matters for golden-fixture equality.
function point(x, y, z) {
  return { x: Number(x.toFixed(4)) + 0, y: Number(y.toFixed(4)) + 0, z: Number(z.toFixed(4)) + 0 };
}

const POINTS_PER_TURN = 48;
// tan(45deg) = 1: a per-revolution (i.e. per-layer-height, since one
// revolution here always spans exactly one layer height) radial shift
// beyond one full layer height is steeper than the ~45deg unsupported-
// overhang guideline cited across FDM printing generally. This is a
// general guideline pulled from the wider FDM literature, not a claim
// evidenced on this project's own hardware — see README.md.
const MAX_SAFE_SHIFT_RATIO = 1;

/**
 * @param {object} args
 * @param {object} args.parameters - baseOuterDiameter, topOuterDiameter, height, zStart (see manifest.json `inputs`)
 * @param {object} args.settings - process settings: layerHeight
 * @returns {{ part: object, paths: Array, warnings?: Array<{code: string, message: string}> }}
 */
export function generate({ parameters = {}, settings = {} }) {
  const layerHeight = finite(settings.layerHeight, 0.7, 0.05, 5);
  const baseOuterDiameter = finite(parameters.baseOuterDiameter, 30, 2, 2000);
  const topOuterDiameter = finite(parameters.topOuterDiameter ?? parameters.baseOuterDiameter, baseOuterDiameter, 2, 2000);
  const height = finite(parameters.height, 40, layerHeight, 2000);
  const zStart = finite(parameters.zStart, 0, -1000, 1000);

  const baseRadius = baseOuterDiameter / 2;
  const topRadius = topOuterDiameter / 2;
  // One revolution per layer height is what makes `layer` a meaningful
  // progress-slider index without ever actually stopping the motion —
  // see the file header.
  const revolutions = Math.max(1, Math.round(height / layerHeight));
  const totalSamples = revolutions * POINTS_PER_TURN;
  const radialShiftPerRevolution = (topRadius - baseRadius) / revolutions;

  const paths = [];
  for (let layer = 0; layer < revolutions; layer += 1) {
    const points = [];
    for (let sample = 0; sample <= POINTS_PER_TURN; sample += 1) {
      const globalSample = layer * POINTS_PER_TURN + sample;
      const f = globalSample / totalSamples;
      const angle = f * revolutions * Math.PI * 2;
      const radius = baseRadius + (topRadius - baseRadius) * f;
      const z = zStart + height * f;
      points.push(point(radius * Math.cos(angle), radius * Math.sin(angle), z));
    }
    paths.push({ family: "Spiral wall", layer, points, intent: "print" });
  }

  const isTapered = Math.abs(topOuterDiameter - baseOuterDiameter) > 1e-6;
  const result = {
    part: {
      shape: isTapered ? "cone" : "cylinder",
      outerDiameter: topOuterDiameter,
      ...(isTapered ? { baseOuterDiameter } : {}),
      height: Number((zStart + height).toFixed(4)),
    },
    paths,
  };

  const angleFromVertical = (Math.atan(Math.abs(radialShiftPerRevolution) / layerHeight) * 180) / Math.PI;
  if (Math.abs(radialShiftPerRevolution) > layerHeight * MAX_SAFE_SHIFT_RATIO) {
    result.warnings = [
      {
        code: "steep-taper",
        message:
          `This taper needs about ${angleFromVertical.toFixed(1)} deg of overhang per revolution ` +
          `(${radialShiftPerRevolution.toFixed(3)} mm radial shift over one ${layerHeight} mm layer height), ` +
          "steeper than the ~45 deg unsupported-overhang guideline used across FDM printing generally. " +
          "That guideline is general FDM knowledge, not evidence from this project's own hardware — no " +
          "vase/spiral wall at this taper rate has been run on the reference machine yet. Consider a " +
          "gentler taper, more height for the same diameter change, or planning for support.",
      },
    ];
  }

  return result;
}
