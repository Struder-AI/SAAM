// Studio's Connect chat panel on a relay computer, with a fake relay provider:
// its routes, their session checks, the print-free launch instance, and the
// runtime handing the provider to every Studio it opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../../studio/server.mjs';
import {createLocalRuntime} from '../../adapters/mcp/src/runtime.mjs';

function fakeRelay({fail=false}={}){
  const calls={status:0,linkCode:0};
  return {calls,
    status(){calls.status++;return {relayUrl:'https://relay.example.test',connected:true,session:{client:'claude-ai'}};},
    async linkCode(){calls.linkCode++;if(fail)throw Error('relay offline');return {code:'ABCD-EFGH',expiresAt:Date.now()+120_000};}};
}
async function library(t){const dir=await mkdtemp(join(tmpdir(),'saam-studio-relay-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function serve(t,server){
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  return `http://127.0.0.1:${server.address().port}`;
}
async function page(origin){
  const html=await(await fetch(origin)).text();
  return {token:html.match(/name="saam-token" content="([^"]+)"/)[1],relay:html.match(/name="saam-relay" content="([^"]*)"/)[1]};
}

test('Studio relay routes report status and issue link codes behind the session token and origin',async t=>{
  const relay=fakeRelay(),origin=await serve(t,createStudio(null,{libraryRoot:await library(t),relay}));
  const {token,relay:flag}=await page(origin);
  assert.equal(flag,'on');
  const script=await fetch(origin+'/relay-panel.mjs');
  assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);await script.text();
  assert.equal((await fetch(origin+'/api/relay')).status,403,'status needs the session token');
  assert.equal((await fetch(origin+'/api/relay',{headers:{'X-SAAM-Token':token,Origin:'http://evil.example'}})).status,403);
  const status=await(await fetch(origin+'/api/relay',{headers:{'X-SAAM-Token':token}})).json();
  assert.deepEqual(status,{relayUrl:'https://relay.example.test',connected:true,session:{client:'claude-ai'},connectorUrl:'https://relay.example.test/mcp'});
  const issue=headers=>fetch(origin+'/api/relay/link-code',{method:'POST',headers,body:'{}'});
  assert.equal((await issue({'X-SAAM-Token':token})).status,403,'a code needs the page origin');
  assert.equal((await issue({Origin:origin,'X-SAAM-Token':'wrong'})).status,403);
  assert.equal((await issue({Origin:'http://evil.example','X-SAAM-Token':token})).status,403);
  assert.equal(relay.calls.linkCode,0,'rejected requests never reach the relay');
  const code=await(await issue({Origin:origin,'X-SAAM-Token':token})).json();
  assert.equal(code.code,'ABCD-EFGH');assert.ok(code.expiresAt>Date.now());assert.equal(relay.calls.linkCode,1);
  assert.equal((await fetch(origin+'/api/relay/link-code',{headers:{'X-SAAM-Token':token}})).status,404);
  assert.equal((await fetch(origin+'/api/relay',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token}})).status,404);
});

test('a relay failure to issue a code reaches the panel as an error',async t=>{
  const origin=await serve(t,createStudio(null,{libraryRoot:await library(t),relay:fakeRelay({fail:true})}));
  const {token}=await page(origin);
  const response=await fetch(origin+'/api/relay/link-code',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token}});
  assert.equal(response.status,502);assert.match((await response.json()).error,/relay offline/);
});

test('without a relay provider Studio shows no panel and has no relay routes',async t=>{
  const origin=await serve(t,createStudio(null,{libraryRoot:await library(t)}));
  const {token,relay}=await page(origin);
  assert.equal(relay,'');
  assert.equal((await fetch(origin+'/api/relay',{headers:{'X-SAAM-Token':token}})).status,404);
  assert.equal((await fetch(origin+'/api/relay/link-code',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token}})).status,404);
});

test('Studio without a print serves the library, refuses print work and opens a print',async t=>{
  const root=await library(t);
  await mkdir(join(root,'first'));
  await writeFile(join(root,'first','plan.json'),JSON.stringify({schema:'scratch-test/1'}));
  await writeFile(join(root,'first','machine.json'),JSON.stringify({name:'Synthetic scratch machine'}));
  const resolver=async dir=>{
    const state=Object.freeze({kind:'shell',marker:dir,review:Object.freeze({approvals:Object.freeze({})})});
    return {bundleFingerprints:async()=>({source:dir,presentation:dir}),loadBundle:async()=>state};
  };
  const server=createStudio(null,{libraryRoot:root,resolveBundle:resolver}),origin=await serve(t,server);
  const {token}=await page(origin);
  assert.equal(server.currentPrint(),null);assert.equal(server.agentSession().directory,null);assert.equal(server.agentSession().printId,null);
  assert.equal(server.generationStatus(),null);
  const state=await fetch(origin+'/api/state');
  assert.equal(state.status,204,'no print is an empty state, not an error');
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,1);
  assert.equal((await(await fetch(origin+'/api/agent-requests')).json()).requests.length,0);
  const post=(route,body={})=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify(body)});
  const refused=await post('generate');
  assert.equal(refused.status,400);assert.equal((await refused.json()).code,'NO_PRINT');
  assert.equal((await post('open',{path:join(root,'first')})).status,200);
  assert.equal(server.currentPrint(),join(root,'first'));
  assert.equal((await(await fetch(origin+'/api/state')).json()).marker,join(root,'first'));
});

test('the runtime opens a print-free launch Studio with the relay panel, and request_review reuses it',async t=>{
  const relay=fakeRelay(),printsRoot=await library(t);
  const runtime=createLocalRuntime({printsRoot,autoOpen:false,relay});t.after(()=>runtime.close());
  const launched=await runtime.openStudio();
  assert.equal(launched.browserOpenRequested,false);
  const {token,relay:flag}=await page(launched.url);
  assert.equal(flag,'on');
  assert.equal((await(await fetch(launched.url+'/api/relay',{headers:{'X-SAAM-Token':token}})).json()).connectorUrl,'https://relay.example.test/mcp');
  const session=runtime.beginSession(),invoke=(name,args)=>session.invoke(name,args);t.after(()=>session.end());
  const [listed]=(await invoke('get_studio_sessions')).sessions;
  assert.equal(listed.instanceId,launched.studioInstanceId);assert.equal(listed.directory,null);
  await assert.rejects(invoke('begin_studio_work',{instruction:'Which print?'}),/Specify printId/);
  const {plan}=await invoke('get_plan_template',{kind:'shell',machineId:'ultimaker-s5'});
  plan.process.minimumLayerSeconds=0;plan.geometry={shape:'box',runMm:12,widthMm:10,heightMm:1};plan.skills['draped-skin'].enabled=false;
  await invoke('create_print',{printId:'part',kind:'shell',machineId:'ultimaker-s5',plan});
  const review=await invoke('request_review',{printId:'part'});
  assert.equal(review.studioInstanceId,launched.studioInstanceId,'the sole launch instance shows the chat\'s print');
  assert.equal(review.url,launched.url);
  assert.equal((await(await fetch(launched.url+'/api/state')).json()).printName,'part');
  const other=await invoke('request_review',{printId:'part',newInstance:true});
  assert.notEqual(other.studioInstanceId,launched.studioInstanceId);
  const second=await page(other.url);
  assert.equal(second.relay,'on','every runtime-owned Studio gets the provider');
  assert.equal((await fetch(other.url+'/api/relay',{headers:{'X-SAAM-Token':second.token}})).status,200);
});

test('a runtime without a relay opens Studio instances without the panel',async t=>{
  const runtime=createLocalRuntime({printsRoot:await library(t),autoOpen:false});t.after(()=>runtime.close());
  const launched=await runtime.openStudio(),{token,relay}=await page(launched.url);
  assert.equal(relay,'');
  assert.equal((await fetch(launched.url+'/api/relay',{headers:{'X-SAAM-Token':token}})).status,404);
});
