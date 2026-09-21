import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInitialPlan,resolveMachinePlan,resolvePlanPatch} from '../print/resolve-plan.mjs';

const defaults=machine=>({geometry:{shape:'box',width:2,height:2},setup:{tool:machine.tool,materialGuid:'default',startupVerified:true,firmwareVersion:''},
  process:{speed:machine.defaultProcess.speed,flow:machine.defaultProcess.flow},output:machine.output,skill:{enabled:false}});
const fit=(plan,machine)=>{plan.process.flow=machine.fit;};

test('one resolver applies defaults, remembered setup and fit in declared precedence',()=>{
  const machine={tool:1,output:'machine-output',fit:7,defaultProcess:{speed:40,flow:4}};
  const plan=resolveInitialPlan(machine,{defaults,rememberedSetup:{tool:2,materialGuid:'remembered'},fit});
  assert.deepEqual(plan.setup,{tool:2,materialGuid:'remembered',startupVerified:true,firmwareVersion:''});
  assert.deepEqual(plan.process,{speed:40,flow:7});assert.equal(plan.output,'machine-output');
});

test('machine resolution preserves user facts and replaces only machine-owned defaults',()=>{
  const oldMachine={tool:0,output:'old',fit:4,defaultProcess:{speed:30}},nextMachine={tool:1,output:'next',fit:8,defaultProcess:{speed:50}};
  const previous={...defaults(oldMachine),geometry:{shape:'box',width:9,height:5},process:{speed:17,flow:3},skill:{enabled:true}};
  const next=resolveMachinePlan(previous,oldMachine,nextMachine,{defaults,rememberedSetup:{tool:3},fit});
  assert.deepEqual(next.geometry,previous.geometry);assert.deepEqual(next.skill,previous.skill);
  assert.deepEqual(next.setup,{tool:3,materialGuid:'default',startupVerified:true,firmwareVersion:''});
  assert.deepEqual(next.process,{speed:50,flow:8});assert.equal(next.output,'next');assert.deepEqual(previous.process,{speed:17,flow:3});
});

test('interactive overrides use the same strict patch resolver',()=>{
  const previous={geometry:{shape:'box',width:3,height:2},setup:{firmwareVersion:'v1',startupVerified:true}};
  const next=resolvePlanPatch(previous,{geometry:{shape:'tube',height:8},setup:{firmwareVersion:'v2'}},
    {geometryTemplate:shape=>({shape,width:2,height:2})});
  assert.deepEqual(next.geometry,{shape:'tube',width:3,height:8});assert.equal(next.setup.startupVerified,false);
  assert.throws(()=>resolvePlanPatch(previous,{geometry:{typo:1}},{geometryTemplate:()=>({})}),/Unknown setting/);
});
