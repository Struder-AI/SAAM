import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "../../operations/additive/3d/non-planar-cladding/generator.mjs";

const opDir = fileURLToPath(new URL("../../operations/additive/3d/non-planar-cladding/", import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(`${opDir}examples/${name}`, "utf8"));
}

test("non-planar-cladding: single-slope output matches its golden fixture", () => {
  const { input, expected } = loadFixture("single-slope-coupon.json");
  assert.deepEqual(generate(input), expected);
});

test("non-planar-cladding: dome output matches its golden fixture", () => {
  const { input, expected } = loadFixture("dome-coupon.json");
  assert.deepEqual(generate(input), expected);
});

test("non-planar-cladding: is deterministic across repeated calls", () => {
  const input = { parameters: { surface: "saddle", width: 30, depth: 30, rise: 5, baseZ: 4 }, settings: { spacing: 1 } };
  assert.deepEqual(generate(input), generate(input));
});

test("non-planar-cladding: z varies within a single pass (genuinely spatial, not layered)", () => {
  const { paths } = generate({ parameters: { surface: "dome", width: 30, depth: 30, rise: 5, baseZ: 3 }, settings: { spacing: 2 } });
  const hasSpatialPass = paths.some((entry) => new Set(entry.points.map((p) => p.z)).size > 1);
  assert.ok(hasSpatialPass, "expected at least one pass with more than one distinct z value");
});

test("non-planar-cladding: every point stays within footprint bounds and above baseZ", () => {
  const baseZ = 2.1;
  const { part, paths } = generate({ parameters: { surface: "dome", width: 40, depth: 40, rise: 6, baseZ }, settings: { spacing: 2 } });
  const halfW = part.width / 2 + 1e-6;
  const halfD = part.depth / 2 + 1e-6;
  for (const entry of paths) {
    for (const p of entry.points) {
      assert.ok(Math.abs(p.x) <= halfW, `x=${p.x} exceeds half-width ${halfW}`);
      assert.ok(Math.abs(p.y) <= halfD, `y=${p.y} exceeds half-depth ${halfD}`);
      assert.ok(p.z >= baseZ - 1e-6, `z=${p.z} fell below baseZ ${baseZ}`);
    }
  }
});

test("non-planar-cladding: single_slope needs no curvature samples, dome/saddle do", () => {
  const slope = generate({ parameters: { surface: "single_slope", width: 20, depth: 20, rise: 4 }, settings: { spacing: 2 } });
  const dome = generate({ parameters: { surface: "dome", width: 20, depth: 20, rise: 4 }, settings: { spacing: 2 } });
  assert.equal(slope.paths[0].points.length, 2);
  assert.equal(dome.paths[0].points.length, 21);
});

test("non-planar-cladding: an unrecognized surface falls back to single_slope rather than throwing", () => {
  const result = generate({ parameters: { surface: "not-a-real-surface", width: 20, depth: 20, rise: 4 }, settings: { spacing: 2 } });
  assert.equal(result.part.surface, "single_slope");
});
