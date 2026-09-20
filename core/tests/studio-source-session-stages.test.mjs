import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSession} from '../../studio/machine-session.mjs';
import {moveStore} from '../../studio/move-store.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

const identity={rotation:[[1,0,0],[0,1,0],[0,0,1]],translationMm:[0,0,0]};
const binding={printId:'fixture',revision:'1',exportHash:'bytes',modelKey:'nominal'};
const descriptor={schema:'saam-machine-presentation/1',binding,label:'Fixture',basis:'Test',limitations:[],
  frameIds:['world','part','tcp'],machineBoundsWorldMm:null,components:[{id:'tip',label:'Tip',role:'tool',frameId:'tcp',local:identity,shape:{kind:'line',fromMm:[0,0,0],toMm:[0,0,5]}}]};
const snapshot=seconds=>({schema:'saam-machine-pose/1',binding,requestId:1,seconds,status:'ready',diagnostics:[],worldFromFrame:{world:identity,part:identity,tcp:identity}});
async function fixture(){
  const worker={calls:[],terminated:0,postMessage(message){this.calls.push(message);},terminate(){this.terminated++;},
    reply(call,data){this.onmessage({data:{id:call.id,...data}});}};
  const session=sourceSession(worker),state={printId:'fixture',revision:1,exportHash:'bytes'};
  const loaded=session.load(state);worker.reply(worker.calls.at(-1),{descriptor,program:{moves:moveStore().snapshot()}});await loaded;
  return {worker,session,state};
}

test('matching pending requests preserve promise identity and cached results preserve result identity',async()=>{
  const {worker,session}=await fixture(),first=session.sample(2),count=worker.calls.length;
  assert.equal(session.sample(2),first);assert.equal(worker.calls.length,count);
  worker.reply(worker.calls.at(-1),{snapshot:snapshot(2)});const ready=await first;
  assert.equal(await session.sample(2),ready);assert.equal(session.current(2),ready);assert.equal(session.held(2),ready);
  assert.equal(worker.calls.length,count);session.dispose();
});

test('pending reuse does not acquire a second abort owner; initiating signal settles cleanup',async()=>{
  const {worker,session}=await fixture(),owner=new AbortController(),second=new AbortController();
  let added=0,removed=0;const add=owner.signal.addEventListener.bind(owner.signal),remove=owner.signal.removeEventListener.bind(owner.signal);
  owner.signal.addEventListener=(...args)=>{added++;return add(...args);};owner.signal.removeEventListener=(...args)=>{removed++;return remove(...args);};
  const first=session.sample(3,{signal:owner.signal});assert.equal(session.sample(3,{signal:second.signal}),first);
  second.abort();assert.equal(session.current(3),null);assert.equal(added,1);
  const cancelled=assert.rejects(first,{name:'AbortError'});owner.abort();await cancelled;assert.equal(removed,1);
  const retry=session.sample(3);worker.reply(worker.calls.at(-1),{snapshot:snapshot(3)});await retry;
  assert.ok(session.current(3));session.dispose();
});

test('already delivered but not yet accepted pose is rejected when a new binding advances the epoch',async()=>{
  const {worker,session,state}=await fixture(),pending=session.sample(2),rejected=assert.rejects(pending,{name:'AbortError'});
  worker.reply(worker.calls.at(-1),{snapshot:snapshot(2)});
  const bound=session.bind({...state,revision:2});worker.reply(worker.calls.at(-1),{descriptor});
  await bound;await rejected;assert.equal(session.current(2),null);assert.equal(session.held(2),null);session.dispose();
});

test('partial pose and worker failure preserve held ready assembly while latest fallback stays explicit',async()=>{
  const {worker,session}=await fixture();const first=session.sample(1);worker.reply(worker.calls.at(-1),{snapshot:snapshot(1)});
  const ready=await first;
  const partial=session.sample(1,{manual:[1]});worker.reply(worker.calls.at(-1),{snapshot:{...snapshot(1),status:'partial',worldFromFrame:{world:identity,part:identity}}});
  assert.equal((await partial).pose,null);assert.equal(session.held(1),ready);
  const failing=session.sample(2);worker.onerror({message:'worker failed'});assert.equal((await failing).pose,null);
  assert.equal(session.held(1),ready);assert.equal(session.error,'worker failed');assert.equal((await session.sample(3)).pose,null);
  assert.equal(worker.terminated,1);session.dispose();assert.equal(session.held(1),null);
});

test('unchanged bind preserves cache and replacement bind clears it before the response arrives',async()=>{
  const {worker,session,state}=await fixture(),pending=session.sample(1);worker.reply(worker.calls.at(-1),{snapshot:snapshot(1)});const ready=await pending;
  const count=worker.calls.length;await session.bind({...state});assert.equal(worker.calls.length,count);assert.equal(session.current(1),ready);
  const changed=session.bind({...state,revision:2});assert.equal(session.current(1),null);assert.equal(session.held(1),null);
  worker.reply(worker.calls.at(-1),{descriptor});await changed;session.dispose();
});

test('unavailable scenes return null while caller cancellation remains the first synchronous guard',async()=>{
  const worker={postMessage(){throw Error('unexpected RPC');},terminate(){}},session=sourceSession(worker);
  assert.equal(await session.sample(1),null);
  const controller=new AbortController();controller.abort();assert.throws(()=>session.sample(1,{signal:controller.signal}),{name:'AbortError'});
  session.dispose();assert.equal(await session.sample(1),null);
});

test('sampling map connects metadata decision and accepted response publication while retaining captured-context limits',async()=>{
  const file='studio/machine-session.mjs',context=await loadFlow({files:[file]});
  const page=flowPacket(context,`${file}::sourceSession::sample`);
  const at=name=>page.components.find(c=>c.label===`sourceSession::${name}`)?.index;
  assert.ok(page.wires.some(w=>w.from===at('readSamplingState')&&w.to===at('planPoseSample')&&w.label==='session'));
  assert.ok(page.wires.some(w=>w.from===at('planPoseSample')&&w.to===at('applySampleDecision')&&w.label==='decision'));
  const receive=flowPacket(context,`${file}::sourceSession::requestPose::receivePose`);
  const accept=receive.components.find(c=>c.label==='sourceSession::acceptPose'),publish=receive.components.find(c=>c.label==='sourceSession::publishPose');
  assert.ok(receive.wires.some(w=>w.from===accept.index&&w.to===publish.index&&w.label==='accepted'));
  assert.ok(receive.uncertainty.some(u=>u.kind==='argument-origin'&&u.expression==='version'));
  assert.equal(context.projection.nodes.has(`${file}::sourceSession::sample::abort`),false);
});
