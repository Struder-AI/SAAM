import test from 'node:test';
import assert from 'node:assert/strict';
import {applyResultDependencies,preparePathGeometry,generateModelResults,addComplementaryResults} from '../print/generate.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {rhino} from '../print/geometry.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
import {wavyCladdingPlan} from './fixtures/wavy-cladding.mjs';
import {rimmingResults} from '../../skills/rimming-planar/scripts/rimming.mjs';
import {plasticWeldResult} from '../../skills/plastic-weld/scripts/weld.mjs';

const freeze=value=>{
  if(value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
};

test('dependency deltas preserve ordered appends and unions without changing earlier records',()=>{
  const results=freeze([{id:'body',report:{count:2},finishedSurfaces:[{shell:{name:'same shell'}}],operations:[
    {id:'changed',after:['base','base'],strokes:[],travelPolicy:{clearanceFor:()=>1}},
    {id:'untouched',after:[],strokes:[]}
  ]}]);
  const delta=freeze([
    {operationId:'changed',mode:'append',after:['rim','rim']},
    {operationId:'changed',mode:'union',after:['weld','base']},
    {operationId:'changed',mode:'append',after:['weld']}
  ]);
  const linked=applyResultDependencies(results,delta);
  assert.deepEqual(linked[0].operations[0].after,['base','rim','weld','weld']);
  assert.deepEqual(results[0].operations[0].after,['base','base']);
  assert.equal(linked[0].operations[1],results[0].operations[1]);
  for(const key of ['strokes','travelPolicy'])assert.equal(linked[0].operations[0][key],results[0].operations[0][key]);
  for(const key of ['report','finishedSurfaces'])assert.equal(linked[0][key],results[0][key]);
  assert.equal(applyResultDependencies(results,[]),results);
  assert.deepEqual(applyResultDependencies(results,delta),linked);
});

test('support and weld stages return completed batches without modifying frozen earlier operations',async()=>{
  const machine=loadMachine(),r=await rhino();
  for(const kind of ['support','weld']){
    const plan=defaults(machine);plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
    if(kind==='support'){
      plan.geometry={shape:'assembly',parts:[{id:'post',geometry:boxMesh(5,8,3),xMm:0,yMm:0,zMm:0},{id:'ledge',geometry:boxMesh(8,8,1),xMm:5,yMm:0,zMm:3}]};
      Object.assign(plan.skills.supports,{enabled:true,assignments:[{id:'ledge',style:'standard',reason:'Assigned fixture',contactZMm:3,footprint:[[[7,1],[12,1],[12,7],[7,7]]],treeNodes:[]}]});
    }else{
      plan.geometry={shape:'box',runMm:20,widthMm:16,heightMm:6};plan.placement={xMm:140,yMm:100};
      Object.assign(plan.skills['plastic-weld'],{enabled:true,sites:[{id:'anchor',part:null,xMm:7,yMm:8,zBottomMm:.8,zTopMm:4.8}]});
    }
    const prepared=preparePathGeometry(plan,machine,r),batch=freeze(generateModelResults(plan,machine,r,prepared)),before=JSON.stringify(batch);
    const output=addComplementaryResults(plan,machine,prepared,batch);
    assert.equal(JSON.stringify(batch),before);
    assert.notEqual(output.summary,batch.summary);
    assert.ok(output.results.some(result=>result.id.startsWith(kind==='support'?'supports':'plastic-weld')));
    const original=batch.results.flatMap(result=>result.operations),updated=output.results.flatMap(result=>result.operations);
    assert.ok(original.some(op=>updated.find(next=>next.id===op.id).after.length>op.after.length));
    for(const prior of batch.results){
      const next=output.results.find(result=>result.id===prior.id);
      assert.equal(next.finishedSurfaces,prior.finishedSurfaces);
      assert.equal(next.report,prior.report);
    }
    assert.equal(JSON.stringify(addComplementaryResults(plan,machine,prepared,batch)),JSON.stringify(output));
  }
});

test('finished cladding retains its producer shell and immutable finished-boundary identity',async()=>{
  const machine=loadMachine('denso-vp6242-rc8'),plan=wavyCladdingPlan({heightMm:12,columns:24,rows:9});plan.skills['pipe-cladding'].shells=2;
  const prepared=preparePathGeometry(plan,machine,await rhino()),batch=freeze(generateModelResults(plan,machine,null,prepared)),before=JSON.stringify(batch);
  const boundary=batch.results[0].finishedSurfaces[0];assert.equal(boundary.shell,prepared.placed);
  const output=addComplementaryResults(plan,machine,prepared,batch);
  assert.equal(JSON.stringify(batch),before);assert.equal(output.results[0],batch.results[0]);
  assert.equal(output.results[0].finishedSurfaces[0],boundary);
  assert.deepEqual(output.summary.pipeCladding.substrate.sourceOperationIds,['vase-wall:wall']);
  assert.equal(output.survey,batch.survey);
});

test('a later invalid rim does not leave prerequisite edits on earlier input operations',()=>{
  const plan=defaults(),surface={id:'valid',reason:'Fixture',baseEdge:'bed',basePart:null,supportedEdge:'top',supportedPart:null,outwardSide:1,degreeU:1,degreeV:1,controlPoints:[[[0,0,0],[0,0,1]],[[4,0,0],[4,0,1]]]};
  Object.assign(plan.skills['rimming-planar'],{enabled:true,surfaces:[surface,{...surface,id:'invalid',baseEdge:'edge',basePart:'missing'}]});
  const modelResults=freeze([{operations:[{id:'body',after:[],strokes:[{points:[[0,0,1],[1,0,1]]}]}]}]);
  assert.throws(()=>rimmingResults({plan,modelResults}),/earlier model operations/);
  assert.deepEqual(modelResults[0].operations[0].after,[]);
  assert.deepEqual(plasticWeldResult({plan,sites:[],modelResults}),{result:null,dependencyChanges:[]});
});
