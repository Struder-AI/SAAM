#!/usr/bin/env node
// Snapshots discover.mjs's live filesystem scan into registry/registry.json
// — the "generated conformance registry" PROJECT_CHARTER.md's governance
// section promises: a real, inspectable artifact anyone can regenerate and
// diff, not a hand-maintained list a maintainer could quietly curate.
// Authorship isn't a field here on purpose — a third-party operation or
// machine that passes discovery (a valid manifest.json in the right place)
// shows up exactly the way a Struder-authored one does.
//
// Run: node registry/generate.mjs
// tests/golden/registry.test.mjs regenerates this in memory on every test
// run and fails if it doesn't match the committed file byte-for-byte —
// that's what catches a manifest added without a re-run of this script.

import { writeFile } from "node:fs/promises";
import { relative, join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, discoverOperations, discoverMachines, discoverPostProcessors } from "./discover.mjs";

function posixRelative(repoRoot, absolutePath) {
  return relative(repoRoot, absolutePath).split("\\").join("/");
}

function operationEntry(found, repoRoot) {
  if (found.error) return { path: posixRelative(repoRoot, found.dir), error: found.error };
  const m = found.manifest;
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    category: m.category,
    capabilityRequirements: m.capabilityRequirements,
    maturity: m.maturity,
    evidenceLabel: m.evidence?.label,
    path: posixRelative(repoRoot, found.dir),
  };
}

function machineEntry(found, repoRoot) {
  if (found.error) return { path: posixRelative(repoRoot, found.dir), error: found.error };
  const m = found.manifest;
  return {
    id: m.id,
    name: m.name,
    capabilities: (m.capabilities ?? []).map((c) => ({ id: c.id, evidenceLabel: c.evidence?.label })),
    postProcessor: m.postProcessor ?? null,
    path: posixRelative(repoRoot, found.dir),
  };
}

function postProcessorEntry(found, repoRoot) {
  if (found.error) return { path: posixRelative(repoRoot, found.dir), error: found.error };
  const m = found.manifest;
  return {
    id: m.id,
    name: m.name,
    machineId: m.machineId,
    maturity: m.maturity,
    evidenceLabel: m.evidence?.label,
    path: posixRelative(repoRoot, found.dir),
  };
}

// Exported (not just used by the CLI path below) so the drift test can
// build the same structure in memory without shelling out or re-reading
// the file it's checking.
export async function buildRegistry(repoRoot = REPO_ROOT) {
  const [operations, machines, postProcessors] = await Promise.all([
    discoverOperations(repoRoot),
    discoverMachines(repoRoot),
    discoverPostProcessors(repoRoot),
  ]);
  return {
    registrySchemaVersion: 1,
    operations: operations.map((o) => operationEntry(o, repoRoot)).sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
    machines: machines.map((m) => machineEntry(m, repoRoot)).sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
    postProcessors: postProcessors
      .map((p) => postProcessorEntry(p, repoRoot))
      .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
  };
}

async function main() {
  const registry = await buildRegistry();
  const errors = [...registry.operations, ...registry.machines, ...registry.postProcessors].filter((e) => e.error);
  const text = `${JSON.stringify(registry, null, 2)}\n`;
  await writeFile(join(REPO_ROOT, "registry", "registry.json"), text, "utf8");
  console.log(
    `Wrote registry/registry.json: ${registry.operations.length} operation(s), ${registry.machines.length} machine(s), ${registry.postProcessors.length} post-processor(s).`
  );
  if (errors.length > 0) {
    console.error(`${errors.length} manifest(s) failed to parse:`);
    for (const e of errors) console.error(`  ${e.path}: ${e.error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
