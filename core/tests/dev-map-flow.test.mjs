import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGraph} from '../../scripts/dev-map/graph.mjs';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';

const sources={
  'core/main.mjs':`import {Tool} from './tool.mjs';
import {prepare} from './prep.mjs';
export function start(items){return run(new Tool(),items,5);}
export function run(tool,items,limit){
  const ready=prepare(items);
  tool.begin(ready);
  for(const item of ready){
    if(item.hot)tool.heat(item,limit);
    tool.place(item);
  }
  return tool.finish();
}
export function detached(thing){thing.place(1);}
export function lone(thing){thing.finish();}
`,
  'core/tool.mjs':`export class Tool{
  begin(list){this.list=list;}
  heat(item,limit){this.temp=limit;}
  place(item){this.list.push(item);}
  finish(){return this.list;}
}
export class Other{place(item){return item;}}
`,
  'core/prep.mjs':`export function prepare(list){return clean(list);}
export function clean(list){return list.slice();}
`};
const files=Object.keys(sources),readSource=file=>sources[file];
const graph=options=>extractGraph({repo:'',files,readSource,...options});
const anchors=g=>new Map(g.declarations.map(d=>[d.id,d.anchor]));

test('a receiver resolves through its value, then through a method name only one class declares',async()=>{
  const g=await graph({literalCouplings:true,receiverCalls:true}),name=anchors(g);
  const added=g.relations.filter(r=>r.resolvedBy).map(r=>[r.resolvedBy,name.get(r.from),name.get(r.to)]);
  // `tool` is a parameter; its value comes from the caller's argument.
  assert.deepEqual(added.filter(([by])=>by==='receiver-value'),[
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::begin'],
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::heat'],
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::place'],
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::finish']]);
  assert.deepEqual(added.filter(([by])=>by==='unique-method-name'),[['unique-method-name','core/main.mjs::lone','core/tool.mjs::Tool::finish']]);
  // `place` is declared by two classes and the receiver is unknown, so nothing is linked.
  assert.ok(!g.relations.some(r=>name.get(r.from)==='core/main.mjs::detached'));
  // Calls on a built-in host stay unresolved and counted, never linked to a same-named method.
  assert.deepEqual(g.receivers.unresolved.map(u=>[name.get(u.from),u.name]),
    [['core/main.mjs::detached','place'],['core/tool.mjs::Tool::place','push'],['core/prep.mjs::clean','slice']]);
  assert.deepEqual(g.receivers.resolved,{'receiver-value':4,'unique-method-name':1});
});

test('receiver resolution is opt-in and leaves the relations before it identical',async()=>{
  const base=await graph({literalCouplings:true}),with_=await graph({literalCouplings:true,receiverCalls:true});
  assert.ok(!('receivers' in base));
  assert.deepEqual(with_.relations.slice(0,base.relations.length),base.relations);
  assert.equal(with_.relations.length-base.relations.length,5);
  await assert.rejects(graph({receiverCalls:true}),/needs literalCouplings/);
});

const packet=async target=>flowPacket(await loadFlow({repo:'',files,readSource}),target);

test('a function body reads as a flow: parameters in, callees in call order, returns out',async()=>{
  const p=await packet('core/main.mjs::run');
  assert.deepEqual(p.inputs,[{port:'in1',name:'tool',provenance:'ast-param'},{port:'in2',name:'items',provenance:'ast-param'},
    {port:'in3',name:'limit',provenance:'ast-param'}]);
  // Order is the first call site, not the declaration order of the callees.
  assert.deepEqual(p.components.map(c=>[c.order,c.label,c.calls,c.links.join()]),[[1,'prepare',1,'ast-call-site'],
    [2,'begin',1,'receiver-value'],[3,'heat',1,'receiver-value'],[4,'place',1,'receiver-value'],[5,'finish',1,'receiver-value']]);
  assert.deepEqual(p.outputs,[{port:'out1',name:'tool.finish()',lines:[11],provenance:'ast-return'}]);
  assert.ok(p.components.every(c=>c.foot===`${c.file.split('/').pop()}:${c.line}-${c.endLine}`));
  // `prepare` calls mapped code, so its box opens onto its own flow page; the rest are blocks of code.
  assert.deepEqual(p.components.map(c=>c.opens),[true,false,false,false,false]);
});

test('wires are local def-use, the threaded receiver and the return; gates are the test as written',async()=>{
  const p=await packet('core/main.mjs::run'),path=n=>`core/tool.mjs::Tool::${n}`;
  const wire=(from,to)=>p.wires.filter(w=>w.from===from&&w.to===to).map(w=>[w.label,w.kind,w.provenance,w.gate?.text??null]);
  assert.deepEqual(wire('in2','core/prep.mjs::prepare'),[['items','data','ast-param',null]]);
  // `ready` is the result of prepare bound to a name and passed on, twice over.
  assert.deepEqual(wire('core/prep.mjs::prepare',path('begin')),[['ready','data','ast-def-use',null]]);
  assert.deepEqual(wire('core/prep.mjs::prepare',path('heat')),[['ready','data','ast-def-use','item.hot']]);
  assert.deepEqual(wire('in3',path('heat')),[['limit','data','ast-param','item.hot']]);
  assert.deepEqual(p.wires.filter(w=>w.kind==='state').map(w=>[w.from.split('::').at(-1),w.to.split('::').at(-1),w.label,w.provenance]),
    [['in1','begin','tool','state-thread'],['begin','heat','tool','state-thread'],['heat','place','tool','state-thread'],
      ['place','finish','tool','state-thread']]);
  assert.deepEqual(wire(path('finish'),'out1'),[['','return','ast-return']].map(w=>[...w,null]));
  // The gate a component carries is the gate every one of its call sites is under.
  assert.deepEqual(p.components.map(c=>c.gate?.text??null),[null,null,'item.hot','of ready',null]);
  assert.ok(p.components.every(c=>!c.gate||c.gate.provenance==='ast-guard'));
});

test('every element of a flow page names the mechanism that produced it',async()=>{
  const p=await packet('core/main.mjs::run');
  const elements=[...p.inputs,...p.outputs,...p.components,...p.components.flatMap(c=>c.sites),...p.wires,
    ...p.vocabulary,...p.weak,...p.unresolved,...p.withheldWires];
  assert.ok(elements.length>20&&elements.every(e=>typeof e.provenance==='string'&&e.provenance));
  const allowed=new Set(['ast-call-site','ast-closure','ast-def-use','ast-param','ast-return','ast-guard','receiver-value',
    'unique-method-name','state-thread','ast-nested-call','heuristic:vocabulary','heuristic:unique-method-name-only']);
  assert.ok(elements.every(e=>allowed.has(e.provenance)));
  assert.ok(p.components.flatMap(c=>c.sites).every(s=>allowed.has(s.link)));
  assert.ok(p.wires.every(w=>!w.gate||w.gate.provenance==='ast-guard'));
  // A call to something outside mapped code is listed, not silently dropped.
  assert.deepEqual(p.unresolved,[]);
  assert.deepEqual((await packet('core/prep.mjs::clean')).unresolved,
    [{call:'list.slice',line:2,column:36,receiver:'list',provenance:'ast-call-site'}]);
  assert.deepEqual(p.heuristics.map(h=>h.name),['heuristic:vocabulary','heuristic:unique-method-name-only']);
  assert.deepEqual(p.authored,[]);
});
