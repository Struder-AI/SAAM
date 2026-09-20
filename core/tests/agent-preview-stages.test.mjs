import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preview,showPrint} from '../agent/toolkit.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

async function fixture(t){
  const library=await mkdtemp(join(tmpdir(),'saam-preview-stages-')),servers=[];
  t.after(async()=>{for(const server of servers)await server.shutdown();await rm(library,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  return {library,target:join(library,'part'),async open(options={}){
    const opened=await preview({command:'create-preview',target:join(library,'part'),library,noOpen:true,...options});
    servers.push(opened.server);return opened;
  }};
}

test('preview subscriptions isolate the owning instance and stop event delivery on shutdown',async t=>{
  const f=await fixture(t),requests=[],batches=[];
  const opened=await f.open({onRequest:event=>requests.push(event),onEvents:event=>batches.push(event)});
  const {instanceId}=opened.result.studio;
  await opened.agent.requests.begin({directory:f.target,instruction:'other instance',source:'studio',studioInstanceId:'other'});
  await opened.agent.requests.begin({directory:f.target,instruction:'agent local',source:'agent',studioInstanceId:instanceId});
  assert.equal(requests.length,0);
  await opened.agent.requests.begin({directory:f.target,instruction:'own instance',source:'studio',studioInstanceId:instanceId});
  assert.equal(requests.length,1);assert.equal(requests[0].studio.instanceId,instanceId);
  opened.agent.events.record('print-opened',{printId:'synthetic'});
  assert.ok(batches.length);assert.equal(batches.at(-1).studio.instanceId,instanceId);
  await opened.server.shutdown();const count=batches.length;
  assert.equal(opened.agent.events.record('print-opened',{printId:'after-shutdown'}),null);
  assert.equal(batches.length,count);await assert.rejects(fetch(opened.result.studio.url));
});

test('context failure retains prepared and ready evidence but closes only its owned preview',async t=>{
  const f=await fixture(t),other=await f.open();let ready;
  await assert.rejects(f.open({command:'open-print',onReady:event=>{
    ready=event;writeFileSync(join(f.target,'plan.json'),'{invalid');
  }}),error=>{
    assert.equal(error.stage,'context');assert.equal(error.partial.directory,f.target);
    assert.equal(error.partial.studio.closed,true);assert.equal(error.partial.print.generation.programChecked,false);
    assert.equal(error.partial.listener.studioInstanceId,ready.studio.instanceId);return true;
  });
  await assert.rejects(fetch(ready.studio.url));assert.equal(other.server.listening,true);
});

test('both preview preparation consumers preserve the failed creation directory',async t=>{
  const f=await fixture(t);await f.open();
  for(const launch of [()=>f.open(),()=>showPrint({command:'create-preview',target:f.target,library:f.library,open:()=>assert.fail('must not open')})]){
    await assert.rejects(launch(),error=>{
      assert.equal(error.stage,'prepare');assert.equal(error.partial.directory,f.target);
      assert.ok(!error.partial.created);assert.ok(!error.partial.studio);return true;
    });
  }
});

test('generated preview stages retain preparation, subscription and listener data boundaries',async()=>{
  const file='core/agent/toolkit.mjs',source=await readFile(new URL('../agent/toolkit.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source}),page=flowPacket(context,`${file}::preview`);
  const at=name=>page.components.find(c=>c.label===name)?.index;
  for(const [from,to,label] of [['preparePreviewPrint','readPreviewPrint','prepared.directory'],['subscribePreview','listenPreview','session'],['listenPreview','previewListener','studio']])
    assert.ok(page.wires.some(w=>w.from===at(from)&&w.to===at(to)&&w.label===label),`${from} -> ${to}`);
  assert.ok(page.components.some(c=>c.label==='closePreview'));
});
