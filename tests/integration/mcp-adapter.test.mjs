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
import { rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildApprovalRecord, applyApproval } from "../../schemas/process-plan/plan-lib.mjs";

const serverPath = fileURLToPath(new URL("../../adapters/mcp/src/server.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function withClient(fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const client = new Client({ name: "saam-integration-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test.after(async () => {
  await rm(new URL(".saam", `file://${repoRoot}`), { recursive: true, force: true });
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

test("list_operations returns both reference operations", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_operations", arguments: {} });
    const ids = JSON.parse(result.content[0].text).map((o) => o.id).sort();
    assert.deepEqual(ids, ["layer-filling", "non-planar-cladding"]);
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

test("the full loop: compile, approve (workbench's own code path), then post_process succeeds with real Lua", async () => {
  await withClient(async (client) => {
    const compiled = await client.callTool({
      name: "compile_plan",
      arguments: { machineId: "reference-dobot-mg400-struderbot", operations: [{ operationId: "layer-filling", parameters: { width: 20, depth: 20, layers: 2, wallCount: 1 } }] },
    });
    const { plan } = JSON.parse(compiled.content[0].text);

    const record = await buildApprovalRecord(plan, { scope: "executable-export", approvedBy: "Integration Test" });
    const approved = applyApproval(plan, record);

    const result = await client.callTool({ name: "post_process", arguments: { plan: approved } });
    assert.notEqual(result.isError, true);
    const { files } = JSON.parse(result.content[0].text);
    assert.deepEqual(Object.keys(files).sort(), ["global.lua", "src0.lua", "src1.lua"]);
    assert.ok(files["src1.lua"].includes("PenOn()"));
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
