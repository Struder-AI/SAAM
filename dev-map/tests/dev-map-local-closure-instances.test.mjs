import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {invocationInstances} from '../lib/instances.mjs';

const file='core/local-closure-instances.mjs';
const shown=async body=>invocationInstances(flowPacket(
  await loadFlow({repo:'',files:[file],readSource:()=>`export function main(value){${body}}`}),
  `${file}::main`
));
const local=(page,name)=>page.components.filter(component=>component.label===`main::${name}`);
const untraced=page=>[
  ...page.inputs.filter(port=>port.port.startsWith('untraced:')),
  ...page.outputs.filter(port=>port.port.startsWith('untraced:'))
];

test('one executed local closure keeps its callable reference without a fabricated return',async()=>{
  const page=await shown('const held=value;const run=input=>input+held;run(value);return {run};');
  const nodes=local(page,'run'),instance=nodes.find(node=>node.id),reference=nodes.find(node=>node.reference==='callable');
  assert.ok(instance);assert.ok(reference);
  assert.deepEqual(untraced(page),[]);
  assert.ok(page.wires.some(wire=>wire.from==='in1'&&wire.to===instance.id&&wire.toPort==='arg1'));
  assert.ok(page.wires.some(wire=>wire.to===reference.index&&wire.kind==='capture'&&wire.label==='held'));
  assert.ok(page.wires.some(wire=>wire.from===reference.index&&wire.fromPort==='callable'&&wire.to==='out1'));
  assert.equal(page.outputs.length,1);
  assert.ok(!page.uncertainty?.some(item=>item.kind==='invocation-origin'));
});

test('recursive local closure resolves its sole outer invocation and retains recursion',async()=>{
  const page=await shown('const split=input=>input>0?split(input-1):input;return split(value);');
  const [instance]=local(page,'split').filter(node=>node.id);
  assert.ok(instance);
  assert.deepEqual(untraced(page),[]);
  assert.ok(page.wires.some(wire=>wire.from==='in1'&&wire.to===instance.id&&wire.toPort==='arg1'));
  assert.ok(page.wires.some(wire=>wire.from===instance.id&&wire.to==='out1'));
  assert.equal(page.outputs.length,1);
});

test('multiple invocation sites without occurrence evidence remain explicitly untraced',()=>{
  const page=invocationInstances({invocationSites:true,components:[{index:'c',path:'x::c',label:'c',closure:true}],
    callBindings:[
      {callee:'x::c',file:'x',start:1,end:2,line:1,column:1},
      {callee:'x::c',file:'x',start:3,end:4,line:1,column:3}
    ],inputs:[],outputs:[],wires:[{from:'in1',to:'c',kind:'data',toPort:'arg1'}]});
  assert.ok(page.outputs.some(port=>port.port==='untraced:to:c'));
  assert.ok(page.uncertainty.some(item=>item.kind==='invocation-origin'));
});
