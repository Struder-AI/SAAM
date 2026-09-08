import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "../../operations/additive/3d/gusset-fin/generator.mjs";

const opDir = fileURLToPath(new URL("../../operations/additive/3d/gusset-fin/", import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(`${opDir}examples/${name}`, "utf8"));
}

const SETTINGS = { layerHeight: 0.7, beadWidth: 0.83 };
const FIN = { length: 30, height: 18, thickness: 3.32, baseZ: 6.3 };

function passLength(path) {
  const [a, b] = [path.points[0], path.points.at(-1)];
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

test("gusset-fin: output matches its golden fixture", () => {
  const { input, expected } = loadFixture("flange-gusset.json");
  assert.deepEqual(generate(input), expected);
});

test("gusset-fin: is deterministic across repeated calls", () => {
  const input = { parameters: FIN, settings: SETTINGS };
  assert.deepEqual(generate(input), generate(input));
});

test("gusset-fin: the last pass is the hypotenuse, laid corner to corner in one stroke", () => {
  const { paths } = generate({ parameters: FIN, settings: SETTINGS });
  const last = paths.at(-1);
  assert.equal(last.points.length, 2, "the finishing pass must be a single straight stroke");

  // Corner to corner: (length, baseZ) and (0, baseZ + height), in some order.
  const ends = [last.points[0], last.points.at(-1)].sort((a, b) => a.x - b.x);
  assert.ok(Math.abs(ends[0].x - 0) < 1e-6 && Math.abs(ends[0].z - (FIN.baseZ + FIN.height)) < 1e-6);
  assert.ok(Math.abs(ends[1].x - FIN.length) < 1e-6 && Math.abs(ends[1].z - FIN.baseZ) < 1e-6);

  // And it really is the full hypotenuse.
  assert.ok(Math.abs(passLength(last) - Math.hypot(FIN.length, FIN.height)) < 1e-3);
});

test("gusset-fin: layers grow from a corner blip, so the triangle stands on its tip", () => {
  const { paths } = generate({ parameters: FIN, settings: SETTINGS });
  const layerCount = new Set(paths.map((p) => p.layer)).size;
  const firstOfLayer = Array.from({ length: layerCount }, (_, l) => paths.find((p) => p.layer === l && p.family === "Fin layer"));

  // The first layer is a short segment in the corner, not the footprint.
  assert.ok(passLength(firstOfLayer[0]) < passLength(firstOfLayer.at(-1)) / 10);

  let previous = 0;
  for (const path of firstOfLayer) {
    const length = passLength(path);
    assert.ok(length > previous - 1e-9, "each layer must be at least as long as the one before it");
    previous = length;
  }
});

test("gusset-fin: every fin layer stroke changes Z along its own length", () => {
  const { paths } = generate({ parameters: FIN, settings: SETTINGS });
  for (const path of paths.filter(p => p.family === "Fin layer")) {
    const rise = Math.abs(path.points[0].z - path.points.at(-1).z);
    assert.ok(rise > 1e-9, "a planar pass would mean this is not a 3D toolpath at all");
  }
});

test("gusset-fin: one continuous print run, with no internal travel even when hops are enabled", () => {
  for (const beads of [1, 2, 3, 4]) {
    const { paths } = generate({ parameters: { ...FIN, thickness: beads * SETTINGS.beadWidth }, settings: { ...SETTINGS, travelHopHeight: 2 } });
    assert.ok(paths.every(p => p.intent === "print"));
    for (let i = 1; i < paths.length; i++) {
      assert.deepEqual(paths[i-1].points.at(-1), paths[i].points[0], "no positioning gap within a fin");
    }
    for (const p of paths.filter(p => p.family === "Fin connection")) {
      const [a,b] = p.points;
      assert.ok((a.x === 0 && b.x === 0) || (a.z === FIN.baseZ && b.z === FIN.baseZ), "connections stay on the base or wall face");
    }
    const strokes = paths.filter(p => p.family === "Fin layer");
    for (let i = 1; i < strokes.length; i++) {
      if (strokes[i].layer !== strokes[i-1].layer) {
        assert.equal(strokes[i].points[0].y, strokes[i-1].points.at(-1).y, "no thickness reset between layers");
      }
    }
  }
});

test("gusset-fin: every point stays inside the declared triangle", () => {
  const { paths } = generate({ parameters: FIN, settings: SETTINGS });
  const slope = FIN.height / FIN.length;
  for (const path of paths) {
    for (const p of path.points) {
      assert.ok(p.x >= -1e-6 && p.x <= FIN.length + 1e-6, `x=${p.x} outside [0, ${FIN.length}]`);
      assert.ok(p.z >= FIN.baseZ - 1e-6 && p.z <= FIN.baseZ + FIN.height + 1e-6, `z=${p.z} out of range`);
      assert.ok(Math.abs(p.y) <= FIN.thickness / 2 + 1e-6, `y=${p.y} outside half-thickness`);
      // Below the hypotenuse: z - baseZ <= height - slope * x.
      assert.ok(p.z - FIN.baseZ <= FIN.height - slope * p.x + 1e-3, `point (${p.x}, ${p.z}) pokes through the hypotenuse`);
    }
  }
});

test("gusset-fin: thickness resolves to a whole number of beads, centered on Y", () => {
  const { paths } = generate({ parameters: { ...FIN, thickness: 3.32 }, settings: SETTINGS });
  const offsets = [...new Set(paths.map((p) => p.points[0].y))].sort((a, b) => a - b);
  assert.equal(offsets.length, 4, "3.32 / 0.83 should give exactly 4 beads");
  assert.ok(Math.abs(offsets[0] + offsets.at(-1)) < 1e-6, "bead offsets should be symmetric about zero");

  const single = generate({ parameters: { ...FIN, thickness: 0.83 }, settings: SETTINGS });
  assert.deepEqual([...new Set(single.paths.map((p) => p.points[0].y))], [0], "a one-bead fin sits on Y=0");
});

test("gusset-fin: warns when the build direction leans past the overhang guideline", () => {
  const steep = generate({ parameters: { length: 10, height: 30 }, settings: SETTINGS });
  assert.equal(steep.warnings.length, 1);
  assert.equal(steep.warnings[0].code, "steep-fin-lean");

  const shallow = generate({ parameters: { length: 30, height: 10 }, settings: SETTINGS });
  assert.ok(!("warnings" in shallow), "a fin inside the guideline should carry no warnings key");
});
