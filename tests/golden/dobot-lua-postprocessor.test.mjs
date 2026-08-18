import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { translate } from "../../machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs";
import { generate } from "../../operations/additive/planar/layer-filling/generator.mjs";

const opDir = fileURLToPath(
  new URL("../../machines/reference-dobot-mg400-struderbot/postprocessor/", import.meta.url)
);

function loadFixture(name) {
  return JSON.parse(readFileSync(`${opDir}examples/${name}`, "utf8"));
}

function samplePlan(overrides = {}) {
  const built = generate({ parameters: { width: 10, depth: 10, layers: 1, wallCount: 1 }, settings: { spacing: 4 } });
  return {
    schemaVersion: 1,
    revision: 1,
    part: built.part,
    machine: { id: "reference-dobot-mg400-struderbot", profileRevision: "1" },
    settings: { layerHeight: 1, beadWidth: 0.83 },
    operations: [
      {
        invocationId: "op-1",
        operationId: "layer-filling",
        operationVersion: "0.1.0",
        parameters: {},
        paths: built.paths,
        provenance: { generatedBy: "layer-filling@0.1.0", generatedAt: "2026-08-17T00:00:00Z" },
      },
    ],
    status: "approved",
    approval: {
      revision: 1,
      contentHash: "sha256:test",
      approvedAt: "2026-08-17T00:00:00Z",
      approvedBy: "test",
      scope: "executable-export",
    },
    ...overrides,
  };
}

test("dobot-lua-postprocessor: output matches its golden fixture", () => {
  const { input, expected } = loadFixture("approved-box-plan.json");
  assert.deepEqual(translate(input), expected);
});

test("dobot-lua-postprocessor: refuses a plan with no approval", () => {
  const plan = samplePlan({ approval: null });
  assert.throws(() => translate({ plan }), /no approval record/);
});

test("dobot-lua-postprocessor: refuses a plan whose approval revision is stale", () => {
  const plan = samplePlan({ revision: 2 }); // approval still says revision: 1
  assert.throws(() => translate({ plan }), /revision 1.*revision 2|does not match/i);
});

test("dobot-lua-postprocessor: refuses an approval scoped below executable-export", () => {
  const plan = samplePlan({ approval: { revision: 1, contentHash: "x", approvedAt: "2026-08-17T00:00:00Z", approvedBy: "test", scope: "geometry" } });
  assert.throws(() => translate({ plan }), /does not authorize executable export/);
});

test("dobot-lua-postprocessor: refuses a plan resolved against a different machine", () => {
  const plan = samplePlan({ machine: { id: "some-other-machine", profileRevision: "1" } });
  assert.throws(() => translate({ plan }), /only accepts plans resolved against/);
});

test("dobot-lua-postprocessor: emits exactly one PenOn and one PenOff in src1.lua", () => {
  const { files } = translate({ plan: samplePlan() });
  const penOnCount = (files["src1.lua"].match(/PenOn\(\)/g) || []).length;
  const penOffCount = (files["src1.lua"].match(/PenOff\(\)/g) || []).length;
  assert.equal(penOnCount, 1, "expected exactly one PenOn() call");
  assert.equal(penOffCount, 1, "expected exactly one PenOff() call");
});

test("dobot-lua-postprocessor: flags a real gap between disjoint paths as a warning", () => {
  const plan = samplePlan();
  plan.operations[0].paths = [
    { family: "A", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }] },
    { family: "B", layer: 0, intent: "print", points: [{ x: 50, y: 50, z: 1 }, { x: 55, y: 50, z: 1 }] },
  ];
  const { warnings } = translate({ plan });
  assert.ok(warnings.some((w) => w.code === "disjoint-transition"));
});

test("dobot-lua-postprocessor: each warning's gapMm is a real number matching its own message, not just prose", () => {
  const plan = samplePlan();
  plan.operations[0].paths = [
    { family: "A", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }] },
    // Exactly 50mm from (5,0,1) to (55,0,1) — a real, checkable distance.
    { family: "B", layer: 0, intent: "print", points: [{ x: 55, y: 0, z: 1 }, { x: 60, y: 0, z: 1 }] },
  ];
  const { warnings } = translate({ plan });
  const gap = warnings.find((w) => w.code === "disjoint-transition");
  assert.equal(typeof gap.gapMm, "number");
  assert.equal(gap.gapMm, 50);
  assert.match(gap.message, /50\.00 mm gap/);
});

test("dobot-lua-postprocessor: is deterministic across repeated calls", () => {
  const plan = samplePlan();
  assert.deepEqual(translate({ plan }), translate({ plan }));
});
