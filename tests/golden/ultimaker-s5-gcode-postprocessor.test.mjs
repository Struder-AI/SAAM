import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { translate } from "../../machines/ultimaker-s5/postprocessor/generator.mjs";
import { generate } from "../../operations/additive/planar/layer-filling/generator.mjs";

const opDir = fileURLToPath(new URL("../../machines/ultimaker-s5/postprocessor/", import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(`${opDir}examples/${name}`, "utf8"));
}

function samplePlan(overrides = {}) {
  const built = generate({ parameters: { width: 10, depth: 10, layers: 1, wallCount: 1 }, settings: { spacing: 4 } });
  return {
    schemaVersion: 1,
    revision: 1,
    part: built.part,
    machine: { id: "ultimaker-s5", profileRevision: "1" },
    settings: { layerHeight: 0.2, beadWidth: 0.8 },
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

test("ultimaker-s5-gcode-postprocessor: output matches its golden fixture", () => {
  const { input, expected } = loadFixture("approved-box-plan.json");
  assert.deepEqual(translate(input), expected);
});

test("ultimaker-s5-gcode-postprocessor: refuses a plan with no approval", () => {
  const plan = samplePlan({ approval: null });
  assert.throws(() => translate({ plan }), /no approval record/);
});

test("ultimaker-s5-gcode-postprocessor: refuses a plan whose approval revision is stale", () => {
  const plan = samplePlan({ revision: 2 }); // approval still says revision: 1
  assert.throws(() => translate({ plan }), /revision 1.*revision 2|does not match/i);
});

test("ultimaker-s5-gcode-postprocessor: refuses an approval scoped below executable-export", () => {
  const plan = samplePlan({ approval: { revision: 1, contentHash: "x", approvedAt: "2026-08-17T00:00:00Z", approvedBy: "test", scope: "geometry" } });
  assert.throws(() => translate({ plan }), /does not authorize executable export/);
});

test("ultimaker-s5-gcode-postprocessor: refuses a plan resolved against a different machine", () => {
  const plan = samplePlan({ machine: { id: "some-other-machine", profileRevision: "1" } });
  assert.throws(() => translate({ plan }), /only accepts plans resolved against/);
});

test("ultimaker-s5-gcode-postprocessor: emits the Griffin header block and no bed-heat command in the body", () => {
  const { files } = translate({ plan: samplePlan() });
  const gcode = files["output.gcode"];
  assert.match(gcode, /;FLAVOR:Griffin/);
  assert.match(gcode, /;START_OF_HEADER/);
  assert.match(gcode, /;END_OF_HEADER/);
  // Matches the reference sample: bed temperature is declared in the header only,
  // never issued as an M140/M190 command in the body — the printer's own connected
  // print-queue system handles bed heating itself before running the payload.
  assert.doesNotMatch(gcode, /M140|M190/);
  // Same for homing — no G28 anywhere, also handled by the printer's own start sequence.
  assert.doesNotMatch(gcode, /\bG28\b/);
});

test("ultimaker-s5-gcode-postprocessor: E-axis extrusion matches (lineWidth x layerHeight) / filamentCrossSectionArea", () => {
  const plan = samplePlan();
  plan.operations[0].paths = [
    { family: "A", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 0.2 }, { x: 10, y: 0, z: 0.2 }] },
  ];
  const { files } = translate({ plan, instanceProfile: { filamentDiameterMm: 2.85 } });
  const gcode = files["output.gcode"];
  const eMatch = gcode.match(/G1 F1800 X10 Y0 Z0\.2 E([\d.-]+)/);
  assert.ok(eMatch, "expected the printed move to appear with an E value");
  const filamentArea = Math.PI * (2.85 / 2) ** 2;
  const expectedEPerMm = (plan.settings.beadWidth * plan.settings.layerHeight) / filamentArea;
  // E starts at 0 (primed after the initial retract) for a single, isolated print path.
  assert.ok(Math.abs(Number(eMatch[1]) - 10 * expectedEPerMm) < 0.001);
});

test("ultimaker-s5-gcode-postprocessor: flags a real gap between disjoint paths as a warning", () => {
  const plan = samplePlan();
  plan.operations[0].paths = [
    { family: "A", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 0.2 }, { x: 5, y: 0, z: 0.2 }] },
    { family: "B", layer: 0, intent: "print", points: [{ x: 50, y: 50, z: 0.2 }, { x: 55, y: 50, z: 0.2 }] },
  ];
  const { warnings } = translate({ plan });
  assert.ok(warnings.some((w) => w.code === "disjoint-transition"));
});

test("ultimaker-s5-gcode-postprocessor: each warning's gapMm is a real number matching its own message, not just prose", () => {
  const plan = samplePlan();
  plan.operations[0].paths = [
    { family: "A", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 0.2 }, { x: 5, y: 0, z: 0.2 }] },
    // Exactly 50mm from (5,0,0.2) to (55,0,0.2) — a real, checkable distance.
    { family: "B", layer: 0, intent: "print", points: [{ x: 55, y: 0, z: 0.2 }, { x: 60, y: 0, z: 0.2 }] },
  ];
  const { warnings } = translate({ plan });
  const gap = warnings.find((w) => w.code === "disjoint-transition");
  assert.equal(typeof gap.gapMm, "number");
  assert.equal(gap.gapMm, 50);
  assert.match(gap.message, /50\.00 mm gap/);
});

test("ultimaker-s5-gcode-postprocessor: does not warn on the initial lead-in travel to the first print point", () => {
  // samplePlan's 10x10, wallCount:1, spacing:4 region is too small to fit any
  // raster fill lines, so layer-filling emits a single perimeter path — meaning
  // the only travel in the whole file is the lead-in from the synthetic start
  // position to that perimeter's first point. If that lead-in were mistakenly
  // treated as a "real" gap, this would report one warning instead of zero.
  const { warnings } = translate({ plan: samplePlan() });
  assert.equal(warnings.filter((w) => w.code === "disjoint-transition").length, 0);
});

test("ultimaker-s5-gcode-postprocessor: never leaves E permanently negative after a full retract/prime cycle", () => {
  const { files } = translate({ plan: samplePlan() });
  const eValues = [...files["output.gcode"].matchAll(/E(-?[\d.]+)/g)].map((m) => Number(m[1]));
  // Every retract dips E by exactly 5mm below its own pre-retract baseline, but each
  // is either re-primed by a matching +5mm or is the one deliberate final retract —
  // the running baseline (ignoring transient retract dips) must never go negative.
  const printedEValues = [...files["output.gcode"].matchAll(/G1 F1800[^\n]*E(-?[\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(printedEValues.every((e) => e >= -0.001), `expected all printed-move E values to be non-negative, got ${printedEValues}`);
});

test("ultimaker-s5-gcode-postprocessor: warns when beadWidth is far outside the nozzle's typical line-width range", () => {
  const plan = samplePlan({ settings: { layerHeight: 0.2, beadWidth: 3.0 } }); // way over 2x a 0.4mm default nozzle
  const { warnings } = translate({ plan });
  assert.ok(warnings.some((w) => w.code === "line-width-outside-typical-range"));
});

test("ultimaker-s5-gcode-postprocessor: is deterministic across repeated calls", () => {
  const plan = samplePlan();
  assert.deepEqual(translate({ plan }), translate({ plan }));
});
