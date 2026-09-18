import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rhino3dm from 'rhino3dm';
import { defaults } from '../print/plan.mjs';
import { generatePath } from '../print/generate.mjs';
import { PathBuilder } from '../path/builder.mjs';
import { composeResults, scheduleOperations } from '../path/compose.mjs';
import { initBundle, generateBundle, loadBundle, approve, deliver } from '../print/bundle.mjs';

const rhino=await rhino3dm();
const machine=JSON.parse(await readFile('machines/ultimaker-s5.json','utf8'));
const operation=(id,rank,after=[])=>({id,rank,layer:rank,layerId:'layer:'+rank,phase:'test',after,
  strokes:[{points:[[10,10,rank],[12,10,rank]],role:'test',speedMmS:10,beadAreaMm2:0.08}],
  travelPolicy:{clearanceFor:()=>rank+2,maxCombMm:0}});

test('unrelated skills weave by layer, in batches, and within a layer',()=>{
  const results=['outline','another-pattern'].map(id=>({id,operations:[operation(id+':1',1),operation(id+':2',2,[id+':1']),operation(id+':3',3,[id+':2'])]}));
  assert.deepEqual(scheduleOperations(results).map(op=>op.id),['outline:1','another-pattern:1','outline:2','another-pattern:2','outline:3','another-pattern:3']);
  assert.deepEqual(scheduleOperations(results,{batchLayers:2}).map(op=>op.id),['outline:1','outline:2','another-pattern:1','another-pattern:2','outline:3','another-pattern:3']);
  const within=[{operations:[operation('edge',1),operation('fill',1)]},{operations:[operation('insert',1)]}];
  assert.deepEqual(scheduleOperations(within,{order:['edge','insert','fill']}).map(op=>op.id),['edge','insert','fill']);
  assert.throws(()=>scheduleOperations(within,{dependencies:[{before:'missing',after:'edge'}]}),/Unknown/);
  assert.throws(()=>scheduleOperations(results,{order:['outline:2','outline:1']}),/cycle/);
  assert.throws(()=>scheduleOperations([{operations:[operation('same',1),operation('same',2)]}]),/Duplicate/);
});

test('composition connects moves with one retraction state and completes shared layers once',()=>{
  const plan=defaults();plan.process.minimumLayerSeconds=60;
  const builder=new PathBuilder({start:[0,0,20],process:plan.process,machine,generatorVersion:'test'});
  const done=[],finish=builder.finishLayer.bind(builder);
  builder.finishLayer=z=>{done.push(z);finish(z);};
  composeResults(builder,[{operations:[operation('a',1)]},{operations:[operation('b',1)]}]);
  assert.equal(done.length,1);
  assert.equal(builder.actions.filter(a=>a.kind==='dwell').length,1);
  assert.deepEqual(builder.actions.filter(a=>a.volumeMm3>0).map(a=>a.operation),['a','b']);
});

test('clearance uses geometry even when scheduling rank is unrelated to Z',()=>{
  const plan=defaults();plan.process.minimumLayerSeconds=0;
  const builder=new PathBuilder({start:[0,0,20],process:plan.process,machine,generatorVersion:'test'});
  const high=operation('earlier-high',5);high.rank=1;
  const low=operation('later-low',1,['earlier-high']);low.rank=2;
  low.travelPolicy.canTravelDirect=()=>true;
  composeResults(builder,[{operations:[high]},{operations:[low]}]);
  assert.ok(builder.actions.some(a=>a.operation==='later-low'&&!a.volumeMm3&&a.to[2]>=5+plan.process.liftMm));
});

test('ready skills weave by actual deposition height while prerequisites take precedence',()=>{
  const low=operation('low',1);low.rank=100;
  const high=operation('high',5);high.rank=0;
  const middle=operation('middle',3);middle.rank=-1;
  const results=[{operations:[high]},{operations:[low]},{operations:[middle]}];
  assert.deepEqual(scheduleOperations(results).map(op=>op.id),['low','middle','high']);
  low.after=[high.id];
  assert.deepEqual(scheduleOperations(results).map(op=>op.id),['middle','high','low']);
});

test('large dependency schedules preserve stable priority, including newly unblocked earlier work',()=>{
  // Independent, deliberately simple reference: repeatedly choose the first
  // eligible operation from a globally sorted priority list.
  const reference=(results,rules)=>{
    const all=results.flatMap(r=>r.operations),indices=new Map(all.map((op,i)=>[op.id,i]));
    const resultOf=new Map(results.flatMap((r,i)=>r.operations.map(op=>[op.id,i])));
    const z=op=>Math.max(...op.strokes.flatMap(s=>s.points.map(p=>p[2])));
    const heights=[...new Set(all.map(z))].sort((a,b)=>a-b);
    const after=new Map(all.map(op=>[op.id,new Set(op.after)]));
    for(const edge of rules.dependencies)after.get(edge.after).add(edge.before);
    for(let i=1;i<rules.order.length;i++)after.get(rules.order[i]).add(rules.order[i-1]);
    const pending=[...all].sort((a,b)=>Math.floor(heights.indexOf(z(a))/rules.batchLayers)-Math.floor(heights.indexOf(z(b))/rules.batchLayers)
      ||resultOf.get(a.id)-resultOf.get(b.id)||a.rank-b.rank||indices.get(a.id)-indices.get(b.id));
    const done=new Set(),out=[];
    while(pending.length){
      const i=pending.findIndex(op=>[...after.get(op.id)].every(id=>done.has(id)));
      assert.ok(i>=0);const [op]=pending.splice(i,1);done.add(op.id);out.push(op.id);
    }
    return out;
  };
  for(const batchLayers of [1,2,7,20]){
    const results=Array.from({length:4},()=>({operations:[]}));
    for(let i=0;i<120;i++){
      const op=operation('op'+i,(i*31)%13,i?[`op${Math.floor((i-1)/3)}`]:[]);
      op.rank=(i*17)%5;results[i%4].operations.push(op);
    }
    const rules={batchLayers,order:['op2','op20','op70'],dependencies:[{before:'op7',after:'op110'},{before:'op7',after:'op110'}]};
    assert.deepEqual(scheduleOperations(results,rules).map(op=>op.id),reference(results,rules));
  }
  const chain=Array.from({length:5000},(_,i)=>operation(String(i),i,i?[String(i-1)]:[]));
  assert.deepEqual(scheduleOperations([{operations:chain}]),chain);
  chain[0].after=['4999'];assert.throws(()=>scheduleOperations([{operations:chain}]),/cycle/);
});

function columns(batchLayers=1){
  const plan=defaults();
  plan.geometry={shape:'assembly',parts:[
    {id:'left',geometry:{shape:'box',runMm:6,widthMm:6,heightMm:1.6},xMm:0,yMm:0,zMm:0},
    {id:'right',geometry:{shape:'box',runMm:6,widthMm:6,heightMm:1.6},xMm:10,yMm:0,zMm:0},
    {id:'roof',geometry:{shape:'box',runMm:16,widthMm:6,heightMm:0.5},xMm:0,yMm:0,zMm:1.6}
  ]};
  plan.skills['full-fill'].parts=['left','right'];
  plan.skills['draped-skin'].part='roof';
  plan.skills['draped-skin'].normalMm=0.25;
  plan.process.minimumLayerSeconds=0;
  plan.composition.batchLayers=batchLayers;
  return plan;
}

test('two real fill instances weave below one spanning roof; roof dependencies cannot be overridden',()=>{
  for(const batch of [1,2]) {
    const plan=columns(batch),path=generatePath(plan,machine,rhino);
    const order=path.summary.composition.operationOrder;
    const walls=order.filter(id=>id.endsWith(':walls'));
    assert.deepEqual(walls.slice(0,4),batch===1?['left:0:walls','right:0:walls','left:1:walls','right:1:walls']:
      ['left:0:walls','left:1:walls','right:0:walls','right:1:walls']);
    const firstSkin=path.actions.findIndex(a=>a.volumeMm3>0&&a.phase==='draped-skin');
    assert.ok(firstSkin>0);
    assert.ok(path.actions.slice(firstSkin).every(a=>a.phase!=='planar'));
    let position=path.initialPosition,spansGap=false;
    const middle=plan.placement.xMm+8;
    for(const action of path.actions)if(action.kind==='move') {
      if(action.phase==='draped-skin'&&action.volumeMm3>0&&
        Math.min(position[0],action.to[0])<middle&&Math.max(position[0],action.to[0])>=middle)spansGap=true;
      position=action.to;
    }
    assert.ok(spansGap,'the roof spans the open gap, even when a straight stroke has no intermediate endpoint there');
    plan.composition.order=['draped-skin:0','left:0:walls'];
    assert.throws(()=>generatePath(plan,machine,rhino),/cycle/);
  }
});

test('a batched lower-column transition clears the already taller column',()=>{
  const plan=columns(2),path=generatePath(plan,machine,rhino);
  const transition=path.actions.filter(a=>a.operation==='right:0:walls'&&!a.volumeMm3);
  assert.ok(transition.some(a=>a.to[2]>=0.4+plan.process.liftMm));
});

test('woven geometry, plan and export use the shared approval and byte-identical delivery workflow',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'saam-woven-test-'));
  try {
    await initBundle(directory,columns(2));
    let state=await loadBundle(directory);
    assert.equal(state.geometry.features.length,18);
    await generateBundle(directory);
    state=await loadBundle(directory);
    assert.equal(state.programError,undefined);
    assert.ok(state.program.moves.some(move=>move.operation==='right:0:walls'));
    state=await approve(directory,{actor:'synthetic weaving test',revision:state.revision});
    assert.equal(await readFile(await deliver(directory),'utf8'),state.code);
  } finally {await rm(directory,{recursive:true,force:true});}
});
