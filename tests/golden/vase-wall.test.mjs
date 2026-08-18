import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "../../operations/additive/planar/vase-wall/generator.mjs";

const opDir = fileURLToPath(new URL("../../operations/additive/planar/vase-wall/", import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(`${opDir}examples/${name}`, "utf8"));
}

test("vase-wall: straight (non-tapered) output matches its golden fixture", () => {
  const { input, expected } = loadFixture("straight-tube.json");
  assert.deepEqual(generate(input), expected);
});

test("vase-wall: tapered output matches its golden fixture", () => {
  const { input, expected } = loadFixture("tapered-shot-glass-wall.json");
  assert.deepEqual(generate(input), expected);
});

test("vase-wall: is deterministic across repeated calls", () => {
  const input = { parameters: { baseOuterDiameter: 20, topOuterDiameter: 30, height: 20 }, settings: {} };
  assert.deepEqual(generate(input), generate(input));
});

test("vase-wall: is a single continuous wall — one path family, no separate perimeter or infill", () => {
  const { paths } = generate({ parameters: { baseOuterDiameter: 20, topOuterDiameter: 26, height: 10 }, settings: {} });
  const families = new Set(paths.map((p) => p.family));
  assert.deepEqual([...families], ["Spiral wall"]);
});

test("vase-wall: every point's radius stays within [min, max] of the two declared diameters", () => {
  const { paths } = generate({
    parameters: { baseOuterDiameter: 20, topOuterDiameter: 32, height: 15 },
    settings: { layerHeight: 0.7 },
  });
  const minR = 10 - 1e-6;
  const maxR = 16 + 1e-6;
  for (const entry of paths) {
    for (const p of entry.points) {
      const r = Math.hypot(p.x, p.y);
      assert.ok(r >= minR && r <= maxR, `radius ${r} outside [${minR}, ${maxR}]`);
    }
  }
});

test("vase-wall: z rises continuously within a single revolution, not just between revolutions", () => {
  const { paths } = generate({ parameters: { baseOuterDiameter: 20, height: 10 }, settings: {} });
  const zValuesInOneRevolution = new Set(paths[0].points.map((p) => p.z));
  assert.ok(zValuesInOneRevolution.size > 1, "expected z to vary within a single revolution's points");
});

test("vase-wall: a gentle taper produces no warning", () => {
  const result = generate({
    parameters: { baseOuterDiameter: 32, topOuterDiameter: 44, height: 54.9, zStart: 2.1 },
    settings: { layerHeight: 0.7 },
  });
  assert.equal(result.warnings, undefined);
});

test("vase-wall: a steep taper produces a steep-taper warning naming the actual overhang angle", () => {
  // 20mm radial change over just 4 revolutions at 0.7mm layer height is
  // 5mm/revolution — far beyond one layer height, deliberately unsafe.
  const result = generate({
    parameters: { baseOuterDiameter: 10, topOuterDiameter: 50, height: 2.8 },
    settings: { layerHeight: 0.7 },
  });
  assert.ok(Array.isArray(result.warnings) && result.warnings.length === 1);
  assert.equal(result.warnings[0].code, "steep-taper");
  assert.match(result.warnings[0].message, /deg of overhang per revolution/);
});

test("vase-wall: straight wall (equal diameters) reports shape cylinder, not cone", () => {
  const { part } = generate({ parameters: { baseOuterDiameter: 25, height: 10 }, settings: {} });
  assert.equal(part.shape, "cylinder");
  assert.equal(part.baseOuterDiameter, undefined);
});

test("vase-wall: tapered wall reports shape cone with both diameters", () => {
  const { part } = generate({ parameters: { baseOuterDiameter: 20, topOuterDiameter: 30, height: 10 }, settings: {} });
  assert.equal(part.shape, "cone");
  assert.equal(part.baseOuterDiameter, 20);
  assert.equal(part.outerDiameter, 30);
});
