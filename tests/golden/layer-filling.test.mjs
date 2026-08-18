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
