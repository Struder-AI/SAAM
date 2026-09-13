// Actual SDK client + stdio subprocess, with approval fixtures outside MCP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundleFor } from '../../studio/server.mjs';
import { syntheticDobotSetup } from './fixtures/dobot.mjs';
import { boxMesh } from './fixtures/mesh.mjs';
import { SKILL_IDS } from '../../skills/catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
async function clientFor(t, printsRoot) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve(root, 'adapters/mcp/src/server.mjs')], cwd: tmpdir(),
    env: { ...process.env, SAAM_PRINTS_ROOT: printsRoot, SAAM_NO_AUTO_OPEN: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'saam-synthetic-integration', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  async function call(name, args = {}, errorPattern) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (errorPattern) { assert.equal(result.isError, true, text); assert.match(text, errorPattern); return; }
    assert.ok(!result.isError, text);
    return JSON.parse(text);
  }
  return { client, call };
}
async function fixture(t) {
  const printsRoot = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-mcp-'));
  t.after(() => rm(printsRoot, { recursive: true, force: true }));
  return { printsRoot, ...await clientFor(t, printsRoot) };
}
async function syntheticApproval(dir, stage) {
  const bundle = await bundleFor(dir), state = await bundle.loadBundle(dir);
  return bundle.approve(dir, { stage, revision: state.revision, actor: 'SYNTHETIC TEST MCP FIXTURE — never a real approval' });
}
async function smallPlan(call, kind, machineId = 'ultimaker-s5') {
  const { plan } = await call('get_plan_template', { kind, machineId });
  plan.process.minimumLayerSeconds = 0;
  if (kind === 'shell') {
    plan.geometry = { shape: 'box', runMm: 12, widthMm: 10, heightMm: 1 };
    plan.skills['draped-skin'].enabled = false;
  } else {
    plan.geometry.points = [[0,0,0],[12,0,0],[12,10,0],[0,10,0],[0,0,2],[12,0,3],[12,10,3],[0,10,2]];
  }
  return plan;
}



test('MCP voxel task discovers its manual and rebuilds field geometry through revision checks',async t=>{
  const {call}=await fixture(t);
  assert.equal((await call('list_skills')).find(s=>s.id==='voxel-tools').kind,'task');
  assert.match((await call('read_skill',{skillId:'voxel-tools'})).manual,/voxel-create/);
  const request={field:{schema:'saam-voxel-field/1',originMm:[0,0,0],sizeMm:[8,8,2],counts:[2,2,2],degrees:[1,1,1],
    knots:[[0,0,1,1],[0,0,1,1],[0,0,1,1]],values:Array(8).fill(1),weights:null,isoValue:0.5},extraction:{edgeMm:1}};
  let state=await call('voxel',{printId:'volume',action:'create',machineId:'ultimaker-s5',request});
  assert.deepEqual(state.approvals,{geometry:false,plan:false,toolpath:false});
  await call('voxel',{printId:'volume',action:'update',expectedRevision:'stale',request},/stale/);
  request.field.values[0]=0;
  state=await call('voxel',{printId:'volume',action:'update',expectedRevision:state.revision,request});
  const saved=await call('get_print',{printId:'volume',includeGeometry:true});
  assert.equal(saved.plan.geometry.shape,'voxel');assert.equal(saved.plan.geometry.field.values[0],0);
  assert.deepEqual((await call('check_print',{printId:'volume'})).checked,['geometry','plan']);
  assert.deepEqual(state.approvals,{geometry:false,plan:false,toolpath:false});
});

test('MCP text task edits actual geometry with a local font and stale-revision protection',async t=>{
  const {call}=await fixture(t),plan=await smallPlan(call,'shell');
  let state=await call('create_print',{printId:'text-sample',kind:'shell',machineId:'ultimaker-s5',plan});
  const manual=await call('read_skill',{skillId:'text'});assert.match(manual.manual,/apply_text/);
  state=await call('apply_text',{printId:'text-sample',expectedRevision:state.revision,request:{feature:{id:'label',text:'BO',fontPath:resolve(root,'skills/text/tests/fixtures/Abel-Regular.ttf'),mode:'recessed',sizeMm:5,depthMm:0.4,positionMm:[2,2],reference:{kind:'plane',origin:[0,0,1],xAxis:[1,0,0],yAxis:[0,1,0]}}}});
  assert.equal(state.approvals.geometry,false);
  const saved=await call('get_print',{printId:'text-sample',includeGeometry:true});
  assert.equal(saved.plan.geometry.shape,'text');assert.ok(saved.plan.geometry.triangles.length>12);
  await call('apply_text',{printId:'text-sample',expectedRevision:'stale',request:{remove:'label'}},/stale/);
  await call('apply_text',{printId:'text-sample',expectedRevision:state.revision,request:{feature:{id:'label',text:'O'}}});
  assert.equal((await call('get_print',{printId:'text-sample',includeGeometry:true})).plan.geometry.features[0].text,'O');
});

test('MCP SDK lists known manuals and profiles; creates persistent isolated bundles with strict inputs and no approval tools', async t => {
  const { call, client, printsRoot } = await fixture(t);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('request_review'));
  assert.ok(!names.some(name => /^(approve|post_process|compile_plan)$/.test(name)));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'full-fill'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'supports'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'pipe-cladding'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'mesh-tools' && skill.kind === 'task'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'text' && skill.kind === 'task'));
  assert.equal((await call('read_skill', {skillId:'supports'})).skillId,'supports');
  assert.match((await call('read_skill', { skillId: 'wedge-demo' })).manual, /eight-point/i);
  const guidance = await call('read_guidance', { guidanceId: 'makers' });
  assert.equal(guidance.text, await readFile(resolve(root, 'MAKERS.md'), 'utf8'));
  assert.equal(guidance.path, 'MAKERS.md');
  assert.ok(guidance.links.some(link => link.guidanceId.startsWith('skills/')));
  const digestLink = guidance.links.find(link => link.guidanceId === 'skills/README.md');
  assert.ok(digestLink);
  const digest = await call('read_guidance', { guidanceId: digestLink.guidanceId });
  for (const skill of await call('list_skills')) {
    if (!SKILL_IDS.includes(skill.id)) continue; // Checkout-local extensions have their own manuals.
    assert.ok(digest.text.includes(skill.description.replaceAll('|', '&#124;')), skill.id);
    assert.ok(digest.links.some(link => link.guidanceId === `skills/${skill.id}/SKILL.md`), skill.id);
  }
  assert.equal((await call('read_guidance', { guidanceId: 'print-tools' })).path, 'core/print/USAGE.md');
  const section = await call('read_guidance', { guidanceId: 'core/export/griffin.md#s5-startup-observations' });
  assert.match(section.text, /^### S5 startup observations/);
  assert.match((await call('read_guidance', { guidanceId: 'wedge-s5-export' })).text, /Griffin/);
  await call('read_guidance', { guidanceId: '../package.json' }, /validation|Invalid/i);
  const machines = await call('list_machines');
  assert.ok(machines.every(machine => machine.outputs.every(output => !Object.hasOwn(output, 'program'))));
  assert.ok(machines.some(machine => machine.id === 'ultimaker-s5'));
  assert.ok(machines.some(machine => machine.id === 'bambu-h2d'));
  assert.ok(machines.some(machine => machine.id === 'dobot-mg400'));
  assert.ok(machines.some(machine => machine.id === 'denso-vp6242-rc8'));
  const dobot = await call('get_plan_template', { kind: 'shell', machineId: 'dobot-mg400' });
  assert.equal(dobot.plan.setup.dobot.configurationSource, null);
  await call('read_skill', { skillId: '../DEVELOP' }, /validation|Invalid|format/i);
  await call('create_print', { printId: '../escape', kind: 'wedge', machineId: 'ultimaker-s5' }, /validation|Invalid|format/i);
  await call('create_print', { printId: 'con', kind: 'wedge', machineId: 'ultimaker-s5' }, /Reserved|validation/i);
  const plan = await smallPlan(call, 'shell');
  await call('create_print', { printId: 'forged', kind: 'shell', machineId: 'ultimaker-s5', plan: { ...plan, approvals: {} } }, /not an agent-editable/);
  let state = await call('create_print', { printId: 'first', kind: 'shell', machineId: 'ultimaker-s5', plan });
  assert.deepEqual(state.approvals, { geometry: false, plan: false, toolpath: false });
  const compact = await call('get_print', { printId: 'first' });
  assert.equal(compact.planComplete, false);
  assert.equal(compact.geometry.omitted, true);
  assert.deepEqual(compact.geometry.boundsMm, { min: [0, 0, 0], max: [12, 10, 1] });
  assert.ok(!Object.hasOwn(compact.plan, 'geometry'));
  const complete = await call('get_print', { printId: 'first', includeGeometry: true });
  assert.equal(complete.planComplete, true);
  assert.deepEqual(complete.plan.geometry, plan.geometry);
  await call('create_print', { printId: 'first', kind: 'shell', machineId: 'ultimaker-s5', plan }, /already exists/);
  await call('create_print', { printId: 'second', kind: 'wedge', machineId: 'bambu-h2d', plan: await smallPlan(call, 'wedge', 'bambu-h2d') });
  assert.deepEqual((await call('list_prints')).map(print => print.printId).sort(), ['first', 'second']);
  await call('generate_print', { printId: 'first' }, /Approve/);
  await call('generate_print', { printId: 'first', development: true }, /Unrecognized|validation/i);
  await call('get_approval_status', { printId: 'first', approvals: { geometry: true } }, /Unrecognized|validation/i);
  await call('deliver_print', { printId: 'first' }, /approval/);
  await call('adjust_print', { printId: 'first', expectedRevision: state.revision, patch: { review: { approvals: {} } } }, /not an agent-editable/);
  const stale = state.revision;
  state = await call('adjust_print', { printId: 'first', expectedRevision: stale, patch: { process: { planarSpeedMmS: 21 } } });
  assert.notEqual(state.revision, stale);
  await call('adjust_print', { printId: 'first', expectedRevision: stale, patch: { process: { planarSpeedMmS: 22 } } }, /stale/);
  const again = await clientFor(t, printsRoot);
  assert.equal((await again.call('get_print', { printId: 'first' })).plan.process.planarSpeedMmS, 21);
  assert.equal((await again.call('get_print', { printId: 'second' })).machineId, 'bambu-h2d');
});

test('MCP Studio survives a viewer disconnect and releases only the closing adapter owner',async t=>{
  const {call,client,printsRoot}=await fixture(t);
  await call('create_print',{printId:'owned',kind:'wedge',machineId:'ultimaker-s5',plan:await smallPlan(call,'wedge')});
  const other=await clientFor(t,printsRoot);
  const a=await call('request_review',{printId:'owned'}),b=await other.call('request_review',{printId:'owned'});
  assert.notEqual(a.url,b.url,'separate adapters never adopt each other\'s listener');
  const before=await readFile(resolve(printsRoot,'owned','review.json'));
  async function view(url){
    const token=(await(await fetch(url)).text()).match(/name="saam-token" content="([^"]+)"/)[1];
    const response=await fetch(url+'/api/viewer?token='+token,{headers:{Connection:'close'}});
    assert.equal(response.status,200);
    const close=()=>response.body.cancel();t.after(close);return close;
  }
  const first=await view(a.url);await view(b.url);await first();
  const reused=await call('request_review',{printId:'owned'});
  assert.equal(reused.url,a.url,'disconnected viewers retain their server during the grace period');
  assert.equal((await call('get_print',{printId:'owned'})).printId,'owned','MCP remains connected');
  await client.close();
  const deadline=Date.now()+6000;
  while(true){
    try{await(await fetch(a.url)).text();}
    catch{break;}
    assert.ok(Date.now()<deadline,'closed adapter must release its listener');
    await new Promise(done=>setTimeout(done,100));
  }
  assert.equal((await fetch(b.url)).status,200);
  const next=await clientFor(t,printsRoot);
  const restarted=await next.call('request_review',{printId:'owned'});
  assert.equal((await fetch(restarted.url)).status,200);
  assert.deepEqual(await readFile(resolve(printsRoot,'owned','review.json')),before);
});

for (const [kind, machineId, skill] of [['shell', 'ultimaker-s5'], ['wedge', 'bambu-h2d'], ['shell', 'ultimaker-s5', 'vase-wall'], ['shell', 'bambu-h2d', 'vase-wall'], ['shell', 'dobot-mg400'], ['shell', 'dobot-mg400', 'vase-wall']]) {
  test(`MCP ${kind}/${machineId}/${skill ?? 'default'} uses Studio, fresh three-stage hashes and byte-identical delivery`, async t => {
    const { call, printsRoot } = await fixture(t), printId = 'reviewed', dir = resolve(printsRoot, printId);
    const plan = await smallPlan(call, kind, machineId);
    if (machineId === 'dobot-mg400') syntheticDobotSetup(plan);
    if (skill === 'vase-wall') {
      plan.skills['full-fill'].enabled = false;
      plan.skills['vase-wall'].enabled = true;
    }
    await call('create_print', { printId, kind, machineId, plan });
    const opened = await call('request_review', { printId });
    assert.equal(opened.browserOpenRequested, false);
    const page = await fetch(opened.url).then(response => response.text());
    assert.match(page, /SAAM Studio/);
    assert.equal((await fetch(opened.url + '/api/state').then(response => response.json())).plan.schema, kind === 'shell' ? 'saam-shell-plan/1' : 'saam-wedge-plan/1');
    assert.equal((await call('request_review', { printId })).url, opened.url);
    await syntheticApproval(dir, 'geometry');
    assert.equal((await call('get_approval_status', { printId })).approvals.geometry, true);
    await call('generate_print', { printId }, /Approve/);
    await syntheticApproval(dir, 'plan');
    const generated = await call('generate_print', { printId });
    assert.equal(generated.checks.result, 'pass');
    assert.equal(generated.checks.mode, 'production');
    assert.ok((await call('check_print', { printId })).checked.includes('exact-export'));
    await call('deliver_print', { printId }, /approval/);
    await syntheticApproval(dir, 'toolpath');
    const status = await call('get_approval_status', { printId });
    assert.equal(status.approvals.toolpath, true);
    const delivered = await call('deliver_print', { printId });
    const bundle = await bundleFor(dir), state = await bundle.loadBundle(dir);
    const exportFile = resolve(dir, 'exports', state.plan.output, state.exportName);
    assert.deepEqual(await readFile(delivered.file), await readFile(exportFile));
    assert.equal((await call('deliver_print', { printId })).exportHash, delivered.exportHash);
    const changed = await call('adjust_print', { printId, expectedRevision: status.revision, patch: { process: { planarSpeedMmS: 22 } } });
    assert.deepEqual(changed.approvals, { geometry: true, plan: false, toolpath: false });
    await call('deliver_print', { printId }, /approval/);
    await syntheticApproval(dir, 'plan');
    await call('generate_print', { printId });
    await syntheticApproval(dir, 'toolpath');
    const bytes = await readFile(exportFile);
    await writeFile(exportFile, Buffer.concat([bytes, Buffer.from('\n; tampered') ]));
    assert.equal((await call('get_approval_status', { printId })).approvals.toolpath, false);
    await call('check_print', { printId }, /changed|stale/);
    await call('deliver_print', { printId }, /approval/);
    const staleProgram = await call('get_approval_status', { printId });
    const geometry = kind === 'shell' ? { heightMm: 1.2 }
      : { points: plan.geometry.points.map(([x, y, z]) => [x, y, z > 0 ? z + 0.2 : z]) };
    const reshaped = await call('adjust_print', { printId, expectedRevision: staleProgram.revision, patch: { geometry } });
    assert.deepEqual(reshaped.approvals, { geometry: false, plan: false, toolpath: false });
  });
}

test('MCP refuses linked output folders and review requests restore the named bundle after Studio selection', async t => {
  const { call, printsRoot } = await fixture(t);
  for (const printId of ['first', 'second']) await call('create_print', { printId, kind: 'shell', machineId: 'ultimaker-s5', plan: await smallPlan(call, 'shell') });
  const { url } = await call('request_review', { printId: 'first' });
  const html = await fetch(url).then(response => response.text());
  const token = html.match(/name="saam-token" content="([^"]+)"/)?.[1] ?? html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  assert.ok(token, 'Studio token is read by the synthetic test, never by the adapter');
  const before = await fetch(url + '/api/state').then(response => response.json());
  const switched = await fetch(url + '/api/open', { method: 'POST', headers: { origin: url, 'x-saam-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ printId: before.printId, path: resolve(printsRoot, 'second') }) });
  assert.equal(switched.status, 200, await switched.text());
  assert.equal((await fetch(url + '/api/state').then(response => response.json())).printName, 'second');
  assert.equal((await call('request_review', { printId: 'first' })).url, url);
  assert.equal((await fetch(url + '/api/state').then(response => response.json())).printName, 'first');
  const outside = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(resolve(printsRoot, 'first', 'exports'));
  await symlink(outside, resolve(printsRoot, 'first', 'exports', 'griffin-gcode'), process.platform === 'win32' ? 'junction' : 'dir');
  await call('generate_print', { printId: 'first' }, /links|junctions/);
});

function asciiSTL(mesh) {
  return Buffer.from('solid synthetic\n' + mesh.triangles.map(triangle => 'facet normal 0 0 0\nouter loop\n'
    + triangle.map(i => 'vertex ' + mesh.vertices[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid synthetic\n');
}

test('MCP STL import preserves source/units and remembered setup across native bundles and read-only path checks', async t => {
  const { call, printsRoot } = await fixture(t);
  const plan = await smallPlan(call, 'shell');
  plan.setup.bedC = 65;
  await call('create_print', { printId: 'Known Setup', kind: 'shell', machineId: 'ultimaker-s5', plan });
  const remembered = await call('remember_setup', { printId: 'Known Setup' });
  assert.equal(remembered.approvalsChanged, false);
  assert.equal((await call('get_plan_template', { kind: 'wedge', machineId: 'ultimaker-s5' })).plan.setup.bedC, 65);
  const sourcePath = resolve(printsRoot, 'SYNTHETIC source.stl');
  const source = asciiSTL(boxMesh(8 / 25.4, 6 / 25.4, 1 / 25.4));
  await writeFile(sourcePath, source);
  await call('import_stl_print', { printId: 'Projects/Inch Part', sourcePath, units: 'unknown', machineId: 'ultimaker-s5' }, /validation|Invalid/i);
  await call('import_stl_print', { printId: 'Projects/Inch Part', sourcePath: 'relative.stl', units: 'inch', machineId: 'ultimaker-s5' }, /absolute path/);
  const created = await call('import_stl_print', { printId: 'Projects/Inch Part', sourcePath, units: 'inch', machineId: 'ultimaker-s5' });
  assert.doesNotMatch(JSON.stringify(created), /mesh-tools/);
  const dir = resolve(printsRoot, 'Projects/Inch Part');
  assert.deepEqual(created.approvals, { geometry: false, plan: false, toolpath: false });
  assert.deepEqual(await readFile(resolve(dir, 'geometry/source.stl')), source);
  const state = await call('get_print', { printId: 'Projects/Inch Part', includeGeometry: true });
  assert.equal(state.plan.setup.bedC, 65);
  assert.equal(state.plan.geometry.source.units, 'inch');
  assert.ok(Math.abs(Math.max(...state.plan.geometry.vertices.map(point => point[0])) - 8) < 1e-8);
  const checked = await call('check_path', { printId: 'Projects/Inch Part' });
  assert.equal(checked.mode, 'development-check-only');
  for (const name of ['path.saampath', 'checks.json']) await assert.rejects(access(resolve(dir, name)), { code: 'ENOENT' });
  assert.equal((await call('get_approval_status', { printId: 'Projects/Inch Part' })).generation, null);
  assert.ok((await call('list_prints')).some(print => print.printId === 'Projects/Inch Part'));
  const { url } = await call('request_review', { printId: 'Projects/Inch Part' });
  assert.equal((await fetch(url + '/api/state').then(response => response.json())).printName, 'Inch Part');
  // Configured imported geometry reopens as the exact saved source and recipe.
  const again = await clientFor(t, printsRoot);
  assert.equal((await again.call('get_print', { printId: 'Projects/Inch Part' })).revision, state.revision);
  await writeFile(resolve(dir, 'geometry/source.stl'), Buffer.from('changed source'));
  await call('check_print', { printId: 'Projects/Inch Part' }, /source changed/);
});

test('MCP rejected mesh import retains its diagnostic and routes to a readable task manual', async t => {
  const { call, printsRoot } = await fixture(t);
  const mesh = boxMesh();
  mesh.triangles.pop();
  const sourcePath = resolve(printsRoot, 'SYNTHETIC open mesh.stl');
  await writeFile(sourcePath, asciiSTL(mesh));
  await call('import_stl_print', { printId: 'Open mesh', sourcePath, units: 'mm', machineId: 'ultimaker-s5' },
    /closed, manifold.*read_skill.*mesh-tools/s);
  const manual = await call('read_skill', { skillId: 'mesh-tools' });
  assert.equal(manual.path, 'skills/mesh-tools/SKILL.md');
  assert.match(manual.manual, /repair-stl/);
  const reference = manual.links.find(link => link.guidanceId.startsWith('core/geom/README.md'));
  assert.ok(reference);
  assert.equal((await call('read_guidance', { guidanceId: reference.guidanceId })).path, 'core/geom/README.md');
});

test('MCP reopens shared nested names, rejects ancestor junctions and migrates old versions without overwriting delivery', async t => {
  const { call, printsRoot } = await fixture(t);
  const printId = 'Customer A/Job 2/Bounded Wedge';
  const created = await call('create_print', { printId, kind: 'wedge', machineId: 'ultimaker-s5', plan: await smallPlan(call, 'wedge') });
  const dir = resolve(printsRoot, printId), saved = JSON.parse(await readFile(resolve(dir, 'plan.json')));
  assert.ok((await call('list_prints')).some(print => print.printId === printId));
  saved.generatorVersion = '0.2.4';
  await writeFile(resolve(dir, 'plan.json'), JSON.stringify(saved));
  await mkdir(resolve(dir, 'delivery'));
  const priorDelivery = Buffer.from('SYNTHETIC PRIOR DELIVERY — not for printing');
  await writeFile(resolve(dir, 'delivery/wedge.gcode'), priorDelivery);
  await call('get_print', { printId }, /version|generator|upgrade/i);
  const upgraded = await call('upgrade_print', { printId });
  assert.deepEqual(upgraded.approvals, { geometry: false, plan: false, toolpath: false });
  assert.deepEqual(await readFile(resolve(dir, 'delivery/wedge.gcode')), priorDelivery);
  assert.notEqual(upgraded.revision, created.revision);
  for (const invalid of ['../Escape', 'A/../B', 'A\\B', '/absolute', 'C:/absolute', 'A/CON.txt', 'A/B/C/D'])
    await call('create_print', { printId: invalid, kind: 'wedge', machineId: 'ultimaker-s5' }, /validation|Invalid/i);
  const outside = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-mcp-ancestor-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, resolve(printsRoot, 'Redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await call('create_print', { printId: 'Redirect/Escape', kind: 'wedge', machineId: 'ultimaker-s5' }, /links|junctions/);
  await assert.rejects(access(resolve(outside, 'Escape')), { code: 'ENOENT' });
});

test('MCP preserves the shared regional recipe and configurable composition without a narrower transport schema', async t => {
  const { call, printsRoot } = await fixture(t), printId = 'Regional Plan';
  const plan = await smallPlan(call, 'shell');
  plan.composition.regions = [{ id: 'body', part: null, zStartMm: 0, zEndMm: null,
    skills: { 'planar-infill': { density: 0.3 } }, supportPolicy: 'supported', lowerSurfaceFrom: null }];
  const created = await call('create_print', { printId, kind: 'shell', machineId: 'ultimaker-s5', plan });
  assert.deepEqual(created.skills, ['planar-infill']);
  const checked = await call('check_path', { printId });
  assert.ok(checked.composition.operationOrder.length > 0);
  const changed = await call('adjust_print', { printId, expectedRevision: created.revision,
    patch: { composition: { batchLayers: 2, order: [checked.composition.operationOrder[0]], dependencies: [] } } });
  const reopened = await call('get_print', { printId, includeGeometry: true });
  assert.deepEqual(reopened.plan.composition.regions, plan.composition.regions);
  assert.equal(reopened.plan.composition.batchLayers, 2);
  assert.deepEqual(reopened.skills, ['planar-infill']);
  assert.notEqual(changed.revision, created.revision);
  await assert.rejects(access(resolve(printsRoot, printId, 'path.saampath')), { code: 'ENOENT' });
});
