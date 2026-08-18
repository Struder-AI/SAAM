// Filesystem discovery for SAAM operation and machine manifests. No
// dependencies. Used by the MCP adapter (adapters/mcp/) for live
// discovery today, and is the raw scan a future generated registry index
// would sit on top of — see docs/authoring/operations.md and
// docs/authoring/machine-definitions.md for what these manifests mean.

import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function findManifests(root, maxDepth) {
  const results = [];
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === "manifest.json") {
        try {
          const manifest = JSON.parse(await readFile(full, "utf8"));
          results.push({ dir, manifestPath: full, manifest });
        } catch (error) {
          results.push({ dir, manifestPath: full, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  await walk(root, 0);
  return results;
}

/** Every operations/** /manifest.json, each tagged with its directory (needed to resolve `generator.module`). */
export async function discoverOperations(repoRoot = REPO_ROOT) {
  return findManifests(join(repoRoot, "operations"), 6);
}

/** Every machines/*\/manifest.json — deliberately depth-1, so a machine's
 *  own manifest is never confused with its nested post-processor's. */
export async function discoverMachines(repoRoot = REPO_ROOT) {
  return findManifests(join(repoRoot, "machines"), 1);
}

/**
 * Every machines/*\/postprocessor/manifest.json. Depth alone can't tell a
 * post-processor's manifest from its owning machine's own manifest one
 * level up — both are plain `manifest.json` files — so this filters by
 * directory name on top of the depth-2 scan.
 */
export async function discoverPostProcessors(repoRoot = REPO_ROOT) {
  const found = await findManifests(join(repoRoot, "machines"), 2);
  return found.filter((entry) => basename(entry.dir) === "postprocessor");
}

/**
 * Dynamically imports an operation's declared generator and calls it.
 * `entry` is one item from discoverOperations().
 */
export async function loadGenerator(entry) {
  if (entry.error) throw new Error(`Manifest at ${relative(REPO_ROOT, entry.manifestPath)} is invalid: ${entry.error}`);
  const { module, export: exportName } = entry.manifest.generator;
  const modulePath = join(entry.dir, module);
  const imported = await import(new URL(`file://${modulePath}`).href);
  const fn = imported[exportName];
  if (typeof fn !== "function") {
    throw new Error(`${entry.manifest.id}: generator export "${exportName}" not found in ${module}`);
  }
  return fn;
}

// Convenience for callers that just want id -> function without walking
// discoverOperations() themselves each time.
export async function loadGeneratorById(operationId, repoRoot = REPO_ROOT) {
  const operations = await discoverOperations(repoRoot);
  const entry = operations.find((o) => o.manifest?.id === operationId);
  if (!entry) throw new Error(`Unknown operation id "${operationId}". Call list_operations to see what's available.`);
  return { entry, generate: await loadGenerator(entry) };
}
