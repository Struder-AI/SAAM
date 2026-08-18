// Deterministic planar layer-filling generator: rectilinear and concentric
// coverage. No dependencies; a pure function of (parameters, settings).
//
// See ../../../../docs/authoring/operations.md for the manifest contract
// this module is registered against (operations/additive/planar/layer-filling/manifest.json).

const TAU = Math.PI * 2;

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
function integer(value, fallback, min = 0, max = 10000) {
  return Math.round(finite(value, fallback, min, max));
}
// The `+ 0` normalizes a rounded -0 (routine from cos/sin near axis
// crossings) to 0 — JSON has no signed zero, so a fixture written via
// JSON.stringify silently loses the sign, and a generator that kept
// emitting -0 in memory would fail equality against its own fixture.
function point(x, y, z) {
  return { x: Number(x.toFixed(4)) + 0, y: Number(y.toFixed(4)) + 0, z: Number(z.toFixed(4)) + 0 };
}
function ring(radius, z, samples = 96) {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const a = (TAU * i) / samples;
    return point(radius * Math.cos(a), radius * Math.sin(a), z);
  });
}
function rectangle(width, depth, z, offset = 0) {
  const x = Math.max(0, width / 2 - offset);
  const y = Math.max(0, depth / 2 - offset);
  return [point(-x, -y, z), point(x, -y, z), point(x, y, z), point(-x, y, z), point(-x, -y, z)];
}

// Alternates raster direction by layer so consecutive layers cross rather
// than stack, and alternates line start/end so the raster is one connected
// region-first sweep rather than a set of disconnected segments.
function raster(width, depth, z, spacing, layer) {
  const horizontal = layer % 2 === 0;
  const primary = horizontal ? depth : width;
  const secondary = horizontal ? width : depth;
  const lines = [];
  for (
    let coordinate = -primary / 2 + spacing / 2, line = 0;
    coordinate <= primary / 2 - spacing / 2;
    coordinate += spacing, line += 1
  ) {
    const a = -secondary / 2 + spacing / 2;
    const b = secondary / 2 - spacing / 2;
    const from = line % 2 === 0 ? a : b;
    const to = line % 2 === 0 ? b : a;
    lines.push(
      horizontal
        ? [point(from, coordinate, z), point(to, coordinate, z)]
        : [point(coordinate, from, z), point(coordinate, to, z)]
    );
  }
  return lines;
}

// One ring per spacing step from the innermost fillable radius outward,
// consolidating what would otherwise be many disconnected concentric
// contours into a predictable, evenly-spaced set.
function circularFill(innerRadius, outerRadius, z, spacing) {
  const paths = [];
  for (
    let radius = Math.max(spacing / 2, innerRadius + spacing / 2);
    radius <= outerRadius - spacing / 2 + 1e-6;
    radius += spacing
  ) {
    paths.push(ring(radius, z));
  }
  return paths;
}

function pathEntry(family, layer, points, intent = "print") {
  return { family, layer, points, intent };
}
function round4(value) {
  return Number(value.toFixed(4));
}

/**
 * @param {object} args
 * @param {object} args.parameters - operation-specific inputs (see manifest.json `inputs`)
 * @param {object} args.settings - process settings: layerHeight, beadWidth, spacing
 * @returns {{ part: object, paths: Array }}
 */
export function generate({ parameters = {}, settings = {} }) {
  const layerHeight = finite(settings.layerHeight, 0.7, 0.05, 5);
  const spacing = finite(settings.spacing, 0.78, 0.1, 5);
  const beadWidth = finite(settings.beadWidth, 0.83, 0.1, 5);
  const wallCount = integer(parameters.wallCount, 2, 1, 8);
  const layers = integer(parameters.layers ?? parameters.layerCount, 1, 1, 300);
  const zStart = finite(parameters.zStart, 0, -1000, 1000);

  const circular =
    parameters.geometry === "annulus" ||
    parameters.geometry === "circle" ||
    Number.isFinite(Number(parameters.outerDiameter ?? parameters.diameter));

  const paths = [];

  if (circular) {
    const outerDiameter = finite(parameters.outerDiameter ?? parameters.diameter, 40, 2, 2000);
    const innerDiameter = finite(
      parameters.innerDiameter,
      0,
      0,
      Math.max(0, outerDiameter - 2 * beadWidth)
    );
    for (let layer = 0; layer < layers; layer += 1) {
      const z = zStart + (layer + 1) * layerHeight;
      paths.push(pathEntry("Outer perimeter", layer, ring(outerDiameter / 2 - beadWidth / 2, z)));
      if (innerDiameter > 0) {
        paths.push(pathEntry("Inner perimeter", layer, ring(innerDiameter / 2 + beadWidth / 2, z)));
      }
      circularFill(innerDiameter / 2, outerDiameter / 2, z, spacing).forEach((points) =>
        paths.push(pathEntry("Concentric fill", layer, points))
      );
    }
    return {
      part: {
        shape: innerDiameter > 0 ? "ring" : "cylinder",
        outerDiameter,
        innerDiameter,
        height: round4(zStart + layers * layerHeight),
      },
      paths,
    };
  }

  const width = finite(parameters.width, 40, 2, 2000);
  const depth = finite(parameters.depth ?? parameters.length, width, 2, 2000);
  for (let layer = 0; layer < layers; layer += 1) {
    const z = zStart + (layer + 1) * layerHeight;
    for (let wall = 0; wall < wallCount; wall += 1) {
      paths.push(
        pathEntry("Prioritized perimeter", layer, rectangle(width, depth, z, beadWidth / 2 + wall * spacing))
      );
    }
    raster(width - 2 * wallCount * spacing, depth - 2 * wallCount * spacing, z, spacing, layer).forEach(
      (points) => paths.push(pathEntry("Region-first raster", layer, points))
    );
  }
  return {
    part: { shape: "box", width, depth, height: round4(zStart + layers * layerHeight) },
    paths,
  };
}
