// The two context maps are a human reference for what onboarding returns. They are
// hand-drawn, so assert their claims against the toolkit's actual context sets.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {onboarding, developmentAreas, root} from '../agent/toolkit.mjs';

const map = name => readFile(resolve(root, name), 'utf8');
const nodes = html => new Map([...html.matchAll(/data-id="([^"]+)" href="([^"]+)"/g)]
  .map(([, id, href]) => [id, href]));
const delivered = html => {
  // Blue-dashed "bundle" wires mark the documents one onboarding call returns.
  const byId = nodes(html), ids = new Set();
  for (const [, a, b] of html.matchAll(/<path class="edge bundle" data-a="([^"]*)" data-b="([^"]*)"/g)) {
    if (byId.has(a)) ids.add(byId.get(a));
    if (byId.has(b)) ids.add(byId.get(b));
  }
  return ids;
};

test('the maker map marks exactly what maker-onboarding and the tour return', async () => {
  const html = await map('maker-context-map.html');
  const {documents, maps} = await onboarding({role: 'maker'});
  const paths = documents.map(document => document.path);
  assert.deepEqual(maps, [], 'maker onboarding returns no maps');
  // The bundle also carries the tour path, which delivers MAKERS plus tour participation.
  assert.deepEqual(delivered(html), new Set([...paths, 'examples/prints/README.md']));
  const targets = new Set(nodes(html).values());
  for (const path of paths) assert.ok(targets.has(path), `${path} needs a node on the maker map`);
});

test('the builder map marks exactly what builder-onboarding returns', async () => {
  const html = await map('builder-context-map.html');
  const {documents, maps} = await onboarding({role: 'builder'});
  assert.deepEqual(maps, [], 'builder onboarding returns no maps without --area');
  assert.deepEqual(delivered(html), new Set(documents.map(document => document.path)));
});

test('both maps carry a node for every area contract, and no dead links', async () => {
  const areaDocuments = new Set(Object.values(developmentAreas).flat());
  const builder = nodes(await map('builder-context-map.html'));
  const targets = new Set(builder.values());
  for (const path of areaDocuments) assert.ok(targets.has(path), `--area contract ${path} needs a node`);
  for (const html of [await map('maker-context-map.html'), await map('builder-context-map.html')]) {
    for (const [id, href] of nodes(html)) {
      if (href.startsWith('.local/') || href.startsWith('dev-map/')) continue; // local / generated
      await readFile(resolve(root, href.split('#')[0]), 'utf8').catch(() => {
        throw new Error(`${id} links to a missing file: ${href}`);
      });
    }
  }
});
