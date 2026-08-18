import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../../registry/generate.mjs";

const registryPath = fileURLToPath(new URL("../../registry/registry.json", import.meta.url));

// The committed registry.json is a snapshot, not a live view — this is
// what catches someone adding or editing a manifest without re-running
// `node registry/generate.mjs`. If this fails, regenerate and commit the
// result rather than hand-editing the JSON.
test("registry.json matches what generate.mjs produces from the current manifests right now", async () => {
  const committed = await readFile(registryPath, "utf8");
  const fresh = `${JSON.stringify(await buildRegistry(), null, 2)}\n`;
  assert.equal(fresh, committed);
});

test("buildRegistry finds all three reference operations, the reference machine, and its post-processor with no manifest errors", async () => {
  const registry = await buildRegistry();
  assert.deepEqual(
    registry.operations.map((o) => o.id),
    ["layer-filling", "non-planar-cladding", "vase-wall"]
  );
  assert.deepEqual(
    registry.machines.map((m) => m.id),
    ["reference-dobot-mg400-struderbot"]
  );
  assert.deepEqual(
    registry.postProcessors.map((p) => p.id),
    ["dobot-lua-postprocessor"]
  );
  const allEntries = [...registry.operations, ...registry.machines, ...registry.postProcessors];
  assert.ok(allEntries.every((e) => !e.error));
});
