import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {preview, beginWork, waitForRequests, inspectFailure, respondToRequest} from '../agent/toolkit.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import * as wedge from '../../skills/wedge-demo/scripts/bundle.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
import {readGuidance} from '../agent/manuals.mjs';
import {SKILL_IDS} from '../../skills/catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = resolve(root, 'scripts/agent-toolkit.mjs'), run = promisify(execFile);
async function fixture(t) {
  const library = await mkdtemp(join(tmpdir(), 'saam-toolkit-test-')), servers = [];
  t.after(async () => {
    for (const server of servers) await server.shutdown();
    await rm(library, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  return {library, async open(options) {
    const opened = await preview({library, noOpen: true, ...options});
    servers.push(opened.server); return opened;
  }};
}

test('the three onboarding roles return the complete digest and leave skill manuals for individual reads', async t => {
  const {library} = await fixture(t);
  const {stdout} = await run(process.execPath, [cli, 'maker-onboarding'], {cwd: library});
  const maker = JSON.parse(stdout);
  assert.equal(maker.ok, true);
  assert.equal(maker.documents.find(doc => doc.path === 'MAKERS.md').text, await readFile(resolve(root, 'MAKERS.md'), 'utf8'));
  assert.equal(maker.environment.nodeSupported, true);
  assert.deepEqual(maker.environment.missingDependencies, []);
  const builder = JSON.parse((await run(process.execPath, [cli, 'builder-onboarding', '--area', 'skills'])).stdout);
  assert.ok(builder.documents.some(doc => doc.path === 'BUILDERS.md'));
  assert.ok(builder.documents.some(doc => doc.path === 'MAKERS.md'), 'builder context includes maker context');
  assert.ok(builder.documents.some(doc => doc.path === 'core/README.md'));
  const dev = JSON.parse((await run(process.execPath, [cli, 'developer-onboarding', '--area', 'mcp', '--area', 'setup', '--area', 'mcp'])).stdout);
  assert.ok(!dev.documents.some(doc => doc.path === 'AGENTS.md'), 'entry-point instructions are already loaded');
  assert.equal(new Set(dev.documents.map(doc => doc.path)).size, dev.documents.length);
  assert.ok(dev.documents.some(doc => doc.path === 'DEVELOPER-CONTEXT.md'));
  const orientation = dev.documents.find(doc => doc.path === 'DEVELOPER-CONTEXT.md');
  assert.equal(orientation.guidanceId, 'DEVELOPER-CONTEXT.md#orientation');
  assert.equal(orientation.text, (await readGuidance(root, orientation.guidanceId)).text);
  assert.deepEqual(maker.maps, []);
  assert.deepEqual(builder.maps, [], 'skill-only builders need no dev maps');
  assert.deepEqual(dev.maps.map(map => map.source), ['maps/0_system.md']);
  assert.ok(!dev.documents.some(doc => ['MAKERS.md','core/print/USAGE.md','skills/DEVELOP.md'].includes(doc.path)), 'developers load workflow context when needed');
  const mapped = JSON.parse((await run(process.execPath, [cli, 'builder-onboarding', '--area', 'regions', '--area', 'regions'])).stdout);
  assert.deepEqual(mapped.maps.map(map => map.source), ['maps/4_regions.md']);
  const region = JSON.parse((await run(process.execPath, [cli, 'read-map', '4d_perimeters'], {cwd: library})).stdout);
  assert.deepEqual(region.maps, mapped.maps);
  assert.ok(region.maps[0].pages.find(page => page.key === '4a_offset').nodes.find(node => node.id === 'offset').shared.some(use => use.page === '4d_perimeters'));
  const sliceId = 'maps/4_regions.md#planar-kernel';
  const slice = JSON.parse((await run(process.execPath, [cli, 'read-guidance', sliceId])).stdout);
  assert.equal(slice.documents[0].text, (await readGuidance(root, sliceId)).text);
  assert.ok(slice.documents[0].text.includes('WASM instance'));
  assert.ok(!slice.documents[0].text.includes('## Perimeter recovery'));
  await assert.rejects(run(process.execPath, [cli, 'read-map', 'invented']));
  assert.ok(dev.documents.some(doc => doc.path === 'adapters/mcp/DEVELOP.md'));
  assert.ok(dev.documents.some(doc => doc.path === 'SETUP.md'));
  for (const packet of [maker, builder, dev]) {
    assert.ok(!packet.documents.some(doc => doc.path.endsWith('/SKILL.md')));
    const digest = packet.documents.find(doc => doc.path === 'skills/README.md');
    assert.equal(digest.text, await readFile(resolve(root, 'skills/README.md'), 'utf8'));
    for (const id of SKILL_IDS) assert.ok(digest.links.some(link => link.guidanceId === `skills/${id}/SKILL.md`), id);
    assert.ok(packet.nextStep);
  }
  const chosen = JSON.parse((await run(process.execPath, [cli, 'read-skill', 'gridfinity'], {cwd: library})).stdout);
  assert.equal(chosen.documents.length, 1);
  assert.equal(chosen.documents[0].text, await readFile(resolve(root, 'skills/gridfinity/SKILL.md'), 'utf8'));
  const section = JSON.parse((await run(process.execPath, [cli, 'read-guidance', 'MAKERS.md#tour-startup'])).stdout);
  assert.equal(section.documents.length, 1);
  assert.equal(section.documents[0].text, (await readGuidance(root, 'MAKERS.md#tour-startup')).text);
  await assert.rejects(readGuidance(root, 'examples/prints/private/README.md'), /Invalid documentation path/);
  await assert.rejects(run(process.execPath, [cli, 'read-skill', 'invented']), error => {
    assert.equal(JSON.parse(error.stdout).ok, false); return true;
  });
  for (const option of ['--skill', '--guide']) await assert.rejects(run(process.execPath, [cli, 'maker-onboarding', option, 'planar-infill']), error => {
    assert.equal(JSON.parse(error.stdout).ok, false); return true;
  });
  await assert.rejects(run(process.execPath, [cli, 'start-tour', '--unexpected']), error => {
    assert.equal(JSON.parse(error.stdout).partial, null); return true;
  });
});

test('skill role flags are independent, additive and report absent optional manuals', async () => {
  const read = async (...args) => JSON.parse((await run(process.execPath, [cli, 'read-skill', ...args])).stdout);
  const maker = await read('planar-infill', '--maker');
  const implicit = await read('planar-infill');
  assert.deepEqual(maker, implicit);
  const both = await read('planar-infill', '--builder', '--maker');
  assert.deepEqual(both.roles, ['maker', 'builder']);
  assert.deepEqual(both.unavailableRoles, []);
  assert.deepEqual(both.documents.map(doc => doc.path), ['skills/planar-infill/SKILL.md', 'skills/planar-infill/DEVELOP.md']);
  const builder = await read('planar-infill', '--builder');
  assert.deepEqual(builder.roles, ['builder']);
  assert.deepEqual(builder.documents, [both.documents[1]]);
  assert.equal(builder.documents[0].text, await readFile(resolve(root, 'skills/planar-infill/DEVELOP.md'), 'utf8'));
  const absent = await read('gridfinity', '--builder', '--developer');
  assert.deepEqual(absent.roles, ['builder', 'developer']);
  assert.deepEqual(absent.unavailableRoles, ['builder', 'developer']);
  assert.deepEqual(absent.documents, []);
  const mixed = await read('planar-infill', '--maker', '--developer');
  assert.deepEqual(mixed.documents, maker.documents);
  assert.deepEqual(mixed.unavailableRoles, ['developer']);
  await assert.rejects(run(process.execPath, [cli, 'read-skill', 'invented', '--builder']));
});

test('create-preview reuses isolated setup and opening preserves approved export bytes', async t => {
  const f = await fixture(t), target = join(f.library, 'My part');
  await mkdir(join(f.library, '.machine-setups'));
  const defaults = await wedge.proposedPlan('ultimaker-s5', {setupFile: join(f.library, 'absent.json')});
  await writeFile(join(f.library, '.machine-setups/ultimaker-s5.json'), JSON.stringify({schema: 'saam-machine-setup/1', machineId: 'ultimaker-s5', setup: {...defaults.setup, bedC: 67}, source: 'SYNTHETIC TEST ONLY'}));
  const ready = [];
  const made = await f.open({command: 'create-preview', target, kind: 'wedge', onReady: event => ready.push(event)});
  assert.equal(ready.length, 1);
  assert.equal(made.result.print.plan.setup.bedC, 67);
  assert.equal(made.result.print.generation.current, false);
  assert.deepEqual(made.result.print.approvals, {geometry: false, settings: false, toolpath: false});
  let state = await wedge.loadBundle(target);
  await wedge.approve(target, {stage: 'geometry', revision: state.revision, actor: 'SYNTHETIC TEST ONLY'});
  await wedge.generateBundle(target);
  state = await wedge.loadBundle(target);
  await wedge.approve(target, {stage: 'toolpath', revision: state.revision, actor: 'SYNTHETIC TEST ONLY'});
  const saved = await Promise.all(['plan.json', 'review.json', 'exports/griffin-gcode/wedge.gcode'].map(name => readFile(join(target, name))));
  const reopened = await f.open({command: 'open-print', target: join(target, 'plan.json')});
  assert.equal(reopened.result.print.approvals.toolpath, true);
  assert.equal(reopened.result.print.generation.current, true);
  assert.deepEqual(await Promise.all(['plan.json', 'review.json', 'exports/griffin-gcode/wedge.gcode'].map(name => readFile(join(target, name)))), saved);
  await assert.rejects(f.open({command: 'create-preview', target, kind: 'wedge'}), /already exists/);
});

test('STL preview preserves original bytes and reports inferred units without approval', async t => {
  const f = await fixture(t), target = join(f.library, 'STL'), source = join(f.library, 'source.stl');
  const mesh = boxMesh(12, 10, 4);
  const bytes = Buffer.from('solid test\n' + mesh.triangles.map(tri => 'facet normal 0 0 0\nouter loop\n' + tri.map(i => 'vertex ' + mesh.vertices[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid test\n');
  await writeFile(source, bytes);
  const {result} = await f.open({command: 'create-preview', target, stl: source});
  assert.equal(result.assumptions.units.units, 'mm');
  assert.equal(result.assumptions.units.unitsInferred, true);
  assert.deepEqual(await readFile(join(target, 'geometry/source.stl')), bytes);
  assert.deepEqual(result.print.approvals, {geometry: false, settings: false, toolpath: false});
  assert.equal(result.print.generation.record, null);
});

test('fresh tours keep earlier bundles and return lesson-one guidance and a listener cursor', async t => {
  const f = await fixture(t);
  const first = await f.open({command: 'start-tour'});
  const original = await readFile(join(first.result.directory, 'plan.json'));
  const second = await f.open({command: 'start-tour'});
  assert.notEqual(first.result.directory, second.result.directory);
  assert.equal(second.result.tour.step, 0);
  assert.deepEqual(second.result.tour.startAt, {layer: 12});
  assert.deepEqual(second.result.listener.after, []);
  assert.equal(second.result.listener.claim, true);
  assert.equal(Object.keys(second.result.tour.copies).length, 2);
  assert.deepEqual(await readFile(join(first.result.directory, 'plan.json')), original);
  const response = await fetch(second.result.studio.url + '/api/state');
  const shown = await response.json();
  assert.equal(response.status, 200);
  assert.equal(shown.tour.step, 0);
  assert.equal(shown.geometryApproved, false);
  assert.equal(shown.program, undefined);
  assert.ok(second.result.context.documents.some(doc => doc.path === 'examples/prints/README.md'));
});

test('begin-work marks pending before context reads, correlates claims, and fails unreadable work', async t => {
  const f = await fixture(t), target = join(f.library, 'part');
  await f.open({command: 'create-preview', target, kind: 'wedge'});
  const begun = await beginWork({target, library: f.library, instruction: 'SYNTHETIC edit', includeGeometry: true});
  assert.equal(begun.request.status, 'working');
  assert.ok(begun.print.plan.geometry);
  assert.equal(begun.print.planComplete, true);
  assert.equal(begun.print.generation.programChecked,false,'beginning an edit defers old-export validation');
  assert.equal(begun.print.approvals.toolpath,null);
  assert.ok(begun.print.geometryHash,'shape confirmation can use the same context packet');
  const queue = createAgentRequests(f.library);
  const queued = await queue.begin({directory: target, source: 'studio', instruction: 'SYNTHETIC failure: discontinuous roof'});
  const waited = await waitForRequests({library: f.library, waitMs: 0, claim: true});
  assert.equal(waited.requests[0].id, queued.id);
  assert.equal(waited.requests[0].status, 'working');
  assert.deepEqual(waited.after, [queued.id]);
  assert.deepEqual((await waitForRequests({library: f.library, waitMs: 0, after: waited.after, claim: true})).requests, []);
  await assert.rejects(beginWork({target: join(f.library, 'other'), library: f.library, requestId: queued.id}), /another print/);
  const claimed = await beginWork({library: f.library, requestId: queued.id});
  assert.equal(claimed.request.id, queued.id);
  assert.equal(claimed.print.plan.geometry, undefined);
  const prepared = await respondToRequest({library: f.library, requestId: queued.id, status: 'working', resultStage: 'geometry'});
  assert.equal(prepared.target.stage, 'geometry');
  assert.equal(prepared.presented, false);
  const diagnostics = await inspectFailure({target, library: f.library, requestId: queued.id});
  assert.match(diagnostics.requests[0].instruction, /discontinuous roof/);
  assert.ok(!diagnostics.context.documents.some(doc => doc.path.endsWith('/SKILL.md')));
  assert.ok(diagnostics.skillReferences.some(ref => ref.skillId === 'wedge-demo' && ref.guidanceId === 'skills/wedge-demo/SKILL.md'));
  await respondToRequest({library: f.library, requestId: queued.id, message: 'SYNTHETIC handled'});
  assert.equal((await queue.list()).find(r => r.id === begun.request.id).status, 'working');
  await assert.rejects(beginWork({target: join(f.library, 'missing'), library: f.library, instruction: 'SYNTHETIC broken'}), error => {
    assert.equal(error.partial.request.status, 'failed'); return true;
  });
  await writeFile(join(target, 'plan.json'), '{broken');
  const broken = await inspectFailure({target, library: f.library});
  assert.ok(broken.validationError);
  assert.ok(broken.recipeReadError);
  assert.equal((await queue.list()).find(r => r.id === begun.request.id).status, 'working');
});

test('failure after creation reports retained bundle and closes only its own server', async t => {
  const f = await fixture(t), target = join(f.library, 'Retained');
  let url;
  await assert.rejects(preview({command: 'create-preview', target, library: f.library, kind: 'wedge', noOpen: true,
    onReady: event => {url = event.studio.url; throw Error('SYNTHETIC readiness notification failure');}}), error => {
    assert.equal(error.partial.created, true);
    assert.equal(error.partial.directory, target);
    assert.equal(error.partial.studio.closed, true);
    return true;
  });
  assert.equal((await wedge.loadBundle(target)).geometryApproved, false);
  await assert.rejects(fetch(url));
});

test('CLI launcher streams ready state and keeps its owned Studio alive', async t => {
  const f = await fixture(t), events = [];
  const child = spawn(process.execPath, [resolve(root, 'studio/server.mjs'), '--toolkit', 'start-tour', '--library', f.library, '--no-open'], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  const exited = once(child, 'exit');
  // This hook must run before fixture cleanup, so stop explicitly in finally too.
  let stderr = '', buffered = '';
  child.stderr.on('data', bytes => {stderr += bytes;});
  try {
    const result = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('Toolkit did not return: ' + stderr)), 30000);
      child.once('error', reject);
      child.once('exit', () => {clearTimeout(timer); reject(Error('Toolkit exited: ' + stderr));});
      child.stdout.on('data', bytes => {
        buffered += bytes;
        while (buffered.includes('\n')) {
          const newline = buffered.indexOf('\n'), line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line); events.push(event);
            if (event.event === 'result' || event.ok === false) {clearTimeout(timer); done(event);}
          } catch (error) {clearTimeout(timer); reject(error);}
        }
      });
    });
    assert.equal(events[0].event, 'studio-ready');
    assert.equal(events[0].context, undefined, 'the first result is the launch, not an onboarding packet');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.context.documents.some(doc => doc.path === 'MAKERS.md'));
    assert.ok(result.context.documents.some(doc => doc.path === 'examples/prints/README.md'));
    assert.ok(!result.context.documents.some(doc => doc.path.endsWith('/SKILL.md')));
    assert.equal(result.listener.claim, true);
    assert.equal(child.exitCode, null);
    const state = await (await fetch(result.studio.url + '/api/state')).json();
    assert.equal(state.tour.step, 0);
    assert.equal(state.geometryApproved, false);
  } finally {child.kill(); await exited;}
});
