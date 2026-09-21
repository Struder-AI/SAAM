import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {loadMachine,MACHINE_IDS} from '../machine/profile.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

function freeze(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}

test('presentation stages preserve caller-owned facts and descriptor across independent samples',async()=>{
  for(const id of MACHINE_IDS){
    const machine=freeze(loadMachine(id));
    const program=freeze({seconds:2,moves:[{from:[100,80,10],to:[110,90,20],startSeconds:0,durationSeconds:2}]});
    const setup=machine.defaultSetup,sourceIdentity=freeze({printId:'stages',revision:1,exportHash:'fixed'});
    const provider=await createMachinePresentation({machine,program,setup,sourceIdentity});
    freeze(provider.descriptor);
    const request=freeze({requestId:1,seconds:1}),first=await provider.sample(request);
    if(provider.descriptor.controls.length){
      const manual=first.controlValues.map((v,i)=>v+(i===0?1:0));
      await provider.sample(freeze({requestId:2,seconds:1,manual,jog:{from:first.controlValues,axis:0}}));
    }
    await provider.sample({requestId:3,seconds:0});
    assert.deepEqual(await provider.sample(request),first,id);
    const other=await createMachinePresentation({machine,program,setup,sourceIdentity});
    provider.dispose();
    await assert.rejects(provider.sample(request),/disposed/);
    assert.deepEqual(await other.sample(request),first,id+' independent lifecycle');
    other.dispose();
  }
});

test('presentation preserves unsupported, abort and invalid-request boundaries',async()=>{
  assert.equal(await createMachinePresentation({machine:{id:'unknown'},program:{}}),null);
  const machine=loadMachine(),program={seconds:0,moves:[]};
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(createMachinePresentation({machine,program,signal:aborted.signal}),{name:'AbortError'});
  const provider=await createMachinePresentation({machine,program});
  await assert.rejects(provider.sample({seconds:0},{signal:aborted.signal}),{name:'AbortError'});
  await assert.rejects(provider.sample({seconds:1}),/outside source duration/);
  await assert.rejects(provider.sample({seconds:0,manual:[1]}),/Invalid manual/);
  const empty=await provider.sample({seconds:0});
  assert.equal(empty.status,'unavailable');assert.equal(empty.diagnostics[0].code,'no-motion');
  provider.dispose();
});

test('generated setup flow connects mechanism and controls to the returned descriptor',async()=>{
  const file='core/machine/presentation.mjs',source=await readFile(new URL('../machine/presentation.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const page=flowPacket(context,`${file}::createMachinePresentation`);
  const index=name=>page.components.find(c=>c.label===name)?.index;
  const mechanism=index('buildMachineMechanism'),controls=index('machineControlLayout'),descriptor=index('buildMachineDescriptor');
  assert.ok(mechanism&&controls&&descriptor);
  for(const [from,to,label] of [[mechanism,controls,'mechanism'],[mechanism,descriptor,'mechanism'],[controls,descriptor,'layout']])
    assert.ok(page.wires.some(w=>w.from===from&&w.to===to&&w.label===label),label);
  assert.ok(page.wires.some(w=>w.from===descriptor&&w.kind==='return'&&w.label==='descriptor'));
  const sample=flowPacket(context,`${file}::createMachinePresentation::sample`);
  assert.ok(sample.components.some(c=>c.label==='sampleMachinePresentation'));
  assert.ok(!page.components.some(c=>['component','line','link','box','joint'].includes(c.label)));
  const sampling=flowPacket(context,`${file}::sampleMachinePresentation`),labels=sampling.components.map(c=>c.label);
  for(const callback of ['solveGantryPose','solveAlignedArmPose','solveUnavailableArmPose','gantrySourcePose','robotSourcePose'])
    assert.ok(labels.some(label=>label.endsWith('::'+callback)),callback);
  assert.ok(!sampling.unresolved.some(({call})=>['solve','sourcePose','probeMargins'].includes(call)));
});
