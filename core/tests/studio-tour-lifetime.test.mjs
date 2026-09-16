import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createTour,tourExample} from '../../studio/tour.mjs';
import {createStudio} from '../../studio/server.mjs';
import {createAgentRequests} from '../../studio/agent-requests.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'saam-tour-lifetime-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const tour=createTour(root),{directory,data}=await tour.action('fresh');
  return {root,tour,directory,runId:data.runId};
}
async function viewer(t,root,directory,disconnectMs=100){
  const server=createStudio(directory,{libraryRoot:root,disconnectMs,localExtension:{}});
  t.after(()=>server.shutdown());await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const url='http://127.0.0.1:'+server.address().port;
  const html=await(await fetch(url)).text(),token=/name="saam-token" content="([^"]+)"/.exec(html)[1];
  const state=await(await fetch(url+'/api/state')).json();assert.ok(state.instanceId);
  return {server,state,async connect(){
    const controller=new AbortController();t.after(()=>controller.abort());
    const response=await fetch(url+'/api/viewer?token='+token,{signal:controller.signal});assert.equal(response.status,200);
    return ()=>controller.abort();
  },async action(action){
    const response=await fetch(url+'/api/tour',{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify({action})});
    assert.equal(response.status,200,await response.text());
  }};
}

test('tour survives a browser reconnect and ends when its Studio shuts down after the grace period',async t=>{
  const {root,tour,directory,runId}=await fixture(t),v=await viewer(t,root,directory,150);
  const requests=createAgentRequests(root),pending=await requests.begin({directory,instruction:'SYNTHETIC pending tour edit'});
  const stopFirst=await v.connect();stopFirst();
  const stopSecond=await v.connect();
  assert.equal((await tour.info()).runId,runId);assert.equal((await tour.info()).active,true);
  const closed=once(v.server,'close');stopSecond();await closed;await v.server.shutdown();
  assert.equal((await tour.info()).active,false);assert.equal((await tour.info()).runId,null);
  assert.equal((await requests.get(pending.id)).status,'cancelled');assert.equal(await tourExample(directory),null);
  const reopened=await viewer(t,root,directory);assert.equal(reopened.state.tour.active,false,'opening the saved print does not restore a tour');
  await reopened.action('fresh');const next=await tour.info();assert.notEqual(next.runId,runId);assert.equal(next.step,0);
});

test('closing an observer or the owner of an older run cannot end another Studio’s current tour',async t=>{
  const {root,tour,directory,runId}=await fixture(t),first=await viewer(t,root,directory),observer=await viewer(t,root,directory);
  await observer.server.shutdown();assert.equal((await tour.info()).runId,runId);
  const second=await viewer(t,root,directory);await second.action('fresh');const replacement=await tour.info();
  assert.notEqual(replacement.runId,runId);
  await first.server.shutdown();assert.equal((await tour.info()).runId,replacement.runId);assert.equal((await tour.info()).active,true);
  await second.server.shutdown();assert.equal((await tour.info()).active,false);
});
