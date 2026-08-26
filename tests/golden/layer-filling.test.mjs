import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "../../operations/additive/planar/layer-filling/generator.mjs";

const opDir = fileURLToPath(new URL("../../operations/additive/planar/layer-filling/", import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(`${opDir}examples/${name}`, "utf8"));
}

test("layer-filling: rectilinear output matches its golden fixture", () => {
  const { input, expected } = loadFixture("rectilinear-box.json");
  assert.deepEqual(generate(input), expected);
});

test("layer-filling: concentric output matches its golden fixture", () => {
  const { input, expected } = loadFixture("concentric-ring.json");
  assert.deepEqual(generate(input), expected);
});

test("layer-filling: is deterministic across repeated calls", () => {
  const input = { parameters: { width: 25, depth: 25, layers: 4 }, settings: {} };
  assert.deepEqual(generate(input), generate(input));
});

test("layer-filling: every point stays within the declared part envelope", () => {
  const { part, paths } = generate({
    parameters: { width: 30, depth: 20, layers: 3, wallCount: 2 },
    settings: { layerHeight: 1, beadWidth: 0.83, spacing: 0.78 },
  });
  const halfW = part.width / 2 + 1e-6;
  const halfD = part.depth / 2 + 1e-6;
  for (const entry of paths) {
    for (const p of entry.points) {
      assert.ok(Math.abs(p.x) <= halfW, `x=${p.x} exceeds half-width ${halfW}`);
      assert.ok(Math.abs(p.y) <= halfD, `y=${p.y} exceeds half-depth ${halfD}`);
    }
  }
});

test("layer-filling: perimeter path families are closed contours", () => {
  const { paths } = generate({
    parameters: { outerDiameter: 40, innerDiameter: 28, layers: 1 },
    settings: {},
  });
  const closedFamilies = new Set(["Outer perimeter", "Inner perimeter"]);
  for (const entry of paths) {
    if (!closedFamilies.has(entry.family)) continue;
    const first = entry.points[0];
    const last = entry.points.at(-1);
    assert.equal(first.x, last.x, `${entry.family} is not closed (x)`);
    assert.equal(first.y, last.y, `${entry.family} is not closed (y)`);
  }
});

test("layer-filling: circular/annular fill alternates raster direction by layer, same as the rectangular case", () => {
  const { paths } = generate({
    parameters: { outerDiameter: 30, innerDiameter: 12, layers: 3 },
    settings: {},
  });
  const isHorizontal = (points) => Math.abs(points[0].y - points[1].y) < 1e-6;
  for (let layer = 0; layer < 3; layer += 1) {
    const fillLines = paths.filter((p) => p.family === "Region-first raster" && p.layer === layer);
    assert.ok(fillLines.length > 0, `layer ${layer} has no fill`);
    const expectedHorizontal = layer % 2 === 0;
    for (const line of fillLines) {
      assert.equal(
        isHorizontal(line.points),
        expectedHorizontal,
        `layer ${layer} should be ${expectedHorizontal ? "horizontal" : "vertical"}`
      );
    }
  }
  // Confirms this isn't accidentally the old identical-every-layer
  // concentric fill: layer 0 and layer 1 must actually differ.
  const layer0 = paths.filter((p) => p.family === "Region-first raster" && p.layer === 0);
  const layer1 = paths.filter((p) => p.family === "Region-first raster" && p.layer === 1);
  assert.notDeepEqual(layer0, layer1);
});

test("layer-filling: circular fill stays clipped to the outer boundary and routes around the inner hole", () => {
  const { paths } = generate({
    parameters: { outerDiameter: 30, innerDiameter: 12, layers: 1 },
    settings: {},
  });
  const outerR = 15 + 1e-3;
  const innerR = 6 - 1e-3;
  for (const entry of paths.filter((p) => p.family === "Region-first raster")) {
    for (const p of entry.points) {
      const r = Math.hypot(p.x, p.y);
      assert.ok(r <= outerR, `point radius ${r} exceeds outer boundary`);
      assert.ok(r >= innerR, `point radius ${r} falls inside the inner hole`);
    }
  }
});

test("layer-filling: layer count matches the request", () => {
  const { paths } = generate({ parameters: { width: 20, depth: 20, layers: 5 }, settings: {} });
  const layerIndices = new Set(paths.map((p) => p.layer));
  assert.equal(layerIndices.size, 5);
});

test("layer-filling: omitting the new solid/density/bore parameters reproduces prior behavior exactly", () => {
  const base = { parameters: { width: 20, depth: 20, layers: 6, wallCount: 2 }, settings: { layerHeight: 1, beadWidth: 0.8, spacing: 0.78 } };
  const withDefaults = {
    parameters: { ...base.parameters, solidBottomLayers: 0, solidTopLayers: 0, infillDensity: undefined, boreDiameter: undefined },
    settings: base.settings,
  };
  assert.deepEqual(generate(withDefaults), generate(base));
});

test("layer-filling: solidBottomLayers/solidTopLayers fill at full density (line spacing == beadWidth) regardless of infillDensity", () => {
  const beadWidth = 0.8;
  const { paths } = generate({
    parameters: { width: 20, depth: 20, layers: 6, wallCount: 1, solidBottomLayers: 2, solidTopLayers: 2, infillDensity: 0.2 },
    settings: { layerHeight: 1, beadWidth, spacing: 0.78 },
  });
  const lineSpacing = (layer) => {
    const lines = paths.filter((p) => p.family === "Region-first raster" && p.layer === layer);
    const coordKey = layer % 2 === 0 ? "y" : "x";
    const coords = [...new Set(lines.map((l) => l.points[0][coordKey]))].sort((a, b) => a - b);
    return coords[1] - coords[0];
  };
  // Layers 0,1 and 4,5 are the forced-solid bottom/top layers (6 total, 2 each end).
  assert.ok(Math.abs(lineSpacing(0) - beadWidth) < 1e-6, "bottom solid layer should be packed at beadWidth");
  assert.ok(Math.abs(lineSpacing(5) - beadWidth) < 1e-6, "top solid layer should be packed at beadWidth");
  // Layers 2,3 are the sparse middle — spaced far wider, per infillDensity.
  const expectedSparseSpacing = beadWidth / 0.2;
  assert.ok(Math.abs(lineSpacing(2) - expectedSparseSpacing) < 1e-6, "middle layer should use the infillDensity-derived spacing");
});

test("layer-filling: infillDensity computes line spacing as beadWidth / density", () => {
  const beadWidth = 0.8;
  const density = 0.25;
  const { paths } = generate({
    parameters: { width: 20, depth: 20, layers: 1, wallCount: 1, infillDensity: density },
    settings: { layerHeight: 1, beadWidth, spacing: 0.78 },
  });
  const lines = paths.filter((p) => p.family === "Region-first raster" && p.layer === 0);
  const ys = [...new Set(lines.map((l) => l.points[0].y))].sort((a, b) => a - b);
  assert.ok(Math.abs(ys[1] - ys[0] - beadWidth / density) < 1e-6);
});

test("layer-filling: a bore excludes fill and wall points within its radius on affected layers, and is entirely absent elsewhere", () => {
  const wallCount = 2;
  const spacing = 0.78;
  const beadWidth = 0.8;
  const layerHeight = 1;
  const layers = 6; // 6mm tall part, bore penetrates the top 3mm (half)
  const boreDiameter = 3;
  const boreR = boreDiameter / 2;
  const { part, paths } = generate({
    parameters: { width: 20, depth: 20, layers, wallCount, boreDiameter, boreDepth: 3 },
    settings: { layerHeight, beadWidth, spacing },
  });

  // point() rounds each coordinate to 4 decimal places independently, so a
  // clipped endpoint that's mathematically exactly on the exclusion circle
  // can land a few 1e-5 inside it after rounding — 1e-3 margin comfortably
  // covers that without weakening what the check is actually for.
  const fillExclusionR = boreR + wallCount * spacing - 1e-3;
  for (const entry of paths.filter((p) => p.family === "Region-first raster")) {
    const affected = entry.layer >= layers / 2; // top half, per boreDepth === height/2
    for (const p of entry.points) {
      const r = Math.hypot(p.x, p.y);
      if (affected) assert.ok(r >= fillExclusionR, `layer ${entry.layer}: fill point at r=${r} falls inside the bore's exclusion zone`);
    }
  }

  // The bore's own inner-perimeter walls appear only on affected (top-half) layers, wallCount of them per layer.
  for (let layer = 0; layer < layers; layer += 1) {
    const innerWalls = paths.filter((p) => p.family === "Inner perimeter" && p.layer === layer);
    if (layer >= layers / 2) assert.equal(innerWalls.length, wallCount, `layer ${layer} should have ${wallCount} bore walls`);
    else assert.equal(innerWalls.length, 0, `layer ${layer} should have no bore walls (below the bore's depth)`);
  }

  // Returned part shape carries the bore forward, same as any other declared dimension.
  assert.equal(part.boreDiameter, boreDiameter);
  assert.equal(part.boreDepth, 3);
});

test("layer-filling: a blind bore's floor gets solidTopLayers of full-density cap beneath it, not left as ordinary sparse infill", () => {
  const beadWidth = 0.8;
  const spacing = 0.78;
  const solidTopLayers = 3;
  // Same shape as the real 20mm test-cube case this was reported against:
  // 40 layers, 0.5mm layer height, a 10mm bore penetrating the top half.
  const { paths } = generate({
    parameters: {
      width: 20,
      depth: 20,
      layers: 40,
      wallCount: 2,
      solidBottomLayers: 3,
      solidTopLayers,
      infillDensity: 0.2,
      boreDiameter: 10,
      boreDepth: 10,
    },
    settings: { layerHeight: 0.5, beadWidth, spacing },
  });

  const lineSpacing = (layer) => {
    const lines = paths.filter((p) => p.family === "Region-first raster" && p.layer === layer);
    const coordKey = layer % 2 === 0 ? "y" : "x";
    const coords = [...new Set(lines.map((l) => l.points[0][coordKey]))].sort((a, b) => a - b);
    return coords[1] - coords[0];
  };

  // Layer 19 (0-indexed) is the last layer below the bore (its top surface
  // is the bore's floor). It and the 2 layers below it (17, 18) should now
  // be solid floor-cap layers — no hole (they're below the bore's depth
  // anyway) and full density.
  for (const layer of [17, 18, 19]) {
    assert.ok(Math.abs(lineSpacing(layer) - beadWidth) < 1e-6, `layer ${layer} should be a solid floor-cap layer`);
    const innerWalls = paths.filter((p) => p.family === "Inner perimeter" && p.layer === layer);
    assert.equal(innerWalls.length, 0, `layer ${layer} is below the bore's depth and should have no bore walls`);
  }
  // One layer further down, outside the 3-layer cap, should still be
  // ordinary sparse middle infill — confirms the cap is scoped, not
  // accidentally solidifying everything beneath the bore.
  assert.ok(Math.abs(lineSpacing(16) - beadWidth / 0.2) < 1e-6, "layer 16 should still be sparse, outside the floor cap");
});

test("layer-filling: a through-hole (boreDepth === height) gets no floor cap, since it has no floor", () => {
  const beadWidth = 0.8;
  const { paths } = generate({
    parameters: { width: 20, depth: 20, layers: 10, wallCount: 1, solidTopLayers: 3, boreDiameter: 6, boreDepth: 5 /* === layers*layerHeight */ },
    settings: { layerHeight: 0.5, beadWidth, spacing: 0.78 },
  });
  // Every layer is bore-affected (boreDepth spans the full height), so
  // there's no "layer below the bore" to have become an unrequested solid
  // cap — every layer should show the bore hole (Inner perimeter walls).
  for (let layer = 0; layer < 10; layer += 1) {
    const innerWalls = paths.filter((p) => p.family === "Inner perimeter" && p.layer === layer);
    assert.equal(innerWalls.length, 1, `layer ${layer} of a through-hole should have exactly 1 bore wall (wallCount:1)`);
  }
});
