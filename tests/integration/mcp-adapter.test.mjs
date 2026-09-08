// Real integration tests for adapters/mcp: spawns the actual server as a
// subprocess and talks to it over real stdio MCP protocol via the
// official SDK's Client, the same way any MCP-capable agent would. This
// is deliberately not a unit test of internal functions — the point is
// to prove the wire protocol, tool schemas, and cross-module wiring
// (registry discovery -> generators -> plan-lib -> post-processor) all
// work together, not just that each piece works in isolation.
//
// Requires `npm install` in adapters/mcp/ (for @modelcontextprotocol/sdk
// and zod) — see adapters/mcp/README.md.

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildApprovalRecord, applyApproval } from "../../schemas/process-plan/plan-lib.mjs";
import { readDobotLua } from "../../machines/reference-dobot-mg400-struderbot/trace/reader.mjs";
import { comparePlanToTrace } from "../../schemas/motion-trace/trace-lib.mjs";

const serverPath = fileURLToPath(new URL("../../adapters/mcp/src/server.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// Each test spawns its own server on an OS-assigned port. Its state lives
// in a suite-specific temporary directory, never the user's live session.
const stateDir = await mkdtemp(join(tmpdir(), "saam-mcp-test-"));
async function clearTestState() {
  // Never let integration cleanup remove the user's live .saam session.
  assert.ok(resolve(stateDir).startsWith(resolve(tmpdir()) + sep + "saam-mcp-test-"));
  await rm(stateDir, { recursive: true, force: true });
}

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, SAAM_NO_AUTO_OPEN: "1", SAAM_BRIDGE_PORT: "0", SAAM_STATE_DIR: stateDir },
  });
  const client = new Client({ name: "saam-integration-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test.after(async () => {
  await clearTestState();
});

test("lists all seven tools", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["compile_plan", "get_approval_status", "list_machines", "list_operations", "post_process", "request_review", "validate_plan"]
    );
  });
});

test("list_machines returns the reference Dobot machine", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_machines", arguments: {} });
    const machines = JSON.parse(result.content[0].text);
    assert.ok(machines.some((m) => m.id === "reference-dobot-mg400-struderbot"));
  });
});

test("list_operations returns every reference operation", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_operations", arguments: {} });
    const ids = JSON.parse(result.content[0].text).map((o) => o.id).sort();
    assert.deepEqual(ids, ["gusset-fin", "layer-filling", "non-planar-cladding", "vase-wall"]);
  });
});

test("compile_plan runs the real generator and writes a plan file", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        operations: [{ operationId: "layer-filling", parameters: { width: 20, depth: 20, layers: 2, wallCount: 1 } }],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan, writtenTo } = JSON.parse(result.content[0].text);
    assert.equal(plan.status, "preview-only");
    assert.equal(plan.approval, null);
    assert.ok(plan.operations[0].paths.length > 0);
    assert.ok(writtenTo.endsWith(".json"));
  });
});

test("compile_plan accepts an empty operations array for a target-only preview", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        target: { shape: "cone", baseOuterDiameter: 32, outerDiameter: 44, height: 57 },
        operations: [],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan } = JSON.parse(result.content[0].text);
    assert.deepEqual(plan.part, { shape: "cone", baseOuterDiameter: 32, outerDiameter: 44, height: 57 });
    assert.deepEqual(plan.operations, []);
    assert.equal(plan.status, "preview-only");
  });
});

test("compile_plan refuses an empty operations array with no target to fall back on", async () => {
  // .saam/session.json is a file on disk, shared by every test in this
  // file regardless of which subprocess wrote it — without clearing it
  // first, an earlier test's leftover session (same machine) would supply
  // a target here via the "held from the session being continued"
  // fallback, masking the very case this test exists to check.
  await clearTestState();
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "reference-dobot-mg400-struderbot", operations: [] },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No target to build toward/);
  });
});

test("compile_plan surfaces a generator's own warnings in its response, not in the persisted plan", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        // Deliberately steep: 20mm radial change over ~4 revolutions.
        operations: [{ operationId: "vase-wall", parameters: { baseOuterDiameter: 10, topOuterDiameter: 50, height: 2.8 } }],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan, warnings } = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(warnings) && warnings.length === 1);
    assert.equal(warnings[0].code, "steep-taper");
    assert.equal(warnings[0].operationId, "vase-wall");
    assert.equal(plan.warnings, undefined);
  });
});

test("compile_plan uses an explicit target as plan.part, not whichever operation ran last", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        target: { shape: "cylinder", outerDiameter: 26, height: 10 },
        operations: [
          { operationId: "layer-filling", parameters: { geometry: "circle", outerDiameter: 26, layers: 3, wallCount: 2 } },
          { operationId: "non-planar-cladding", parameters: { surface: "dome", width: 26, depth: 26, rise: 4, baseZ: 2.1 } },
        ],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan } = JSON.parse(result.content[0].text);
    // Without an explicit target, this would be non-planar-cladding's own
    // { shape: "surface", ... } — the bug this test guards against.
    assert.deepEqual(plan.part, { shape: "cylinder", outerDiameter: 26, height: 10 });
  });
});

test("compile_plan keeps an existing session's target when a later call omits it", async () => {
  await withClient(async (client) => {
    const first = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        target: { shape: "box", width: 30, depth: 30, height: 12 },
        operations: [{ operationId: "layer-filling", parameters: { width: 30, depth: 30, layers: 2, wallCount: 1 } }],
      },
    });
    assert.notEqual(first.isError, true);

    const second = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        operations: [
          { operationId: "layer-filling", parameters: { width: 30, depth: 30, layers: 2, wallCount: 1 } },
          { operationId: "non-planar-cladding", parameters: { surface: "dome", width: 30, depth: 30, rise: 4, baseZ: 1.4 } },
        ],
      },
    });
    assert.notEqual(second.isError, true);
    const { plan } = JSON.parse(second.content[0].text);
    assert.deepEqual(plan.part, { shape: "box", width: 30, depth: 30, height: 12 });
  });
});

test("compile_plan falls back to the first operation's own shape when no target is ever given", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        operations: [
          { operationId: "layer-filling", parameters: { width: 15, depth: 15, layers: 1, wallCount: 1 } },
          { operationId: "non-planar-cladding", parameters: { surface: "dome", width: 15, depth: 15, rise: 3, baseZ: 0.7 } },
        ],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan } = JSON.parse(result.content[0].text);
    // The first operation's own shape ("box"), not the second's ("surface").
    assert.equal(plan.part.shape, "box");
  });
});

test("compile_plan rejects an unknown machine id", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "not-real", operations: [{ operationId: "layer-filling" }] },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown machine id/);
  });
});

test("compile_plan rejects an unknown operation id", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "reference-dobot-mg400-struderbot", operations: [{ operationId: "not-real" }] },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown operation id/);
  });
});

test("validate_plan reports every missing field on a malformed plan", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "validate_plan", arguments: { plan: { foo: 1 } } });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.length > 0);
  });
});

test("post_process refuses a plan with no approval", async () => {
  await withClient(async (client) => {
    const compiled = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "reference-dobot-mg400-struderbot", operations: [{ operationId: "layer-filling", parameters: { width: 10, depth: 10, layers: 1 } }] },
    });
    const { plan } = JSON.parse(compiled.content[0].text);
    const result = await client.callTool({ name: "post_process", arguments: { plan } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /no approval record/);
  });
});

test("post_process refuses a plan targeting an unregistered machine", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "post_process", arguments: { plan: { machine: { id: "some-other-machine" } } } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No post-processor registered/);
  });
});

test("get_approval_status correctly reports no approval, then a real one after applying it", async () => {
  await withClient(async (client) => {
    const compiled = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "reference-dobot-mg400-struderbot", operations: [{ operationId: "layer-filling", parameters: { width: 10, depth: 10, layers: 1 } }] },
    });
    const { plan } = JSON.parse(compiled.content[0].text);

    const before = await client.callTool({ name: "get_approval_status", arguments: { plan, scope: "executable-export" } });
    assert.equal(JSON.parse(before.content[0].text).hasCurrentApproval, false);

    const record = await buildApprovalRecord(plan, { scope: "executable-export", approvedBy: "Integration Test" });
    const approved = applyApproval(plan, record);

    const after = await client.callTool({ name: "get_approval_status", arguments: { plan: approved, scope: "executable-export" } });
    assert.equal(JSON.parse(after.content[0].text).hasCurrentApproval, true);
  });
});

for (const machineId of ["reference-dobot-mg400-struderbot", "dobot-stop"]) {
test(`the isolated integration loop preserves travel geometry and relay policy for ${machineId}`, async () => {
  await withClient(async (client) => {
    const compiled = await client.callTool({
      name: "compile_plan",
      arguments: { machineId, settings: { travelHopHeight: 1.5 }, operations: [{ operationId: "layer-filling", parameters: { outerDiameter: 20, innerDiameter: 6, layers: 2, wallCount: 1 } }] },
    });
    const { plan } = JSON.parse(compiled.content[0].text);

    const record = await buildApprovalRecord(plan, { scope: "executable-export", approvedBy: "Integration Test" });
    const approved = applyApproval(plan, record);

    const result = await client.callTool({ name: "post_process", arguments: { plan: approved } });
    assert.notEqual(result.isError, true);
    const { files } = JSON.parse(result.content[0].text);
    assert.deepEqual(Object.keys(files).sort(), ["global.lua", "src0.lua", "src1.lua"]);
    assert.ok(files["src1.lua"].includes("PenOn()"));
    const trace = readDobotLua({ files });
    assert.equal(trace.source.machineId, machineId);
    assert.deepEqual(comparePlanToTrace(plan, trace), []);
    const plannedTravel = plan.operations.flatMap(op => op.paths).filter(p => p.intent === "travel");
    assert.ok(plannedTravel.length > 0);
    const travel = trace.segments.filter(s => s.intent === "travel");
    for (const path of plannedTravel) for (const p of path.points.slice(1)) {
      assert.ok(travel.some(s => Math.hypot(s.to.x-p.x,s.to.y-p.y,s.to.z-p.z) < 1e-4));
    }
    if (machineId === "dobot-stop") {
      assert.ok(travel.every(s => !s.extruding), "travel must switch extrusion off");
      assert.equal(trace.totals.extrudingDwellS, 0);
    } else assert.ok(travel.some(s => s.extruding), "reference machine retains continuous extrusion");
  });
});
}

test("the full loop, second machine: compile against ultimaker-s5, approve, then post_process picks the right post-processor by machine.id", async () => {
  // Proves post_process is a real dynamic lookup (discoverMachines -> its
  // declared postProcessor -> discoverPostProcessors -> loadGenerator),
  // not hardcoded to the one machine that happened to be built first.
  await withClient(async (client) => {
    const compiled = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "ultimaker-s5", operations: [{ operationId: "layer-filling", parameters: { width: 20, depth: 20, layers: 2, wallCount: 1 } }] },
    });
    assert.notEqual(compiled.isError, true);
    const { plan } = JSON.parse(compiled.content[0].text);
    assert.equal(plan.machine.id, "ultimaker-s5");

    const record = await buildApprovalRecord(plan, { scope: "executable-export", approvedBy: "Integration Test" });
    const approved = applyApproval(plan, record);

    const result = await client.callTool({ name: "post_process", arguments: { plan: approved } });
    assert.notEqual(result.isError, true);
    const { files } = JSON.parse(result.content[0].text);
    assert.deepEqual(Object.keys(files), ["output.gcode"]);
    assert.match(files["output.gcode"], /;FLAVOR:Griffin/);
  });
});

test("list_machines includes ultimaker-s5 alongside the reference Dobot machine", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_machines", arguments: {} });
    const ids = JSON.parse(result.content[0].text).map((m) => m.id).sort();
    assert.deepEqual(ids, ["dobot-stop", "reference-dobot-mg400-struderbot", "ultimaker-s5"]);
  });
});

test("request_review writes a plan file and never attaches an approval", async () => {
  await withClient(async (client) => {
    const compiled = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "reference-dobot-mg400-struderbot", operations: [{ operationId: "layer-filling", parameters: { width: 10, depth: 10, layers: 1 } }] },
    });
    const { plan } = JSON.parse(compiled.content[0].text);
    const result = await client.callTool({ name: "request_review", arguments: { plan } });
    assert.notEqual(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.writtenTo.endsWith(".json"));
    assert.ok(parsed.nextStep.includes("Reference Workbench"));
  });
});

test("compile_plan places an invocation with `at`, without changing the shape the generator produced", async () => {
  await withClient(async (client) => {
    const parameters = { width: 30, depth: 4, layers: 1, wallCount: 1 };
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        target: { shape: "box", width: 30, depth: 30, height: 0.7 },
        operations: [
          { operationId: "layer-filling", parameters },
          { operationId: "layer-filling", parameters, at: { x: 10, y: -5, rotation: 90 } },
        ],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan } = JSON.parse(result.content[0].text);
    const [origin, placed] = plan.operations;

    // The placement is recorded on the invocation that carries it, and
    // absent from the one that doesn't.
    assert.deepEqual(placed.at, { x: 10, y: -5, rotation: 90 });
    assert.ok(!("at" in origin), "an unplaced invocation should carry no `at`");

    // Same path structure — placement moves an operation's output, it
    // does not regenerate or reshape it.
    assert.equal(placed.paths.length, origin.paths.length);

    // Every point is the origin point rotated 90 deg CCW then translated:
    // (x, y) -> (-y + 10, x - 5). Z is untouched.
    for (const [i, path] of placed.paths.entries()) {
      const source = origin.paths[i];
      assert.equal(path.family, source.family);
      assert.equal(path.points.length, source.points.length);
      for (const [j, point] of path.points.entries()) {
        const from = source.points[j];
        assert.ok(Math.abs(point.x - (-from.y + 10)) < 1e-3, `x mismatch at ${i}/${j}`);
        assert.ok(Math.abs(point.y - (from.x - 5)) < 1e-3, `y mismatch at ${i}/${j}`);
        assert.equal(point.z, from.z, "placement must never touch Z");
      }
    }

    // A rigid-body transform preserves lengths: the placed bar is still
    // 30 x 4, just lying the other way.
    const spanOf = (op, axis) => {
      const all = op.paths.flatMap((p) => p.points.map((pt) => pt[axis]));
      return Math.max(...all) - Math.min(...all);
    };
    assert.ok(Math.abs(spanOf(origin, "x") - spanOf(placed, "y")) < 1e-3);
    assert.ok(Math.abs(spanOf(origin, "y") - spanOf(placed, "x")) < 1e-3);
  });
});

test("compile_plan surfaces a generator's hole warnings instead of silently dropping them", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "compile_plan",
      arguments: {
        machineId: "reference-dobot-mg400-struderbot",
        target: { shape: "ring", outerDiameter: 120, innerDiameter: 51, height: 0.7 },
        operations: [
          {
            operationId: "layer-filling",
            parameters: {
              geometry: "annulus",
              outerDiameter: 120,
              innerDiameter: 51,
              layers: 1,
              holes: [{ x: 45, y: 0, diameter: 8 }, { x: 59, y: 0, diameter: 8 }],
            },
          },
        ],
      },
    });
    assert.notEqual(result.isError, true);
    const { plan, warnings } = JSON.parse(result.content[0].text);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, "hole-outside-part");
    assert.equal(warnings[0].operationId, "layer-filling");
    assert.ok(plan.operations[0].paths.some((p) => p.family === "Hole perimeter"));
  });
});
