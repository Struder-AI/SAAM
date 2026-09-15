import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentUI} from '../../studio/agent-ui.mjs';

test('dots and viewport fade clear together on readiness, retain later work and stop on errors',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval,addEventListener:globalThis.addEventListener};
  t.after(()=>Object.assign(globalThis,saved));
  const classes=new Set(),dots={},notice={},indicator={querySelector:()=>dots,setAttribute(){}};
  const canvas={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  globalThis.document={getElementById:id=>({'agent-status':indicator,'agent-timeout':notice,canvas}[id])};
  globalThis.addEventListener=()=>{};globalThis.setInterval=()=>0;
  const old={inputKey:'old'},next={inputKey:'next',stage:'toolpath'};
  const first={id:'a',kind:'edit',printId:'part',status:'working',baseline:old,updatedAt:1,expiresAt:Date.now()+60000};
  let records=[first];globalThis.fetch=async()=>({ok:true,json:async()=>({requests:records})});
  const ui=createAgentUI();await ui.refresh();
  ui.loading();ui.received({printId:'part',snapshot:next,requests:records});
  assert.equal(dots.hidden,false);assert.ok(classes.has('work-faded'));
  ui.present({printId:'part',snapshot:next});ui.settled();
  assert.equal(dots.hidden,true);assert.ok(!classes.has('work-faded'));
  const second={...first,id:'b',baseline:next,updatedAt:2};
  records=[first,second];await ui.refresh();
  assert.equal(dots.hidden,false);assert.ok(classes.has('work-faded'));
  ui.loading();ui.present({printId:'part',snapshot:next,requests:[first]});ui.settled();
  assert.equal(dots.hidden,false,'a stale result snapshot cannot discard a later request');
  ui.settled(Error('Load failed'));assert.equal(dots.hidden,true);assert.ok(!classes.has('work-faded'));
});
