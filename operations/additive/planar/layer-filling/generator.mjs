import { withTravel } from "../../../travel.mjs";
// Deterministic planar layer-filling generator: rectilinear and concentric
// coverage. No dependencies; a pure function of (parameters, settings).
//
// See ../../../../docs/authoring/operations.md for the manifest contract
// this module is registered against (operations/additive/planar/layer-filling/manifest.json).

const TAU = Math.PI * 2;
import { orderLayer } from "./ordering.mjs";

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
// An off-center ring, for a hole's own perimeter. ring() above is the
// concentric case and keeps its fixed 96 samples so existing output is
// byte-identical; a bolt hole is typically an order of magnitude smaller
// than the part, where 96 segments is far finer than the bead can
// resolve, so this one picks a sample count from the arc length instead
// and floors it at 24 to stay round at small diameters.
function ringAt(cx, cy, radius, z) {
  const samples = Math.min(96, Math.max(24, Math.ceil((TAU * radius) / 0.6)));
  return Array.from({ length: samples + 1 }, (_, i) => {
    const a = (TAU * i) / samples;
    return point(cx + radius * Math.cos(a), cy + radius * Math.sin(a), z);
  });
}

// Subtracts blocked spans from one base span, returning whatever survives,
// left to right. This is what lets a raster line cross a region containing
// any number of holes: each hole contributes the chord it blocks on that
// line, and the line becomes however many segments are left over.
function subtractIntervals([lo, hi], blocked) {
  let segments = [[lo, hi]];
  for (const [bLo, bHi] of blocked) {
    const next = [];
    for (const [sLo, sHi] of segments) {
      if (bHi <= sLo || bLo >= sHi) {
        next.push([sLo, sHi]);
        continue;
      }
      if (bLo > sLo) next.push([sLo, bLo]);
      if (bHi < sHi) next.push([bHi, sHi]);
    }
    segments = next;
  }
  return segments;
}

// The chord a circular hole blocks on a scan line, or null if the line
// misses it. `across` is the scan line's fixed coordinate; a hole's own
// center is split into the same fixed/varying axes by the caller.
function blockedChord(coordinate, holeAcross, holeAlong, holeR) {
  const d = coordinate - holeAcross;
  if (Math.abs(d) >= holeR) return null;
  const half = Math.sqrt(holeR * holeR - d * d);
  return [holeAlong - half, holeAlong + half];
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

// Clip scan rows to the usable circular boundary and subtract expanded
// bore/hole intervals. Ordering into complete regions happens in ordering.mjs.
function circularRaster(outerRadius, innerRadius, holes, z, spacing, layer) {
  const horizontal = layer % 2 === 0;
  const lines = [];
  let line = 0;
  for (
    let coordinate = -outerRadius + spacing / 2;
    coordinate <= outerRadius - spacing / 2;
    coordinate += spacing, line += 1
  ) {
    const outerHalf = Math.sqrt(Math.max(0, outerRadius * outerRadius - coordinate * coordinate));
    if (outerHalf < spacing / 4) continue; // sliver too thin near the edge to bother printing
    // Alternating start/end side by line, same as raster() above, turns
    // what would otherwise be disconnected segments into one connected
    // sweep back and forth across the region.
    const flip = line % 2 === 0;
    const seg = (from, to) => {
      const [a, b] = flip ? [from, to] : [to, from];
      return horizontal ? [point(a, coordinate, z), point(b, coordinate, z)] : [point(coordinate, a, z), point(coordinate, b, z)];
    };

    const blocked = [];
    if (innerRadius > 0 && Math.abs(coordinate) < innerRadius) {
      const innerHalf = Math.sqrt(Math.max(0, innerRadius * innerRadius - coordinate * coordinate));
      blocked.push([-innerHalf, innerHalf]);
    }
    for (const hole of holes) {
      const chord = blockedChord(
        coordinate,
        horizontal ? hole.y : hole.x,
        horizontal ? hole.x : hole.y,
        hole.r
      );
      if (chord) blocked.push(chord);
    }

    // Only genuinely degenerate segments are dropped. A sub-bead sliver
    // beside a hole is kept, exactly as this function has always kept the
    // equivalent sliver beside the inner perimeter — filtering one but not
    // the other would change existing annulus output for no real gain.
    for (const [from, to] of subtractIntervals([-outerHalf, outerHalf], blocked)) {
      if (to - from > 1e-9) lines.push(seg(from, to));
    }
  }
  return lines;
}

// Rectangular raster fill, optionally excluding a centered circular hole
// (e.g. a bore into the top face) — used instead of raster() whenever a
// layer's fill region isn't a plain rectangle. Same alternating-direction
// and connected-sweep convention as raster() and circularRaster() above;
// holeR <= 0 behaves identically to raster().
function boxRaster(width, depth, holeR, z, spacing, layer) {
  const horizontal = layer % 2 === 0;
  const primary = horizontal ? depth : width;
  const secondary = horizontal ? width : depth;
  if (primary < spacing || secondary < spacing) return [];
  const lines = [];
  let line = 0;
  for (
    let coordinate = -primary / 2 + spacing / 2;
    coordinate <= primary / 2 - spacing / 2;
    coordinate += spacing, line += 1
  ) {
    const a = -secondary / 2 + spacing / 2;
    const b = secondary / 2 - spacing / 2;
    const flip = line % 2 === 0;
    const seg = (from, to) => {
      const [x1, x2] = flip ? [from, to] : [to, from];
      return horizontal
        ? [point(x1, coordinate, z), point(x2, coordinate, z)]
        : [point(coordinate, x1, z), point(coordinate, x2, z)];
    };
    if (holeR <= 0 || Math.abs(coordinate) >= holeR) {
      lines.push(seg(a, b));
      continue;
    }
    const half = Math.sqrt(Math.max(0, holeR * holeR - coordinate * coordinate));
    for (const [from, to] of subtractIntervals([a, b], [[-half, half]])) {
      if (to - from > 1e-9) lines.push(seg(from, to));
    }
  }
  return lines;
}

// Normalizes the `holes` input and rejects any that don't fit the material
// they'd be cut into: a hole has to clear the outer edge, and on an annulus
// the bore too, by at least a bead each side — otherwise there's no wall
// left to print around it and the "hole" is just a bite out of the rim. A
// rejected hole is dropped and reported, never silently clamped into a
// position nobody asked for.
function parseHoles(raw, outerDiameter, innerDiameter, beadWidth, warnings) {
  if (!Array.isArray(raw)) return [];
  const outerR = outerDiameter / 2;
  const innerR = innerDiameter / 2;
  const holes = [];
  raw.forEach((entry, index) => {
    const x = Number(entry?.x);
    const y = Number(entry?.y);
    const diameter = Number(entry?.diameter);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(diameter) || diameter <= 0) {
      warnings.push({
        code: "hole-ignored",
        message: `holes[${index}] needs a finite x, y and a positive diameter; it was ignored.`,
      });
      return;
    }
    const r = diameter / 2;
    const distance = Math.hypot(x, y);
    if (distance + r > outerR - beadWidth) {
      warnings.push({
        code: "hole-outside-part",
        message: `holes[${index}] (dia ${diameter} at ${x}, ${y}) reaches past the outer edge; it was ignored.`,
      });
      return;
    }
    if (innerR > 0 && distance - r < innerR + beadWidth) {
      warnings.push({
        code: "hole-breaks-bore",
        message: `holes[${index}] (dia ${diameter} at ${x}, ${y}) overlaps the bore wall; it was ignored.`,
      });
      return;
    }
    holes.push({ x: round4(x), y: round4(y), r });
  });
  return holes;
}

function pathEntry(family, layer, points, intent = "print") {
  return { family, layer, points, intent };
}
function round4(value) {
  return Number(value.toFixed(4));
}

function connectorClearsHoles(a, b, holes) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  return holes.every(h => {
    const t = length2 ? Math.max(0, Math.min(1, ((h.x-a.x)*dx + (h.y-a.y)*dy)/length2)) : 0;
    return Math.hypot(a.x+t*dx-h.x, a.y+t*dy-h.y) >= h.r - 1e-4;
  });
}

// Region membership, never a distance threshold, determines continuity.
// If a sparse scan skipped enough of a void to invalidate a straight
// connector, that is a geometric region break and remains a travel.
function appendRaster(paths, ordered, layer, holes) {
  let previous = null;
  for (const item of ordered) {
    const from = previous?.points.at(-1), to = item.points[0];
    if (previous?.region === item.region && connectorClearsHoles(from, to, holes)) {
      paths.push(pathEntry("Raster connection", layer, [from, to]));
    }
    paths.push(pathEntry("Region-first raster", layer, item.points));
    previous = item;
  }
}

/**
 * @param {object} args
 * @param {object} args.parameters - operation-specific inputs (see manifest.json `inputs`)
 * @param {object} args.settings - process settings: layerHeight, beadWidth, spacing
 * @returns {{ part: object, paths: Array }}
 */
function generateGeometry({ parameters = {}, settings = {} }) {
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
  // Advisory output from this compile, not plan content — same contract
  // vase-wall's steep-taper check uses; the adapter surfaces these.
  const warnings = [];

  if (circular) {
    const outerDiameter = finite(parameters.outerDiameter ?? parameters.diameter, 40, 2, 2000);
    const innerDiameter = finite(
      parameters.innerDiameter,
      0,
      0,
      Math.max(0, outerDiameter - 2 * beadWidth)
    );
    // Through-holes at arbitrary positions in the face — bolt holes in a
    // flange, say. Distinct from innerDiameter (one concentric annulus)
    // and from the rectangular branch's boreDiameter (one centered bore):
    // these are a set, each with its own center, and they run the full
    // height of this invocation. Each is walled and then excluded from
    // fill, the same order the bore case uses.
    const holes = parseHoles(parameters.holes, outerDiameter, innerDiameter, beadWidth, warnings);

    for (let layer = 0; layer < layers; layer += 1) {
      const pathStart = paths.length;
      const z = zStart + (layer + 1) * layerHeight;
      for (let wall = 0; wall < wallCount; wall += 1) {
        const radius = outerDiameter / 2 - beadWidth / 2 - wall * spacing;
        if (radius <= 0) throw new Error("Requested boundary loops do not fit inside the outer diameter.");
        paths.push(pathEntry("Outer perimeter", layer, ring(radius, z)));
      }
      if (innerDiameter > 0) {
        for (let wall = 0; wall < wallCount; wall += 1) {
          paths.push(pathEntry("Inner perimeter", layer, ring(innerDiameter / 2 + beadWidth / 2 + wall * spacing, z)));
        }
      }
      for (const hole of holes) {
        for (let wall = 0; wall < wallCount; wall += 1) {
          paths.push(
            pathEntry("Hole perimeter", layer, ringAt(hole.x, hole.y, hole.r + beadWidth / 2 + wall * spacing, z))
          );
        }
      }
      // Fill clears each hole's own walls, not just the nominal hole —
      // same allowance the bore case applies via fillHoleR below.
      // Place the fill centerline one spacing beyond the innermost wall
      // centerline, for every boundary (including off-center holes).
      const allowance = beadWidth / 2 + wallCount * spacing;
      const fillHoles = holes.map((h) => ({ ...h, r: h.r + allowance }));
      const fillOuter = outerDiameter / 2 - allowance;
      const fillInner = innerDiameter > 0 ? innerDiameter / 2 + allowance : 0;
      const lines = fillOuter > fillInner ? circularRaster(fillOuter, fillInner, fillHoles, z, spacing, layer) : [];
      const wallLimit = beadWidth / 2 + (wallCount - 1) * spacing;
      const protectedHoles = holes.map(h => ({ ...h, r: h.r + wallLimit }));
      if (innerDiameter > 0) protectedHoles.push({ x: 0, y: 0, r: innerDiameter / 2 + wallLimit });
      appendRaster(paths, orderLayer(paths, pathStart, lines, layer), layer, protectedHoles);
    }
    return {
      part: {
        shape: innerDiameter > 0 ? "ring" : "cylinder",
        outerDiameter,
        innerDiameter,
        height: round4(zStart + layers * layerHeight),
        ...(holes.length > 0
          ? { holes: holes.map((h) => ({ x: h.x, y: h.y, diameter: round4(h.r * 2) })) }
          : {}),
      },
      paths,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  const width = finite(parameters.width, 40, 2, 2000);
  const depth = finite(parameters.depth ?? parameters.length, width, 2, 2000);

  // infillDensity is optional and only changes behavior when given — omit
  // it and every layer keeps using settings.spacing exactly as before, so
  // existing plans/fixtures that don't know about this parameter are
  // unaffected. When given, it's a rough single-layer coverage-fraction
  // model (bead width / line spacing) for a single-direction rectilinear
  // pattern — general infill-density math, not evidence specific to this
  // project. solidBottomLayers/solidTopLayers override it to full density
  // (spacing === beadWidth, lines packed edge to edge) for that many
  // layers at each end, regardless of infillDensity.
  const infillDensity = parameters.infillDensity != null ? finite(parameters.infillDensity, 1, 0.02, 1) : null;
  const solidBottomLayers = integer(parameters.solidBottomLayers, 0, 0, layers);
  const solidTopLayers = integer(parameters.solidTopLayers, 0, 0, layers);

  // A centered cylindrical bore into the top face — distinct from
  // innerDiameter's full-through annulus (round parts only). Always cut
  // through, regardless of a layer's solid/sparse infill classification:
  // a bore that starts at the top face has to stay open through any solid
  // top layers too, or it never actually reaches the surface.
  const boreDiameter = finite(parameters.boreDiameter, 0, 0, Math.min(width, depth));
  const boreDepth = boreDiameter > 0 ? finite(parameters.boreDepth, 0, 0, layers * layerHeight) : 0;
  const boreR = boreDiameter / 2;
  const partTopZ = zStart + layers * layerHeight;

  // A blind bore's floor is a top-facing surface exactly like the part's
  // own outer top — solid material below, open void (the bore) above —
  // so it gets the same solidTopLayers treatment, counting downward from
  // the floor instead of from the part's top. Without this, the layer(s)
  // forming the floor were just ordinary sparse-infill middle layers,
  // leaving a gapped, unsupported-looking bottom to the cavity instead of
  // an actual solid floor.
  const boreFloorLayerIndex = boreR > 0 && boreDepth < layers * layerHeight - 1e-9
    ? Math.round((partTopZ - boreDepth - zStart) / layerHeight) - 1
    : -1;

  for (let layer = 0; layer < layers; layer += 1) {
    const pathStart = paths.length;
    const z = zStart + (layer + 1) * layerHeight;
    const isFloorCap = boreFloorLayerIndex >= 0 && layer <= boreFloorLayerIndex && layer > boreFloorLayerIndex - solidTopLayers;
    const isSolid = layer < solidBottomLayers || layer >= layers - solidTopLayers || isFloorCap;
    const layerSpacing = isSolid ? beadWidth : infillDensity != null ? beadWidth / infillDensity : spacing;
    const hasBore = boreR > 0 && z > partTopZ - boreDepth + 1e-9;

    for (let wall = 0; wall < wallCount; wall += 1) {
      paths.push(
        pathEntry("Prioritized perimeter", layer, rectangle(width, depth, z, beadWidth / 2 + wall * spacing))
      );
    }
    if (hasBore) {
      for (let wall = 0; wall < wallCount; wall += 1) {
        paths.push(pathEntry("Inner perimeter", layer, ring(boreR + beadWidth / 2 + wall * spacing, z)));
      }
    }
    const fillHoleR = hasBore ? boreR + beadWidth / 2 + wallCount * spacing : 0;
    appendRaster(paths, orderLayer(paths, pathStart, boxRaster(width - 2 * wallCount * spacing, depth - 2 * wallCount * spacing, fillHoleR, z, layerSpacing, layer), layer), layer,
      hasBore ? [{ x: 0, y: 0, r: boreR + beadWidth / 2 + (wallCount - 1) * spacing }] : []);
  }
  return {
    part: {
      shape: "box",
      width,
      depth,
      height: round4(zStart + layers * layerHeight),
      ...(boreR > 0 ? { boreDiameter, boreDepth } : {}),
    },
    paths,
  };
}

// Explicit travel and hops are opt-in through the shared process setting.
export function generate(args = {}) {
  const result = generateGeometry(args);
  return { ...result, paths: withTravel(result.paths, args.settings?.travelHopHeight) };
}
