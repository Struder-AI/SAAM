import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
import {composePages} from '../../scripts/dev-map/composition.mjs';

const file='core/operators.mjs',path=`${file}::main`;
const helpers=`export const left=x=>({...x,side:1});
export const right=x=>({...x,side:2});
export const step=(state,item)=>({state:{...state,item},actions:[item]});
export const after=x=>x;
export const distance=(x,y)=>x.length+y.length;
`;
const packet=async body=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>helpers+body}),path);
const at=(p,label)=>p.components.find(c=>c.label===label)?.index;

test('conditional values expose condition, alternatives and selected output',async()=>{
  const p=await packet('export function main(flag,x){const result=flag?left(x):right(x);return after(result);}');
  const op=p.operators.find(o=>o.kind==='choice');
  assert.equal(op.test,'flag');assert.equal(op.file,file);assert.ok(op.line>0);
  assert.deepEqual(op.alternatives.map(a=>a.port),['true','false']);
  for(const [from,port] of [['in1','control'],[at(p,'left'),'true'],[at(p,'right'),'false']])
    assert.ok(p.wires.some(w=>w.from===from&&w.to===op.id&&w.toPort===port));
  assert.ok(p.wires.some(w=>w.from===op.id&&w.fromPort==='selected'&&w.to===at(p,'after')));
  assert.ok(!p.wires.some(w=>w.from===at(p,'left')&&w.to===at(p,'right')));
});

test('nested conditional alternatives keep distinct selected values and literal arms',async()=>{
  const p=await packet('export function main(flag,inner,x){return flag?(inner?left(x):right(x)):null;}');
  assert.equal(p.operators.length,2);
  const inside=p.operators.find(o=>o.test==='inner'),outside=p.operators.find(o=>o.test==='flag');
  assert.ok(p.wires.some(w=>w.from===inside.id&&w.to===outside.id&&w.toPort==='true'));
  assert.deepEqual(outside.alternatives.find(a=>a.port==='false'),{port:'false',expression:'null',constant:true});
  assert.ok(p.wires.some(w=>w.from===outside.id&&w.to==='out1'&&w.fromPort==='selected'));
});

test('iteration state has initial/current/next/final ports without asserting runtime call order',async()=>{
  const p=await packet('export function main(initial,items){let state=initial;for(const item of items){const next=step(state,item);state=next.state;}return state;}');
  const op=p.operators.find(o=>o.kind==='iteration');
  assert.equal(op.binding,'state');assert.equal(op.minIterations,0);assert.equal(op.test,'of items');
  for(const expected of [{from:'in1',to:op.id,toPort:'initial'},
    {from:op.id,to:at(p,'step'),fromPort:'current'},
    {from:at(p,'step'),to:op.id,toPort:'next',label:'state'},
    {from:op.id,to:'out1',fromPort:'final'}])
    assert.ok(p.wires.some(w=>Object.entries(expected).every(([k,v])=>w[k]===v)),JSON.stringify(expected));
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===op.id&&w.toPort==='iterable'));
  assert.ok(p.wires.some(w=>w.from===op.id&&w.fromPort==='item'&&w.to===at(p,'step')&&w.label==='item'));
  assert.ok(!p.wires.some(w=>w.from==='in2'&&w.to===at(p,'step')),'collection is not passed as one item');
  assert.ok(!p.uncertainty?.some(u=>u.kind==='loop-data-flow'&&u.binding==='state'));
  assert.ok(!p.wires.some(w=>w.provenance==='state-thread'));
});

test('unsupported loop transfer or unknown next values never gain a certified feedback edge',async()=>{
  for(const body of [
    'for(const item of items){if(item.stop)break;state=step(state,item).state;}',
    'for(const item of items){if(item.skip)continue;state=step(state,item).state;}',
    'for(const item of items){state=unknown(state,item);}',
    'for(const item of items){for(const child of item.children)state=step(state,child).state;}',
  ]) {
    const p=await packet(`export function main(initial,items){let state=initial;${body}return after(state);}`);
    assert.ok(p.uncertainty?.some(u=>u.kind==='loop-data-flow'&&u.binding==='state'),body);
    assert.ok(!p.wires.some(w=>w.toPort==='next'),body);
    assert.ok(!p.wires.some(w=>w.to===at(p,'after')&&w.fromPort==='final'),body);
  }
});

test('unknown conditional targets remain uncertain rather than inventing an alternative origin',async()=>{
  const p=await packet('export function main(flag,x){const value=flag?left(x):unknown(x);return after(value);}');
  assert.ok(!p.operators?.length);assert.ok(p.uncertainty.some(u=>u.kind==='branch-result'));
  assert.ok(!p.wires.some(w=>w.to===at(p,'after')));
});

test('member payloads keep state/actions names and arithmetic branch dependencies',async()=>{
  const p=await packet('export function main(flag,x,y){const composed=step(x,y);after(composed.state);after(composed.actions);const volume=flag?x.volume:distance(x,y)*x.area;return after(volume);}');
  const named=p.wires.filter(w=>w.from===at(p,'step')&&w.to===at(p,'after')).map(w=>w.label);
  assert.ok(named.includes('composed.state'));assert.ok(named.includes('composed.actions'));
  const choice=p.operators.find(o=>o.kind==='choice');
  assert.ok(choice.alternatives.find(a=>a.port==='false').expression.includes('distance(x,y)*x.area'));
  assert.ok(p.wires.some(w=>w.from===at(p,'distance')&&w.to===choice.id&&w.toPort==='false'));
});

test('group contraction retains operators on the shared parent and balances their crossing wires',async()=>{
  const p=await packet('export function main(flag,x){const value=flag?left(x):right(x);return after(value);}');
  const composed=composePages(new Map([[path,p]]),{schema:1,flows:[{path,groups:[{id:'alternatives',members:[`${file}::left`,`${file}::right`]}]}]},{});
  const parent=composed.pages.get(path),child=[...composed.groupPages.values()][0],op=p.operators[0];
  assert.deepEqual(parent.operators,p.operators);
  assert.equal(parent.wires.filter(w=>w.to===op.id&&w.from===child.index).length,2);
  for(const boundary of child.boundary)assert.ok(parent.wires.some(w=>w.edgeId===boundary.edgeId));
  const endpoints=new Set([...parent.components.map(c=>c.index),...parent.operators.map(o=>o.id),...parent.inputs.map(p=>p.port),...parent.outputs.map(p=>p.port)]);
  assert.ok(parent.wires.every(w=>endpoints.has(w.from)&&endpoints.has(w.to)));
});

test('unused local bookkeeping does not become a synthetic stage',async()=>{
  const p=await packet('export function main(flag,x){let unused=x;if(flag)unused=3;return after(x);}');
  assert.ok(!p.operators?.length);
  assert.ok(p.wires.some(w=>w.from==='in2'&&w.to===at(p,'after')));
});

test('do-while control reads the next value and records its mandatory first iteration',async()=>{
  const p=await packet('export function main(initial,item){let state=initial;do{state=step(state,item).state;}while(state.more);return state;}');
  const op=p.operators.find(o=>o.kind==='iteration');
  assert.equal(op.minIterations,1);
  assert.ok(p.wires.some(w=>w.from===at(p,'step')&&w.to===op.id&&w.toPort==='control'&&w.label==='state.more'));
});

test('an external comparison cannot masquerade as a known constant branch or next state',async()=>{
  const p=await packet('export function main(x){const last=unknown(x)===1;return after(last&&x.ready);}');
  assert.ok(!p.operators?.some(o=>o.alternatives?.some(a=>a.constant&&a.expression==='last')));
  assert.ok(p.uncertainty.some(u=>u.kind==='branch-result'));
  const loop=await packet('export function main(initial,items){let state=initial;for(const item of items)state=unknown(item)+1;return after(state);}');
  assert.ok(!loop.wires.some(w=>w.toPort==='next'));
  assert.ok(loop.uncertainty.some(u=>u.kind==='loop-data-flow'&&u.binding==='state'));
});

test('missing condition and iterable origins are explicit on their operators',async()=>{
  const choice=await packet('export function main(x){const condition=unknown(x)===1;return condition?left(x):right(x);}');
  const op=choice.operators.find(o=>o.kind==='choice');
  assert.equal(op.controlUnknown,true);assert.ok(choice.uncertainty.some(u=>u.kind==='choice-control'&&u.operator===op.id));
  const loop=await packet('export function main(initial,items){let state=initial;for(const item of unknown(items))state=step(state,item).state;return state;}');
  assert.equal(loop.operators.find(o=>o.kind==='iteration').iterationSourceUnknown,true);
  assert.ok(loop.uncertainty.some(u=>u.kind==='iteration-source'));
});
