import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readDobotLua, resolveExtrusionOutput } from "../../machines/reference-dobot-mg400-struderbot/trace/reader.mjs";
import { translate } from "../../machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs";
import {
  validateTraceShape,
  comparePlanToTrace,
  checkExtrusionSpeedConsistency,
  checkStationaryExtrusion,
  extrusionWindows,
  sampleAt,
} from "../../schemas/motion-trace/trace-lib.mjs";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../machines/reference-dobot-mg400-struderbot/postprocessor/examples/approved-box-plan.json", import.meta.url)
    ),
    "utf8"
  )
);

const read = (overrides = {}) =>
  readDobotLua({
    files: fixture.expected.files,
    instanceProfile: fixture.input.instanceProfile,
    ...overrides,
  });

test("dobot-lua-trace: the exported program reads back as a well-formed trace", () => {
  const trace = read();
  const validation = validateTraceShape(trace);
  assert.deepEqual(validation.errors, []);
  assert.equal(trace.source.machineId, "reference-dobot-mg400-struderbot");
  assert.ok(trace.segments.length > 0);
});

test("dobot-lua-trace: reading is driven by executing the Lua, not by matching text", () => {
  // J and L are project helpers defined in global.lua, and the reader learns
  // what they do by running them. Redefining L there must change the trace
  // without a single character of src1.lua changing — if it does not, the
  // reader is pattern-matching names and would inherit the generator's own
  // assumptions about them.
  const slowed = {
    ...fixture.expected.files,
    "global.lua": fixture.expected.files["global.lua"].replace(
      "THICK_PRINT_SPEED = 1.0",
      "THICK_PRINT_SPEED = 7.0"
    ),
  };
  const before = read();
  const after = read({ files: slowed });

  const speedsBefore = new Set(before.segments.map((s) => s.speedPercent));
  const speedsAfter = new Set(after.segments.map((s) => s.speedPercent));
  assert.ok(speedsBefore.has(1), "the original global.lua prints at 1%");
  assert.ok(speedsAfter.has(7), "the edited global.lua prints at 7%");
  assert.deepEqual(
    before.segments.map((s) => s.to),
    after.segments.map((s) => s.to),
    "changing a speed constant must not move any geometry"
  );
});

test("dobot-lua-trace: the exported program deposits exactly where the plan said to", () => {
  // Geometry is faithful. This is worth asserting on its own, because it is
  // what makes the speed finding below unambiguous: the export puts material
  // in the right places, and gets there wrong.
  const trace = read();
  assert.deepEqual(comparePlanToTrace(fixture.input.plan, trace), []);
});

test("dobot-lua-trace: the reader agrees with a freshly generated program, not just the committed one", () => {
  const generated = translate({ plan: fixture.input.plan, instanceProfile: fixture.input.instanceProfile });
  const trace = readDobotLua({ files: generated.files, instanceProfile: fixture.input.instanceProfile });
  assert.deepEqual(comparePlanToTrace(fixture.input.plan, trace), []);
});

test("dobot-lua-trace: extrusion is attributed to the instance profile's own relay port", () => {
  const trace = read();
  assert.equal(trace.source.extrusionOutput, fixture.input.instanceProfile.io.extrusionRelayOutput);
  assert.equal(trace.source.extrusionOutputDeterminedBy, "declared");
  assert.equal(extrusionWindows(trace).length, 1, "one continuous extrusion window, per the project's convention");
});

test("dobot-lua-trace: the extrusion port can be inferred when no profile is supplied", () => {
  const trace = read({ instanceProfile: null });
  assert.equal(trace.source.extrusionOutputDeterminedBy, "inferred");
  assert.equal(trace.source.extrusionOutput, "DO_EXAMPLE");
});

test("dobot-lua-trace: an ambiguous extrusion port is reported rather than guessed at", () => {
  const events = [
    { kind: "digital-output", port: "A", value: 1 },
    { kind: "digital-output", port: "A", value: 0 },
    { kind: "digital-output", port: "B", value: 1 },
    { kind: "digital-output", port: "B", value: 0 },
  ];
  const warnings = [];
  const resolved = resolveExtrusionOutput({ declared: null, events, warnings });
  assert.equal(resolved.port, null);
  assert.equal(resolved.determinedBy, "unknown");
  assert.equal(warnings[0].code, "ambiguous-extrusion-output");
});

// --------------------------------------------------------------- defects
//
// The three tests below record defects that exist in the reference
// post-processor right now. They assert the broken behaviour on purpose, so
// that the suite stays green while the defect is documented rather than
// forgotten. Each will fail the moment the generator is fixed; when that
// happens, invert the assertion — do not delete the test.

test("DEFECT dobot-lua-postprocessor: printing moves are emitted through the travel helper", () => {
  // generator.mjs picks between J() and L() with
  //     previous && distance(previous, point) > EPSILON_MM
  // where EPSILON_MM (0.01) is a same-point epsilon being used as a
  // disjoint-gap threshold. Every real move exceeds it, so every printing
  // move after the first is emitted as J() — travel speed — while the relay
  // is still on. Only the first point takes L(), because `previous` is null
  // there and && short-circuits.
  const trace = read();
  const findings = checkExtrusionSpeedConsistency(trace);

  assert.equal(findings.length, 1, "the whole print sits in one extrusion window");
  const [finding] = findings;
  assert.equal(finding.code, "inconsistent-extrusion-speed");
  assert.equal(finding.ratio, 100, "1% print speed against 100% jump speed");

  const printing = trace.segments.filter((s) => s.extruding && s.lengthMm > 1e-6);
  const viaL = printing.filter((s) => s.source.call === "L");
  const viaJ = printing.filter((s) => s.source.call === "J");
  assert.equal(viaL.length, 1, "exactly one printing move uses the print helper");
  assert.equal(viaJ.length, 8, "every other printing move uses the travel helper");

  // Geometry alone cannot see this: the points and their order are correct.
  assert.deepEqual(comparePlanToTrace(fixture.input.plan, trace), []);
});

test("DEFECT dobot-lua-postprocessor: the tool sits still for four seconds with the relay open", () => {
  // PenOn() dwells PEN_ON_DWELL_MS to let pressure build. That dwell happens
  // after the tool has descended to the first print point, so the purge lands
  // on the part rather than beside it.
  const trace = read();
  const findings = checkStationaryExtrusion(trace);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].durationS, 4);
  assert.equal(trace.totals.extrudingDwellS, 4);

  const firstPrint = fixture.input.plan.operations[0].paths.find((p) => p.intent === "print").points[0];
  const dwellAt = findings[0].at;
  assert.ok(
    Math.hypot(dwellAt.x - firstPrint.x, dwellAt.y - firstPrint.y) > 1e-9 ||
      Math.abs(dwellAt.z - firstPrint.z) < 1e-9,
    "the dwell happens at print height, not clear of the part"
  );
});

test("DEFECT dobot-lua-postprocessor: no move is blended, so the tool stops at every waypoint", () => {
  // Not one MovL carries a CP parameter. With a constant-rate extruder that
  // is a deposit at every waypoint, which is the reported mechanism behind
  // end-of-segment blobs.
  const trace = read();
  assert.ok(trace.segments.every((s) => s.blend === null));

  const warning = trace.warnings.find((w) => w.code === "unblended-extruding-moves");
  assert.ok(warning, "the reader reports this rather than leaving it to be inferred");
  assert.equal(warning.count, 9);

  // And it is visible in the motion, not only in the metadata: speed reaches
  // zero at each waypoint while material is still flowing.
  const printing = trace.segments.find((s) => s.extruding && s.lengthMm > 1);
  assert.equal(sampleAt(trace, printing.tStartS).speedMmS, 0);
  assert.equal(sampleAt(trace, printing.tEndS).speedMmS, 0);
});

// ---------------------------------------------------------------- refusal

test("dobot-lua-trace: refuses a program that calls something it cannot account for", () => {
  const files = {
    ...fixture.expected.files,
    "src1.lua": fixture.expected.files["src1.lua"].replace("PenOn()", "SomeUndocumentedMotionCall(1)"),
  };
  assert.throws(
    () => read({ files }),
    (error) => /unknown function "SomeUndocumentedMotionCall"/.test(error.message)
  );
});

test("dobot-lua-trace: refuses a program with no entry point rather than showing an empty preview", () => {
  assert.throws(
    () => read({ entry: "NotAFunction" }),
    (error) => /defines no "NotAFunction" function/.test(error.message)
  );
});

// ------------------------------------------------------------ non-planar

test("dobot-lua-trace: traces a path whose z changes continuously inside one extrusion window", () => {
  // Nothing in the trace model is layer-based. A helical wall — z rising
  // through every move, with no layer boundary anywhere — must come back as
  // one ordered extrusion window, not as a stack of anything.
  const files = {
    "global.lua": fixture.expected.files["global.lua"],
    "src1.lua": `
function RunPlan()
  local r0 = 180
  MovJ(P(20, 0, 30, r0), { SpeedJ = 100, AccJ = 100 })
  DO("DO_EXAMPLE", 1)
  for i = 0, 72 do
    local a = i * 0.0873
    L(10 * math.cos(a), 10 * math.sin(a), 1 + i * 0.05, r0)
  end
  DO("DO_EXAMPLE", 0)
end
`,
  };
  const trace = readDobotLua({ files, extrusionOutput: "DO_EXAMPLE" });

  const printing = trace.segments.filter((s) => s.extruding && s.lengthMm > 1e-6);
  assert.equal(printing.length, 73);
  assert.equal(extrusionWindows(trace).length, 1, "one window, no layer boundaries");

  const heights = printing.map((s) => s.to.z);
  assert.ok(heights.every((z, i) => i === 0 || z > heights[i - 1]), "z rises through every printing move");
  assert.ok(new Set(heights).size === heights.length, "no two moves share a height, so there are no layers to group by");

  // Sampling mid-print lands inside the helix, at a height between the ends.
  const middle = sampleAt(trace, trace.totals.durationS / 2);
  assert.ok(middle.point.z > heights[0] && middle.point.z < heights.at(-1));
  assert.deepEqual(checkExtrusionSpeedConsistency(trace), [], "a uniform helix raises nothing");
});

test("dobot-lua-trace: an arc is measured along its curve, not across its chord", () => {
  // The post-processor does not emit Arc3 yet; its own manifest says it
  // should. The reader handles it now so that a preview is ready when it does.
  const files = {
    "global.lua": fixture.expected.files["global.lua"],
    "src1.lua": `
function RunPlan()
  local r0 = 180
  MovJ(P(10, 0, 1, r0), { SpeedJ = 100, AccJ = 100 })
  DO("DO_EXAMPLE", 1)
  Arc3(P(0, 10, 1, r0), P(-10, 0, 1, r0), { SpeedL = 5, AccL = 20 })
  DO("DO_EXAMPLE", 0)
end
`,
  };
  const trace = readDobotLua({ files, extrusionOutput: "DO_EXAMPLE" });
  const arc = trace.segments.find((s) => s.kind === "arc");

  assert.ok(arc, "Arc3 produces an arc segment");
  assert.ok(Math.abs(arc.lengthMm - Math.PI * 10) < 1e-3, "half a circle of radius 10, not a 20 mm chord");
  assert.equal(arc.extruding, true);
});

test("dobot-lua-trace: a joint move is flagged as an approximate path rather than drawn as truth", () => {
  // MovJ interpolates in joint space, so the real tool path bows away from
  // the straight line between its endpoints. Modelling MG400 kinematics is
  // out of scope; claiming a precision the preview does not have is not.
  const trace = read();
  const joints = trace.segments.filter((s) => s.kind === "joint");
  assert.ok(joints.length > 0);
  assert.ok(joints.every((s) => s.pathFidelity === "approximate"));
  assert.ok(joints.every((s) => /bows away/.test(s.note ?? "")));
  assert.equal(trace.totals.approximateSegments, joints.length);
});

test("dobot-lua-trace: durations are marked as resting on assumed machine limits", () => {
  // SpeedL is a percentage of a maximum the machine manifest does not carry.
  // Durations are therefore indicative; the trace has to say so.
  const trace = read();
  assert.equal(trace.kinematics.assumed, true);
  assert.ok(trace.kinematics.sourceNote.length > 0);

  const measured = read({ kinematics: { maxLinearSpeedMmS: 500 } });
  assert.equal(measured.kinematics.assumed, false);
  assert.ok(measured.totals.durationS > trace.totals.durationS, "a slower machine takes longer");

  // Geometry does not depend on those numbers at all.
  assert.deepEqual(
    trace.segments.map((s) => s.to),
    measured.segments.map((s) => s.to)
  );
});
