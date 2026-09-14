import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMachine,poseMachine,validateSnapshot,transform,untransform,machineFitBounds,boundsCorners} from '../../studio/machine-view.mjs';
import {sourceSession,machineCameras} from '../../studio/machine-session.mjs';
import {createProjection} from '../../studio/camera.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {moveStore} from '../../studio/move-store.mjs';

const identity={rotation:[[1,0,0],[0,1,0],[0,0,1]],translationMm:[0,0,0]};
const binding={printId:'fixture',revision:'1',exportHash:'bytes',modelKey:'nominal'};
const descriptor={schema:'saam-machine-presentation/1',binding,label:'Fixture',basis:'Analytical test',limitations:[],frameIds:['world','part','tcp'],machineBoundsWorldMm:null,
  components:[{id:'tip',label:'Tip',role:'tool',frameId:'tcp',local:identity,shape:{kind:'line',fromMm:[0,0,0],toMm:[0,0,5]}}]};
const snapshot=(requestId,seconds)=>({schema:'saam-machine-pose/1',binding,requestId,seconds,status:'ready',diagnostics:[],worldFromFrame:{world:identity,part:identity,tcp:{...identity,translationMm:[seconds,0,0]}}});

test('moving-bed source alignment retains tool contact with nonzero placement in both camera frames',async()=>{
  const program={seconds:2,moves:[{from:[100,80,5],to:[110,90,15],startSeconds:0,durationSeconds:2}]};
  const machine=loadMachine('ultimaker-s5'),provider=await createMachinePresentation({machine,program,setup:machine.defaultSetup,sourceIdentity:binding});
  const scene=compileMachine(provider.descriptor),request={requestId:1,seconds:1};
  const pose=poseMachine(scene,validateSnapshot(await provider.sample(request),scene.descriptor,request));
  const tcp=pose.components.find(c=>c.role==='tool').vertices[0];
  assert.deepEqual(tcp,[105,85,10]);
  const room=transform(pose.part,tcp);assert.deepEqual(room,pose.part.translationMm.map((v,i)=>v+tcp[i]));
  assert.deepEqual(untransform(pose.part,room),tcp);
  const display=p=>untransform(pose.part,p).map((v,i)=>v-([100,80,0][i]));
  assert.deepEqual(display(room),[5,5,10]);
  const bounds=machineFitBounds(scene,pose,display);assert.ok(bounds.min.every(Number.isFinite));
  provider.dispose();
});

test('rail endpoints and slider bounds come from the machine and stay fixed across source and manual movement',async()=>{
  const machine=loadMachine('split-delta'),program={seconds:1,moves:[{from:[0,0,20],to:[0,0,20],startSeconds:0,durationSeconds:1}]};
  const provider=await createMachinePresentation({machine,program,sourceIdentity:binding}),scene=compileMachine(provider.descriptor);
  const sample=async request=>poseMachine(scene,validateSnapshot(await provider.sample(request),scene.descriptor,request));
  const length=(pose,id)=>{const v=pose.components.find(c=>c.id===id).vertices;return Math.hypot(...v[1].map((n,i)=>n-v[0][i]));};
  const source=await sample({requestId:1,seconds:.5});assert.ok(Math.abs(length(source,'rail-0')-(machine.kinematicModel.railMaxMm-machine.kinematicModel.railMinMm))<1e-6);assert.ok(Math.abs(length(source,'rod-0')-machine.kinematicModel.rodLengthMm)<1e-6);
  const manual=await sample({requestId:2,seconds:.5,manual:[0,0,30,0,0,0]});assert.equal(length(manual,'rail-0'),length(source,'rail-0'));assert.ok(Math.abs(length(manual,'rod-0')-machine.kinematicModel.rodLengthMm)<1e-6);
  const reset=await sample({requestId:3,seconds:.5});assert.deepEqual(reset,source);
  const other=await createMachinePresentation({machine,program:{seconds:2,moves:[{from:[20,0,80],to:[40,0,90],startSeconds:0,durationSeconds:2}]},sourceIdentity:binding});assert.deepEqual(other.descriptor.controls,provider.descriptor.controls);other.dispose();
  provider.dispose();
});

test('consumer rejects wrong-time, stale, reflected and incomplete-ready poses; partial geometry stays honest',()=>{
  for(const mutate of [s=>s.seconds++,s=>s.binding={...binding,exportHash:'old'},s=>s.worldFromFrame.tcp={...identity,rotation:[[-1,0,0],[0,1,0],[0,0,1]]},s=>delete s.worldFromFrame.tcp]){
    const s=structuredClone(snapshot(1,2));mutate(s);assert.throws(()=>validateSnapshot(s,descriptor,{requestId:1,seconds:2}),/Machine presentation/);
  }
  const s=structuredClone(snapshot(1,2));s.status='partial';delete s.worldFromFrame.tcp;
  validateSnapshot(s,descriptor,{requestId:1,seconds:2});assert.equal(poseMachine(compileMachine(descriptor),s),null);
});

class WorkerFixture {
  calls=[];terminated=false;
  postMessage(message){this.calls.push(message);}
  terminate(){this.terminated=true;}
  reply(call,data){this.onmessage({data:{id:call.id,...data}});}
}
async function sessionFixture(){
  const worker=new WorkerFixture(),session=sourceSession(worker),state={printId:'fixture',revision:1,exportHash:'bytes'};
  const loaded=session.load(state);worker.reply(worker.calls.at(-1),{descriptor,program:{moves:moveStore().snapshot()}});await loaded;
  return {worker,session,state};
}
test('reverse seeks and replacement binds discard obsolete worker responses; disposal terminates resources',async()=>{
  const {worker,session,state}=await sessionFixture();
  const old=session.sample(2),oldCall=worker.calls.at(-1),rejected=assert.rejects(old,{name:'AbortError'});
  const next=session.sample(1),nextCall=worker.calls.at(-1);worker.reply(nextCall,{snapshot:snapshot(nextCall.id,1)});await next;await rejected;
  worker.reply(oldCall,{snapshot:snapshot(oldCall.id,2)});assert.equal(session.current(2),null);assert.equal(session.current(1).pose.components[0].vertices[0][0],1);
  const prior=session.sample(3),priorCall=worker.calls.at(-1),obsolete=assert.rejects(prior,{name:'AbortError'});
  const rebound=session.bind({...state,revision:2}),bindCall=worker.calls.at(-1);worker.reply(priorCall,{snapshot:snapshot(priorCall.id,3)});worker.reply(bindCall,{descriptor});await rebound;await obsolete;
  assert.equal(session.current(3),null);
  const pending=session.sample(4),disposed=assert.rejects(pending,{name:'AbortError'});session.dispose();await disposed;assert.equal(worker.terminated,true);
});
test('a failed worker leaves an immediately usable toolpath fallback',async()=>{
  const {worker,session}=await sessionFixture(),pending=session.sample(1);
  worker.onerror({message:'Worker failed'});assert.equal((await pending).pose,null);assert.equal((await session.sample(2)).pose,null);assert.match(session.error,/Worker failed/);
});

test('manual and source poses at the same time have separate cache identity and obsolete manual requests are cancelled',async()=>{
  const {worker,session}=await sessionFixture();
  const first=session.sample(1),firstCall=worker.calls.at(-1);worker.reply(firstCall,{snapshot:snapshot(firstCall.id,1)});await first;
  const held=session.held(1);assert.ok(held.pose);assert.equal(session.held(2),null);
  const manual=[5,0,0],pending=session.sample(1,{manual}),call=worker.calls.at(-1),cancelled=assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(call.manual,manual);assert.equal(session.current(1,{manual}),null);
  assert.equal(session.held(1),held,'pending manual request retains the complete assembly');
  await session.sample(1);await cancelled;
  worker.reply(call,{snapshot:{...snapshot(call.id,1),manual}});assert.equal(session.current(1).snapshot.manual,undefined);
  const second=session.sample(1,{manual}),secondCall=worker.calls.at(-1);
  worker.reply(secondCall,{snapshot:{...snapshot(secondCall.id,1),manual}});await second;
  assert.deepEqual(session.current(1,{manual}).snapshot.manual,manual);assert.equal(session.current(1),null);
  assert.throws(()=>validateSnapshot({...snapshot(1,1),manual},descriptor,{requestId:1,seconds:1}),/manual/);
  session.dispose();
  assert.equal(session.held(1),null);
});
test('an incompatible descriptor disables only the machine, preserving decoded toolpath',async()=>{
  const worker=new WorkerFixture(),session=sourceSession(worker),loaded=session.load({printId:'fixture',revision:1,exportHash:'bytes'}),moves=moveStore();
  moves.push({line:1,from:[1,2,3],to:[4,5,6]});
  worker.reply(worker.calls.at(-1),{descriptor:{...descriptor,schema:'unsupported/2'},program:{moves:moves.snapshot()}});
  assert.deepEqual((await loaded).moves[0].to,[4,5,6]);assert.equal(session.scene,null);assert.match(session.error,/version/);assert.equal(worker.terminated,true);
});
test('mode switching restores independent zoom, pan, orbit and fit without accumulating drift',()=>{
  const cameras=machineCameras(),ghost={yaw:-.7,tilt:.6,zoom:3,pan:[12,24],fitBounds:null},machine={yaw:0,tilt:1,zoom:1,pan:[0,0],fitBounds:{min:[-50,-50,0],max:[50,50,400]}};
  assert.deepEqual(cameras.switch('machine',ghost,machine),machine);
  const changed={...machine,zoom:2};assert.deepEqual(cameras.switch('ghost',changed),ghost);
  assert.deepEqual(cameras.switch('machine',ghost,machine),changed);
  const restored=machineCameras();assert.deepEqual(restored.restore(cameras.snapshot(changed)),changed);assert.equal(restored.mode,'machine');
  const invalid=machineCameras();assert.equal(invalid.restore({mode:'machine',views:{}}),null);assert.equal(invalid.mode,'ghost');
  cameras.refit(()=>null);assert.equal(cameras.switch('ghost',changed).fitBounds,null);
});
test('machine fit contains the full envelope while using the available viewport',()=>{
  const bounds={min:[-250,-250,0],max:[250,250,800]};
  for(const [yaw,tilt] of [[-.78,.62],[0,0],[0,Math.PI/2]]){
    const project=createProjection(bounds,800,400,yaw,tilt,1,[0,0],true),points=boundsCorners(bounds).map(project);
    assert.ok(points.every(p=>p[0]>=0&&p[0]<=800&&p[1]>=0&&p[1]<=400));
    const extent=[0,1].map(i=>Math.max(...points.map(p=>p[i]))-Math.min(...points.map(p=>p[i])));
    assert.ok(extent[0]>=679||extent[1]>=319,'one projected dimension should fill the padded view');
  }
});
