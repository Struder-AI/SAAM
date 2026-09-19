import {createPlanningState,planningPath,planningResult,planContext,planMove,planTravel,planFan,ActionAccumulator} from '../path/planning.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {planarPolicy} from '../path/builder.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

function initialState(start=[10,10,1]){const machine=loadMachine(),plan=defaults(machine);return createPlanningState({start,process:plan.process,machine,generatorVersion:'test'});}
test('short representable segments retain the start used by the next variable-volume move',()=>{
  const initial=initialState(),first=[10.00002,10.00001,1],second=[10.05,10.04,1];
  const length=(a,c)=>Math.hypot(...a.map((v,i)=>v-c[i]));
  const width=.4,gap=.03;
  const firstMove=planMove(initial,first,10,length(initial.position,first)*width*gap,{gapMm:gap});
  const secondMove=planMove(firstMove.state,second,10,length(first,second)*width*gap,{gapMm:gap});
  const {actions}=planningPath(secondMove.state,[firstMove.actions,secondMove.actions]);
  assert.equal(actions.length,2,'a short corner survives the five-decimal coordinate grid');
  let previous=initial.start;
  for(const action of actions){
    assert.ok(Math.abs(action.volumeMm3-length(previous,action.to)*width*action.gapMm)<1e-12);
    previous=action.to;
  }
  const crossing=planMove(initialState([10.0000049,10,1]),[10.0000051,10,1],10,0);
  assert.equal(planningPath(crossing.state,[crossing.actions]).actions.length,1,'even a sub-grid distance can cross a rounding boundary');
});
test('all skill writers coalesce a straight run while preserving volume and endpoints',()=>{
  for(const phase of ['planar','draped-skin','vase-wall','inclined']) {
    let state=planContext(initialState(),phase,1,phase+':test').state;
    const collected=new ActionAccumulator();
    for(let i=1;i<=100;i++){const moved=planMove(state,[10+i*.1,10+i*.2,1+i*.05],10,Math.hypot(.1,.2,.05)*.08,{role:'test'});state=moved.state;collected.add(moved.actions);}
    const {actions}=planningPath(state,[collected.finish()]);
    assert.equal(actions.length,1,phase);
    assert.deepEqual(actions[0].to,[20,30,6]);
    assert.ok(Math.abs(actions[0].volumeMm3-Math.hypot(10,20,5)*.08)<1e-10);
    assert.ok(Math.abs(state.stats.printMm-Math.hypot(10,20,5))<1e-10);
  }
  const first=planMove(initialState(),[11,10,1],20),second=planMove(first.state,[12,10,1],20);
  const {actions}=planningPath(second.state,[first.actions,second.actions]);
  assert.equal(actions.length,1);assert.equal(actions[0].volumeMm3,0);
});
test('corners, reversals, curves and process/semantic changes remain explicit commands',()=>{
  for(const change of [
    state=>planMove(state,[12,11,1],10,.08),
    state=>planMove(state,[10,10,1],10,.08),
    state=>planMove(state,[12,10,1],20,.08),
    state=>planMove(state,[12,10,1],10,.04),
    state=>planMove(state,[12,10,1],10,0),
    state=>planMove({...state,operationId:'other'},[12,10,1],10,.08),
    state=>planMove(planContext(state,'other',1).state,[12,10,1],10,.08),
    state=>planMove(state,[12,10,1],10,.08,{gapMm:.1}),
    state=>{const fan=planFan(state,100),moved=planMove(fan.state,[12,10,1],10,.08);return planningResult(moved.state,{chunks:[fan.actions,moved.actions]});}
  ]) {const first=planMove(initialState(),[11,10,1],10,.08),changed=change(first.state);
    const {actions}=planningPath(changed.state,[first.actions,changed.actions]);assert.equal(actions.filter(a=>a.kind==='move').length,2);}
  let state=initialState();const collected=new ActionAccumulator();
  for(let i=1;i<=100;i++){const moved=planMove(state,[10+i*.1,10+0.00001*i*i,1],10,.008);state=moved.state;collected.add(moved.actions);}
  assert.ok(planningPath(state,[collected.finish()]).actions.length>90,'small cumulative bends cannot turn into one straight line');
});

test('nearby stroke starts move directly without retraction or lift, retaining hole and surface checks',()=>{
  const region=[[[0,0],[20,0],[20,20],[0,20]]];
  const policy=planarPolicy(region,{layerZ:1,liftMm:1,maxCombMm:0,lineWidthMm:.4});
  const moved=planMove(initialState(),[11,10,1],10,.08),traveled=planTravel(moved.state,[11,11,1],policy);
  const {actions}=planningPath(traveled.state,[moved.actions,traveled.actions]);
  assert.equal(traveled.travelKind,'combed');
  assert.equal(traveled.state.stats.retractions,0);assert.equal(traveled.state.stats.hopped,0);
  assert.deepEqual(actions.at(-1).to,[11,11,1]);assert.equal(actions.at(-1).travel,'combed');
  assert.equal(actions.at(-1).volumeMm3,0,'repositioning does not invent deposition');
  const hole=[[[10.3,9],[10.3,11],[10.6,11],[10.6,9]]];
  const holePolicy=planarPolicy([...region,...hole],{layerZ:1,liftMm:1,maxCombMm:0,lineWidthMm:.4});
  assert.equal(planTravel(initialState(),[10.9,10,1],holePolicy).travelKind,'hopped','a short gap across a slot still preserves the opening');
  assert.equal(planTravel(initialState(),[10.5,10,1.2],{canTravelDirect:(a,b,limit)=>limit===1&&b[2]>=a[2]}).travelKind,'combed');
  assert.equal(planTravel(initialState(),[10.5,10,1],{canTravelDirect:()=>false}).travelKind,'hopped');
});
