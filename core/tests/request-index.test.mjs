import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {createTour} from '../../studio/tour.mjs';

test('operational polling reuses history and retains waiting work and undisplayed results',async t=>{
  const root=await fs.mkdtemp(resolve(tmpdir(),'saam-request-index-')),folder=resolve(root,'.studio-requests');
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));await fs.mkdir(folder);
  const id=n=>n.toString(16).padStart(32,'0');
  for(let n=0;n<1000;n++)await fs.writeFile(resolve(folder,id(n)+'.json'),JSON.stringify({id:id(n),printId:'part',kind:'edit',status:'completed',createdAt:n,updatedAt:n,presented:true}));
  const requests=createAgentRequests(root),other=createAgentRequests(root);t.after(()=>{requests.close();other.close();});
  assert.equal((await requests.query()).length,1);
  const readFile=fs.readFile,readdir=fs.readdir;let reads=0,scans=0;
  fs.readFile=async(...args)=>{reads++;return readFile(...args);};fs.readdir=async(...args)=>{scans++;return readdir(...args);};syncBuiltinESMExports();
  t.after(()=>{fs.readFile=readFile;fs.readdir=readdir;syncBuiltinESMExports();});
  for(let n=0;n<5;n++)assert.equal((await requests.query()).length,1);
  assert.deepEqual({reads,scans},{reads:0,scans:0},'warm operational polls neither parse nor enumerate history');
  const queued=await other.begin({directory:resolve(root,'part'),source:'studio',instruction:'External process work'});
  let seen=false;for(let n=0;n<100;n++){if((await requests.query()).some(r=>r.id===queued.id)){seen=true;break;}await new Promise(done=>setTimeout(done,10));}
  assert.ok(seen,'the watcher discovers another writer');
  await requests.update(queued.id,{status:'waiting'});
  assert.ok((await requests.query()).some(r=>r.id===queued.id&&r.status==='waiting'));
  const pending={id:id(1001),printId:'part',kind:'edit',status:'completed',createdAt:1001,updatedAt:1001,expiresAt:Date.now()+600000,requiresTarget:true,
    baseline:{inputKey:'before',generationKey:'before'},result:{inputKey:'after',generationKey:'after'},target:{inputKey:'after',stage:'toolpath'}};
  await fs.writeFile(resolve(folder,pending.id+'.json'),JSON.stringify(pending));
  assert.equal((await requests.list()).length,1002,'explicit history reconciles immediately and remains complete');
  const active=await requests.query();assert.ok(active.some(r=>r.id===pending.id));assert.ok(active.some(r=>r.id===queued.id));assert.ok(active.length<=3);
  active[0].status='cancelled';assert.notEqual((await requests.query())[0].status,'cancelled','callers cannot mutate the index');
  await fs.unlink(resolve(folder,pending.id+'.json'));await requests.list();assert.equal((await requests.query()).some(r=>r.id===pending.id),false);
});

test('actual activity renews only owned working requests, preserving pause, target and baseline',async t=>{
  const root=await fs.mkdtemp(resolve(tmpdir(),'saam-request-activity-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  let now=1;const store=createAgentRequests(root,{ownerId:'agent',now:()=>now}),other=createAgentRequests(root,{ownerId:'other',now:()=>now});
  t.after(()=>{store.close();other.close();});
  const request=await store.begin({directory:resolve(root,'part'),instruction:'Actual edit'});
  now=500001;await store.activity(request.id,{directory:resolve(root,'part')});
  const active=await store.get(request.id);assert.equal(active.expiresAt,1100001);assert.deepEqual(active.baseline,request.baseline);
  await assert.rejects(other.activity(request.id),/Claim this request/);
  await assert.rejects(store.activity(request.id,{directory:resolve(root,'another')}),/another print/);
  await store.update(request.id,{status:'waiting'});const waiting=await store.get(request.id);now+=100;
  assert.deepEqual(await store.activity(request.id),waiting,'a tool receipt does not resume paused work');
  await store.update(request.id,{status:'cancelled'});assert.equal((await store.activity(request.id)).status,'cancelled');
});

test('late start-layer work cannot alter a replacement tour lesson',async t=>{
  const root=await fs.mkdtemp(resolve(tmpdir(),'saam-layer-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const tour=createTour(root);t.after(()=>tour.close());
  const {data}=await tour.action('fresh'),scope={runId:data.runId,lessonId:data.lessonId};
  await tour.setStartAt({layer:8},scope);
  await tour.action('fresh');
  await assert.rejects(tour.setStartAt({layer:12},scope),/lesson ended/);
  assert.equal((await tour.info()).startAt,null);
});
