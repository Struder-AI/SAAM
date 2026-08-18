#!/usr/bin/env node
// SAAM MCP adapter: discovery, deterministic generation, validation,
// approval-status reads, review requests, and post-processing for any
// MCP-capable agent. See docs/authoring/process-plan-workflow.md for the
// workflow this fits into, and docs/architecture/agent-safety-boundary.md
// for what this adapter deliberately does not do.
//
// It never calls a model and never holds a provider API key. Approval is
// exclusively a human action in the reference workbench
// (interfaces/reference-workbench/) — this adapter can serve that
// workbench locally and read back an approval it produced, but cannot
// create one itself. Tool calls go over stdio, per the MCP standard; a
// small loopback-only HTTP bridge (http-bridge.mjs) additionally serves
// the workbench's built static files and a same-origin session API — see
// docs/architecture/agent-safety-boundary.md for exactly what that
// bridge does and does not expose.
//
// Currently requires being run from within a SAAM repository checkout —
// operations, machines, and schemas are discovered by real filesystem
// paths (registry/discover.mjs), not bundled into this package. See
// README.md "Known limitations."

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  REPO_ROOT,
  discoverOperations,
  discoverMachines,
  loadGenerator,
} from "../../../registry/discover.mjs";
import { validatePlanShape, hasCurrentApproval } from "../../../schemas/process-plan/plan-lib.mjs";
import { translate as translateForDobot } from "../../../machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs";
import { startHttpBridge } from "./http-bridge.mjs";
import { openBrowser } from "./open-browser.mjs";
import { getSession, setSession } from "./session.mjs";

const PLANS_DIR = join(REPO_ROOT, ".saam", "plans");
const BRIDGE_PORT = Number(process.env.SAAM_BRIDGE_PORT) || 4700;
const bridge = await startHttpBridge({ port: BRIDGE_PORT });
// unref() so the HTTP bridge alone can't keep the process alive — the
// stdio MCP transport is the real reason this process should stay up.
// Without this, the process (and the child-process teardown timeout of
// whatever spawned it) hangs for seconds after the agent disconnects,
// because Node won't exit while a listening server handle is still ref'd.
bridge.server.unref();
let hasOpenedBrowser = false;

/** Makes `plan` the workbench's live session and, the first time this is
 * called in this process's lifetime, opens the workbench to show it —
 * the "ask your agent, a browser tab shows the result" step described in
 * README.md. Later calls just update what the already-open tab is
 * watching; they don't reopen a new tab each time. Returns whether this
 * call was the one that triggered the open. */
async function publishToWorkbench(plan) {
  await setSession(plan);
  const justOpened = !hasOpenedBrowser;
  if (justOpened) {
    hasOpenedBrowser = true;
    openBrowser(bridge.url);
  }
  return justOpened;
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plan";
}

async function writePlanFile(plan) {
  await mkdir(PLANS_DIR, { recursive: true });
  const name = `${Date.now()}-${slugify(plan.part?.shape ?? "plan")}.json`;
  const path = join(PLANS_DIR, name);
  await writeFile(path, JSON.stringify(plan, null, 2) + "\n", "utf8");
  return path;
}

const server = new McpServer({ name: "saam", version: "0.1.0" });

server.registerTool(
  "list_machines",
  {
    title: "List machines",
    description:
      "Lists SAAM machine definitions available for planning, with their model constraints, satisfied capabilities and evidence, and installed tooling. Does not include instance-specific calibration — see docs/authoring/machine-definitions.md.",
    inputSchema: {},
  },
  async () => {
    const found = await discoverMachines();
    return json(
      found.map((entry) => ({
        id: entry.manifest?.id,
        name: entry.manifest?.name,
        summary: entry.manifest?.summary,
        modelConstraints: entry.manifest?.modelConstraints,
        capabilities: entry.manifest?.capabilities,
        installedTooling: entry.manifest?.installedTooling,
        error: entry.error,
      }))
    );
  }
);

server.registerTool(
  "list_operations",
  {
    title: "List operations",
    description:
      "Lists SAAM operation (skill) manifests available to compose into a plan: id, capability requirements, input parameters, maturity, and evidence. Use an operation's `id` (not its display name) in compile_plan.",
    inputSchema: {},
  },
  async () => {
    const found = await discoverOperations();
    return json(
      found.map((entry) => ({
        id: entry.manifest?.id,
        name: entry.manifest?.name,
        summary: entry.manifest?.summary,
        capabilityRequirements: entry.manifest?.capabilityRequirements,
        maturity: entry.manifest?.maturity,
        evidence: entry.manifest?.evidence,
        inputs: entry.manifest?.inputs,
        dependencies: entry.manifest?.dependencies,
        error: entry.error,
      }))
    );
  }
);

server.registerTool(
  "compile_plan",
  {
    title: "Compile a process plan",
    description:
      "Runs the real, deterministic generators for the given operation invocations against the given machine, producing a machine-resolved process plan at status 'preview-only' with no approval, and publishes it as the live session the SAAM Reference Workbench is watching — opening it in the operator's browser the first time this is called. Call this again with the full updated operation list (not just the new one) to add or change operations; the workbench updates to show the new revision, and any prior approval is left behind on the now-superseded revision it was actually granted for. This tool never creates an approval and never redesigns geometry; it only runs what the named operations themselves define. Pass `target` to declare (or update) what the whole plan is building toward — the workbench's \"Finished Part\" view renders this directly, independent of and unaffected by however many operations get composed toward it. Omit it to keep composing toward whatever target the session already has.",
    inputSchema: {
      machineId: z.string().describe('Machine id from list_machines, e.g. "reference-dobot-mg400-struderbot".'),
      target: z
        .object({
          shape: z.string().describe('e.g. "box", "cylinder", "ring" — freeform, matches how you\'d describe the part.'),
          width: z.number().optional(),
          depth: z.number().optional(),
          outerDiameter: z.number().optional(),
          innerDiameter: z.number().optional(),
          height: z.number(),
        })
        .optional()
        .describe(
          "The part the human is actually trying to build, as a simple idealized envelope — not a toolpath, not any one operation's own output. Held steady across calls: omit it on later compile_plan calls for the same session to keep composing toward the target you already declared. If never provided in this session, falls back to the first operation's own declared shape as a starting default."
        ),
      settings: z
        .object({
          layerHeight: z.number().optional(),
          beadWidth: z.number().optional(),
          spacing: z.number().optional(),
        })
        .optional()
        .describe("Process settings shared across operations. Reasonable defaults are used for anything omitted."),
      operations: z
        .array(
          z.object({
            operationId: z.string().describe("Operation id from list_operations, e.g. \"layer-filling\"."),
            strategy: z.string().optional(),
            parameters: z.record(z.string(), z.unknown()).optional(),
          })
        )
        .min(1)
        .describe("Ordered list of operation invocations to compose into this plan."),
    },
  },
  async ({ machineId, target, settings, operations }) => {
    const machines = await discoverMachines();
    const machine = machines.find((m) => m.manifest?.id === machineId);
    if (!machine) {
      return errorResult(`Unknown machine id "${machineId}". Call list_machines to see what's available.`);
    }

    const resolvedSettings = { layerHeight: 0.7, beadWidth: 0.83, spacing: 0.78, ...settings };
    const builtOperations = [];
    let firstOperationPart = null;

    for (const [index, invocation] of operations.entries()) {
      const catalog = await discoverOperations();
      const opEntry = catalog.find((o) => o.manifest?.id === invocation.operationId);
      if (!opEntry) {
        return errorResult(`Unknown operation id "${invocation.operationId}". Call list_operations to see what's available.`);
      }
      let generate;
      try {
        generate = await loadGenerator(opEntry);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
      const result = generate({ parameters: { strategy: invocation.strategy, ...invocation.parameters }, settings: resolvedSettings });
      if (index === 0) firstOperationPart = result.part;
      builtOperations.push({
        invocationId: `op-${index + 1}`,
        operationId: opEntry.manifest.id,
        operationVersion: opEntry.manifest.version ?? "0.1.0",
        strategy: invocation.strategy,
        parameters: invocation.parameters ?? {},
        dependencies: index > 0 ? [`op-${index}`] : [],
        paths: result.paths,
        evidence: opEntry.manifest.evidence?.label ?? "EXPERIMENTAL",
        provenance: {
          generatedBy: `${opEntry.manifest.id}@${opEntry.manifest.version ?? "0.1.0"}`,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // Continuing the same live session (same machine) advances its
    // revision rather than resetting to 1 — a stale approval granted for
    // an earlier revision must not look valid against new content just
    // because both happened to be numbered the same.
    const existingSession = await getSession();
    const continuingSameMachine = existingSession && existingSession.machine?.id === machineId;
    const revision = continuingSameMachine ? existingSession.revision + 1 : 1;

    // The target is explicit > held from the session being continued >
    // the first operation's own declared shape as a starting default —
    // never silently overwritten by whichever operation happens to run
    // last, which is what made "Finished Part" show the wrong shape (or
    // the wrong part entirely) the moment a plan had more than one
    // operation composed toward it.
    const part = target ?? (continuingSameMachine ? existingSession.part : null) ?? firstOperationPart;

    const plan = {
      schemaVersion: 1,
      revision,
      part,
      machine: { id: machineId, profileRevision: "1" },
      settings: resolvedSettings,
      operations: builtOperations,
      status: "preview-only",
      approval: null,
    };

    const { valid, errors } = validatePlanShape(plan);
    if (!valid) {
      return errorResult(`Generated plan failed its own shape check — this indicates a bug in this adapter, not your request: ${errors.join(" ")}`);
    }

    const path = await writePlanFile(plan);
    const justOpened = await publishToWorkbench(plan);
    return json({
      plan,
      writtenTo: path,
      nextStep: justOpened
        ? `Opened ${bridge.url} in the operator's browser with this plan loaded. Ask them to review the synchronized 3D previews and approve it there — this adapter cannot approve on your behalf.`
        : "Published revision to the already-open SAAM Reference Workbench tab, which updates automatically. Ask the operator to review and approve the new revision there.",
    });
  }
);

server.registerTool(
  "request_review",
  {
    title: "Request human review",
    description:
      "Publishes an existing plan (e.g. one edited outside compile_plan) as the SAAM Reference Workbench's live session, opening the workbench if it isn't already open. Does not create an approval — approval is exclusively a human action.",
    inputSchema: { plan: z.record(z.string(), z.unknown()).describe("A full process plan, e.g. as returned by compile_plan.") },
  },
  async ({ plan }) => {
    const { valid, errors } = validatePlanShape(plan);
    if (!valid) return errorResult(`Not a valid plan: ${errors.join(" ")}`);
    const path = await writePlanFile(plan);
    const justOpened = await publishToWorkbench(plan);
    return json({
      writtenTo: path,
      nextStep: justOpened
        ? `Opened ${bridge.url} in the operator's browser with this plan loaded. Ask them to review it there.`
        : "Published to the already-open SAAM Reference Workbench tab, which updates automatically. Ask the operator to review it there.",
    });
  }
);

server.registerTool(
  "validate_plan",
  {
    title: "Validate a process plan",
    description: "Checks a plan against the structural shape required by schemas/process-plan/process-plan.schema.json.",
    inputSchema: { plan: z.record(z.string(), z.unknown()) },
  },
  async ({ plan }) => json(validatePlanShape(plan))
);

server.registerTool(
  "get_approval_status",
  {
    title: "Read a plan's approval status",
    description:
      "Reports whether a plan currently carries a valid approval for the given scope, bound to its current revision. Read-only — this tool cannot create or modify an approval.",
    inputSchema: {
      plan: z.record(z.string(), z.unknown()),
      scope: z.enum(["geometry", "executable-export", "machine-control"]),
    },
  },
  async ({ plan, scope }) =>
    json({
      scope,
      hasCurrentApproval: hasCurrentApproval(plan, scope),
      approval: plan.approval ?? null,
      revision: plan.revision,
    })
);

server.registerTool(
  "post_process",
  {
    title: "Post-process an approved plan",
    description:
      "Translates an approved plan into native machine output. Refuses (with a clear reason) if the plan lacks a current executable-export approval — this enforces the same gate as the reference post-processor's own code, not a separate check that could drift from it.",
    inputSchema: { plan: z.record(z.string(), z.unknown()) },
  },
  async ({ plan }) => {
    if (plan.machine?.id !== "reference-dobot-mg400-struderbot") {
      return errorResult(`No post-processor registered in this adapter for machine "${plan.machine?.id}" yet.`);
    }
    try {
      const result = translateForDobot({ plan });
      return json(result);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
