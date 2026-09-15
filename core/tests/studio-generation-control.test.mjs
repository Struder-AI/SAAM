import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import * as bundle from '../print/bundle.mjs';
import {generationControl} from '../print/generation-control.mjs';
import {createStudio} from '../../studio/server.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';

async function fixture(t){
  const root=await mkdtemp(resolve(tmpdir(),'saam-generation-control-')),dir=resolve(root,'part');
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const plan=await bundle.proposedPlan('ultimaker-s5');plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:1};
  plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
  await bundle.initBundle(dir,plan,{machineId:'ultimaker-s5'});
  const server=createStudio(dir,{libraryRoot:root,localExtension:{}});t.after(()=>server.shutdown());
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const url='http://127.0.0.1:'+server.address().port,token=/name="saam-token" content="([^"]+)"/.exec(await(await fetch(url)).text())[1];
  const get=async path=>await(await fetch(url+'/api/'+path)).json();
  const post=(path,data,auth=token)=>fetch(url+'/api/'+path,{method:'POST',headers:{Origin:url,'X-SAAM-Token':auth,'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {root,dir,server,get,post};
}

test('Studio cancellation bypasses the generation queue, stops its worker and permits retry without a repair request',async t=>{
  const {root,dir,get,post}=await fixture(t),state=await get('state');
  assert.equal((await post('cancel-generation',{printId:state.printId},'invalid')).status,403);
  assert.equal((await post('cancel-generation',{printId:'stale'})).status,400);
  const generating=post('generate',{printId:state.printId,planHash:state.planHash,development:true});
  let job;for(let n=0;n<100;n++){job=await get('preparation');if(job.cancellable)break;await new Promise(done=>setTimeout(done,5));}
  assert.ok(job.cancellable);
  const cancelled=await post('cancel-generation',{printId:state.printId,planHash:state.planHash});
  assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).cancelled,true);
  const original=await generating;assert.equal((await original.json()).code,'GENERATION_CANCELLED');
  assert.equal(JSON.parse(await readFile(resolve(dir,'review.json'),'utf8')).generation,null,'cancelled calculations write no generation record');
  assert.equal((await get('state')).generationCancelled,true);
  assert.equal((await createAgentRequests(root).wait({waitMs:0})).requests.length,0,'cancellation does not ask the agent to repair a generator failure');
  const retry=await post('generate',{printId:state.printId,development:true});assert.equal(retry.status,200,await retry.text());
  const completed=await get('state');assert.ok(completed.program);assert.equal(completed.generationCancelled,false);
});

test('cancellation before commit preserves files; cancellation after commit begins lets the checked result finish',async t=>{
  const {dir}=await fixture(t),control=generationControl(),review=await readFile(resolve(dir,'review.json'),'utf8');
  assert.equal(control.cancel(),true);
  await assert.rejects(bundle.generateBundle(dir,{development:true,beforeCommit:control.beforeCommit}),{code:'GENERATION_CANCELLED'});
  assert.equal(await readFile(resolve(dir,'review.json'),'utf8'),review);
  const finishing=generationControl();let attempted=false;
  await bundle.generateBundle(dir,{development:true,beforeCommit:finishing.beforeCommit,onProgress(progress){
    if(progress.stage==='Saving your toolpath'){attempted=true;assert.equal(finishing.cancel(),false);}
  }});
  assert.ok(attempted);assert.ok((await bundle.loadBundle(dir,{program:'source'})).program);
});

test('approval and delivery history update review metadata while keeping the displayed source identity',async t=>{
  const {dir,get}=await fixture(t);
  let shown=await get('state');
  await bundle.approve(dir,{stage:'geometry',actor:'SYNTHETIC metadata fixture',revision:shown.revision,program:false});
  let changed=await get('revision?'+new URLSearchParams({fingerprint:shown.fingerprint}));
  assert.notEqual(changed.fingerprint,shown.fingerprint);assert.equal(changed.presentationFingerprint,shown.presentationFingerprint);
  assert.equal(changed.reviewUpdate.geometryApproved,true);assert.equal(changed.reviewUpdate.toolpathApproved,false);
  await bundle.generateBundle(dir);shown=await get('state');
  await bundle.approve(dir,{stage:'toolpath',actor:'SYNTHETIC metadata fixture',revision:shown.revision,program:'source'});
  await bundle.deliver(dir);
  changed=await get('revision?'+new URLSearchParams({fingerprint:shown.fingerprint}));
  assert.equal(changed.presentationFingerprint,shown.presentationFingerprint);assert.equal(changed.reviewUpdate.exportHash,shown.exportHash);
  assert.equal(changed.reviewUpdate.toolpathApproved,true);assert.notEqual(changed.reviewUpdate.revision,shown.revision);
  assert.equal(changed.reviewUpdate.review.history,undefined,'compact control updates omit accumulated audit history');
  const latest=await bundle.loadBundle(dir,{program:false});await bundle.adjustBundle(dir,{process:{planarSpeedMmS:30}},{expectedRevision:latest.revision});
  const edited=await get('revision?'+new URLSearchParams({fingerprint:changed.fingerprint}));
  assert.notEqual(edited.presentationFingerprint,changed.presentationFingerprint,'a real edit still changes scene/source identity');
});
