// Deterministic non-planar cladding generator: a coordinated XYZ surface
// skin over a known, already-built footprint. No dependencies; a pure
// function of (parameters, settings).
//
// This operation deposits the *skin*, not the structure beneath it. It
// takes the footprint and the Z height its support ends at (`baseZ`) as
// given — see manifest.json `dependencies` and
// ../../../../docs/authoring/operations.md for how it composes with a
// scaffold-producing operation such as layer-filling.
//
// Unlike a layered operation, Z changes continuously along each pass
// here, not just between layers — see the "3D toolpath" definition in
// ../../../../docs/authoring/terminology.md.

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

// `+ 0` normalizes a rounded -0 to 0 — see the layer-filling generator's
// `point()` for why this matters for golden-fixture equality.
function point(x, y, z) {
  return { x: Number(x.toFixed(4)) + 0, y: Number(y.toFixed(4)) + 0, z: Number(z.toFixed(4)) + 0 };
}

const SURFACES = new Set(["single_slope", "dome", "saddle"]);

function surfaceHeight(surface, x, y, width, depth, baseZ, rise) {
  if (surface === "dome") {
    const r2 = (x / (width / 2)) ** 2 + (y / (depth / 2)) ** 2;
    return baseZ + Math.max(0, rise * (1 - r2));
  }
  if (surface === "saddle") {
    return baseZ + rise * 0.5 * (1 + (x / (width / 2)) ** 2 - (y / (depth / 2)) ** 2);
  }
  // single_slope: linear rise along Y, independent of X.
  return baseZ + rise * (y / depth + 0.5);
}

/**
 * @param {object} args
 * @param {object} args.parameters - surface, width, depth, rise|angle, baseZ (see manifest.json `inputs`)
 * @param {object} args.settings - process settings: spacing
 * @returns {{ part: object, paths: Array }}
 */
export function generate({ parameters = {}, settings = {} }) {
  const requestedSurface = String(parameters.surface || "single_slope");
  const surface = SURFACES.has(requestedSurface) ? requestedSurface : "single_slope";
  const width = finite(parameters.width ?? parameters.size, 40, 5, 500);
  const depth = finite(parameters.depth ?? parameters.size, width, 5, 500);
  const rise = finite(
    parameters.rise,
    parameters.angle ? Math.tan((Number(parameters.angle) * Math.PI) / 180) * depth : 8,
    0.1,
    200
  );
  const baseZ = finite(parameters.baseZ, 0, 0, 1000);
  const spacing = finite(settings.spacing, 0.78, 0.1, 20);

  // A straight slope only needs its two endpoints per pass; a curved
  // surface needs enough samples along Y to represent its curvature.
  const samplesAcross = surface === "single_slope" ? 1 : 20;
  const paths = [];

  let index = 0;
  for (let x = -width / 2 + spacing / 2; x <= width / 2 - spacing / 2; x += spacing, index += 1) {
    const points = [];
    const goingPositiveY = index % 2 === 0;
    for (let sample = 0; sample <= samplesAcross; sample += 1) {
      const f = sample / samplesAcross;
      const y = (goingPositiveY ? -depth / 2 : depth / 2) + (goingPositiveY ? depth : -depth) * f;
      points.push(point(x, y, surfaceHeight(surface, x, y, width, depth, baseZ, rise)));
    }
    paths.push({
      family: `${surface.replaceAll("_", " ")} cladding`,
      layer: 0,
      points,
      intent: "print",
    });
  }

  return {
    part: { shape: "surface", width, depth, height: Number((baseZ + rise).toFixed(4)), surface },
    paths,
  };
}
