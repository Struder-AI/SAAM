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
  travelPolicy:{clearanceFor:()=>rank+2,maxCombMm:0},clearanceZ:rank+2});

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
  assert.ok(builder.actions.some(a=>a.operation==='later-low'&&!a.volumeMm3&&a.to[2]>=7));
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
    assert.ok(path.actions.some(a=>a.phase==='draped-skin'&&a.volumeMm3>0&&a.to[0]>plan.placement.xMm+6&&a.to[0]<plan.placement.xMm+10),'the roof spans the open gap');
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
    for(const stage of ['geometry','plan']) state=await approve(directory,{stage,actor:'synthetic weaving test',revision:state.revision});
    await generateBundle(directory);
    state=await loadBundle(directory);
    assert.equal(state.programError,undefined);
    assert.ok(state.program.moves.some(move=>move.operation==='right:0:walls'));
    state=await approve(directory,{stage:'toolpath',actor:'synthetic weaving test',revision:state.revision});
    assert.equal(await readFile(await deliver(directory),'utf8'),state.code);
  } finally {await rm(directory,{recursive:true,force:true});}
});
