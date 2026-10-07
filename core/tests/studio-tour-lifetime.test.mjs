import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTour,tourExample} from '../../studio/tour.mjs';
import {createStudio} from '../../studio/server.mjs';
import {createChatChannel} from '../application/chat-requests.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'saam-tour-lifetime-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const channel=createChatChannel(root,{ownerId:'studio:test'}),tour=createTour(root,{chat:channel.binding}),{directory,data}=await tour.action('fresh');
  return {root,tour,directory,runId:data.runId,channel};
}
async function viewer(t,root,directory,channel){
  const server=createStudio(directory,{libraryRoot:root,chat:channel.binding});
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

test('tour survives a browser reconnect and resumes after Studio releases its instance',async t=>{
  const {root,tour,directory,runId,channel}=await fixture(t),v=await viewer(t,root,directory,channel);
  const requests=channel.requests,pending=await requests.begin({directory,instruction:'SYNTHETIC pending tour edit'});
  const stopFirst=await v.connect();stopFirst();
  const stopSecond=await v.connect();
  assert.equal((await tour.info()).runId,runId);assert.equal((await tour.info()).active,true);
  stopSecond();await v.server.shutdown();
  assert.equal((await tour.info()).active,true);assert.equal((await tour.info()).runId,runId);
  assert.equal((await requests.get(pending.id)).status,'cancelled');assert.equal((await tourExample(directory)).id,'starter');
  const reopened=await viewer(t,root,directory,channel);assert.equal(reopened.state.tour.active,true,'opening the saved print resumes the tour');
  await reopened.action('fresh');const next=await tour.info();assert.notEqual(next.runId,runId);assert.equal(next.step,0);
});
