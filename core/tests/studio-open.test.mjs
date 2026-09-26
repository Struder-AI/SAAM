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
import {summarizeWork} from '../../studio/work-state.mjs';

test('an explicit scratch resolver follows Studio opening and listing without changing the default registry',async t=>{
  const library=await mkdtemp(join(tmpdir(),'saam-studio-scratch-'));t.after(()=>rm(library,{recursive:true,force:true}));
  const {mkdir}=await import('node:fs/promises');
  for(const id of ['first','second']){
    await mkdir(join(library,id));
    await writeFile(join(library,id,'plan.json'),JSON.stringify({schema:'scratch-test/1'}));
    await writeFile(join(library,id,'machine.json'),JSON.stringify({name:'Synthetic scratch machine'}));
  }
  const supplied=new Map();let bundleLoads=0;
  const resolver=async dir=>{
    assert.equal(JSON.parse(await readFile(join(dir,'plan.json'),'utf8')).schema,'scratch-test/1');
    const state=Object.freeze({kind:'shell',marker:dir,code:'adapter-only',dir,review:Object.freeze({approvals:Object.freeze({})})});
    supplied.set(dir,state);
    return {bundleFingerprints:async()=>({source:dir,presentation:dir}),loadBundle:async()=>{bundleLoads++;return state;}};
  };
  const server=createStudio(join(library,'first'),{libraryRoot:library,resolveBundle:resolver});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  for(const file of ['refresh-plan.mjs','viewer-renderer.mjs','studio-state.mjs','studio-controls.mjs']){
    const module=await fetch(origin+'/'+file);
    assert.equal(module.status,200,file);assert.match(module.headers.get('content-type'),/javascript/,file);
    assert.equal(await module.text(),await readFile(new URL('../../studio/'+file,import.meta.url),'utf8'),file);
  }
  const reviewModule=await fetch(origin+'/core/print/review-state.mjs');
  assert.equal(reviewModule.status,200);assert.match(reviewModule.headers.get('content-type'),/javascript/);
  assert.equal(await reviewModule.text(),await readFile(new URL('../print/review-state.mjs',import.meta.url),'utf8'));
  const firstResponse=await fetch(origin+'/api/state'),first=await firstResponse.json(),firstTag=firstResponse.headers.get('etag');
  assert.match(firstTag,/^W\/"[A-Za-z0-9_-]+"$/);
  assert.equal(first.marker,join(library,'first'));assert.equal(first.code,undefined);assert.equal(first.dir,undefined);
  assert.equal(first.printName,'first');assert.equal(first.downloadName,'first');assert.equal(first.work.snapshot.studioInstanceId,first.instanceId);
  assert.equal(supplied.get(join(library,'first')).code,'adapter-only');assert.equal(supplied.get(join(library,'first')).tour,undefined);
  const loaded=bundleLoads,unchanged=await fetch(origin+'/api/state',{headers:{'If-None-Match':'"different", '+firstTag.slice(2)}});
  assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
  assert.equal(bundleLoads,loaded+1,'a conditional state read uses one coherent legacy snapshot');
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,2);
  const response=await fetch(origin+'/api/open',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({path:join(library,'second','plan.json')})});
  assert.equal(response.status,200);
  assert.equal((await(await fetch(origin+'/api/state')).json()).marker,join(library,'second'));
  const [{bundleFor},{listPrints}]=await Promise.all([import('../../studio/adapter-resolution.mjs'),import('../../studio/server.mjs')]);
  await assert.rejects(bundleFor(join(library,'first')),/cannot review/);
  assert.deepEqual(await listPrints(library),[]);
});

test('Studio reopens saved exports without creating or rewriting approvals',async t=>{
  const library=await mkdtemp(join(tmpdir(),'saam-studio-open-'));t.after(()=>rm(library,{recursive:true,force:true}));
  const geometry=join(library,'geometry-only'),ready=join(library,'ready-h2d');
  await shell.initBundle(geometry,boxPlan());
  let state=await shell.loadBundle(geometry);
  // Producers connect their own nearby strokes; an authored 1 mm gap between
  // two line-network centerlines remains a short same-layer travel to report.
  const gapped=boxPlan(loadMachine('bambu-h2d'));
  for(const settings of Object.values(gapped.skills))settings.enabled=false;
  Object.assign(gapped.skills['line-network'],{enabled:true,layers:1,networks:[{id:'dashes',strokes:[
    {closed:false,points:[[0,0],[10,0]]},{closed:false,points:[[11,0],[20,0]]}]}]});
  await shell.initBundle(ready,gapped,{machineId:'bambu-h2d'});
  await shell.generateBundle(ready);
  const original=await readFile(join(ready,'plan.json'));
  const server=createStudio(geometry,{libraryRoot:library});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const get=async()=>await(await fetch(origin+'/api/state')).json();
  const post=(route,data,authorized=true)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:authorized?origin:'http://evil.invalid','X-SAAM-Token':token},body:JSON.stringify(data)});
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,2);
  const first=await get();assert.equal(first.toolpathApproved,false);assert.equal(first.program,undefined);
  assert.equal((await post('open',{path:ready},false)).status,403);
  const archive=join(ready,(await shell.loadBundle(ready)).review.generation.file);
  assert.equal((await post('open',{path:archive,printId:first.printId})).status,200);
  state=await get();assert.ok(state.program.summary.moves);assert.equal(state.program.moves,undefined);assert.equal(state.toolpathApproved,false);
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
  assert.match(pending.requests[0].instruction,/Tell the person[\s\S]*Mention this finding to the person in your next reply/);
  assert.equal(summarizeWork(pending.requests,{now:Date.now()+3600000}).active,false);
  assert.equal(summarizeWork(pending.requests,{now:Date.now()+3600000}).message,'');
  assert.equal((await createAgentRequests(library,{now:()=>Date.now()+3600000}).list())[0].status,'working');
  await requests.update(pending.requests[0].id,{status:'completed'});
  await post('view-ready',shown);
  assert.equal((await requests.wait({waitMs:0})).requests.length,0,'acknowledged export is not requeued');
  assert.deepEqual(await readFile(join(ready,'plan.json')),original);
  assert.equal((await post('generate',{development:true,printId:first.printId})).status,400,'an old tab cannot mutate a newly opened print');
  assert.equal((await post('open',{path:join(library,'missing')})).status,400);
  assert.equal((await get()).printId,state.printId,'failed opening retains the current print');
  await writeFile(archive,Buffer.from('altered'));
  assert.equal((await post('open',{path:ready})).status,200);
  state=await get();assert.equal(state.program,undefined);assert.match(state.programError,/changed/);
  assert.equal(state.toolpathApproved,false);
  assert.equal((await post('open',{path:join(geometry,'plan.json')})).status,200);
  assert.equal((await get()).toolpathApproved,false);
});

test('background preparation leaves review writable and persists only a currently approved generation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-studio-preparation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await shell.initBundle(dir,boxPlan());
  const initial=await shell.loadBundle(dir,{program:false}),original=await readFile(join(dir,'plan.json'));
  const worker=new Worker(new URL('../../studio/generation-worker.mjs',import.meta.url),{workerData:{directory:dir,generationHash:initial.generationHash}});
  t.after(()=>worker.terminate());
  const [prepared]=await once(worker,'message');assert.equal(prepared.type,'prepared');assert.equal(prepared.error,undefined);
  assert.deepEqual(await readFile(join(dir,'plan.json')),original);
  const request=async()=>{const reply=once(worker,'message');worker.postMessage({type:'generate'});return (await reply)[0];};
  const generated=await request();assert.equal(generated.error,undefined);assert.equal(generated.checks.mode,'production');
  assert.ok(generated.source.metadata);assert.equal(generated.source.metadata.moves,undefined);assert.equal(generated.source.metadata.events,undefined);
  assert.equal((await shell.loadBundle(dir)).toolpathApproved,false);
  const generatedState=await shell.loadBundle(dir),exportFile=join(dir,generatedState.review.generation.file),exportBefore=await readFile(exportFile);
  const plan=JSON.parse(await readFile(join(dir,'plan.json'),'utf8'));plan.process.layerMm=.1;await writeFile(join(dir,'plan.json'),JSON.stringify(plan));
  assert.match((await request()).error,/print changed during generation/);
  assert.deepEqual(await readFile(exportFile),exportBefore);
});

test('final approval rejects a saved export whose bytes changed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-approval-export-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await shell.initBundle(dir,boxPlan());await shell.generateBundle(dir,{development:false});
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state=await(await fetch(origin+'/api/state')).json();assert.ok(state.program);
  const file=join(dir,(await shell.loadBundle(dir)).review.generation.file);await writeFile(file,(await readFile(file,'utf8'))+'; changed after viewing\n');
  const response=await fetch(origin+'/api/approve',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({actor:'SYNTHETIC stale export test',revision:state.revision})});
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
  const {readStableBundle}=await import('../../studio/adapter-resolution.mjs');let reads=0;
  const adapter={bundleFingerprints:async()=>({source:'current',presentation:'current'}),loadBundle:async()=>{if(reads++===0)throw Error('Plan and geometry disagree. Ask the agent to recreate the geometry.');return {revision:'updated'};}};
  assert.equal((await readStableBundle(adapter,'synthetic',{program:false})).state.revision,'updated');assert.equal(reads,2);
  reads=0;adapter.loadBundle=async()=>{reads++;throw Error('Unconfigured machine');};
  await assert.rejects(readStableBundle(adapter,'synthetic',{}),/Unconfigured machine/);assert.equal(reads,1);
});

test('a closed agent session marks only the work it left; the same owner\'s later work stays live',()=>{
  const at=Date.now(),closedOwners=new Map([['owner',at]]);
  const record=(id,updatedAt)=>({id,printId:'part',ownerId:'owner',kind:'edit',status:'working',createdAt:updatedAt,updatedAt,expiresAt:at+600000});
  assert.equal(summarizeWork([record('left',at-1)],{now:at,closedOwners}).message,'(connection closed)');
  assert.equal(summarizeWork([record('next',at+1)],{now:at,closedOwners}).active,true);
});
