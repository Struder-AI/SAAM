import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioEvents,DELIVERED_KINDS,HELD_KINDS} from '../../studio/studio-events.mjs';

test('held events wait for a read; a delivered event pushes the whole queue and only reads drain it',()=>{
  let now=1;const events=createStudioEvents({now:()=>now++}),pushed=[];
  const stop=events.subscribe(batch=>pushed.push(batch));
  events.record('viewer-opened',{viewers:1});
  events.record('view-presented',{stage:'geometry',revision:'r1'});
  assert.equal(pushed.length,0,'held kinds do not push');assert.equal(events.pendingDelivery(),false);assert.equal(events.size,2);
  const opened=events.record('print-opened',{printId:'part',kind:'not-yours',seq:99});
  assert.equal(opened.delivery,'delivered');assert.equal(opened.seq,3);assert.equal(opened.kind,'print-opened','detail cannot override queue fields');
  assert.equal(pushed.length,1);assert.deepEqual(pushed[0].map(e=>e.kind),['viewer-opened','view-presented','print-opened'],'a delivered event carries everything held');
  assert.equal(events.pendingDelivery(),true);assert.equal(events.size,3,'a push does not drain');
  const read=events.drain();assert.deepEqual(read.map(e=>e.seq),[1,2,3]);assert.equal(events.size,0);assert.equal(events.pendingDelivery(),false);
  assert.deepEqual(events.history().map(e=>e.seq),[1,2,3]);
  assert.ok(read.every(e=>!('key' in e)&&typeof e.at==='number'));
  stop();events.record('print-opened',{printId:'other'});assert.equal(pushed.length,1);
});

test('identical consecutive observations collapse, the queue stays bounded and unknown kinds reject',()=>{
  const events=createStudioEvents({limit:3,historyLimit:2});
  events.record('viewer-opened',{viewers:1});events.record('viewer-opened',{viewers:1});
  assert.equal(events.size,1);
  events.record('viewer-opened',{viewers:2});events.record('viewer-opened',{viewers:1});events.record('viewer-closed',{viewers:0});
  assert.equal(events.size,3);assert.deepEqual(events.peek().map(e=>e.seq),[2,3,4]);
  assert.deepEqual(events.history().map(e=>e.seq),[1],'overflow moves the oldest into history');
  assert.throws(()=>events.record('mystery',{}),/Unknown Studio event kind/);
  assert.ok(DELIVERED_KINDS.has('request-queued')&&HELD_KINDS.has('generation-started'));
  assert.equal([...DELIVERED_KINDS].filter(kind=>HELD_KINDS.has(kind)).length,0);
});

test('waits end on a delivered event, an unread delivery, abort or close, never on a held event',async()=>{
  const events=createStudioEvents();
  const held=setTimeout(()=>events.record('viewer-opened',{viewers:1}),20);
  const started=Date.now();assert.equal(await events.wait({waitMs:120}),false,'a held event does not wake the wait');assert.ok(Date.now()-started>=100);clearTimeout(held);
  setTimeout(()=>events.record('export-delivered',{name:'part'}),10);
  assert.equal(await events.wait({waitMs:5000}),true);assert.ok(Date.now()-started<3000);
  assert.equal(await events.wait({waitMs:5000}),true,'an unread delivered event returns immediately');
  events.drain();
  const controller=new AbortController();setTimeout(()=>controller.abort(),10);
  assert.equal(await events.wait({waitMs:5000,signal:controller.signal}),false);
  const closing=events.wait({waitMs:5000});events.close();assert.equal(await closing,false);
  assert.equal(events.record('print-opened',{}),null,'a closed queue records nothing');
});
