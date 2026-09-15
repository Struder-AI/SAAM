import test from 'node:test';
import assert from 'node:assert/strict';
import {agentIndicator,hasPresentedResult,hasUnpreparedEdit} from '../../studio/work-state.mjs';
import {createAgentRequests,workSnapshot} from '../../studio/agent-requests.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const original={inputKey:'original',generationKey:'original-program',stage:'toolpath'};
const updated={inputKey:'updated',generationKey:'updated-program',stage:'toolpath'};
const request={id:'edit',printId:'part',kind:'edit',status:'working',baseline:original,updatedAt:10,expiresAt:1000};
const view={printId:'part',snapshot:original,ready:true,loading:false};
const active=(records,patch={})=>agentIndicator(records,{now:20,view:{...view,...patch}}).active;

test('old playback remains distinct from the requested result; readiness ends activity before acknowledgement',()=>{
  assert.equal(active([request]),true);
  assert.equal(active([request],{snapshot:updated,ready:false,loading:true}),true);
  assert.equal(active([request],{snapshot:updated,ready:true}),false);
  assert.equal(active([request],{snapshot:updated,ready:true}),false,'reconnecting to the same result stays idle');
  assert.equal(active([{...request,baseline:updated}],{snapshot:updated}),true,'a new request starts activity');
});

test('early completion retains activity until the updated result is presented',()=>{
  const completed={...request,status:'completed',result:updated};
  assert.equal(active([completed]),true,'old playable output does not satisfy the update');
  assert.equal(active([completed],{snapshot:updated,ready:false}),true);
  assert.equal(active([completed],{snapshot:updated,ready:true}),false);
  assert.equal(active([],{loading:true,ready:false}),true,'viewer loading covers missing agent bookkeeping');
});

test('waiting, guidance, failures, cancellation and work on another print have distinct activity',()=>{
  assert.equal(active([{...request,status:'waiting'}]),false);
  assert.equal(active([{...request,status:'queued'}]),false);
  assert.equal(active([{...request,kind:'guidance'}],{snapshot:updated}),false,'chat guidance does not obscure the preview');
  assert.equal(active([{...request,kind:'guidance',status:'completed',result:updated}]),false);
  assert.equal(active([{...request,status:'failed'}]),false);
  assert.equal(active([{...request,status:'cancelled'}]),false);
  assert.equal(active([{...request,printId:'other'}]),false);
  assert.equal(active([request],{errorAt:15,ready:false}),false);
  assert.equal(active([{...request,updatedAt:16}],{errorAt:15,ready:false}),true,'claimed recovery starts new activity');
  assert.deepEqual(agentIndicator([{...request,presented:true}],{now:1001,closedOwners:new Set([undefined]),view}),{active:false,message:''},'delivered work cannot later report a bookkeeping timeout or disconnect');
});

test('a generation already underway when a new edit arrives cannot satisfy that edit',()=>{
  assert.equal(active([request],{snapshot:{...original,generationKey:'regenerated'}}),true);
  const regeneration={...request,target:{...original,stage:'toolpath'}};
  assert.equal(active([regeneration],{snapshot:{...original,generationKey:'regenerated',stage:'toolpath'}}),false);
});

test('intermediate playback does not clear an overlapping edit; pausing it restores an idle view',()=>{
  const first={...request,requiresTarget:true,target:{...updated,stage:'toolpath'}};
  const second={...request,id:'lettering',requiresTarget:true,target:{inputKey:'both-edits',stage:'toolpath'}};
  assert.equal(active([first,second],{snapshot:{...updated,stage:'toolpath'}}),true);
  assert.equal(active([first,{...second,status:'waiting'}],{snapshot:{...updated,stage:'toolpath'}}),false);
  assert.equal(active([{...first,presented:true},second],{snapshot:{inputKey:'both-edits',generationKey:'both-program',stage:'toolpath'}}),false);
  assert.equal(active([{...second,target:undefined}],{snapshot:updated}),true,'unbound overlapping work is never assumed delivered');
  assert.equal(active([{...first,status:'cancelled'},second],{snapshot:{inputKey:'both-edits',generationKey:'both-program',stage:'toolpath'}}),false,'superseded intermediate output need never be displayed');
  assert.equal(active([first,{...second,status:'failed'}],{snapshot:{...updated,stage:'toolpath'}}),false,'failed remaining work does not lock the delivered preview');
});

test('intermediate saves, unchanged geometry and unrelated work cannot satisfy or hide an edit',()=>{
  const unbound={...request,requiresTarget:true};
  assert.equal(active([unbound],{snapshot:updated}),true,'even a single edit must publish its intended result');
  assert.equal(hasPresentedResult({...request,baseline:{...original,geometryKey:'same'}},
    {...updated,geometryKey:'same',stage:'geometry'}),false,'legacy settings changes are not delivered by unchanged geometry');
  const bound={...unbound,target:{...updated,stage:'toolpath'}};
  const waiting={snapshot:{...updated,stage:'geometry'},awaitingConfirmation:true};
  assert.equal(active([bound],waiting),false,'the exact prepared result can wait for shape confirmation');
  assert.equal(active([bound,unbound],waiting),true,'that confirmation cannot hide an unrelated edit');
  assert.deepEqual(agentIndicator([{...bound,status:'completed',result:updated}],{now:1001,view}),
    {active:false,message:'(lost contact)'},'early completion cannot leave an absent result busy forever');
});

test('generation waits for saved targets, with guidance and delivered work excluded',()=>{
  const current={...request,requiresTarget:true,expiresAt:Date.now()+60000};
  assert.equal(hasUnpreparedEdit([current],updated),true);
  assert.equal(hasUnpreparedEdit([{...current,target:{...updated,stage:'toolpath'}}],updated),false);
  assert.equal(hasUnpreparedEdit([{...current,target:{...original,stage:'toolpath'}}],updated),true);
  assert.equal(hasUnpreparedEdit([{...current,kind:'guidance'},{...current,presented:true}],updated),false);
});

test('request snapshots survive restart, capture result identity and support waiting and resuming',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-work-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'part');
  const {mkdir}=await import('node:fs/promises');await mkdir(directory);
  let state={plan:{geometry:{height:4}},machine:{id:'test'},review:{history:[]}};
  const save=()=>Promise.all(Object.entries(state).map(([name,value])=>writeFile(join(directory,name+'.json'),JSON.stringify(value))));
  await save();const requests=createAgentRequests(root),started=await requests.begin({directory,instruction:'Make it taller'});
  assert.deepEqual(started.baseline,workSnapshot(state));
  state.plan.geometry.height=8;await save();
  const prepared=await requests.update(started.id,{status:'working',resultStage:'toolpath'});
  await requests.update(started.id,{status:'waiting'});
  assert.equal((await createAgentRequests(root).list())[0].status,'waiting');
  const resumed=await requests.update(started.id,{status:'working'});
  assert.deepEqual(resumed.baseline,started.baseline);assert.deepEqual(resumed.target,prepared.target);
  const done=await requests.update(started.id);
  assert.notEqual(done.baseline.inputKey,done.result.inputKey);
  assert.deepEqual(done.result,workSnapshot(state));
});

test('overlapping requests bind results independently and retain presentation across reconnects',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-work-overlap-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const {mkdir}=await import('node:fs/promises');const directory=join(root,'part');await mkdir(directory);
  const state={plan:{height:4},machine:{id:'test'},review:{history:[]}};
  const save=()=>Promise.all(Object.entries(state).map(([name,value])=>writeFile(join(directory,name+'.json'),JSON.stringify(value))));
  await save();const requests=createAgentRequests(root);
  const a=await requests.begin({directory,instruction:'First'}),b=await requests.begin({directory,instruction:'Second'});
  assert.ok((await requests.list()).every(r=>r.requiresTarget));
  state.plan.height=8;await save();await requests.update(a.id,{status:'working',resultStage:'geometry'});
  await requests.presented(directory,{...workSnapshot(state),stage:'geometry'});
  const records=await createAgentRequests(root).list();
  assert.equal(records.find(r=>r.id===a.id).presented,true);
  assert.ok(!records.find(r=>r.id===b.id).presented);
  await requests.update(b.id,{status:'waiting'});
  await requests.cancelFor(directory);assert.ok((await requests.list()).every(r=>r.status==='cancelled'));
});
