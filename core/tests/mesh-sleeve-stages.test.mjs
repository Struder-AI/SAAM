import test from 'node:test';
import assert from 'node:assert/strict';
import {fitMeshSleeve} from '../geom/mesh-sleeve.mjs';
import {flutedVase} from './fixtures/mesh-sleeve.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';
import {fileURLToPath} from 'node:url';

test('sleeve preparation preserves source ownership, query reuse and live report accounting',()=>{
  const mesh=flutedVase();
  for(const p of mesh.vertices)Object.freeze(p);
  for(const t of mesh.triangles)Object.freeze(t);
  Object.freeze(mesh.vertices);Object.freeze(mesh.triangles);
  const before=JSON.stringify([mesh.vertices,mesh.triangles]),fit=fitMeshSleeve(mesh);
  assert.equal(fit.report.sourceSectionQueries,25);
  const source=fit.sourceSectionAt(7.123);
  assert.equal(fit.report.sourceSectionQueries,26);
  assert.equal(fit.sourceSectionAt(7.123),source);
  assert.equal(fit.report.sourceSectionQueries,26);
  const fitted=fit.sectionAt(7.123);
  assert.equal(fit.sectionAt(7.123),fitted);
  assert.equal(fit.report.sourceSectionQueries,26);
  assert.equal(JSON.stringify([mesh.vertices,mesh.triangles]),before);
});

test('sleeve entry graph connects sampled sections, fitted controls, patch and quality stages',async()=>{
  const file='core/geom/mesh-sleeve.mjs';
  const context=await loadFlow({repo:fileURLToPath(new URL('../../',import.meta.url)),files:[file]});
  const page=flowPacket(context,`${file}::fitMeshSleeve`);
  const id=name=>page.components.find(c=>c.label===name)?.index;
  const linked=(from,to,label)=>page.wires.some(w=>w.from===id(from)&&w.to===id(to)&&w.label===label);
  for(const [from,to,label] of [
    ['prepareSleeveSource','sampleSleeveSections','source.sourceSectionAt'],
    ['sampleSleeveSections','fitSleeveControls','samples'],
    ['fitSleeveControls','assembleSleevePatch','controlXY'],
    ['assembleSleevePatch','sleevePointQuery','patch'],
    ['sampleSleeveSections','measureSleeveFit','samples'],
    ['sleevePointQuery','measureSleeveFit','pointAt'],
    ['measureSleeveFit','prepareFittedSections','quality']
  ])assert.ok(linked(from,to,label),`${from} → ${to}: ${label}`);
});
