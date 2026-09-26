// Actual SDK client + stdio subprocess, with approval fixtures outside MCP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundleFor } from '../../studio/adapter-resolution.mjs';
import { syntheticDobotSetup } from './fixtures/dobot.mjs';
import { boxMesh } from './fixtures/mesh.mjs';
import {createTour} from '../../studio/tour.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';

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
async function smallPlan(call, machineId = 'ultimaker-s5') {
  const { plan } = await call('get_plan_template', { kind: 'shell', machineId });
  plan.process.minimumLayerSeconds = 0;
  plan.geometry = { shape: 'box', runMm: 12, widthMm: 10, heightMm: 1 };
  plan.skills['draped-skin'].enabled = false;
  return plan;
}

test('MCP correlates ordinary maker work and receives Studio requests without approvals',async t=>{
  const {call,printsRoot}=await fixture(t),plan=await smallPlan(call);
  await call('create_print',{printId:'ordinary',kind:'shell',machineId:'ultimaker-s5',plan});
  const first=await call('begin_studio_work',{printId:'ordinary',instruction:'Change infill'});
  const second=await call('begin_studio_work',{printId:'ordinary',instruction:'Add lettering'});
  const waiting=await call('respond_to_studio_request',{requestId:second.id,status:'waiting',message:'Awaiting a choice'});
  assert.equal(waiting.status,'waiting');
  const targeted=await call('respond_to_studio_request',{requestId:second.id,status:'working',resultStage:'geometry'});
  assert.equal(targeted.target.stage,'geometry');assert.ok(targeted.target.inputKey);
  const activityStore=createAgentRequests(printsRoot);
  const untouched=await activityStore.get(first.id);
  await call('get_print',{printId:'ordinary',requestIds:[second.id]});
  const activity=await activityStore.get(second.id);
  assert.ok(activity.updatedAt>targeted.updatedAt);assert.deepEqual(activity.target,targeted.target);
  assert.equal((await activityStore.get(first.id)).updatedAt,untouched.updatedAt,'another request on the same print receives no implicit renewal');
  await call('respond_to_studio_request',{requestId:first.id,message:'Done'});
  assert.deepEqual((await call('get_studio_requests')).requests.filter(r=>r.status==='working').map(r=>r.id),[second.id]);
  const queue=createAgentRequests(printsRoot),request=await queue.begin({directory:resolve(printsRoot,'ordinary'),source:'studio',instruction:'Offer infill options'});
  assert.equal((await call('wait_for_studio_request',{waitMs:0})).requests[0].id,request.id);
  await call('begin_studio_work',{printId:'ordinary',instruction:'Offer choices',requestId:request.id});
  await call('respond_to_studio_request',{requestId:request.id,message:'Choices offered'});
  assert.deepEqual((await call('wait_for_studio_request',{waitMs:0})).requests,[]);
  const bundled=await queue.begin({directory:resolve(printsRoot,'ordinary'),source:'studio',instruction:'SYNTHETIC bundled claim'});
  const claimed=await call('wait_for_studio_request',{waitMs:0,claim:true});
  assert.equal(claimed.requests[0].id,bundled.id);
  assert.equal(claimed.requests[0].status,'working');
  assert.equal((await queue.list()).find(item=>item.id===bundled.id).status,'working');
  assert.equal((await call('get_print',{printId:'ordinary'})).toolpathApproved,false);
});

test('MCP follows tour chat gates while production generation remains available for review',async t=>{
  const {call,printsRoot}=await fixture(t),tour=createTour(printsRoot);
  await tour.action('fresh');const before=await call('get_tour');
  assert.equal(before.step,0);assert.equal(before.canNext,false);
  await call('set_tour_start_at',{startAt:{layer:12},runId:before.runId,lessonId:before.lessonId});
  const saved=await call('get_print',{printId:'tour/handle',includeGeometry:true});
  saved.plan.geometry.parts[1].geometry.heightMm=11;
  await call('adjust_print',{printId:'tour/handle',expectedRevision:saved.revision,patch:{geometry:saved.plan.geometry}});
  const after=await call('get_tour',{after:before.cursor,waitMs:50});assert.equal(after.canNext,false,'wait for the browser to render the edit');
  const generated=await call('generate_print',{printId:'tour/handle'});assert.equal(generated.checks.mode,'production');
  await call('deliver_print',{printId:'tour/handle'},/Exit the tour/);
  await tour.action('exit');
  const current=await call('get_print',{printId:'tour/handle'});
  const changed=await call('change_machine',{printId:'tour/handle',machineId:'bambu-h2d',expectedRevision:current.revision});
  assert.equal(changed.machineId,'bambu-h2d');assert.equal(changed.toolpathApproved,null,
    'a geometry-only mutation does not claim current output approval state');
});



test('MCP text task edits actual geometry with a local font and stale-revision protection',async t=>{
  const {call}=await fixture(t),plan=await smallPlan(call);
  let state=await call('create_print',{printId:'text-sample',kind:'shell',machineId:'ultimaker-s5',plan});
  const manual=await call('read_skill',{skillId:'text'});assert.match(manual.manual,/apply_text/);
  state=await call('apply_text',{printId:'text-sample',expectedRevision:state.revision,request:{feature:{id:'label',text:'BO',fontPath:resolve(root,'skills/text/tests/fixtures/Abel-Regular.ttf'),mode:'recessed',sizeMm:5,depthMm:0.4,positionMm:[2,2],reference:{kind:'plane',origin:[0,0,1],xAxis:[1,0,0],yAxis:[0,1,0]}}}});
  assert.equal(state.toolpathApproved,false);
  const saved=await call('get_print',{printId:'text-sample',includeGeometry:true});
  assert.equal(saved.plan.geometry.shape,'text');assert.ok(saved.plan.geometry.triangles.length>12);
  await call('apply_text',{printId:'text-sample',expectedRevision:'stale',request:{remove:'label'}},/stale/);
  await call('apply_text',{printId:'text-sample',expectedRevision:state.revision,request:{feature:{id:'label',text:'O'}}});
  assert.equal((await call('get_print',{printId:'text-sample',includeGeometry:true})).plan.geometry.features[0].text,'O');
});

test('MCP SDK lists known manuals and profiles; creates persistent isolated bundles with strict inputs and no final approval tools', async t => {
  const { call, client, printsRoot } = await fixture(t);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('request_review'));
  assert.ok(!names.includes('confirm_geometry'));
  assert.ok(!names.some(name => /^(approve|post_process|compile_plan)$/.test(name)));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'full-fill'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'supports'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'pipe-cladding'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'mesh-tools' && skill.kind === 'geometry'));
  assert.ok((await call('list_skills')).some(skill => skill.id === 'text' && skill.kind === 'geometry'));
  assert.equal((await call('read_skill', {skillId:'supports'})).skillId,'supports');
  const guidance = await call('read_guidance', { guidanceId: 'makers' });
  assert.equal(guidance.text, await readFile(resolve(root, 'MAKERS.md'), 'utf8'));
  assert.equal(guidance.path, 'MAKERS.md');
  assert.ok(guidance.links.some(link => link.guidanceId.startsWith('skills/')));
  const digestLink = guidance.links.find(link => link.guidanceId === 'skills/DIGEST.md');
  assert.ok(digestLink);
  const digest = await call('read_guidance', { guidanceId: digestLink.guidanceId });
  assert.equal(digest.path, 'skills/DIGEST.md');
  assert.equal((await call('read_guidance', { guidanceId: 'print-tools' })).path, 'core/print/USAGE.md');
  const section = await call('read_guidance', { guidanceId: 'core/export/griffin.md#s5-startup-observations' });
  assert.match(section.text, /^### S5 startup observations/);
  await call('read_guidance', { guidanceId: '../package.json' }, /validation|Invalid/i);
  const machines = await call('list_machines');
  assert.ok(machines.every(machine => machine.outputs.every(output => !Object.hasOwn(output, 'program'))));
  assert.ok(machines.some(machine => machine.id === 'ultimaker-s5'));
  assert.ok(machines.some(machine => machine.id === 'bambu-h2d'));
  assert.ok(machines.find(machine => machine.id === 'bambu-x1-carbon').outputs.every(output => output.implemented));
  for(const id of ['ultimaker-2-extended','ultimaker-3']) {
    const machine=machines.find(machine=>machine.id===id);
    assert.ok(machine,id);
    assert.ok(machine.outputs.every(output=>output.implemented===false&&output.reason));
  }
  assert.ok(machines.some(machine => machine.id === 'dobot-mg400'));
  assert.ok(machines.some(machine => machine.id === 'denso-vs068a4-rc8a'));
  const dobot = await call('get_plan_template', { kind: 'shell', machineId: 'dobot-mg400' });
  assert.equal(dobot.plan.setup.dobot.configurationSource, null);
  await call('read_skill', { skillId: '../DEVELOP' }, /validation|Invalid|format/i);
  await call('create_print', { printId: '../escape', kind: 'shell', machineId: 'ultimaker-s5' }, /validation|Invalid|format/i);
  await call('create_print', { printId: 'con', kind: 'shell', machineId: 'ultimaker-s5' }, /Reserved|validation/i);
  const plan = await smallPlan(call);
  await call('create_print', { printId: 'forged', kind: 'shell', machineId: 'ultimaker-s5', plan: { ...plan, approvals: {} } }, /not an agent-editable/);
  let state = await call('create_print', { printId: 'first', kind: 'shell', machineId: 'ultimaker-s5', plan });
  assert.equal(state.toolpathApproved, false);
  const compact = await call('get_print', { printId: 'first' });
  assert.equal(compact.planComplete, false);
  assert.equal(compact.geometry.omitted, true);
  assert.deepEqual(compact.geometry.boundsMm, { min: [0, 0, 0], max: [12, 10, 1] });
  assert.ok(!Object.hasOwn(compact.plan, 'geometry'));
  const complete = await call('get_print', { printId: 'first', includeGeometry: true });
  assert.equal(complete.planComplete, true);
  assert.deepEqual(complete.plan.geometry, plan.geometry);
  await call('create_print', { printId: 'first', kind: 'shell', machineId: 'ultimaker-s5', plan }, /already exists/);
  await call('create_print', { printId: 'second', kind: 'shell', machineId: 'bambu-h2d', plan: await smallPlan(call, 'bambu-h2d') });
  assert.deepEqual((await call('list_prints')).map(print => print.printId).sort(), ['first', 'second']);
  const generated=await call('generate_print', { printId: 'first' });assert.equal(generated.checks.mode,'production');
  await call('generate_print', { printId: 'first', development: true }, /Unrecognized|validation/i);
  await call('get_approval_status', { printId: 'first', approvals: { geometry: true } }, /Unrecognized|validation/i);
  await call('deliver_print', { printId: 'first' }, /approval/);
  await call('adjust_print', { printId: 'first', expectedRevision: state.revision, patch: { review: { approvals: {} } } }, /not an agent-editable/);
  const stale = generated.revision;
  state = await call('adjust_print', { printId: 'first', expectedRevision: stale, patch: { process: { planarSpeedMmS: 21 } } });
  assert.notEqual(state.revision, stale);
  await call('adjust_print', { printId: 'first', expectedRevision: stale, patch: { process: { planarSpeedMmS: 22 } } }, /stale/);
  const again = await clientFor(t, printsRoot);
  assert.equal((await again.call('get_print', { printId: 'first' })).plan.process.planarSpeedMmS, 21);
  assert.equal((await again.call('get_print', { printId: 'second' })).machineId, 'bambu-h2d');
});

test('MCP Studio survives a viewer disconnect and releases only the closing adapter owner',async t=>{
  const {call,client,printsRoot}=await fixture(t);
  await call('create_print',{printId:'owned',kind:'shell',machineId:'ultimaker-s5',plan:await smallPlan(call)});
  const other=await clientFor(t,printsRoot);
  const a=await call('request_review',{printId:'owned'}),b=await other.call('request_review',{printId:'owned'});
  assert.notEqual(a.url,b.url,'separate adapters never adopt each other\'s listener');
  assert.equal((await call('get_studio_sessions')).sessions[0].instanceId,a.studioInstanceId);
  await other.call('close_studio_session',{studioInstanceId:a.studioInstanceId},/not owned/);
  const duplicate=await call('request_review',{printId:'owned',newInstance:true});
  assert.notEqual(duplicate.studioInstanceId,a.studioInstanceId,'one agent can open the same shared bundle in another owned Studio');
  await call('begin_studio_work',{printId:'owned',instruction:'Ambiguous instance'},/Specify studioInstanceId/);
  await call('close_studio_session',{studioInstanceId:duplicate.studioInstanceId});
  await call('create_print',{printId:'owned-second',kind:'shell',machineId:'ultimaker-s5',plan:await smallPlan(call)});
  const switched=await call('request_review',{printId:'owned-second'});
  assert.equal(switched.studioInstanceId,a.studioInstanceId,'switching prints reuses the sole live Studio');
  assert.equal(switched.url,a.url);
  const secondStudio=await call('request_review',{printId:'owned-second',newInstance:true});
  assert.equal((await call('get_studio_sessions')).sessions.length,2,'one agent can own multiple Studio instances');
  assert.notEqual(secondStudio.studioInstanceId,a.studioInstanceId);
  await call('close_studio_session',{studioInstanceId:secondStudio.studioInstanceId});
  const before=await readFile(resolve(printsRoot,'owned','plan.json'));
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
  assert.deepEqual(await readFile(resolve(printsRoot,'owned','plan.json')),before);
});

// One case per transport/output shape; vase geometry and machine semantics are
// covered by the skill and exporter suites, not by repeating this protocol flow.
for (const machineId of ['ultimaker-s5', 'bambu-h2d', 'dobot-mg400']) {
  test(`MCP shell/${machineId} uses Studio, fresh final-review hashes and byte-identical delivery`, async t => {
    const { call, printsRoot } = await fixture(t), printId = 'reviewed', dir = resolve(printsRoot, printId);
    const plan = await smallPlan(call, machineId);
    if (machineId === 'dobot-mg400') syntheticDobotSetup(plan);
    await call('create_print', { printId, kind: 'shell', machineId, plan });
    const opened = await call('request_review', { printId });
    assert.equal(opened.browserOpenRequested, false);
    const page = await fetch(opened.url).then(response => response.text());
    assert.match(page, /SAAM Studio/);
    assert.equal((await fetch(opened.url + '/api/state').then(response => response.json())).plan.schema, 'saam-shell-plan/1');
    assert.equal((await call('request_review', { printId })).url, opened.url);
    assert.equal((await call('get_approval_status', { printId })).toolpathApproved, false);
    const generated = await call('generate_print', { printId });
    assert.equal(generated.checks.result, 'pass');
    assert.equal(generated.checks.mode, 'production');
    assert.ok((await call('check_print', { printId })).checked.includes('exact-export'));
    await call('deliver_print', { printId }, /approval/);
    await syntheticApproval(dir, 'toolpath');
    const status = await call('get_approval_status', { printId });
    assert.equal(status.toolpathApproved, true);
    const delivered = await call('deliver_print', { printId });
    const bundle = await bundleFor(dir), state = await bundle.loadBundle(dir);
    const exportFile = resolve(dir,state.review.generation.file);
    assert.deepEqual(await readFile(delivered.file), await readFile(exportFile));
    assert.equal((await call('deliver_print', { printId })).exportHash, delivered.exportHash);
    const changed = await call('adjust_print', { printId, expectedRevision: status.revision, patch: { process: { planarSpeedMmS: 22 } } });
    assert.equal(changed.toolpathApproved, false);
    await call('deliver_print', { printId }, /approval/);
    await call('generate_print', { printId });
    await syntheticApproval(dir, 'toolpath');
    const regenerated=await bundle.loadBundle(dir),currentExportFile=resolve(dir,regenerated.review.generation.file),bytes=await readFile(currentExportFile);
    await writeFile(currentExportFile, Buffer.concat([bytes, Buffer.from('\n; tampered') ]));
    assert.equal((await call('get_approval_status', { printId })).toolpathApproved, false);
    await call('check_print', { printId }, /changed|stale/);
    await call('deliver_print', { printId }, /approval/);
    const staleProgram = await call('get_approval_status', { printId });
    const reshaped = await call('adjust_print', { printId, expectedRevision: staleProgram.revision, patch: { geometry: { heightMm: 1.2 } } });
    assert.equal(reshaped.toolpathApproved, false);
  });
}

test('MCP refuses linked output folders and review requests restore the named bundle after Studio selection', async t => {
  const { call, printsRoot } = await fixture(t);
  for (const printId of ['first', 'second']) await call('create_print', { printId, kind: 'shell', machineId: 'ultimaker-s5', plan: await smallPlan(call) });
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
  const plan = await smallPlan(call);
  plan.setup.bedC = 65;
  await call('create_print', { printId: 'Known Setup', kind: 'shell', machineId: 'ultimaker-s5', plan });
  const remembered = await call('remember_setup', { printId: 'Known Setup' });
  assert.equal(remembered.approvalsChanged, false);
  assert.equal((await call('get_plan_template', { kind: 'shell', machineId: 'ultimaker-s5' })).plan.setup.bedC, 65);
  const sourcePath = resolve(printsRoot, 'SYNTHETIC source.stl');
  const source = asciiSTL(boxMesh(8 / 25.4, 6 / 25.4, 1 / 25.4));
  await writeFile(sourcePath, source);
  await call('import_stl_print', { printId: 'Projects/Inch Part', sourcePath, units: 'unknown', machineId: 'ultimaker-s5' }, /validation|Invalid/i);
  await call('import_stl_print', { printId: 'Projects/Inch Part', sourcePath: 'relative.stl', units: 'inch', machineId: 'ultimaker-s5' }, /absolute path/);
  const created = await call('import_stl_print', { printId: 'Projects/Inch Part', sourcePath, units: 'inch', machineId: 'ultimaker-s5' });
  assert.doesNotMatch(JSON.stringify(created), /mesh-tools/);
  const dir = resolve(printsRoot, 'Projects/Inch Part');
  assert.equal(created.toolpathApproved, false);
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

test('MCP rejected mesh import retains its diagnostic and routes to a readable geometry skill manual', async t => {
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

test('MCP reopens shared nested names and rejects ancestor junctions and invalid names', async t => {
  const { call, printsRoot } = await fixture(t);
  const printId = 'Customer A/Job 2/Nested Part';
  await call('create_print', { printId, kind: 'shell', machineId: 'ultimaker-s5', plan: await smallPlan(call) });
  assert.ok((await call('list_prints')).some(print => print.printId === printId));
  const again = await clientFor(t, printsRoot);
  assert.equal((await again.call('get_print', { printId })).printId, printId);
  for (const invalid of ['../Escape', 'A/../B', 'A\\B', '/absolute', 'C:/absolute', 'A/CON.txt', 'A/B/C/D'])
    await call('create_print', { printId: invalid, kind: 'shell', machineId: 'ultimaker-s5' }, /validation|Invalid/i);
  const outside = await mkdtemp(resolve(tmpdir(), 'saam-synthetic-mcp-ancestor-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, resolve(printsRoot, 'Redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await call('create_print', { printId: 'Redirect/Escape', kind: 'shell', machineId: 'ultimaker-s5' }, /links|junctions/);
  await assert.rejects(access(resolve(outside, 'Escape')), { code: 'ENOENT' });
});

test('MCP preserves the shared regional recipe and configurable composition without a narrower transport schema', async t => {
  const { call, printsRoot } = await fixture(t), printId = 'Regional Plan';
  const plan = await smallPlan(call);
  plan.composition.regions = [{ id: 'body', part: null, zStartMm: 0, zEndMm: null,
    skills: { 'planar-infill': { density: 0.3 } }, lowerSurfaceFrom: null }];
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


test('the local runtime runs operations without an MCP transport, under the same strict schemas',async t=>{
  const {createLocalRuntime}=await import('../../adapters/mcp/src/runtime.mjs');
  const {createMcpAdapter}=await import('../../adapters/mcp/src/server.mjs');
  const printsRoot=await mkdtemp(resolve(tmpdir(),'saam-runtime-'));t.after(()=>rm(printsRoot,{recursive:true,force:true}));
  const runtime=createLocalRuntime({printsRoot,autoOpen:false});t.after(()=>runtime.close());
  const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
  const adapter=createMcpAdapter({printsRoot,autoOpen:false});t.after(()=>adapter.close());
  const [ct,st]=InMemoryTransport.createLinkedPair(),client=new Client({name:'runtime-parity',version:'1'});
  await adapter.server.connect(st);await client.connect(ct);t.after(()=>client.close());
  assert.deepEqual(runtime.operations.map(o=>o.name).sort(),(await client.listTools()).tools.map(o=>o.name).sort());
  assert.ok((await runtime.invoke('list_machines')).some(machine=>machine.id==='ultimaker-s5'));
  const plan=await smallPlan((name,args)=>runtime.invoke(name,args));
  await assert.rejects(runtime.invoke('create_print',{printId:'part',kind:'shell',machineId:'ultimaker-s5',plan,approved:true}),/unrecognized/i);
  const created=await runtime.invoke('create_print',{printId:'part',kind:'shell',machineId:'ultimaker-s5',plan});
  assert.equal(created.toolpathApproved,false);
  await assert.rejects(runtime.invoke('grant_approval',{}),/Unknown SAAM operation/);
});

test('MCP transport close persists scoped failure and pushes it to Studio before shutdown',async t=>{
  const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
  const {createMcpAdapter}=await import('../../adapters/mcp/src/server.mjs');
  const printsRoot=await mkdtemp(resolve(tmpdir(),'saam-close-'));t.after(()=>rm(printsRoot,{recursive:true,force:true}));
  const adapter=createMcpAdapter({printsRoot,autoOpen:false});t.after(()=>adapter.close());
  const [ct,st]=InMemoryTransport.createLinkedPair(),client=new Client({name:'close-test',version:'1'});
  await adapter.server.connect(st);await client.connect(ct);
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
  await call('create_print',{printId:'part',kind:'shell',machineId:'ultimaker-s5',plan:await smallPlan(call)});
  const request=await call('begin_studio_work',{printId:'part',instruction:'Pending edit'});
  const other=await createAgentRequests(printsRoot,{ownerId:'another-connection'}).begin({directory:resolve(printsRoot,'part'),instruction:'Independent'});
  const {url}=await call('request_review',{printId:'part'}),html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const viewer=await fetch(url+'/api/viewer?token='+token),reader=viewer.body.getReader();await reader.read();
  const studioRequest=await(await fetch(url+'/api/agent-request',{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:'{}'})).json();
  await client.close();let events='';for(;;){const {done,value}=await reader.read();if(done)break;events+=new TextDecoder().decode(value);}
  await adapter.close();assert.match(events,/event: agent-connection-closed/);assert.match(events,/connectionClosed/);
  const requests=await createAgentRequests(printsRoot).list();
  for(const id of [request.id,studioRequest.id])assert.equal(requests.find(r=>r.id===id).connectionClosed,true);
  assert.equal(requests.find(r=>r.id===other.id).status,'working');
});


test('waiting for Studio does not block immediate dots, responses or tour metadata',async t=>{
  const {call,printsRoot}=await fixture(t),tour=createTour(printsRoot);await tour.action('fresh');
  const waiting=call('wait_for_studio_request',{waitMs:4000});
  await new Promise(r=>setTimeout(r,30));const started=Date.now();
  const work=await call('begin_studio_work',{instruction:'Change this shape'});
  assert.equal(work.printId,'tour/handle');assert.ok(Date.now()-started<1000,'begin must bypass an outstanding wait');
  await call('respond_to_studio_request',{requestId:work.id,message:'Geometry updated; acknowledgement already sent'});
  const guide=await call('get_tour');assert.equal(guide.step,0);
  const request=await createAgentRequests(printsRoot).begin({directory:guide.directory,source:'studio',instruction:'Congratulate now'});
  const result=await waiting;assert.equal(result.requests[0].id,request.id);assert.ok(Date.now()-request.createdAt<1000,'listener returns as soon as work is queued');
});

test('a queued Studio request is pushed to the MCP client and included in the next tool result',async t=>{
  const {LoggingMessageNotificationSchema}=await import('@modelcontextprotocol/sdk/types.js');
  const {call,client,printsRoot}=await fixture(t),tour=createTour(printsRoot),{directory}=await tour.action('fresh');
  let resolveNotice;const notice=new Promise(resolve=>{resolveNotice=resolve;});
  client.setNotificationHandler(LoggingMessageNotificationSchema,message=>{if(message.params.logger==='saam.studio')resolveNotice(message.params.data);});
  const record=await createAgentRequests(printsRoot).begin({directory,source:'studio',instruction:'Offer infill options now'});
  const timeout=setTimeout(()=>resolveNotice({timeout:true}),1500);const pushed=await notice;clearTimeout(timeout);
  assert.equal(pushed.request?.id,record.id);assert.ok(Date.now()-record.createdAt<1000);
  const response=await call('get_print',{printId:'tour/handle'});assert.equal(response.studioRequests[0].id,record.id);
});

test('MCP reads the Studio event queue, and delivered events reach tool results, waits and notifications',async t=>{
  const {LoggingMessageNotificationSchema}=await import('@modelcontextprotocol/sdk/types.js');
  const {call,client,printsRoot}=await fixture(t);
  await call('create_print',{printId:'events',kind:'shell',machineId:'ultimaker-s5',plan:await smallPlan(call)});
  const notices=[];client.setNotificationHandler(LoggingMessageNotificationSchema,message=>{if(message.params.logger==='saam.studio'&&message.params.data.type==='studio-events')notices.push(message.params.data.events.map(e=>e.kind));});
  const {url}=await call('request_review',{printId:'events'});
  const html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  let state=await(await fetch(url+'/api/state')).json();
  assert.equal((await post('view-ready',{stage:'geometry',revision:state.revision})).status,200);
  const first=await call('get_studio_events');
  assert.deepEqual(first.events.map(e=>e.kind),['view-presented']);assert.deepEqual(first.generation,[]);assert.equal(first.studioEvents,undefined);
  assert.deepEqual((await call('get_studio_events')).events,[],'reads drain the queue');
  const waiting=call('wait_for_studio_request',{waitMs:5000});await new Promise(done=>setTimeout(done,30));
  assert.equal((await post('open',{path:resolve(printsRoot,'events')})).status,200);
  const woke=await waiting;assert.deepEqual(woke.events.map(e=>e.kind),['print-opened']);assert.deepEqual(woke.requests,[]);
  for(let n=0;n<100&&!notices.length;n++)await new Promise(done=>setTimeout(done,20));
  assert.deepEqual(notices,[['print-opened']],'a delivered event is pushed as a notification');
  state=await(await fetch(url+'/api/state')).json();
  const updated=await post('plan',{plan:state.plan,revision:state.revision});assert.equal(updated.status,200,await updated.text());
  const summary=await call('get_print',{printId:'events'});
  assert.deepEqual(summary.studioEvents.map(e=>e.kind),['plan-updated'],'held events ride on the next tool result');
  assert.equal((await call('get_print',{printId:'events'})).studioEvents,undefined);
  assert.deepEqual((await call('get_studio_events',{history:true})).recent.map(e=>e.kind),['view-presented','print-opened','plan-updated']);
});
