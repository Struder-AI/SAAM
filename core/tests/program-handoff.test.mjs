import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createCheckedProgramHandoff,consumeCheckedProgram,createPendingCheckedProgramStore} from '../print/program-handoff.mjs';

const source=(generationHash,exportHash,label)=>({type:'generated',checks:{generationHash,exportHash},source:{
  generationHash,exportHash,metadata:{label,moves:[1],events:[2],nested:{value:1}},code:label,sources:{program:label}}});

test('checked program handoffs retain independent concurrent job results',async t=>{
  const firstWorker=new Worker('setInterval(()=>{},1000)',{eval:true}),secondWorker=new Worker('setInterval(()=>{},1000)',{eval:true});
  t.after(()=>Promise.all([firstWorker.terminate(),secondWorker.terminate()]));
  let firstTicket,secondTicket;
  const first=createCheckedProgramHandoff(firstWorker,'generation-a',(_message,ticket)=>{firstTicket=ticket;});
  const second=createCheckedProgramHandoff(secondWorker,'generation-b',(_message,ticket)=>{secondTicket=ticket;});
  const firstMessage=source('generation-a','export-a','first');
  firstWorker.emit('message',firstMessage);firstMessage.source.metadata.nested.value=9;
  secondWorker.emit('message',source('generation-b','export-b','second'));
  const firstResult=consumeCheckedProgram(firstTicket,'generation-a','export-a');
  assert.equal(firstResult.code,'first');assert.equal(firstResult.metadata.nested.value,1);
  const result=consumeCheckedProgram(secondTicket,'generation-b','export-b');
  assert.equal(result.code,'second');assert.equal(result.metadata.moves,undefined);
  result.metadata.nested.value=9;
  assert.equal(consumeCheckedProgram(secondTicket,'generation-b','export-b'),null,'tickets are single-use');
});

test('checked program handoffs reject stale, disposed and mismatched results',async t=>{
  const worker=new Worker('setInterval(()=>{},1000)',{eval:true});t.after(()=>worker.terminate());
  assert.equal(consumeCheckedProgram({},'generation-current','export'),null,'callers cannot forge a checked ticket');
  const received=[];
  const stale=createCheckedProgramHandoff(worker,'generation-current',(_message,ticket)=>received.push(ticket));
  worker.emit('message',source('generation-stale','export','stale'));assert.deepEqual(received,[null]);
  stale.dispose();worker.emit('message',source('generation-current','export','late'));assert.deepEqual(received,[null]);
  let ticket;
  const live=createCheckedProgramHandoff(worker,'generation-current',(_message,value)=>{ticket=value;});
  worker.emit('message',source('generation-current','export','current'));
  assert.equal(consumeCheckedProgram(ticket,'generation-current','other'),null);
  assert.equal(consumeCheckedProgram(ticket,'generation-current','export'),null,'a rejected ticket cannot be retried');
});

test('unclaimed checked programs have bounded capacity and lifetime',async()=>{
  const store=createPendingCheckedProgramStore({capacity:2,ttlMs:15});
  store.retain('first',{code:'first'});store.retain('second',{code:'second'});store.retain('third',{code:'third'});
  assert.equal(store.size,2);assert.equal(store.take('first'),null,'oldest unclaimed source is evicted');
  assert.equal(store.take('second').code,'second');assert.equal(store.size,1);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(store.take('third'),null,'unclaimed source expires');assert.equal(store.size,0);
});
