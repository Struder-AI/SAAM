import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {applyPlanPatch,editedPlanReview} from '../print/workflow.mjs';
import {editFixture} from './workflow-edit-fixture.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
async function fixture(t){const f=await editFixture();t.after(f.cleanup);return f;}

test('patch and review transitions preserve frozen prior records and locked replacement semantics',()=>{
  const previous=freeze({geometry:{shape:'box',width:3,old:1},setup:{firmwareVersion:'v1',startupVerified:true},
    process:{primeLine:{start:[0,0]},pattern:{motif:'grid',density:1}},skills:{surface:null},optional:null});
  const patch=freeze({geometry:{shape:'tube',height:4},setup:{firmwareVersion:'v2'},
    process:{primeLine:{passes:[{from:[1,2]}]},pattern:{paths:[[0,1]]}},skills:{surface:{kind:'face',face:2}},optional:{value:1}});
  const plan=applyPlanPatch(previous,patch,shape=>({shape,width:2,height:2}));
  assert.deepEqual(plan.geometry,{shape:'tube',width:3,height:4});
  assert.deepEqual(plan.process,{primeLine:{passes:[{from:[1,2]}]},pattern:{paths:[[0,1]]}});
  assert.equal(plan.setup.startupVerified,false);assert.equal(previous.setup.startupVerified,true);
  assert.notEqual(plan.process.primeLine,patch.process.primeLine);
  assert.equal(applyPlanPatch(previous,{setup:{firmwareVersion:'v2',startupVerified:true}}).setup.startupVerified,true);
  const review=freeze({approvals:{toolpath:{hash:'old'}},generation:{id:'old'},history:[{event:'reviewed'}],extra:1});
  const updated=editedPlanReview(review,'old-plan',true,'fixed-time');
  assert.deepEqual(updated,{approvals:{},generation:null,history:[{event:'reviewed'},
    {event:'plan-edited',time:'fixed-time',previousPlanHash:'old-plan',geometryChanged:true,invalidated:['toolpath']}],extra:1});
  assert.equal(review.history.length,1);assert.equal(review.generation.id,'old');
  assert.throws(()=>applyPlanPatch(previous,{geometry:{unknown:1}}),/Unknown setting: unknown/);
});

test('frozen submitted plans and patches update without modifying caller state; no-op preserves review',async t=>{
  const f=await fixture(t),before=await f.read('review.json');
  const noop=await f.api.updatePlan(f.directory,freeze(f.state.plan),f.state.revision);
  assert.equal(noop.revision,f.state.revision);assert.equal(await f.read('review.json'),before);
  const candidate=structuredClone(f.state.plan);candidate.process.planarSpeedMmS=17;freeze(candidate);
  const updated=await f.api.updatePlan(f.directory,candidate,f.state.revision);
  assert.equal(updated.plan.process.planarSpeedMmS,17);assert.equal(f.state.review.history.length,1);
  assert.equal(updated.review.history.length,2);assert.deepEqual(updated.review.approvals,{});
  const patch=freeze({geometry:{height:5}});
  const shaped=await f.api.adjustBundle(f.directory,patch,{expectedRevision:updated.revision});
  assert.equal(shaped.geometry.parameters.height,5);assert.equal(shaped.review.history.at(-1).geometryChanged,true);
});

test('stale, invalid and unbuildable changes leave persisted plan and review untouched',async t=>{
  const f=await fixture(t),plan=await f.read('plan.json'),review=await f.read('review.json');
  await assert.rejects(f.api.adjustBundle(f.directory,{unknown:1},{expectedRevision:'stale'}),/review is stale/);
  assert.deepEqual(f.events,[]);
  await assert.rejects(f.api.adjustBundle(f.directory,{process:{planarSpeedMmS:0}}),/invalid speed/);
  f.failGeometry=true;
  await assert.rejects(f.api.adjustBundle(f.directory,{geometry:{height:9}}),/geometry failed/);
  assert.equal(await f.read('plan.json'),plan);assert.equal(await f.read('review.json'),review);
});

test('geometry write failure happens after plan commit and before review save; reload repairs it',async t=>{
  // Blocking the descriptor lets initial reads succeed, but fails the second geometry write.
  let blocked=false;
  // Adapter callbacks are captured at construction: use a separate fixture with an intercepted creator.
  const {createBundleWorkflow}=await import('../print/workflow.mjs');
  const g=await editFixture(adapter=>createBundleWorkflow({...adapter,async createGeometry(parameters){
    const result=await adapter.createGeometry(parameters);
    if(blocked){await rm(join(g.directory,'geometry/model.json'));await mkdir(join(g.directory,'geometry/model.json'));}
    return result;
  }}));t.after(g.cleanup);
  const before=await g.read('review.json'),original=await g.read('geometry/model.json');blocked=true;
  await assert.rejects(g.api.adjustBundle(g.directory,{geometry:{height:9}}));
  assert.equal(JSON.parse(await g.read('plan.json')).geometry.height,9);
  assert.equal(await g.read('review.json'),before);
  assert.equal(JSON.parse(await g.read('geometry/model.mesh.json')).height,9);
  blocked=false;await rm(join(g.directory,'geometry/model.json'),{recursive:true});
  await writeFile(join(g.directory,'geometry/model.json'),original);
  assert.equal((await g.api.loadBundle(g.directory,{program:false})).geometry.parameters.height,9);
});

test('edit graph connects patch, validated plan and new review to persistence',async()=>{
  const file='core/print/workflow.mjs',source=await readFile(new URL('../print/workflow.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const adjusted=flowPacket(context,`${file}::createBundleWorkflow::adjustBundle`);
  const updated=flowPacket(context,`${file}::createBundleWorkflow::updatePlan`);
  const component=(page,name)=>page.components.find(c=>c.path===`${file}::${name}`||c.label===name||c.label===`createBundleWorkflow::${name}`)?.index;
  assert.ok(adjusted.wires.some(w=>w.from===component(adjusted,'applyPlanPatch')&&w.to===component(adjusted,'updatePlan')&&w.label==='plan'));
  const validate=component(updated,'validatePlanUpdate'),review=component(updated,'editedPlanReview'),persist=component(updated,'persistPlanUpdate');
  assert.ok(validate&&review&&persist);
  assert.ok(updated.wires.some(w=>w.from===validate&&w.to===persist&&w.label==='change.plan'));
  assert.ok(updated.wires.some(w=>w.from===review&&w.to===persist&&w.label==='review'));
});
