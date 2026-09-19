import test from 'node:test';
import assert from 'node:assert/strict';
import {addPrimeResult,summarizeGeneratedPath} from '../print/generate.mjs';
import {prepareRegionRecords,prepareRegionDependencies} from '../print/regions.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};

test('priming adds prerequisite operations without modifying the earlier result batch',()=>{
  const machine=loadMachine(),plan=defaults(machine);
  plan.process.primeLine={startMm:[10,10],endMm:[20,10],zMm:.2,widthMm:.4,heightMm:.2,speedMmS:10};
  const batch=freeze({results:[{id:'body',operations:[{id:'body:0',after:['foundation','prime-line:0'],strokes:[]}]}],summary:{shape:'box'},survey:null});
  const before=JSON.stringify(batch),primed=addPrimeResult(plan,machine,batch);
  assert.equal(JSON.stringify(batch),before);
  assert.equal(primed.results[0].id,'prime-line');
  assert.deepEqual(primed.results[1].operations[0].after,['foundation','prime-line:0']);
  assert.notEqual(primed.results[1].operations[0],batch.results[0].operations[0]);
  assert.equal(primed.summary.primeLine.lengthMm,10);
  assert.equal(primed.summary.primeLine.volumeMm3,.8);
  plan.process.primeLine=null;
  assert.equal(addPrimeResult(plan,machine,batch).results,batch.results);
});

test('summary creation preserves the model result and declared survey evidence',()=>{
  const summary=freeze({shape:'box'}),placed=freeze({bounds:{min:[0,0,0],max:[2,2,2]}});
  const survey=freeze({declaredLimitDeg:20,limitDeg:30,experimentalOverride:true,maxSlopeDeg:22.34567,steepFraction:.123456});
  const result=summarizeGeneratedPath(placed,survey,summary);
  assert.deepEqual(summary,{shape:'box'});
  assert.deepEqual(result.nonplanarLimit,{machineMaxAngleDeg:20,effectiveMaxAngleDeg:30,experimentalOverride:true,surfaceMaxSlopeDeg:22.346,excludedAreaPercent:12.35});
  assert.equal(result.physicalValidation,'not performed');
});

test('regional preparation produces independent dependency records and keeps its input plan intact',()=>{
  const machine=loadMachine(),plan=defaults(machine),shell=freeze({bounds:{min:[0,0,0],max:[4,4,1]}});
  plan.composition.regions=[
    {id:'base',part:'body',zStartMm:0,zEndMm:.4,lowerSurfaceFrom:null,skills:{'full-fill':{mode:'body'}}},
    {id:'top',part:'body',zStartMm:.4,zEndMm:1,lowerSurfaceFrom:'base',skills:{'full-fill':{mode:'body'}}}
  ];
  freeze(plan);const before=JSON.stringify(plan),prepared=prepareRegionRecords(plan,shell,null);
  for(const record of prepared) {record.after.add=()=>{throw Error('Previous-stage dependency mutation');};Object.freeze(record);}
  const linked=prepareRegionDependencies(prepared,machine);
  assert.equal(JSON.stringify(plan),before);
  assert.equal(prepared[1].after.size,0);
  assert.deepEqual([...linked[1].after],['base']);
  assert.notEqual(linked[1],prepared[1]);
  assert.equal(linked[1].plan.composition.regions.length,0);
  assert.equal(linked[1].plan.skills['draped-skin'].enabled,false);
});
