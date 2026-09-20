import test from 'node:test';
import assert from 'node:assert/strict';
import {offsetSurfaceRegion,prepareSurfaceOffset,sweepSurfaceOffset,finishSurfaceOffset} from '../region/surface-offset.mjs';
import {rectangle,offsetPlane,offsetCylinder} from './fixtures/surface-offset.mjs';

const freeze=value=>{
  if(value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
};

// Freeze alone does not protect a Map's entries. Deny all mutations and whole-
// map enumeration, proving later phases neither edit nor copy earlier caches.
function readOnlySamples(samples){
  for(const frame of samples.values())freeze(frame);
  const denied=new Set(['set','delete','clear','entries','keys','values','forEach',Symbol.iterator]);
  return new Proxy(samples,{
    get(target,key){
      if(denied.has(key))return ()=>{throw Error('Earlier surface samples must only be queried by key');};
      const value=Reflect.get(target,key,target);
      return typeof value==='function'?value.bind(target):value;
    },
    set(){throw Error('Earlier surface samples are read-only');},
    defineProperty(){throw Error('Earlier surface samples are read-only');},
    deleteProperty(){throw Error('Earlier surface samples are read-only');}
  });
}
const snapshot=samples=>[...samples].map(([key,frame])=>[key,frame]);
const immutableStage=stage=>freeze({...stage,surfaceSamples:readOnlySamples(stage.surfaceSamples)});

test('constrained phases reuse read-only sample layers without mutating or copying prior caches',()=>{
  const patch=freeze(offsetPlane()),cp=patch.cp.slice(),source=freeze([rectangle(0,0,4,20)]);
  const options=freeze({constraintLoopsUv:[rectangle(0,0,20,20),rectangle(8,6,4,8).reverse()],maxStepMm:1});
  const first=prepareSurfaceOffset(patch,source,1,options),firstEntries=snapshot(first.surfaceSamples);
  assert.ok(first.surfaceSamples.size>0,'constraint simplification must populate preparation samples');
  const prepared=immutableStage(first),second=sweepSurfaceOffset(patch,prepared),secondEntries=snapshot(second.surfaceSamples);
  assert.ok(second.work.boundaryStops>0);assert.ok(second.bands.length>0);
  assert.equal(second.work.evaluations,second.surfaceSamples.size);
  for(const key of second.surfaceSamples.keys())assert.equal(first.surfaceSamples.has(key),false,'phase delta must contain only cache misses');
  const swept=immutableStage(second),result=finishSurfaceOffset(patch,prepared,swept);
  assert.deepEqual(result,offsetSurfaceRegion(patch,source,1,options));
  assert.deepEqual(finishSurfaceOffset(patch,prepared,swept),result,'completed stages can be reused');
  const again=sweepSurfaceOffset(patch,prepared);
  assert.deepEqual(again.bands,second.bands);assert.deepEqual(again.work,second.work);
  assert.deepEqual([...again.surfaceSamples.keys()],[...second.surfaceSamples.keys()]);
  assert.deepEqual(snapshot(first.surfaceSamples),firstEntries);
  assert.deepEqual(snapshot(second.surfaceSamples),secondEntries);
  assert.deepEqual(patch.cp,cp);
});

test('curved geodesic sweep keeps immutable geometry and reports integration separately from final projection',()=>{
  const patch=freeze(offsetCylinder()),source=freeze([rectangle(.25,6,.5,8)]),settings=freeze({toleranceMm:.005,maxStepMm:1});
  const prepared=immutableStage(prepareSurfaceOffset(patch,source,.4,settings));
  const rawSweep=sweepSurfaceOffset(patch,prepared),swept=immutableStage(rawSweep),before=JSON.stringify(swept.bands);
  const result=finishSurfaceOffset(patch,prepared,swept);
  assert.deepEqual(result,offsetSurfaceRegion(patch,source,.4,settings));
  assert.equal(result.report.integrationSteps,swept.work.integrationSteps);
  assert.equal(result.report.subdivisions,swept.work.subdivisions);
  assert.equal(result.report.bandTriangles,swept.bands.length);
  assert.ok(result.report.evaluations>=prepared.work.evaluations+swept.work.evaluations);
  assert.equal(JSON.stringify(swept.bands),before);
});

test('zero-offset projection and failed sweeps leave earlier phase records intact',()=>{
  const patch=freeze(offsetPlane()),source=freeze([rectangle(4,4,8,8)]);
  const prepared=immutableStage(prepareSurfaceOffset(patch,source,0)),swept=immutableStage(sweepSurfaceOffset(patch,prepared));
  assert.deepEqual(swept.bands,[]);assert.equal(swept.work.evaluations,0);
  const result=finishSurfaceOffset(patch,prepared,swept);
  assert.equal(result.report.evaluations,4);assert.equal(result.report.integrationSteps,0);
  const failed=immutableStage(prepareSurfaceOffset(patch,freeze([rectangle(0,0,20,20)]),.4));
  const before=JSON.stringify({source:failed.source,work:failed.work});
  assert.throws(()=>sweepSurfaceOffset(patch,failed),/patch boundary/);
  assert.equal(failed.surfaceSamples.size,0);
  assert.equal(JSON.stringify({source:failed.source,work:failed.work}),before);
});

test('repeated constrained growth accepts frozen preceding geometry without retaining a mutable prior phase',()=>{
  const patch=freeze(offsetPlane()),options=freeze({constraintLoopsUv:[rectangle(0,0,20,20),rectangle(8,6,4,8).reverse()],maxStepMm:1});
  let covered=freeze([rectangle(0,0,4,20)]);
  for(let step=0;step<6;step++){
    const before=JSON.stringify(covered),prepared=immutableStage(prepareSurfaceOffset(patch,covered,1,options));
    const swept=immutableStage(sweepSurfaceOffset(patch,prepared)),result=finishSurfaceOffset(patch,prepared,swept);
    assert.deepEqual(result,offsetSurfaceRegion(patch,covered,1,options));
    assert.equal(JSON.stringify(covered),before);
    covered=freeze(result.loopsUv);
  }
});
