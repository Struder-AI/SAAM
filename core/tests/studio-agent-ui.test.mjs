import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentUI} from '../../studio/agent-ui.mjs';

test('dots and viewport fade clear together on readiness, retain later work and stop on errors',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval,addEventListener:globalThis.addEventListener};
  t.after(()=>Object.assign(globalThis,saved));
  const classes=new Set(),dots={},notice={},indicator={querySelector:()=>dots,setAttribute(){}};
  const canvas={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  globalThis.document={getElementById:id=>({'agent-status':indicator,'agent-timeout':notice,canvas}[id]),addEventListener:()=>{}};
  globalThis.addEventListener=()=>{};globalThis.setInterval=()=>0;
  const old={inputKey:'old'},next={inputKey:'next',stage:'toolpath'};
  const first={id:'a',kind:'edit',printId:'part',status:'working',baseline:old,updatedAt:1,expiresAt:Date.now()+60000,target:{...next,stage:'toolpath'}};
  let records=[first];globalThis.fetch=async()=>({ok:true,json:async()=>({requests:records})});
  let activityChanges=0,receipts=0;
  const ui=createAgentUI({onActivity:()=>activityChanges++,onPresentation:()=>receipts++});await ui.refresh();
  const unchanged=activityChanges;await ui.refresh();
  assert.equal(activityChanges,unchanged,'unchanged polling does not rerender tour guidance');
  ui.loading();ui.received({printId:'part',snapshot:next,requests:records});
  assert.equal(dots.hidden,false);assert.ok(classes.has('work-faded'));
  ui.present({printId:'part',snapshot:next});ui.settled();
  assert.equal(dots.hidden,true);assert.ok(!classes.has('work-faded'));
  const second={...first,id:'b',baseline:next,target:undefined,updatedAt:2};
  records=[first,second];await ui.refresh();
  assert.equal(dots.hidden,false);assert.ok(classes.has('work-faded'));
  ui.loading();ui.present({printId:'part',snapshot:next,requests:[first]});ui.settled();
  assert.equal(dots.hidden,false,'a stale result snapshot cannot discard a later request');
  ui.settled(Error('Load failed'));assert.equal(dots.hidden,true);assert.ok(!classes.has('work-faded'));
  const presented={...second,presented:true,updatedAt:3};
  records=[{...first,presented:true,updatedAt:3},presented];await ui.refresh();
  records=[first,second];await ui.refresh();
  ui.loading();ui.received({printId:'part',snapshot:next,requests:[first,second]});ui.settled();
  assert.equal(dots.hidden,true,'late polling and state responses cannot revive an already presented request');
  const late={...second,id:'late',baseline:old,updatedAt:4};
  records=[late];await ui.refresh();ui.present({printId:'part',snapshot:next});
  assert.equal(dots.hidden,false,'an already rendered intermediate result still needs its target');
  const beforeTarget=receipts;
  records=[{...late,updatedAt:5,target:{...next,stage:'toolpath'}}];await ui.refresh();
  assert.equal(dots.hidden,true);
  assert.ok(receipts>beforeTarget,'publishing a target after rendering asks for its persistent receipt without a reload');
  const obsolete={...second,id:'obsolete',updatedAt:6};
  records=[obsolete];await ui.refresh();assert.equal(dots.hidden,false);
  records=[];await ui.refresh();assert.equal(dots.hidden,true,'bounded snapshots retire work no longer returned by the server');
  ui.updated([obsolete]);assert.equal(dots.hidden,true,'an old state response cannot revive a retired request');
  let respond;globalThis.fetch=()=>new Promise(done=>{respond=done;});
  const polling=ui.refresh();ui.updated([{...obsolete,id:'new-during-poll',updatedAt:7}]);
  respond({ok:true,json:async()=>({requests:[]})});await polling;
  assert.equal(dots.hidden,false,'work received after polling began survives an older empty response');
});

test('request reads are push-driven, and a declined acknowledgement is not retried forever',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval,addEventListener:globalThis.addEventListener};
  t.after(()=>Object.assign(globalThis,saved));
  const dots={},notice={},indicator={querySelector:()=>dots,setAttribute(){}};
  const canvas={classList:{toggle(){}}};
  const listeners=new Map(),intervals=[];
  globalThis.document={getElementById:id=>({'agent-status':indicator,'agent-timeout':notice,canvas}[id]),
    addEventListener:(name,fn)=>listeners.set('document:'+name,fn)};
  globalThis.addEventListener=(name,fn)=>listeners.set(name,fn);
  globalThis.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
  const shown={inputKey:'current',stage:'toolpath'};
  const record={id:'a',kind:'edit',printId:'part',status:'working',baseline:{inputKey:'before'},updatedAt:1,
    expiresAt:Date.now()+60000,target:{...shown}};
  let reads=0;globalThis.fetch=async()=>{reads++;return {ok:true,json:async()=>({requests:[record]})};};
  let receipts=0;
  const ui=createAgentUI({onPresentation:()=>receipts++});
  await ui.refresh();
  // The server never marks the record presented, so the browser keeps seeing it.
  ui.present({printId:'part',snapshot:shown});
  assert.equal(receipts,1);
  const timer=intervals.find(entry=>entry.ms===750),idle=reads;
  assert.ok(timer,'a local timer still re-evaluates expiry');
  for(let n=0;n<40;n++)timer.fn();
  assert.equal(receipts,1,'a declined acknowledgement is not asked again for the same view and records');
  assert.equal(reads,idle,'the local timer performs no network read');
  assert.ok(intervals.some(entry=>entry.ms===15_000),'a slow heartbeat still recovers a missed push');
  // Anything that actually moves asks again.
  ui.updated([{...record,updatedAt:2}]);
  assert.equal(receipts,2);
  const before=reads;
  listeners.get('saam-studio-change')({detail:{kinds:['print']}});
  assert.equal(reads,before,'an unrelated change is not a request read');
  await listeners.get('saam-studio-change')({detail:{kinds:['requests']}});
  await listeners.get('saam-viewer-connection')({detail:{open:true}});
  assert.ok(reads>before,'pushes and a reopened viewer stream drive the read');
});
