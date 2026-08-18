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

test("layer-filling: perimeter and ring path families are closed contours", () => {
  const { paths } = generate({
    parameters: { outerDiameter: 40, innerDiameter: 28, layers: 1 },
    settings: {},
  });
  const closedFamilies = new Set(["Outer perimeter", "Inner perimeter", "Concentric fill"]);
  for (const entry of paths) {
    if (!closedFamilies.has(entry.family)) continue;
    const first = entry.points[0];
    const last = entry.points.at(-1);
    assert.equal(first.x, last.x, `${entry.family} is not closed (x)`);
    assert.equal(first.y, last.y, `${entry.family} is not closed (y)`);
  }
});

test("layer-filling: layer count matches the request", () => {
  const { paths } = generate({ parameters: { width: 20, depth: 20, layers: 5 }, settings: {} });
  const layerIndices = new Set(paths.map((p) => p.layer));
  assert.equal(layerIndices.size, 5);
});
