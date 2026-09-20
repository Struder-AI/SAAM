import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {perimeterLoops,preparePerimeterContours,recoverCollapsedPerimeters} from '../region/perimeters.mjs';
import {perimeterFixtures} from './fixtures/perimeter-stages.mjs';
import {loopArea} from '../region/region2d.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('collapsed-wall recovery preserves frozen region/preparation and keeps central tracks separate',()=>{
  for(const name of ['ring-2-1','islands','cut-track']){
    const f=freeze(perimeterFixtures().find(f=>f.name===name)),before=structuredClone(f);
    const prepared=freeze(preparePerimeterContours(f.region,f.inset)),old=structuredClone(prepared);
    assert.equal(prepared.needsRecovery,true);
    const recovered=freeze(recoverCollapsedPerimeters(f.region,f.inset,prepared));
    assert.deepEqual(recoverCollapsedPerimeters(f.region,f.inset,prepared),recovered);
    assert.deepEqual(perimeterLoops(f.region,f.inset),[...recovered.loops,...recovered.centers]);
    assert.deepEqual(prepared,old);assert.deepEqual(f,before);
    if(name==='ring-2-1'){assert.equal(recovered.centers.length,1);assert.equal(recovered.loops.length,0);}
    if(name==='islands'){assert.equal(recovered.centers.length,1);assert.equal(recovered.loops.length,2);}
    if(name==='cut-track')assert.equal(recovered.centers.length,0);
    assert.ok(recovered.centers.every(c=>loopArea(c)>0));
  }
});

test('ordinary contours return directly and numeric errors leave source unchanged',()=>{
  for(const name of ['ring-2-0.2','empty','no-hole']){
    const f=perimeterFixtures().find(f=>f.name===name);freeze(f);
    const prepared=preparePerimeterContours(f.region,f.inset);
    assert.equal(prepared.needsRecovery,false);assert.deepEqual(perimeterLoops(f.region,f.inset),prepared.loops);
  }
  const f=freeze(perimeterFixtures().find(f=>f.name==='invalid-inset')),before=structuredClone(f);
  assert.throws(()=>preparePerimeterContours(f.region,f.inset),/Offset distance must be finite/);assert.deepEqual(f,before);
});

test('perimeter graph carries explicit preparation into recovery behind a decision',async()=>{
  const file='core/region/perimeters.mjs',source=await readFile(new URL('../region/perimeters.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source}),page=flowPacket(context,`${file}::perimeterLoops`);
  const node=name=>page.components.find(c=>c.label===name)?.index;
  assert.ok(page.wires.some(w=>w.from===node('preparePerimeterContours')&&w.to===node('recoverCollapsedPerimeters')&&w.label==='prepared'));
  assert.ok(page.gates.some(g=>g.text==='!prepared.needsRecovery'));
});
