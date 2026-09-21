import test from 'node:test';
import assert from 'node:assert/strict';
import {invocationInstances} from '../lib/instances.mjs';
import {compactPage} from '../lib/agent-view.mjs';

const ambiguous=()=>({
  index:'1.1.1',path:'core/example.mjs::main',file:'core/example.mjs',kind:'function',destination:'graph',
  invocationSites:true,
  components:[{index:'1.1.2',path:'core/example.mjs::stage',file:'core/example.mjs',label:'stage',closure:true,line:2,endLine:2}],
  callBindings:[
    {callee:'core/example.mjs::stage',file:'core/example.mjs',start:10,end:17,line:3,column:1},
    {callee:'core/example.mjs::stage',file:'core/example.mjs',start:20,end:27,line:4,column:1}],
  inputs:[],outputs:[],calledFrom:[],callerWires:[],gates:[],requires:[],formulas:[],operators:[],
  wires:[
    {from:'1.1.2',fromPort:'result',to:'out1',kind:'return'},
    {from:'in1',to:'1.1.2',toPort:'arg1',kind:'data'}]
});

test('ambiguous invocation endpoints name unknown producers and consumers without fabricated boundary roles',()=>{
  const page=invocationInstances(ambiguous()),producer=page.inputs.find(p=>p.port==='untraced:from:1.1.2'),
    consumer=page.outputs.find(p=>p.port==='untraced:to:1.1.2');
  assert.deepEqual(producer,{port:'untraced:from:1.1.2',name:'unknown invocation producer · stage',index:'1.1.2',
    unknown:true,role:'unknown-invocation-producer',side:'input'});
  assert.deepEqual(consumer,{port:'untraced:to:1.1.2',name:'unknown invocation consumer · stage',index:'1.1.2',
    unknown:true,role:'unknown-invocation-consumer',side:'output'});
  assert.ok(![producer,consumer].some(p=>p.role==='input'||p.role==='return'));
  assert.ok(page.wires.some(w=>w.from===producer.port&&w.to==='out1'));
  assert.ok(page.wires.some(w=>w.from==='in1'&&w.to===consumer.port));
  assert.deepEqual(page.uncertainty.filter(u=>u.kind==='invocation-origin').map(u=>u.port).sort(),
    [producer.port,consumer.port].sort());
});

test('compact CLI presentation preserves unknown invocation semantics and canonical navigation',()=>{
  const compact=compactPage(ambiguous()),ports=[...compact.inputs,...compact.outputs].filter(p=>p.port.startsWith('untraced:'));
  assert.deepEqual(ports.map(p=>[p.role,p.index,p.unknown]),[
    ['unknown-invocation-producer','1.1.2',true],['unknown-invocation-consumer','1.1.2',true]]);
  assert.ok(ports.every(p=>p.name.startsWith('unknown invocation ')));
  assert.equal(compact.wires.length,2);
});
