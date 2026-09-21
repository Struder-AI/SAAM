import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import * as bundle from '../print/bundle.mjs';
import {generationControl} from '../print/generation-control.mjs';
import {createStudio} from '../../studio/server.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {PreparedGenerationJob} from '../../studio/prepared-generation-job.mjs';
import {EventEmitter} from 'node:events';

class SyntheticWorker extends EventEmitter {
  messages=[];terminations=0;
  postMessage(message){this.messages.push(message);}
  terminate(){this.terminations++;return Promise.resolve(0);}
  unref(){}
}

const syntheticJob=()=>{
  const worker=new SyntheticWorker();let detachments=0;
  const job=new PreparedGenerationJob({key:'part:plan',directory:'part',generationHash:'plan',createWorker:()=>worker,
    attachSource:()=>()=>{detachments++;}});
  return {job,worker,get detachments(){return detachments;}};
};

test('prepared generation job owns ready, generating and disposed settlement',async()=>{
  const fixture=syntheticJob(),{job,worker}=fixture;
  assert.equal(job.status,'preparing');
  worker.emit('message',{type:'progress',progress:{stage:'Checking paths'}});
  assert.deepEqual(job.progress,{stage:'Checking paths'});
  worker.emit('message',{type:'prepared'});assert.equal(job.status,'ready');
  const generated=job.generate(true);assert.equal(job.status,'generating');
  assert.deepEqual(worker.messages,[{type:'generate',development:true}]);
  worker.emit('message',{type:'generated',checks:{generationHash:'plan'}});
  assert.deepEqual(await generated,{generationHash:'plan'});assert.equal(job.status,'disposed');
  assert.equal(worker.terminations,1);assert.equal(fixture.detachments,1);
  await job.dispose();assert.equal(worker.terminations,1);assert.equal(fixture.detachments,1);
});

test('prepared generation job retains failure and cancellation outcomes',async()=>{
  const failed=syntheticJob();
  failed.worker.emit('message',{type:'prepared',error:'SYNTHETIC diagnostic'});
  assert.equal(failed.job.status,'failed');assert.equal(failed.job.error,'SYNTHETIC diagnostic');
  await assert.rejects(failed.job.generate(false),/SYNTHETIC diagnostic/);
  await failed.job.dispose();assert.equal(failed.worker.terminations,1);assert.equal(failed.detachments,1);

  const cancelled=syntheticJob(),pending=cancelled.job.generate(false);
  const result=cancelled.job.cancel();assert.equal(result.cancelled,true);await result.done;
  await assert.rejects(pending,{code:'GENERATION_CANCELLED'});
  assert.equal(cancelled.job.status,'disposed');assert.equal(cancelled.worker.terminations,1);assert.equal(cancelled.detachments,1);
});

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
  const generating=post('generate',{printId:state.printId,generationHash:state.generationHash,development:true});
  let job;for(let n=0;n<100;n++){job=await get('preparation');if(job.cancellable)break;await new Promise(done=>setTimeout(done,5));}
  assert.ok(job.cancellable);
  const cancelled=await post('cancel-generation',{printId:state.printId,generationHash:state.generationHash});
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
  await bundle.generateBundle(dir);const shown=await get('state');
  await bundle.approve(dir,{actor:'SYNTHETIC metadata fixture',revision:shown.revision,program:'source'});
  await bundle.deliver(dir);
  const changed=await get('revision?'+new URLSearchParams({fingerprint:shown.fingerprint}));
  assert.equal(changed.presentationFingerprint,shown.presentationFingerprint);assert.equal(changed.reviewUpdate.exportHash,shown.exportHash);
  assert.equal(changed.reviewUpdate.toolpathApproved,true);assert.notEqual(changed.reviewUpdate.revision,shown.revision);
  assert.equal(changed.reviewUpdate.review.history,undefined,'compact control updates omit accumulated audit history');
  const latest=await bundle.loadBundle(dir,{program:false});await bundle.adjustBundle(dir,{process:{planarSpeedMmS:30}},{expectedRevision:latest.revision});
  const edited=await get('revision?'+new URLSearchParams({fingerprint:changed.fingerprint}));
  assert.notEqual(edited.presentationFingerprint,changed.presentationFingerprint,'a real edit still changes scene/source identity');
});
