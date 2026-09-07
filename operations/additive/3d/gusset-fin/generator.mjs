import { withTravel } from "../../../travel.mjs";
// Deterministic gusset-fin generator: a triangular reinforcing rib in the
// corner between a vertical wall and the horizontal face it stands on.
// No dependencies; a pure function of (parameters, settings).
//
// The distinguishing idea is the build direction. A gusset is a right
// triangle, and stacking it in ordinary constant-Z layers means every
// layer is a different length and the first one is the entire footprint —
// the triangle stands on its base and each layer overhangs the last on its
// sloped side. This operation instead stacks layers *perpendicular to the
// hypotenuse*, growing out of the corner: layer 1 is a short segment right
// where the wall meets the face, each layer is a little longer, and the
// final layer is the hypotenuse itself, laid down in one straight pass.
// The triangle stands on its tip, in the print's own frame of reference.
//
// So the layers are planar — but in a plane that is freely oriented, not
// horizontal. Every pass therefore changes Z continuously along its own
// length, which is why this operation requires coordinated-xyz-motion and
// lives under 3d/ rather than planar/. See
// ../../../../docs/authoring/terminology.md for the "3D toolpath"
// definition this matches.
//
// Local frame: the origin is the corner itself — where the wall face meets
// the base face. +X runs out along the base, +Z runs up the wall, and Y is
// the fin's thickness, centered on zero. Where that corner actually sits in
// the finished part, and which way the fin points, is the plan's business,
// not this operation's: see the `at` field in
// ../../../../schemas/process-plan/process-plan.schema.json.

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

// `+ 0` normalizes a rounded -0 to 0 — see the layer-filling generator's
// `point()` for why this matters for golden-fixture equality.
function point(x, y, z) {
  return { x: Number(x.toFixed(4)) + 0, y: Number(y.toFixed(4)) + 0, z: Number(z.toFixed(4)) + 0 };
}

/**
 * @param {object} args
 * @param {object} args.parameters - length, height, thickness, baseZ (see manifest.json `inputs`)
 * @param {object} args.settings - process settings: layerHeight, beadWidth
 * @returns {{ part: object, paths: Array, warnings?: Array }}
 */
function generateGeometry({ parameters = {}, settings = {} }) {
  const layerHeight = finite(settings.layerHeight, 0.7, 0.05, 5);
  const beadWidth = finite(settings.beadWidth, 0.83, 0.1, 5);

  const length = finite(parameters.length, 20, 1, 1000);
  const height = finite(parameters.height, 20, 1, 1000);
  const thickness = finite(parameters.thickness, beadWidth, beadWidth, 100);
  const baseZ = finite(parameters.baseZ, 0, -1000, 1000);

  const warnings = [];

  // The triangle's legs are `length` (along +X) and `height` (along +Z);
  // the hypotenuse closes them. `reach` is the perpendicular distance from
  // the corner to that hypotenuse — the total depth this fin builds
  // through, and therefore what the layer count divides up.
  const diagonal = Math.hypot(height, length);
  const reach = (height * length) / diagonal;
  const layers = Math.max(1, Math.round(reach / layerHeight));
  const step = reach / layers;

  // Beads across the fin's thickness. A gusset is usually a very thin
  // feature, so one bead is both the default and the common case.
  const beadCount = Math.max(1, Math.round(thickness / beadWidth));
  const yOffsets =
    beadCount === 1
      ? [0]
      : Array.from(
          { length: beadCount },
          (_, k) => -thickness / 2 + beadWidth / 2 + (k * (thickness - beadWidth)) / (beadCount - 1)
        );

  // The build direction leans away from vertical by exactly atan(height /
  // length). Past 45 degrees the fin is being printed more sideways than
  // upward, which is the same unsupported-overhang guideline vase-wall
  // warns against — a general FDM rule of thumb, not a measurement from
  // this project's own hardware.
  const leanDegrees = (Math.atan2(height, length) * 180) / Math.PI;
  if (leanDegrees > 45) {
    warnings.push({
      code: "steep-fin-lean",
      message:
        `A fin ${height} tall over ${length} long leans its build direction ${leanDegrees.toFixed(1)} degrees ` +
        `from vertical, past the ~45 degree unsupported-overhang guideline used across FDM printing generally. ` +
        `Lengthening the fin or lowering it brings the lean back down.`,
    });
  }

  const paths = [];
  let pass = 0;
  for (let layer = 0; layer < layers; layer += 1) {
    const distance = (layer + 1) * step;
    // Where this layer's line crosses each leg. At the final layer these
    // resolve exactly to (length, 0) and (0, height) — the hypotenuse.
    const alongBase = (distance * diagonal) / height;
    const upWall = (distance * diagonal) / length;

    // Snake across thickness too: the next layer begins at the same Y
    // edge where the preceding layer finished, without sweeping back
    // across the fin's entire thickness.
    const offsets = layer % 2 === 0 ? yOffsets : [...yOffsets].reverse();
    for (const y of offsets) {
      // Alternating direction pass to pass keeps the fin one connected
      // serpentine instead of a stack of disconnected strokes, the same
      // convention layer-filling's raster uses.
      const outward = pass % 2 === 0;
      const base = point(alongBase, y, baseZ);
      const wall = point(0, y, baseZ + upWall);
      const points = outward ? [wall, base] : [base, wall];
      const previous = paths.at(-1)?.points.at(-1);
      if (previous) {
        // Both ends lie on the same base or wall face of this convex
        // triangular prism. Their straight connection stays in the fin.
        // This is deliberate deposition, independent of gap length.
        paths.push({ family: "Fin connection", layer, points: [previous, points[0]], intent: "print" });
      }
      paths.push({
        family: "Fin layer",
        layer,
        points,
        intent: "print",
      });
      pass += 1;
    }
  }

  return {
    part: {
      shape: "gusset",
      length,
      height: Number((baseZ + height).toFixed(4)),
      thickness,
    },
    paths,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// Explicit travel and hops are opt-in through the shared process setting.
export function generate(args = {}) {
  const result = generateGeometry(args);
  return { ...result, paths: withTravel(result.paths, args.settings?.travelHopHeight) };
}
