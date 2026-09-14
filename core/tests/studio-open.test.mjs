import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../../studio/server.mjs';
import * as wedge from '../../skills/wedge-demo/scripts/bundle.mjs';
import {defaults} from '../../skills/wedge-demo/scripts/model.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import workerThreads from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';

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

test('Studio reopens saved approval stages and exports without creating or rewriting approvals',async t=>{
  const library=await mkdtemp(join(tmpdir(),'saam-studio-open-'));t.after(()=>rm(library,{recursive:true,force:true}));
  const geometry=join(library,'geometry-only'),ready=join(library,'ready-h2d');
  await wedge.initBundle(geometry,defaults());
  let state=await wedge.loadBundle(geometry);
  await wedge.approve(geometry,{stage:'geometry',actor:'SYNTHETIC TEST reopen',revision:state.revision});
  await wedge.initBundle(ready,defaults(loadMachine('bambu-h2d')),{machineId:'bambu-h2d'});
  state=await wedge.loadBundle(ready);
  for(const stage of ['geometry','plan'])state=await wedge.approve(ready,{stage,actor:'SYNTHETIC TEST reopen',revision:state.revision});
  await wedge.generateBundle(ready);
  const original=await readFile(join(ready,'review.json'));
  const server=createStudio(geometry,{libraryRoot:library});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const get=async()=>await(await fetch(origin+'/api/state')).json();
  const post=(route,data,authorized=true)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:authorized?origin:'http://evil.invalid','X-SAAM-Token':token},body:JSON.stringify(data)});
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,2);
  const first=await get();assert.equal(first.geometryApproved,true);assert.equal(first.planApproved,false);assert.equal(first.program,undefined);
  assert.equal((await post('open',{path:ready},false)).status,403);
  const archive=join(ready,'exports/bambu-gcode/wedge.gcode.3mf');
  assert.equal((await post('open',{path:archive,printId:first.printId})).status,200);
  state=await get();assert.equal(state.planApproved,true);assert.ok(state.program.summary.moves);assert.equal(state.program.moves,undefined);assert.equal(state.toolpathApproved,false);
  assert.notEqual(state.printId,first.printId);assert.notEqual(state.fingerprint,first.fingerprint);
  assert.deepEqual(await readFile(join(ready,'review.json')),original);
  assert.equal((await post('generate',{development:true,printId:first.printId})).status,400,'an old tab cannot mutate a newly opened print');
  assert.equal((await post('open',{path:join(library,'missing')})).status,400);
  assert.equal((await get()).printId,state.printId,'failed opening retains the current print');
  await writeFile(archive,Buffer.from('altered'));
  assert.equal((await post('open',{path:ready})).status,200);
  state=await get();assert.equal(state.program,undefined);assert.match(state.programError,/changed/);
  assert.equal(state.geometryApproved,true);assert.equal(state.planApproved,true);assert.equal(state.toolpathApproved,false);
  assert.equal((await post('open',{path:join(geometry,'plan.json')})).status,200);
  assert.equal((await get()).geometryApproved,true);
});

test('background preparation leaves review writable and persists only a currently approved generation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-studio-preparation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await wedge.initBundle(dir,defaults());
  const initial=await wedge.loadBundle(dir,{program:false}),original=await readFile(join(dir,'review.json'));
  const worker=new Worker(new URL('../../studio/generation-worker.mjs',import.meta.url),{workerData:{directory:dir,planHash:initial.planHash}});
  t.after(()=>worker.terminate());
  const [prepared]=await once(worker,'message');assert.equal(prepared.type,'prepared');assert.equal(prepared.error,undefined);
  assert.deepEqual(await readFile(join(dir,'review.json')),original);
  await assert.rejects(readFile(join(dir,'exports/griffin-gcode/wedge.gcode')),{code:'ENOENT'});
  const request=async()=>{const reply=once(worker,'message');worker.postMessage({type:'generate'});return (await reply)[0];};
  assert.match((await request()).error,/Approve the geometry/);
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  let revision=initial.revision;
  for(const stage of ['geometry','plan']){
    const response=await fetch(origin+'/api/approve',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({stage,actor:'SYNTHETIC worker test',revision})});
    assert.equal(response.status,200);const saved=await response.json();
    assert.ok(saved.approval);assert.equal(saved.approval.plan,undefined);
    revision=saved.approval.revision;
  }
  const generated=await request();assert.equal(generated.error,undefined);assert.equal(generated.checks.mode,'production');
  assert.ok(generated.source.metadata);assert.equal(generated.source.metadata.moves,undefined);assert.equal(generated.source.metadata.events,undefined);
  assert.equal((await wedge.loadBundle(dir)).toolpathApproved,false);
  const exportBefore=await readFile(join(dir,'exports/griffin-gcode/wedge.gcode'));
  const plan=JSON.parse(await readFile(join(dir,'plan.json'),'utf8'));plan.process.layerMm=.1;await writeFile(join(dir,'plan.json'),JSON.stringify(plan));
  assert.match((await request()).error,/prepared print changed/);
  assert.deepEqual(await readFile(join(dir,'exports/griffin-gcode/wedge.gcode')),exportBefore);
});

test('compact approval response invalidates a browser program when saved export bytes change',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-approval-export-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await wedge.initBundle(dir,defaults());await wedge.generateBundle(dir,{development:true});
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state=await(await fetch(origin+'/api/state')).json();assert.ok(state.program);
  const file=join(dir,'exports/griffin-gcode/wedge.gcode');await writeFile(file,(await readFile(file,'utf8'))+'; changed after viewing\n');
  const response=await fetch(origin+'/api/approve',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify({stage:'geometry',actor:'SYNTHETIC stale export test',revision:state.revision})});
  assert.equal(response.status,200);const {approval}=await response.json();
  assert.equal(approval.geometryApproved,true);assert.equal(approval.programAvailable,false);
  assert.match(approval.programError,/files changed/);assert.equal(approval.exportHash,null);
});

test('explicit generation retries a failed background worker once without bypassing approvals',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-worker-retry-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await wedge.initBundle(dir,defaults());
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
  let state=await get();assert.match((await failure).message,/SYNTHETIC worker startup failure/);
  await get();await get();assert.equal(attempts,1,'state refresh must not create a background retry loop');
  const denied=await post('generate',{});assert.equal(denied.status,400);
  assert.match((await denied.json()).error,/Approve the geometry/);assert.equal(attempts,2,'explicit request starts exactly one fresh worker');
  state=await get();assert.deepEqual(state.review.approvals,{});assert.equal(state.review.generation,null);
  for(const stage of ['geometry','plan']){
    const response=await post('approve',{stage,actor:'SYNTHETIC worker retry test',revision:state.revision});
    assert.equal(response.status,200);Object.assign(state,(await response.json()).approval);
  }
  assert.equal((await post('generate',{})).status,200);
  state=await get();assert.ok(state.program);assert.equal(state.review.generation.mode,'production');
  assert.equal(state.toolpathApproved,false);assert.equal(attempts,2,'the recovered prepared worker is reused after approval');
});
