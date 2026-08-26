import assert from "node:assert/strict";
import test from "node:test";
import { discoverOperations, discoverMachines, discoverPostProcessors, loadGeneratorById } from "../../registry/discover.mjs";

test("discoverOperations finds all three reference operations, uniquely", async () => {
  const found = await discoverOperations();
  const ids = found.map((o) => o.manifest?.id).sort();
  assert.deepEqual(ids, ["layer-filling", "non-planar-cladding", "vase-wall"]);
});

test("discoverMachines finds both reference machines and not their nested post-processors", async () => {
  const found = await discoverMachines();
  const ids = found.map((m) => m.manifest?.id).sort();
  assert.deepEqual(ids, ["reference-dobot-mg400-struderbot", "ultimaker-s5"]);
});

test("discoverPostProcessors finds both post-processors and not their owning machines' own manifests", async () => {
  const found = await discoverPostProcessors();
  const ids = found.map((p) => p.manifest?.id).sort();
  assert.deepEqual(ids, ["dobot-lua-postprocessor", "ultimaker-s5-gcode-postprocessor"]);
});

test("loadGeneratorById dynamically loads and runs the real layer-filling generator", async () => {
  const { generate } = await loadGeneratorById("layer-filling");
  const result = generate({ parameters: { width: 20, depth: 20, layers: 2 }, settings: {} });
  assert.equal(result.part.shape, "box");
  assert.ok(result.paths.length > 0);
});

test("loadGeneratorById rejects an unknown operation id with a helpful message", async () => {
  await assert.rejects(() => loadGeneratorById("not-a-real-operation"), /Unknown operation id/);
});
