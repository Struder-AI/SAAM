#!/usr/bin/env node
// SAAM MCP adapter: discovery, deterministic generation, validation,
// approval-status reads, review requests, and post-processing for any
// MCP-capable agent. See docs/authoring/process-plan-workflow.md for the
// workflow this fits into, and docs/architecture/agent-safety-boundary.md
// for what this adapter deliberately does not do.
//
// It never calls a model, never holds a provider API key, and never
// creates an approval record — approval is exclusively a human action in
// the reference workbench (interfaces/reference-workbench/). This
// adapter runs entirely over stdio: no network port, no HTTP surface.
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

const PLANS_DIR = join(REPO_ROOT, ".saam", "plans");

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
      "Runs the real, deterministic generators for the given operation invocations against the given machine, producing a machine-resolved process plan at status 'preview-only' with no approval. Writes the plan to a local file and returns its path — open that file in the SAAM Reference Workbench ('Open plan…') to inspect and approve it. This tool never creates an approval and never redesigns geometry; it only runs what the named operations themselves define.",
    inputSchema: {
      machineId: z.string().describe('Machine id from list_machines, e.g. "reference-dobot-mg400-struderbot".'),
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
  async ({ machineId, settings, operations }) => {
    const machines = await discoverMachines();
    const machine = machines.find((m) => m.manifest?.id === machineId);
    if (!machine) {
      return errorResult(`Unknown machine id "${machineId}". Call list_machines to see what's available.`);
    }

    const resolvedSettings = { layerHeight: 0.7, beadWidth: 0.83, spacing: 0.78, ...settings };
    const builtOperations = [];
    let part = null;

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
      part = result.part;
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

    const plan = {
      schemaVersion: 1,
      revision: 1,
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
    return json({
      plan,
      writtenTo: path,
      nextStep: `Open ${path} in the SAAM Reference Workbench ('Open plan…') to inspect the synchronized 3D previews and approve it. This adapter cannot approve on your behalf.`,
    });
  }
);

server.registerTool(
  "request_review",
  {
    title: "Request human review",
    description:
      "Writes a plan to the local review location and returns instructions for a human to open and approve it in the SAAM Reference Workbench. Does not create an approval — approval is exclusively a human action.",
    inputSchema: { plan: z.record(z.string(), z.unknown()).describe("A full process plan, e.g. as returned by compile_plan.") },
  },
  async ({ plan }) => {
    const { valid, errors } = validatePlanShape(plan);
    if (!valid) return errorResult(`Not a valid plan: ${errors.join(" ")}`);
    const path = await writePlanFile(plan);
    return json({
      writtenTo: path,
      nextStep: `Ask the operator to open ${path} in the SAAM Reference Workbench ('Open plan…'), review the synchronized previews, and approve it there.`,
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
