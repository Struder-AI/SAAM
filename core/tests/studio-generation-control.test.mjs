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
    createHandoff:(sourceWorker,_generationHash,receive)=>{
      const onMessage=message=>receive(message,message.source?.generationHash==='plan'&&message.source?.exportHash===message.checks?.exportHash?{}:null);
      sourceWorker.on('message',onMessage);
      return {dispose(){detachments++;sourceWorker.off('message',onMessage);}};
    }});
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
  worker.emit('message',{type:'generated',checks:{generationHash:'plan',exportHash:'export'},source:{generationHash:'plan',exportHash:'export'}});
  assert.deepEqual((await generated).checks,{generationHash:'plan',exportHash:'export'});assert.equal(job.status,'disposed');
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
  return {root,dir,server,url,token,get,post};
}

test('viewer progress carries the same identity and cancellation contract as preparation status',async t=>{
  const {root,dir,server,url,token,get,post}=await fixture(t),state=await get('state');
  const response=await fetch(url+'/api/viewer?token='+token),reader=response.body.getReader(),decoder=new TextDecoder();
  t.after(()=>reader.cancel().catch(()=>{}));
  const generating=post('generate',{printId:state.printId,generationHash:state.generationHash,development:true});
  let pending='',update;
  for(let n=0;n<30&&!update;n++){
    const read=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Timed out waiting for Studio progress.')),1000))]);
    if(read.done)break;pending+=decoder.decode(read.value,{stream:true});
    let index;while((index=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,index);pending=pending.slice(index+2);
      const event=/^event: (.+)$/m.exec(block)?.[1],data=/^data: (.+)$/m.exec(block)?.[1];
      if(event==='studio-update'&&data){const parsed=JSON.parse(data);if(parsed.kind==='progress'&&parsed.status?.requested)update=parsed;}
    }
  }
  assert.ok(update);assert.equal(update.status.studioInstanceId,state.instanceId);assert.equal(update.status.printId,state.printId);
  assert.equal(update.status.generationHash,state.generationHash);assert.equal(update.status.cancellable,true);
  assert.ok(['preparing','generating'].includes(update.status.status));
  const requestStore=createAgentRequests(root),agentProgress=server.generationStatus();t.after(()=>requestStore.close());
  assert.equal(agentProgress.printId,requestStore.printId(dir));
  assert.notEqual(agentProgress.printId,update.status.printId,'agent and viewer identities retain their existing scopes');
  const fallback=await get('preparation');
  for(const key of ['studioInstanceId','printId','generationHash','status','cancellable','progress','error'])assert.ok(Object.hasOwn(fallback,key),key);
  assert.equal((await generating).status,200);
});

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
  assert.equal((await bundle.loadBundle(dir,{program:false})).review.generation,null,'cancelled calculations write no generation record');
  assert.equal((await get('state')).generationCancelled,true);
  assert.equal((await createAgentRequests(root).wait({waitMs:0})).requests.length,0,'cancellation does not ask the agent to repair a generator failure');
  const retry=await post('generate',{printId:state.printId,development:true});assert.equal(retry.status,200,await retry.text());
  const completed=await get('state');assert.ok(completed.program);assert.equal(completed.generationCancelled,false);
});

test('cancellation before commit preserves files; cancellation after commit begins lets the checked result finish',async t=>{
  const {dir}=await fixture(t),control=generationControl(),manifest=await readFile(resolve(dir,'plan.json'),'utf8');
  assert.equal(control.cancel(),true);
  await assert.rejects(bundle.generateBundle(dir,{development:true,beforeCommit:control.beforeCommit}),{code:'GENERATION_CANCELLED'});
  assert.equal(await readFile(resolve(dir,'plan.json'),'utf8'),manifest);
  const finishing=generationControl();let attempted=false;
  await bundle.generateBundle(dir,{development:true,beforeCommit:finishing.beforeCommit,onProgress(progress){
    if(progress.stage==='Saving your toolpath'){attempted=true;assert.equal(finishing.cancel(),false);}
  }});
  assert.ok(attempted);assert.ok((await bundle.loadBundle(dir,{program:'source'})).program);
});

test('conditional state returns approval metadata while keeping the displayed source identity',async t=>{
  const {dir,url}=await fixture(t);
  await bundle.generateBundle(dir);
  const shownResponse=await fetch(url+'/api/state'),shown=await shownResponse.json(),shownTag=shownResponse.headers.get('etag');
  assert.ok(shownTag);
  await bundle.approve(dir,{actor:'SYNTHETIC metadata fixture',revision:shown.revision,program:'source'});
  await bundle.deliver(dir);
  const changedResponse=await fetch(url+'/api/state',{headers:{'If-None-Match':shownTag}}),changed=await changedResponse.json();
  assert.equal(changedResponse.status,200);assert.equal(changed.presentationFingerprint,shown.presentationFingerprint);
  assert.equal(changed.exportHash,shown.exportHash);assert.equal(changed.toolpathApproved,true);assert.notEqual(changed.revision,shown.revision);
  const latest=await bundle.loadBundle(dir,{program:false});await bundle.adjustBundle(dir,{process:{planarSpeedMmS:30}},{expectedRevision:latest.revision});
  const editedResponse=await fetch(url+'/api/state',{headers:{'If-None-Match':changedResponse.headers.get('etag')}}),edited=await editedResponse.json();
  assert.equal(editedResponse.status,200);
  assert.notEqual(edited.presentationFingerprint,changed.presentationFingerprint,'a real edit still changes scene/source identity');
});

test('prepared generation rejects stale checked output and ignores it after cancellation',async()=>{
  const stale=syntheticJob(),pending=stale.job.generate(false);
  stale.worker.emit('message',{type:'generated',checks:{generationHash:'other',exportHash:'export'},source:{generationHash:'other',exportHash:'export'}});
  await assert.rejects(pending,/unchecked machine source/);assert.equal(stale.job.status,'failed');
  await stale.job.dispose();

  const cancelled=syntheticJob(),cancelledPending=cancelled.job.generate(false);
  const result=cancelled.job.cancel();await result.done;
  cancelled.worker.emit('message',{type:'generated',checks:{generationHash:'plan',exportHash:'export'},source:{generationHash:'plan',exportHash:'export'}});
  await assert.rejects(cancelledPending,{code:'GENERATION_CANCELLED'});
  assert.equal(cancelled.job.status,'disposed');
});
