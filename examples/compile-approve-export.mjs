#!/usr/bin/env node
// A real, runnable walkthrough of SAAM's full loop — discover, compile,
// approve, export — without needing an agent hooked up. It talks to the
// actual adapter over real stdio MCP protocol, the same way any
// MCP-capable agent would (see adapters/mcp/README.md), and stands in for
// the one manual step a human normally does in the workbench's own UI
// (clicking "Approve for export") by calling the exact same approval
// function the workbench calls, from schemas/process-plan/plan-lib.mjs —
// not a shortcut around the approval gate, just this script playing the
// human's part so it can run unattended.
//
// Run from the repository root:
//   node examples/compile-approve-export.mjs
//
// SAAM_NO_AUTO_OPEN=1 is set below so this doesn't pop a browser tab —
// remove that env var, or run the same compile_plan call from your own
// agent instead, to see it land in the live reference workbench.

import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildApprovalRecord, applyApproval } from "../schemas/process-plan/plan-lib.mjs";

const serverPath = fileURLToPath(new URL("../adapters/mcp/src/server.mjs", import.meta.url));

function log(step, text) {
  console.log(`\n[${step}] ${text}`);
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${result.content?.[0]?.text ?? "unknown error"}`);
  }
  return JSON.parse(result.content[0].text);
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, SAAM_NO_AUTO_OPEN: "1", SAAM_BRIDGE_PORT: "4799" },
  });
  const client = new Client({ name: "saam-example", version: "0.1.0" });
  await client.connect(transport);

  try {
    log("1/5", "Discovering what's available…");
    const machines = await callTool(client, "list_machines", {});
    const operations = await callTool(client, "list_operations", {});
    console.log(`  machines: ${machines.map((m) => m.id).join(", ")}`);
    console.log(`  operations: ${operations.map((o) => o.id).join(", ")}`);

    log("2/5", "Composing a two-operation plan (layer-filling + non-planar-cladding)…");
    const { plan } = await callTool(client, "compile_plan", {
      machineId: "reference-dobot-mg400-struderbot",
      operations: [
        { operationId: "layer-filling", parameters: { width: 24, depth: 24, layers: 3, wallCount: 2 } },
        { operationId: "non-planar-cladding", parameters: { surface: "dome", width: 24, depth: 24, rise: 6, baseZ: 2.1 } },
      ],
    });
    console.log(`  revision ${plan.revision}, ${plan.operations.length} operation(s), ${plan.operations.reduce((n, op) => n + op.paths.length, 0)} path(s) total`);

    log("3/5", "Approving for executable export — the one step a human normally does in the workbench's own UI…");
    const record = await buildApprovalRecord(plan, { scope: "executable-export", approvedBy: "example script" });
    const approved = applyApproval(plan, record);
    console.log(`  approved by "${record.approvedBy}", scope "${record.scope}", bound to revision ${record.revision}`);

    log("4/5", "Checking approval status the same way an agent double-checking before export would…");
    const status = await callTool(client, "get_approval_status", { plan: approved, scope: "executable-export" });
    console.log(`  hasCurrentApproval: ${status.hasCurrentApproval}`);

    log("5/5", "Post-processing the approved plan into real DobotStudio Pro Lua…");
    const { files, warnings } = await callTool(client, "post_process", { plan: approved });
    for (const [name, contents] of Object.entries(files)) {
      console.log(`  --- ${name} (${contents.split("\n").length} lines) ---`);
    }
    if (warnings?.length) {
      console.log(`  warnings: ${warnings.length} (one per gap between raster passes in the cladding operation — expected for this shape, not a bug)`);
      console.log(`    e.g. [${warnings[0].code}] ${warnings[0].message}`);
    }
    const preview = files["src1.lua"].split("\n");
    console.log(`\n  --- src1.lua, first 12 of ${preview.length} lines (PenOn/PenOff wraps every printed move — see the full file for the rest) ---`);
    console.log(preview.slice(0, 12).map((l) => `  ${l}`).join("\n"));

    console.log("\nDone — this is the same compile → approve → export loop an agent runs through your own MCP client, minus the live browser preview (SAAM_NO_AUTO_OPEN=1 above).");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
