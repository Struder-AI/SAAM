import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMachine,startupPosition,startupRetracted} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {uprightPose} from '../path/pose.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {ActionAccumulator,createPlanningState,planMove,planTravel,planPark,planLayerCooling,
  planFan,planNozzle,planExtrusion,planningPath} from '../path/planning.mjs';
import {planComposition,planStrokeDeposition,scheduleOperations,validateOperationBatch,
  prepareOperationPriorities,prepareOperationDependencies,orderReadyOperations} from '../path/compose.mjs';
import {planPriming} from '../path/prime.mjs';

function frozen(value,seen=new Set()) {
  if(!value||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);for(const child of Object.values(value))frozen(child,seen);
  return Object.freeze(value);
}
const copy=value=>JSON.parse(JSON.stringify(value));
function initial(overrides={}) {
  const machine=loadMachine(),process={...defaults(machine).process,minimumLayerSeconds:0};
  return createPlanningState({start:[10,10,1],machine,process,generatorVersion:'state-test',...overrides});
}
const partRegion=[[[0,0],[30,0],[30,30],[0,30]]];
const policy=()=>planarPolicy(partRegion,{layerZ:1,liftMm:1,maxCombMm:8,lineWidthMm:.4});

// Object.freeze does not prevent Map/Set writes; reject their mutation methods too.
function readonlyCollection(value) {
  for(const method of value instanceof Map?['set','delete','clear']:['add','delete','clear'])
    Object.defineProperty(value,method,{value:()=>{throw Error(`Cannot mutate shared ${method}`);}});
  for(const item of value.values())if(item instanceof Set||item instanceof Map)readonlyCollection(item);else frozen(item);
  return Object.freeze(value);
}

test('scheduler stages preserve reusable frozen inputs and stable priorities under precedence constraints',()=>{
  const op=(id,z,rank)=>({id,rank,layerId:`layer-${z}`,after:[],order:'given',
    strokes:[{points:[[0,0,z],[1,0,z]]}],travelPolicy:{clearanceFor:()=>z}});
  const results=frozen([{operations:[op('aHigh',2,0),op('aLow',0,10),op('aTie',0,10),op('aTie2',0,10)]},
    {operations:[op('bLow',0,-5),op('bHigh',2,-5)]}]);
  const rules=frozen({order:['bLow','aLow'],dependencies:[{before:'aTie',after:'bHigh'}]});
  const before=copy({results,rules});
  for(const [batchLayers,expected] of [[1,['aTie','aTie2','bLow','aLow','aHigh','bHigh']],
    [2,['aHigh','aTie','aTie2','bLow','aLow','bHigh']]]) {
    const batch=validateOperationBatch(results,batchLayers);frozen(batch.operations);
    readonlyCollection(batch.byId);readonlyCollection(batch.resultIndex);
    const priorities=readonlyCollection(prepareOperationPriorities(batch.operations,batch.resultIndex,batchLayers));
    const dependencies=readonlyCollection(prepareOperationDependencies(batch.operations,batch.byId,rules));
    const inputs=copy({priorities:[...priorities],dependencies:[...dependencies].map(([id,set])=>[id,[...set]])});
    const ordered=Object.freeze(orderReadyOperations(batch.operations,priorities,dependencies));
    assert.deepEqual(ordered.map(x=>x.id),expected);
    assert.deepEqual(orderReadyOperations(batch.operations,priorities,dependencies),ordered,
      'scheduling again from the same intermediate values must give the same complete order');
    assert.deepEqual(scheduleOperations(results,{...rules,batchLayers}),ordered);
    assert.deepEqual(copy({priorities:[...priorities],dependencies:[...dependencies].map(([id,set])=>[id,[...set]])}),inputs);
    assert.ok(ordered.every(item=>batch.byId.get(item.id)===item),'operations preserve their identities');
  }
  assert.deepEqual(copy({results,rules}),before);
});

test('a failed cyclic schedule does not consume prerequisite sets or corrupt reusable priorities',()=>{
  const operations=frozen(['a','b'].map(id=>({id,rank:0,layerId:'shared',strokes:[],travelPolicy:{clearanceFor:()=>0}})));
  const batch=validateOperationBatch([{operations}],1);
  const priorities=readonlyCollection(prepareOperationPriorities(batch.operations,readonlyCollection(batch.resultIndex),1));
  const dependencies=readonlyCollection(new Map([['a',new Set(['b'])],['b',new Set(['a'])]]));
  for(let attempt=0;attempt<2;attempt++)assert.throws(()=>orderReadyOperations(operations,priorities,dependencies),/cycle/);
  assert.deepEqual([...dependencies].map(([id,set])=>[id,[...set]]),[['a',['b']],['b',['a']]]);
  const acyclic=readonlyCollection(new Map([['a',new Set()],['b',new Set(['a'])]]));
  assert.deepEqual(orderReadyOperations(operations,priorities,acyclic),operations);
});

test('collinear stage merging preserves every earlier frozen state and action chunk',()=>{
  const start=frozen(initial()),before=copy(start);
  const first=frozen(planMove(start,[11,10,1],10,.08,{role:'wall'}));
  const firstBefore=copy(first);
  const second=frozen(planMove(first.state,[12,10,1],10,.08,{role:'wall'}));
  const oldPath=planningPath(first.state,[first.actions]);
  const merged=planningPath(second.state,[first.actions,second.actions]);
  assert.deepEqual(copy(start),before);
  assert.deepEqual(copy(first),firstBefore,'a later merge must not mutate the earlier chunk or its tail action');
  assert.equal(oldPath.actions.length,1);assert.deepEqual(oldPath.actions[0].to,[11,10,1]);
  assert.equal(oldPath.actions[0].volumeMm3,.08);
  assert.equal(merged.actions.length,1);assert.deepEqual(merged.actions[0].to,[12,10,1]);
  assert.equal(merged.actions[0].volumeMm3,.16);
  assert.equal(merged.summary.travel.printMm,2);
  assert.equal(second.state.layerSeconds,.2);
});

test('travel stages preserve joined, combed and hopped decisions without mutating the incoming state',()=>{
  const start=frozen(initial()),chunks=[];
  const deposited=frozen(planMove(start,[11,10,1],10,.08));chunks.push(deposited.actions);
  const joined=frozen(planTravel(deposited.state,[11,10,1],policy()));chunks.push(joined.actions);
  const combed=frozen(planTravel(joined.state,[11,11,1],policy()));chunks.push(combed.actions);
  const previous=copy(combed),hopped=frozen(planTravel(combed.state,[24,20,1],{maxCombMm:0}));chunks.push(hopped.actions);
  assert.deepEqual([joined.travelKind,combed.travelKind,hopped.travelKind],['joined','combed','hopped']);
  assert.deepEqual(copy(combed),previous);
  const path=planningPath(hopped.state,chunks),moves=path.actions.filter(a=>a.kind==='move');
  assert.deepEqual(moves.at(-1).to,[24,20,1]);
  assert.ok(moves.some(a=>a.to[2]===2),'lift clears deposited material by the planned one millimeter');
  assert.equal(path.actions.filter(a=>a.kind==='retract').length,1);
  assert.equal(path.actions.filter(a=>a.kind==='recover').length,1);
  assert.equal(path.summary.travel.joined,1);assert.equal(path.summary.travel.combed,1);assert.equal(path.summary.travel.hopped,1);
  assert.equal(hopped.state.retracted,false);
});

test('cooling and stationary extrusion preserve layer timing and do not retroactively alter motion',()=>{
  const base=initial(),start=frozen({...base,process:{...base.process,minimumLayerSeconds:5}});
  const move=frozen(planMove(start,[11,10,1],10,.08)),fan=frozen(planFan(move.state,70));
  const metered=frozen(planExtrusion(fan.state,2,100)),before=copy(metered);
  const cooled=frozen(planLayerCooling(metered.state));
  assert.deepEqual(copy(metered),before);
  const path=planningPath(cooled.state,[move.actions,fan.actions,metered.actions,cooled.actions]);
  const extrude=path.actions.find(a=>a.kind==='extrude');
  assert.equal(extrude.volumeMm3,2);assert.equal(extrude.flowMm3S,start.process.maxFlowMm3S);
  assert.equal(metered.state.layerSeconds,.1+2/start.process.maxFlowMm3S);
  assert.equal(path.actions.find(a=>a.kind==='dwell').seconds,5-metered.state.layerSeconds);
  assert.equal(cooled.state.layerSeconds,0);
  assert.deepEqual(move.state.position,[11,10,1]);
});

test('composition returns ordered actions and finishes a shared layer once while preserving frozen inputs',()=>{
  const base=initial(),start=frozen({...base,process:{...base.process,minimumLayerSeconds:10}});
  const op=(id,points)=>({id,rank:0,phase:'fixture',layer:0,layerId:'shared',order:'given',after:[],
    strokes:[{points,role:'fill',speedMmS:10,beadAreaMm2:.08}],travelPolicy:{maxCombMm:0,clearanceFor:()=>2}});
  const results=frozen([{operations:[op('first',[[10,10,1],[12,10,1]]),op('second',[[12,10,1],[12,12,1]])]}]);
  const before=copy({start,results}),events=[];
  const planned=frozen(planComposition(start,results,{},event=>events.push({...event})));
  const path=planningPath(planned.state,[planned.actions],{composition:planned.summary});
  assert.deepEqual(copy({start,results}),before);
  assert.deepEqual(planned.summary,{operationOrder:['first','second'],layers:1});
  assert.deepEqual(path.actions.filter(a=>a.volumeMm3>0).map(a=>a.operation),['first','second']);
  assert.equal(path.actions.filter(a=>a.kind==='dwell').length,1);
  assert.deepEqual(events.map(e=>e.completed),[0,1,2]);
  assert.equal(planned.state.layerSeconds,0);
});

test('priming produces the sacrificial passes without altering input state and rejects impossible placement atomically',()=>{
  const machine=loadMachine(),plan=defaults(machine);
  const start=frozen(createPlanningState({start:startupPosition(machine,plan),machine,process:plan.process,
    generatorVersion:'state-test',retracted:startupRetracted(machine,plan)}));
  const results=frozen([{operations:[{strokes:[{points:[[140,100,.2],[148,108,.2]],beadAreaMm2:.08}]}]}]);
  const bounds=frozen({min:[140,100,0],max:[148,108,2]}),before=copy({start,results,bounds});
  const primed=frozen(planPriming(start,bounds,results)),path=planningPath(primed.state,[primed.actions]);
  assert.deepEqual(copy({start,results,bounds}),before);
  const printing=path.actions.filter(a=>a.volumeMm3>0);
  assert.equal(printing.length,3);assert.ok(printing.every(a=>a.role==='prime'&&a.to[2]===.2));
  assert.ok(Math.abs(printing.reduce((sum,a)=>sum+a.volumeMm3,0)-16.032)<1e-10);
  assert.equal(primed.state.retracted,true);assert.equal(primed.state.layerSeconds,0);
  assert.throws(()=>planPriming(start,{min:[0,0,0],max:[330,240,2]},results),/No room for machine priming strokes/);
  assert.deepEqual(copy(start),before.start);
});

test('oriented stages preserve pose-only moves and snapshot poses through later reorientation',()=>{
  const machine=loadMachine('denso-vp6242-rc8'),plan=defaults(machine);
  const start=frozen(initial({machine,process:plan.process,motion:plan.setup.denso,start:[10,0,1]}));
  const pose=frozen({...uprightPose(),rotaryDeg:720});
  const turn=frozen(planMove(start,[10,0,1],10,0,{pose,durationSeconds:2})),before=copy(turn);
  const raised=frozen(planMove(turn.state,[10,0,2],10,.08,{pose}));
  const parked=frozen(planPark(raised.state));
  const path=planningPath(parked.state,[turn.actions,raised.actions,parked.actions]);
  assert.deepEqual(copy(turn),before);
  assert.deepEqual(path.actions[0].to,[10,0,1]);assert.equal(path.actions[0].durationSeconds,2);
  assert.equal(path.actions[0].pose.rotaryDeg,720);assert.equal(path.actions[1].volumeMm3,.08);
  assert.deepEqual(start.pose,uprightPose());
});

test('individual planning stages retain bounded state and deltas as an unmerged path grows',()=>{
  let state=frozen(initial());const initialBytes=JSON.stringify(state).length,chunks=[];
  let first;
  for(let i=1;i<=2048;i++) {
    const next=frozen(planMove(state,[10+i*.002,10+(i%2)*.1,1],10,.001));
    if(i===1)first=next;
    chunks.push(next.actions);state=next.state;
    if([1,32,256,2048].includes(i)) {
      assert.ok(JSON.stringify(state).length<initialBytes+5000,'state cannot carry the growing action history');
      assert.ok(JSON.stringify(next.actions).length<2500,'one move cannot return a copy of earlier action chunks');
    }
  }
  const path=planningPath(state,chunks);
  assert.equal(path.actions.length,2048,'every alternating corner must remain an explicit move');
  assert.deepEqual(first.state.position,[10.002,10.1,1]);
  assert.equal(planningPath(first.state,[first.actions]).actions.length,1);
});

const actionRecords=chunk=>chunk.chunks?chunk.chunks.reduce((sum,c)=>sum+actionRecords(c),0)
  :(chunk.append?.length??0)+(chunk.replaceLast?1:0);

test('stage-local compaction discards superseded local moves without mutating nested source chunks',()=>{
  const start=frozen(initial()),first=frozen(planMove(start,[11,10,1],10,.08));
  const second=frozen(planMove(first.state,[12,10,1],10,.08)),third=frozen(planMove(second.state,[13,10,1],10,.08));
  const source=frozen({chunks:[first.actions,{chunks:[second.actions,third.actions]}]}),before=copy(source);
  const accumulator=new ActionAccumulator();accumulator.add(source);
  const compact=frozen(accumulator.finish());
  assert.equal(actionRecords(compact),1);
  assert.equal(compact.append.length,1);assert.ok(!compact.replaceLast);
  assert.deepEqual(planningPath(third.state,[compact]),planningPath(third.state,[source]));
  assert.deepEqual(copy(source),before);
  assert.equal(first.actions.append[0].volumeMm3,.08);
});

test('a leading replacement survives compaction and cannot alter a previously finalized stage',()=>{
  const first=frozen(planMove(frozen(initial()),[11,10,1],10,.08));
  const previous=frozen(planningPath(first.state,[first.actions])),previousBefore=copy(previous);
  const second=frozen(planMove(first.state,[12,10,1],10,.08)),third=frozen(planMove(second.state,[13,10,1],10,.08));
  const source=frozen({chunks:[second.actions,third.actions]}),before=copy(source);
  const accumulator=new ActionAccumulator();accumulator.add(source);
  const compact=frozen(accumulator.finish());
  assert.equal(actionRecords(compact),1);assert.equal(compact.append.length,0);
  assert.deepEqual(compact.replaceLast.to,[13,10,1]);
  const path=planningPath(third.state,[first.actions,compact]);
  assert.equal(path.actions.length,1);assert.equal(path.actions[0].volumeMm3,.24);
  assert.deepEqual(copy(previous),previousBefore);
  assert.deepEqual(planningPath(first.state,[first.actions]),previous);
  assert.deepEqual(copy(source),before);
});

test('fan and temperature barriers survive compaction between otherwise mergeable straight moves',()=>{
  const stages=[];let state=frozen(initial());
  const apply=result=>{const step=frozen(result);stages.push(step);state=step.state;};
  apply(planMove(state,[11,10,1],10,.08));apply(planMove(state,[12,10,1],10,.08));
  apply(planFan(state,60));
  apply(planMove(state,[13,10,1],10,.08));apply(planMove(state,[14,10,1],10,.08));
  apply(planNozzle(state,205));
  apply(planMove(state,[15,10,1],10,.08));apply(planMove(state,[16,10,1],10,.08));
  const source=frozen(stages.map(s=>s.actions)),before=copy(source),accumulator=new ActionAccumulator();
  for(const chunk of source)accumulator.add(chunk);
  const compact=frozen(accumulator.finish()),path=planningPath(state,[compact]);
  assert.equal(actionRecords(compact),5);
  assert.deepEqual(path.actions.map(a=>a.kind),['move','fan','move','temperature','move']);
  assert.deepEqual(path.actions.filter(a=>a.kind==='move').map(a=>a.to[0]),[12,14,16]);
  assert.deepEqual(path.actions.filter(a=>a.kind==='move').map(a=>a.volumeMm3),[.16,.16,.16]);
  assert.deepEqual(path,planningPath(state,source));
  assert.deepEqual(copy(source),before);
});

test('finishing a local accumulator detaches its published buffer before reuse',()=>{
  const first=frozen(planMove(frozen(initial()),[11,10,1],10,.08));
  const accumulator=new ActionAccumulator();accumulator.add(first.actions);
  const published=frozen(accumulator.finish()),before=copy(published);
  const second=frozen(planMove(first.state,[12,10,1],10,.08));accumulator.add(second.actions);
  const next=frozen(accumulator.finish());
  assert.notStrictEqual(next.append,published.append);
  assert.equal(next.append.length,0);assert.ok(next.replaceLast);
  assert.deepEqual(copy(published),before);
  assert.deepEqual(planningPath(second.state,[published,next]),planningPath(second.state,[first.actions,second.actions]));
});

test('a subdivided straight deposition stage retains only the final merged action',()=>{
  const start=frozen(initial());
  const stroke=frozen({points:Array.from({length:10001},(_,i)=>[10+i*.001,10,1]),role:'wall',speedMmS:10,beadAreaMm2:.08});
  const op=frozen({id:'straight',phase:'fixture',layer:0}),before=copy(start);
  const planned=frozen(planStrokeDeposition(start,stroke,op));
  assert.equal(actionRecords(planned.actions),1,'superseded move replacements cannot accumulate until final path assembly');
  const path=planningPath(planned.state,[planned.actions]);
  assert.equal(path.actions.length,1);assert.deepEqual(path.actions[0].to,[20,10,1]);
  assert.ok(Math.abs(path.actions[0].volumeMm3-.8)<1e-10);
  assert.equal(planned.state.stats.printMm,10);
  assert.deepEqual(copy(start),before);
});
