import test from 'node:test';
import assert from 'node:assert/strict';
import {composePages,readCompositions} from '../lib/composition.mjs';
import {numberRegion} from '../lib/regions.mjs';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {fileURLToPath} from 'node:url';

const file='core/work.mjs',path=`${file}::run`;
const component=(n,index)=>({index,path:`${file}::${n}`,file,label:n,line:1,endLine:2,lines:2});
const packet={index:'1.1.1',path,file,kind:'function',components:[component('a','1.1.2'),component('b','1.1.3'),component('c','1.1.4')],
  inputs:[{port:'in1',name:'item'}],outputs:[{port:'out1',name:'result'}],gates:[{text:'ready',kind:'if'}],
  wires:[{from:'in1',to:'1.1.2',label:'item',kind:'data'},{from:'1.1.2',to:'1.1.3',label:'value',kind:'data',gate:0},
    {from:'1.1.3',to:'1.1.4',label:'ready',kind:'data'},{from:'1.1.4',to:'out1',label:'result',kind:'return'}],
  children:[],requires:[],formulas:[],calledFrom:[],couplings:[],unresolved:[],external:0};
const config={schema:1,flows:[{path,groups:[{id:'prepare',members:[`${file}::a`,`${file}::b`]}]}]};
const run=(cfg=config)=>composePages(new Map([[path,packet]]),cfg,{});

test('grouping preserves canonical declarations, ungrouped nodes, named crossing edges and gates',()=>{
  const result=run(),root=result.pages.get(path),child=[...result.groupPages.values()][0];
  assert.deepEqual(root.components.map(c=>c.index),['1.1.1.0.1','1.1.4']);
  assert.deepEqual(child.components.map(c=>c.index),['1.1.2','1.1.3']);
  assert.deepEqual(child.codeTargets,[`${file}::a`,`${file}::b`]);
  assert.deepEqual(child.gates,packet.gates);
  assert.equal(child.wires.find(w=>w.label==='value').gate,0);
  assert.equal(root.wires.length,3);assert.equal(child.wires.length,3);
  assert.equal(root.composition.edges,4);assert.equal(root.composition.internal,1);
  assert.deepEqual(packet.components.map(c=>c.index),['1.1.2','1.1.3','1.1.4']);
});

test('every generated crossing wire has a balanced child boundary and unchanged evidence',()=>{
  const result=run(),root=result.pages.get(path),child=[...result.groupPages.values()][0];
  for(const boundary of child.boundary) {
    const parent=root.wires.find(w=>w.edgeId===boundary.edgeId),local=child.wires.find(w=>w.edgeId===boundary.edgeId);
    assert.ok(parent);assert.ok(local);
    assert.equal(parent.from,boundary.parentFrom);assert.equal(parent.to,boundary.parentTo);
    assert.equal(local.label,parent.label);assert.equal(local.gate,parent.gate);
    assert.ok([...child.inputs,...child.outputs].some(p=>p.port===boundary.port));
  }
  const represented=new Set([...root.wires,...child.wires].map(w=>w.edgeId));
  assert.equal(represented.size,packet.wires.length);
});

test('invalid authored relationships, unknown members and duplicate ownership fail',()=>{
  assert.throws(()=>run({...config,edges:[]}),/unsupported field edges/);
  assert.throws(()=>run({schema:1,flows:[{path,groups:[{id:'bad',members:['missing']}]}]}),/Unknown composition member/);
  assert.throws(()=>run({schema:1,flows:[{path,groups:[{id:'bad',members:[`${file}::a`,`${file}::a`]}]}]}),/Duplicate composition member/);
});

test('execution groups cannot hide an intervening outside stage and invent feedback',()=>{
  assert.throws(()=>run({schema:1,flows:[{path,groups:[{id:'ends',members:[`${file}::a`,`${file}::c`]}]}]}),/Non-convex composition/);
  const dependency={...packet,kind:'class'};
  assert.doesNotThrow(()=>composePages(new Map([[path,dependency]]),{schema:1,flows:[{path,groups:[
    {id:'members',members:[`${file}::a`,`${file}::c`]}]}]},{}));
});

test('closure references do not impose execution convexity and retain every crossing boundary',()=>{
  const cfg={schema:1,flows:[{path,groups:[{id:'ends',members:[`${file}::a`,`${file}::c`]}]}]};
  for(const reference of [{kind:'capture',provenance:'ast-closure-capture',toPort:'capture:value'},
    {kind:'data',provenance:'ast-closure-value',fromPort:'callable'}]) {
    const source={...packet,wires:packet.wires.map((w,i)=>i===1?{...w,...reference}:w)};
    const result=composePages(new Map([[path,source]]),cfg,{}),parent=result.pages.get(path),child=[...result.groupPages.values()][0];
    const crossing=parent.wires.find(w=>w.provenance===reference.provenance);
    assert.ok(crossing,'reference stays on parent map');
    assert.ok(child.wires.some(w=>w.edgeId===crossing.edgeId&&w.provenance===reference.provenance));
    assert.ok(child.boundary.some(b=>b.edgeId===crossing.edgeId));
  }
  assert.throws(()=>composePages(new Map([[path,packet]]),cfg,{}),/Non-convex composition/,
    'ordinary data dependencies still forbid hidden intervening execution');
});

test('actual Lua parser closure groups preserve capture edges without false execution feedback',async()=>{
  const repo=fileURLToPath(new URL('../../',import.meta.url)),file='core/export/dobot-lua-subset.mjs',path=`${file}::parse`;
  const context=await loadFlow({repo,files:[file]}),page=flowPacket(context,path);
  const config=await readCompositions({repo}),spec=config.flows.find(s=>s.path===path);
  assert.ok(spec);
  assert.ok(page.wires.some(w=>w.kind==='capture'));
  const result=composePages(new Map([[path,page]]),{schema:1,flows:[spec]},{});
  const represented=new Map([...result.pages.get(path).wires,...[...result.groupPages.values()].flatMap(p=>p.wires)].map(w=>[w.edgeId,w]));
  assert.equal(represented.size,page.wires.length,'all generated relationships survive grouping');
  assert.equal([...represented.values()].filter(w=>w.kind==='capture').length,page.wires.filter(w=>w.kind==='capture').length);
});

test('source containment gives each file all of its declarations without first-caller ownership',()=>{
  const region={index:'4',files:['core/a.mjs','core/b.mjs']};
  const a={file:region.files[0],path:'core/a.mjs::start'},b={file:region.files[1],path:'core/b.mjs::helper'};
  const m={entries:()=>[a],inRegion:new Map([['4',[a,b]]]),callees:new Map([[a.path,[{to:b,start:0}]]])};
  const result=numberRegion(m,region);
  assert.equal(result.index.get(a.path),'4.1.1');assert.equal(result.index.get(b.path),'4.2.1');
  assert.equal(result.files[1].entries[0].node,b);assert.equal(result.files[0].entries[0].children.length,0);
});

test('region grouping expands files into canonical declaration context with generated calls only',()=>{
  const a={file:'core/a.mjs',path:'core/a.mjs::start',line:1,endLine:2},b={file:'core/b.mjs',path:'core/b.mjs::finish',line:1,endLine:2};
  const page={index:'1',path:'core',kind:'region',files:[a.file,b.file],children:[{index:'1.1',file:a.file},{index:'1.2',file:b.file}]};
  const index=new Map([[a.path,'1.1.1'],[b.path,'1.2.1']]);
  const model={nodes:[a,b],calls:[{from:a,to:b,fromFile:a.file,start:5,line:1,label:'item',relation:{kind:'call'}}],couplings:[]};
  const result=composePages(new Map([['core',page]]),{schema:1,flows:[{path:'core',groups:[{id:'job',members:[a.file,b.file]}]}]},
    {model,index,packets:new Map()});
  const root=result.pages.get('core'),child=[...result.groupPages.values()][0];
  assert.equal(root.structural,true);assert.deepEqual(root.children,page.children);
  assert.deepEqual(child.components.map(c=>c.index),['1.1.1','1.2.1']);
  assert.equal(child.wires.length,1);assert.equal(child.wires[0].kind,'call');assert.equal(child.wires[0].label,'item');
  assert.equal(child.wires[0].evidence.line,1);
});

test('structural group diagnostics stay with member declarations and preserve parent evidence',()=>{
  const a={file:'core/a.mjs',path:'core/a.mjs::start',line:1,endLine:2},b={file:'core/b.mjs',path:'core/b.mjs::finish',line:1,endLine:2};
  const page={index:'1',path:'core',kind:'region',files:[a.file,b.file],children:[]};
  const index=new Map([[a.path,'1.1.1'],[b.path,'1.2.1']]);
  const source=new Map([[a.path,{path:a.path,file:a.file,components:[],uncertainty:[{kind:'a-limit',line:1}],unresolved:[{call:'a',line:1}]}],
    [b.path,{path:b.path,file:b.file,components:[],uncertainty:[{kind:'b-limit',line:1}],unresolved:[{call:'b',line:1}]}]]);
  const result=composePages(new Map([['core',page]]),{schema:1,flows:[{path:'core',groups:[
    {id:'a',members:[a.file]},{id:'b',members:[b.file]}]}]},
    {model:{nodes:[a,b],calls:[],couplings:[]},index,packets:source});
  assert.equal(result.pages.get('core').uncertainty.length,2);
  const [ga,gb]=result.groupPages.values();
  assert.deepEqual(ga.uncertainty.map(u=>u.kind),['a-limit']);assert.deepEqual(gb.uncertainty.map(u=>u.kind),['b-limit']);
  assert.deepEqual(ga.unresolved.map(u=>u.call),['a']);assert.deepEqual(gb.unresolved.map(u=>u.call),['b']);
  assert.ok(!ga.analysisContext&&!gb.analysisContext);
});

test('local-flow subgroups link caller uncertainty without duplicating or hiding it',()=>{
  const source={...packet,uncertainty:[{kind:'receiver-state-order',line:8}],unresolved:[{call:'callback',line:9}]};
  const result=composePages(new Map([[path,source]]),config,{}),child=[...result.groupPages.values()][0];
  assert.deepEqual(result.pages.get(path).uncertainty,source.uncertainty);
  assert.deepEqual(result.pages.get(path).unresolved,source.unresolved);
  assert.deepEqual(child.analysisContext,{index:packet.index,path,uncertainty:1,unresolved:1});
  assert.ok(!child.uncertainty);assert.deepEqual(child.unresolved,[]);
});
