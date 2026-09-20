import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planPriming,preparePrimingFootprint,selectPrimingPath,emitPrimingPath} from '../path/prime.mjs';
import {primingFixtures} from './fixtures/priming-stages.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('priming stages accept frozen inputs and reuse completed footprint/path results',()=>{
  for(const name of ['default','support-extents','only-rear','motion-bounds','stationary','volumes','reverse-start']){
    const f=freeze(primingFixtures().find(f=>f.name===name)),before=structuredClone(f),p=f.state.process;
    const footprint=freeze(preparePrimingFootprint(f.geometry,f.results,p.lineWidthMm));
    assert.equal(footprint.hasDeposition,true);
    const settings=freeze({...f.state.machine.startup.primingStrokes,widthMm:p.lineWidthMm,zMm:p.firstLayerMm});
    const bed=f.state.motionBounds??f.state.machine.bounds;
    const points=freeze(selectPrimingPath(footprint,f.state.position,bed,settings));
    assert.deepEqual(selectPrimingPath(footprint,f.state.position,bed,settings),points);
    const emitted=freeze(emitPrimingPath(f.state,points));
    assert.deepEqual(emitPrimingPath(f.state,points),emitted);
    assert.deepEqual(planPriming(f.state,f.geometry,f.results),emitted);assert.deepEqual(f,before);
  }
});

test('unplaceable and empty priming retain failure/no-op boundaries before state transitions',()=>{
  for(const name of ['no-room','invalid-length','invalid-gap']){
    const f=freeze(primingFixtures().find(f=>f.name===name)),before=structuredClone(f);
    assert.throws(()=>planPriming(f.state,f.geometry,f.results),name==='no-room'?/No room/:/Invalid machine priming/);assert.deepEqual(f,before);
  }
  for(const name of ['empty','travel-only','no-settings']){
    const f=freeze(primingFixtures().find(f=>f.name===name)),result=planPriming(f.state,f.geometry,f.results);
    assert.equal(result.state,f.state);assert.deepEqual(result.actions,{chunks:[]});
  }
});

test('priming graph carries footprint into selection and selected points into emission',async()=>{
  const file='core/path/prime.mjs',source=await readFile(new URL('../path/prime.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source}),page=flowPacket(context,`${file}::planPriming`);
  const node=name=>page.components.find(c=>c.label===name)?.index;
  assert.ok(page.wires.some(w=>w.from===node('preparePrimingFootprint')&&w.to===node('selectPrimingPath')&&w.label==='footprint'));
  assert.ok(page.wires.some(w=>w.from===node('selectPrimingPath')&&w.to===node('emitPrimingPath')&&w.label==='points'));
});
