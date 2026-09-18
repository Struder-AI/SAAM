import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../../studio/server.mjs';
import * as shell from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
// A small planar box keeps these Studio-lifecycle tests fast and machine-neutral.
const boxPlan=(machine=loadMachine())=>{const p=defaults(machine);p.geometry={shape:'box',runMm:10,widthMm:10,heightMm:2};p.skills['draped-skin'].enabled=false;p.process.minimumLayerSeconds=0;return p;};
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import workerThreads from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {agentIndicator} from '../../studio/work-state.mjs';

test('an explicit scratch resolver follows Studio opening and listing without changing the default registry',async t=>{
  const library=await mkdtemp(join(tmpdir(),'saam-studio-scratch-'));t.after(()=>rm(library,{recursive:true,force:true}));
  const {mkdir}=await import('node:fs/promises');
  for(const id of ['first','second']){
    await mkdir(join(library,id));
    await writeFile(join(library,id,'plan.json'),JSON.stringify({schema:'scratch-test/1'}));
    await writeFile(join(library,id,'machine.json'),JSON.stringify({name:'Synthetic scratch machine'}));
  }
  const resolver=async dir=>{
    assert.equal(JSON.parse(await readFile(join(dir,'plan.json'),'utf8')).schema,'scratch-test/1');
    return {bundleFingerprint:async()=>dir,loadBundle:async()=>({kind:'shell',marker:dir,review:{approvals:{}}})};
  };
  const server=createStudio(join(library,'first'),{libraryRoot:library,resolveBundle:resolver});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  assert.equal((await(await fetch(origin+'/api/state')).json()).marker,join(library,'first'));
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,2);
  const response=await fetch(origin+'/api/open',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({path:join(library,'second','plan.json')})});
  assert.equal(response.status,200);
  assert.equal((await(await fetch(origin+'/api/state')).json()).marker,join(library,'second'));
  const {bundleFor,listPrints}=await import('../../studio/server.mjs');
  await assert.rejects(bundleFor(join(library,'first')),/cannot review/);
  assert.deepEqual(await listPrints(library),[]);
});

test('Studio reopens saved exports without creating or rewriting approvals',async t=>{
  const library=await mkdtemp(join(tmpdir(),'saam-studio-open-'));t.after(()=>rm(library,{recursive:true,force:true}));
  const geometry=join(library,'geometry-only'),ready=join(library,'ready-h2d');
  await shell.initBundle(geometry,boxPlan());
  let state=await shell.loadBundle(geometry);
  await shell.initBundle(ready,boxPlan(loadMachine('bambu-h2d')),{machineId:'bambu-h2d'});
  await shell.generateBundle(ready);
  const original=await readFile(join(ready,'review.json'));
  const server=createStudio(geometry,{libraryRoot:library});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const get=async()=>await(await fetch(origin+'/api/state')).json();
  const post=(route,data,authorized=true)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:authorized?origin:'http://evil.invalid','X-SAAM-Token':token},body:JSON.stringify(data)});
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,2);
  const first=await get();assert.equal(first.geometryApproved,false);assert.equal(first.planApproved,false);assert.equal(first.program,undefined);
  assert.equal((await post('open',{path:ready},false)).status,403);
  const archive=join(ready,'exports/bambu-gcode/part.gcode.3mf');
  assert.equal((await post('open',{path:archive,printId:first.printId})).status,200);
  state=await get();assert.equal(state.planApproved,false);assert.ok(state.program.summary.moves);assert.equal(state.program.moves,undefined);assert.equal(state.toolpathApproved,false);
  assert.notEqual(state.printId,first.printId);assert.notEqual(state.fingerprint,first.fingerprint);
  const requests=createAgentRequests(library,{ownerId:server.agentSession().ownerId});
  const shown={stage:'toolpath',revision:state.revision,exportHash:state.exportHash};
  assert.equal((await post('view-ready',{...shown,exportHash:'stale'})).status,200);
  assert.equal((await requests.list()).length,0,'stale displayed data creates no advisory');
  assert.equal((await post('view-ready',shown)).status,200);
  assert.equal((await post('view-ready',shown)).status,200);
  const pending=await requests.wait({waitMs:0,claim:true});
  assert.equal(pending.requests.length,1);assert.equal(pending.requests[0].kind,'advisory');
  assert.equal(pending.requests[0].evidence.exportHash,state.exportHash);
  assert.deepEqual(pending.requests[0].evidence.shortTravel,state.program.summary.shortTravel);
  assert.ok(pending.requests[0].evidence.shortTravel.count>0);
  assert.equal(agentIndicator(pending.requests,{now:Date.now()+3600000}).active,false);
  assert.equal(agentIndicator(pending.requests,{now:Date.now()+3600000}).message,'');
  assert.equal((await createAgentRequests(library,{now:()=>Date.now()+3600000}).list())[0].status,'working');
  await requests.update(pending.requests[0].id,{status:'completed'});
  await post('view-ready',shown);
  assert.equal((await requests.wait({waitMs:0})).requests.length,0,'acknowledged export is not requeued');
  assert.deepEqual(await readFile(join(ready,'review.json')),original);
  assert.equal((await post('generate',{development:true,printId:first.printId})).status,400,'an old tab cannot mutate a newly opened print');
  assert.equal((await post('open',{path:join(library,'missing')})).status,400);
  assert.equal((await get()).printId,state.printId,'failed opening retains the current print');
  await writeFile(archive,Buffer.from('altered'));
  assert.equal((await post('open',{path:ready})).status,200);
  state=await get();assert.equal(state.program,undefined);assert.match(state.programError,/changed/);
  assert.equal(state.geometryApproved,false);assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
  assert.equal((await post('open',{path:join(geometry,'plan.json')})).status,200);
  assert.equal((await get()).geometryApproved,false);
});

test('background preparation leaves review writable and persists only a currently approved generation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-studio-preparation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await shell.initBundle(dir,boxPlan());
  const initial=await shell.loadBundle(dir,{program:false}),original=await readFile(join(dir,'review.json'));
  const worker=new Worker(new URL('../../studio/generation-worker.mjs',import.meta.url),{workerData:{directory:dir,planHash:initial.planHash}});
  t.after(()=>worker.terminate());
  const [prepared]=await once(worker,'message');assert.equal(prepared.type,'prepared');assert.equal(prepared.error,undefined);
  assert.deepEqual(await readFile(join(dir,'review.json')),original);
  await assert.rejects(readFile(join(dir,'exports/griffin-gcode/part.gcode')),{code:'ENOENT'});
  const request=async()=>{const reply=once(worker,'message');worker.postMessage({type:'generate'});return (await reply)[0];};
  const generated=await request();assert.equal(generated.error,undefined);assert.equal(generated.checks.mode,'production');
  assert.ok(generated.source.metadata);assert.equal(generated.source.metadata.moves,undefined);assert.equal(generated.source.metadata.events,undefined);
  assert.equal((await shell.loadBundle(dir)).toolpathApproved,false);
  const exportBefore=await readFile(join(dir,'exports/griffin-gcode/part.gcode'));
  const plan=JSON.parse(await readFile(join(dir,'plan.json'),'utf8'));plan.process.layerMm=.1;await writeFile(join(dir,'plan.json'),JSON.stringify(plan));
  assert.match((await request()).error,/prepared print changed/);
  assert.deepEqual(await readFile(join(dir,'exports/griffin-gcode/part.gcode')),exportBefore);
});

test('final approval rejects a saved export whose bytes changed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-approval-export-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await shell.initBundle(dir,boxPlan());await shell.generateBundle(dir,{development:false});
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state=await(await fetch(origin+'/api/state')).json();assert.ok(state.program);
  const file=join(dir,'exports/griffin-gcode/part.gcode');await writeFile(file,(await readFile(file,'utf8'))+'; changed after viewing\n');
  const response=await fetch(origin+'/api/approve',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({stage:'toolpath',actor:'SYNTHETIC stale export test',revision:state.revision})});
  assert.equal(response.status,400);assert.match((await response.json()).error,/files changed/);
  const current=await(await fetch(origin+'/api/state')).json();assert.match(current.programError,/files changed/);assert.equal(current.exportHash,undefined);
});

test('ordinary review does not slice; explicit generation retries a failed worker',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-worker-retry-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await shell.initBundle(dir,boxPlan());
  const OriginalWorker=workerThreads.Worker;let attempts=0,failed;
  const failure=new Promise(resolve=>{failed=resolve;});
  workerThreads.Worker=class extends OriginalWorker{
    constructor(url,options){
      const fail=++attempts===1;
      super(fail?"throw new Error('SYNTHETIC worker startup failure')":url,fail?{eval:true}:options);
      if(fail)this.once('error',failed);
    }
  };
  syncBuiltinESMExports();
  t.after(()=>{workerThreads.Worker=OriginalWorker;syncBuiltinESMExports();});
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const get=async()=>await(await fetch(origin+'/api/state')).json();
  const post=(route,data)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify(data)});
  let state=await get();
  await get();await get();assert.equal(attempts,0,'geometry review does not slice');
  const failedGeneration=await post('generate',{});assert.equal(failedGeneration.status,400);
  assert.match((await failedGeneration.json()).error,/SYNTHETIC worker startup failure/);
  state=await get();assert.deepEqual(state.review.approvals,{});assert.equal(state.review.generation,null);
  assert.match((await failure).message,/SYNTHETIC worker startup failure/);
  await get();await get();assert.equal(attempts,1,'state refresh must not create a background retry loop');
  assert.equal((await post('generate',{})).status,200);
  state=await get();assert.ok(state.program);assert.equal(state.review.generation.mode,'production');
  assert.equal(state.toolpathApproved,false);assert.equal(attempts,2,'explicit retry starts exactly one replacement worker');
});

test('preparation diagnostics stay actionable until explicit retry; state polling never restarts them',async t=>{
  const library=await mkdtemp(join(tmpdir(),'saam-preparation-diagnostic-')),dir=join(library,'part');
  t.after(()=>rm(library,{recursive:true,force:true}));await shell.initBundle(dir,boxPlan());
  const OriginalWorker=workerThreads.Worker;let attempts=0,reported;
  const diagnostic=new Promise(resolve=>{reported=resolve;});
  workerThreads.Worker=class extends OriginalWorker{
    constructor(url,options){
      const fail=++attempts===1;
      super(fail?"const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>parentPort.postMessage({type:'generated',error:'SYNTHETIC completed diagnostic'}));parentPort.postMessage({type:'prepared',error:'SYNTHETIC completed diagnostic'});":url,fail?{eval:true}:options);
      if(fail)this.once('message',reported);
    }
  };
  syncBuiltinESMExports();t.after(()=>{workerThreads.Worker=OriginalWorker;syncBuiltinESMExports();});
  const server=createStudio(dir,{libraryRoot:library});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const get=async()=>await(await fetch(origin+'/api/state')).json();
  const post=(route,data)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify(data)});
  let state=await get();assert.equal(attempts,0);
  const first=await post('generate',{});assert.equal(first.status,400);
  assert.equal((await diagnostic).error,'SYNTHETIC completed diagnostic');
  assert.equal((await first.json()).error,'SYNTHETIC completed diagnostic');
  assert.equal(attempts,1,'the first explicit request reports the completed diagnostic without recalculating');
  state=await get();assert.equal(state.generationError,'SYNTHETIC completed diagnostic');
  await get();assert.equal(attempts,1,'polling after a surfaced diagnostic still cannot retry it');
  const retry=await post('generate',{});assert.equal(retry.status,200);
  assert.equal(attempts,2,'a subsequent explicit request starts exactly one real worker');
  state=await get();assert.ok(state.program);assert.equal(state.review.generation.mode,'production');
  assert.equal(state.toolpathApproved,false);assert.equal(attempts,2,'approved generation reuses the recovered candidate');
});


test('Studio opening retries a read spanning a multi-file edit but preserves persistent validation errors',async()=>{
  const {readStableBundle}=await import('../../studio/server.mjs');let reads=0;
  const adapter={bundleFingerprint:async()=>'current',loadBundle:async()=>{if(reads++===0)throw Error('Plan and geometry disagree. Ask the agent to recreate the geometry.');return {revision:'updated'};}};
  assert.equal((await readStableBundle(adapter,'synthetic',{program:false})).state.revision,'updated');assert.equal(reads,2);
  reads=0;adapter.loadBundle=async()=>{reads++;throw Error('Unconfigured machine');};
  await assert.rejects(readStableBundle(adapter,'synthetic',{}),/Unconfigured machine/);assert.equal(reads,1);
});
