import test from 'node:test';
import assert from 'node:assert/strict';
import {compactPage} from '../lib/agent-view.mjs';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {attachPortReferences} from '../lib/port-references.mjs';
import {presentationPage} from '../lib/presentation.mjs';

const file='core/compact.mjs';
test('region diagnostics expose counts and addresses while finding detail stays behind the click',()=>{
  const path='core/example.mjs::main';
  const page={kind:'region',index:'1',components:[{index:'1.0.1',path:'core::@group/work',kind:'group',label:'Work',members:[path],files:['core/example.mjs'],count:1}],
    children:[{index:'1.1',file:'core/example.mjs'}],composition:{source:'flows.json',groups:[{members:[path]}]},uncertainty:[
    {path,kind:'argument-origin',line:2,expression:'private implementation'},
    {path,kind:'argument-origin',line:3,valueUnknown:true},
    {path,kind:'closure-capture',count:2,lifetimeUnknown:true},
    {file:'core/example.mjs',kind:'module-effect',line:1}],
    unresolved:[{path,rule:'parameter-target',call:'callback',line:2}]};
  const before=structuredClone(page),shown=presentationPage(freeze(page));
  assert.deepEqual(shown.uncertaintySummary,{count:5,details:'1',sources:[
    {index:'1.0.1',count:4},
    {index:'1.1',count:1}]});
  assert.deepEqual(shown.unresolvedSummary,{count:1,details:'1',sources:[{index:'1.0.1',count:1}]});
  assert.ok(!shown.components[0].members&&!shown.components[0].files&&!shown.composition.groups);
  assert.ok(!shown.uncertainty&&!shown.unresolved);
  assert.deepEqual(page,before);
  assert.deepEqual(presentationPage(shown),shown);
  assert.deepEqual(compactPage(page).uncertaintySummary,shown.uncertaintySummary);
  assert.deepEqual(compactPage(page,{code:true}).uncertaintySummary,shown.uncertaintySummary);
  const unlocated={...page,uncertainty:[...page.uncertainty,{kind:'unknown-effect',line:9}]};
  assert.deepEqual(presentationPage(unlocated).uncertainty,[{kind:'unknown-effect',line:9}]);
  assert.deepEqual(presentationPage(unlocated).uncertaintySummary,shown.uncertaintySummary);
  assert.deepEqual(presentationPage({...page,kind:'function'}).unresolved,page.unresolved);
});
test('capture diagnostics share closure metadata without losing bindings, access modes or limits',()=>{
  const base={kind:'closure-capture',line:4,closure:'core/state.mjs::factory::read',valueUnknown:true};
  const rows=[{...base,binding:'a',access:'read'},{...base,binding:'b',access:'read'},
    {...base,binding:'c',access:'write'}, {...base,binding:'d',access:'read',lifetimeUnknown:true},
    {...base,closure:'core/state.mjs::factory::other',binding:'a',access:'read'},
    {kind:'argument-origin',line:7}];
  const source={kind:'function',index:'1.1.1',uncertainty:rows};
  const shown=presentationPage(source),group=shown.uncertainty[0];
  assert.equal(group.count,3);
  assert.deepEqual(group.bindings,{read:['a','b'],write:['c']});
  const expand=shown.uncertainty.flatMap(({bindings,count,...row})=>bindings
    ? Object.entries(bindings).flatMap(([access,names])=>names.map(binding=>({...row,binding,access}))) : [row]);
  assert.deepEqual(expand,rows);
  assert.equal(shown.uncertainty.reduce((n,u)=>n+(u.count??1),0),rows.length);
  assert.deepEqual(presentationPage(shown),shown);
  assert.equal(source.uncertainty.length,6);
  assert.deepEqual(compactPage(source).uncertainty,shown.uncertainty);
});
const dataPathForTest=/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
async function richPage(body) {
  const source=`export const make=x=>x;export const consume=x=>x;export function main(a,b,flag,cb){${body}}`;
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const packets=new Map([...context.projection.nodes.values()].filter(n=>n.kind!=='module').map(n=>[n.path,flowPacket(context,n.path)]));
  attachPortReferences(packets,new Map([...packets].map(([path,page])=>[path,page.index])));
  return packets.get(`${file}::main`);
}
function freeze(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;
}

test('default caller references keep every destination and flag without predicate labels',()=>{
  const refs=[
    {index:'4.8.19',path:'core/geom/fill.mjs::scanlineFillComponent',labels:['edges.length===0 || closed(edges)'],possibleTarget:true},
    {index:'4.8.20',labels:['Number.isFinite(value) && value>0'],executionUnknown:true,optional:false},
    {index:'4.8.19',labels:['second secret predicate'],sites:2,flagCounts:{unknown:1,optional:2}},
    {index:null,path:'skills/example.mjs::outside',file:'skills/example.mjs',line:7,column:3,labels:['external secret predicate'],external:true,targetUnknown:true},
    {file:'adapters/external.mjs',line:12,label:'opaque secret predicate',unknown:true},
  ];
  const expected=[
    {index:'4.8.19',possibleTarget:true},
    {index:'4.8.20',executionUnknown:true,optional:false},
    {index:'4.8.19',sites:2,flagCounts:{unknown:1,optional:2}},
    {path:'skills/example.mjs::outside',file:'skills/example.mjs',line:7,column:3,external:true,targetUnknown:true},
    {file:'adapters/external.mjs',line:12,unknown:true},
  ];
  const wires=[{from:'4.8.2',to:'4.8.1',kind:'call',provenance:'called-from',caller:'4.8.2',callee:'4.8.1'}];
  const rich=freeze({index:'4.8.1',path:`${file}::main`,file,kind:'function',destination:'graph',callerReferences:refs,calledFrom:refs,
    components:[{index:'4.8.3',file,label:'requireThat',shape:'assertion',callerReferences:refs}],
    children:[{index:'4.8.3',callerReferences:refs}],callerWires:wires});
  const before=structuredClone(rich),shown=presentationPage(rich),compact=compactPage(rich);
  assert.deepEqual(shown.callerReferences,expected);assert.deepEqual(shown.calledFrom,expected);
  assert.deepEqual(shown.components[0].callerReferences,expected);assert.ok(!('children' in shown));
  assert.deepEqual(compact.callerReferences,expected);assert.deepEqual(compact.components[0].callerReferences,expected);
  assert.deepEqual(shown.callerWires,wires);assert.deepEqual(compact.callerWires,wires);
  assert.deepEqual(presentationPage(shown),shown,'default reference projection is idempotent');
  assert.deepEqual(rich,before,'rich stored evidence remains untouched');
  for(const value of [shown,compact]) {
    const serialized=JSON.stringify(value);assert.ok(!serialized.includes('secret predicate'));
    assert.ok(!serialized.includes('edges.length'));assert.ok(!serialized.includes('Number.isFinite'));
  }
});

test('terminal and fallback calledFrom references use the same concise identities',()=>{
  const caller={index:'6.2.3',path:'core/path/example.mjs::caller',labels:['secret predicate'],unknown:true};
  for(const destination of ['code','graph']) {
    const rich=freeze({index:'1.1.1',file,path:`${file}::main`,destination,calledFrom:[caller]});
    for(const shown of [presentationPage(rich),compactPage(rich)])assert.deepEqual(shown.calledFrom,[{index:'6.2.3',unknown:true}]);
  }
});

test('busy off-page component callers compact to a canonical summary while page evidence stays complete',()=>{
  const refs=Array.from({length:6},(_,i)=>({index:`6.2.${i+1}`,path:`core/a.mjs::caller${i+1}`}));
  const few=refs.slice(0,5);
  const rich=freeze({index:'4.8',path:file,file,kind:'file',destination:'graph',
    callerReferences:refs,components:[{index:'4.8.3',file,label:'leaf',callerReferences:refs},
      {index:'4.8.4',file,label:'small',callerReferences:few}],
    children:[{index:'4.8.2'},{index:'4.8.3',path:`${file}::leaf`,lines:1,callerReferences:refs,uncertainty:[{kind:'raw'}]},
      {index:'4.8.4',path:`${file}::small`,lines:1,callerReferences:few}],
    regions:[{index:'1'},{index:'2',callerReferences:refs}]});
  const shown=presentationPage(rich);
  assert.deepEqual(shown.callerReferences,refs.map(({index})=>({index})));
  assert.ok(!('callerReferences' in shown.components[0]));
  assert.deepEqual(shown.components[0].callerSummary,{count:6,index:'4.8.3'});
  assert.ok(!('children' in shown));
  assert.deepEqual(shown.regions[1].callerReferences,refs.map(({index})=>({index})));
  assert.deepEqual(presentationPage(shown),shown);
  const compact=compactPage(rich);
  assert.deepEqual(compact.callerReferences,refs.map(({index})=>({index})));
  assert.deepEqual(compact.components[0].callerSummary,{count:6,index:'4.8.3'});
  assert.ok(!('callerReferences' in compact.components[0]));
  assert.ok(!('uncertainty' in compact.components[0]));
  assert.equal(compact.components[0].path,`${file}::leaf`);assert.equal(compact.components[0].lines,1);
  assert.deepEqual(compact.components[1].callerReferences,few.map(({index})=>({index})));
});

test('code reads omit repeated caller lists but keep unrepresented and outside callers',()=>{
  const page=freeze({index:'1.1.1',file,destination:'code',callerReferences:[{index:'2.1.1'}],
    calledFrom:[{index:'2.1.1'},{index:'2.1.2'},{file:'skills/a.mjs',line:2},{file:'skills/b.mjs',line:3}]});
  for(const code of [false,true]) {
    const shown=compactPage(page,{code});
    assert.deepEqual(shown.callerReferences,[{index:'2.1.1'}]);
    assert.deepEqual(shown.calledFrom,[{index:'2.1.2'},{file:'skills/a.mjs',line:2},{file:'skills/b.mjs',line:3}]);
  }
});

test('single possible targets and callback execution limits appear on shared stage boxes',async()=>{
  const rich=await richPage('const fn=flag?make:consume;return fn(a);');
  const before=structuredClone(rich),shown=presentationPage(freeze(rich)),compact=compactPage(rich);
  assert.deepEqual(rich,before);
  for(const page of [shown,compact]) {
    assert.equal(page.components.length,2);
    assert.ok(page.components.every(c=>c.possibleTarget===true&&!c.executionUnknown));
  }
  const callback=await richPage('a.map(x=>make(x));return consume(a);');
  for(const page of [presentationPage(callback),compactPage(callback)]) {
    assert.equal(page.components.find(c=>c.label==='make').executionUnknown,true);
    assert.ok(!page.components.find(c=>c.label==='consume').executionUnknown);
  }
});

test('known outside invocation targets retain source evidence without a fabricated unknown target',()=>{
  const targets=[{path:'skills/example.mjs::prepare',label:'prepare',file:'skills/example.mjs',line:2,endLine:8}];
  const page={index:'1.1.1',path:`${file}::main`,file,kind:'function',destination:'graph',
    operators:[{id:'op1',kind:'invocation',file,line:4,endLine:4,callee:'prepare',scope:'outside',targets}]};
  for(const shown of [presentationPage(page),compactPage(page)]) {
    assert.equal(shown.operators[0].scope,'outside');
    assert.equal(shown.operators[0].targets[0].path,targets[0].path);
    assert.ok(!shown.operators[0].targetUnknown);
  }
  const possible=presentationPage({...page,operators:[{...page.operators[0],possibleTarget:true}]});
  assert.equal(possible.operators[0].possibleTarget,true);
});

test('invocation uncertainty belongs to its occurrence, not every use of the declaration',async()=>{
  const rich=await richPage('make(a);const fn=flag?make:consume;fn(b);a.map(x=>make(x));return a;');
  for(const page of [presentationPage(rich),compactPage(rich)]) {
    const calls=page.components.filter(c=>c.label==='make'&&c.reference!=='callable');
    assert.equal(calls.length,3);
    assert.ok(!calls[0].possibleTarget&&!calls[0].executionUnknown);
    assert.equal(calls[1].possibleTarget,true);assert.ok(!calls[1].executionUnknown);
    assert.equal(calls[2].executionUnknown,true);assert.ok(!calls[2].possibleTarget);
    assert.ok(page.components.filter(c=>c.reference==='callable').every(c=>!c.possibleTarget&&!c.executionUnknown));
  }
});

test('returned records show field names and source with spread and computed-key limits',async()=>{
  const rich=await richPage('const x=make(a);return {x,decision:flag?"secret-left":"secret-right",...b,[a.key]:x};');
  const before=structuredClone(rich),shown=presentationPage(freeze(rich));
  assert.deepEqual(rich,before);
  const output=shown.outputs[0];
  assert.equal(output.name,'{x, decision, …}');assert.equal(output.spread,true);assert.equal(output.computedKeys,true);
  assert.equal(output.source.file,file);assert.ok(output.source.line>0);
  assert.ok(!output.name.includes('secret-left'));
  assert.equal(compactPage(rich).outputs[0].name,output.name);
});

test('condition predicates stay behind source while default gates retain identity, branch and source address',async()=>{
  const rich=await richPage('if(a.mode==="specific-format")return make(a);else throw new Error("unsupported");');
  const shown=presentationPage(rich),compact=compactPage(rich);
  assert.ok(rich.gates.some(g=>g.text.includes('specific-format')));
  for(const gate of shown.gates){
    assert.equal(gate.name,'a.mode');assert.ok(['if','else'].includes(gate.branch));
    assert.equal(gate.file,file);assert.ok(gate.line>0);assert.ok(gate.endLine>=gate.line);
    assert.ok(!('text' in gate));assert.ok(!('terms' in gate));
  }
  for(const gate of compact.gates){assert.ok(gate.range);assert.ok(!('text' in gate));}
  assert.deepEqual(shown.wires,rich.wires.map(({expression,...wire})=>wire));
});

test('compact graph preserves wires, gates, operator semantics and explicit unknowns without mutating its packet',async()=>{
  const rich=await richPage('let count=0;for(const x of a)cb?.(++count);const chosen=flag?make(a):make(b);return consume({chosen,missing:unknown()});');
  rich.destination='graph';rich.stale={regenerate:'0',reason:'generation-dependencies-changed',files:[file],changed:[file]};
  const before=structuredClone(rich),compact=compactPage(freeze(rich));
  assert.deepEqual(rich,before);
  assert.deepEqual(compact.wires,presentationPage(rich).wires);
  assert.equal(compact.gates.length,rich.gates.length);
  assert.ok(compact.gates.every(g=>g.name&&g.branch&&!('text' in g)&&(g.terms??[]).every(term=>!('text' in term))));
  assert.deepEqual(compact.uncertainty,rich.uncertainty);
  assert.deepEqual(compact.unresolved,rich.unresolved);
  assert.deepEqual(compact.stale,rich.stale);
  assert.deepEqual(compact.range,[rich.line,rich.endLine]);assert.equal(compact.file,file);assert.equal(compact.path,rich.path);
  for(const op of rich.operators) {
    const kept=compact.operators.find(o=>o.id===op.id);assert.ok(kept);
    for(const key of ['kind','operation','binding','optional','targetUnknown','gate'])
      assert.deepEqual(kept[key],op[key],`${op.id}.${key}`);
    assert.equal(kept.column,op.column);assert.deepEqual(kept.range,[op.line,op.endLine]);
    assert.ok(!kept.ports,'wire endpoint roles carry the visible ports without a second inventory');
  }
});

test('throw labels and guard wires keep source details behind the default read',async()=>{
  const rich=await richPage('if(!a||!b)throw new TypeError("private diagnostic text");throw a.error;');
  const before=structuredClone(rich);
  assert.ok(rich.outputs.some(o=>o.name.includes('private diagnostic text')));
  assert.ok(rich.wires.some(w=>w.kind==='gate'&&w.label.includes('||')));
  for(const page of [presentationPage(freeze(rich)),compactPage(rich)]) {
    assert.deepEqual(page.outputs.map(o=>o.name),['TypeError','a.error']);
    assert.ok(page.outputs.every(o=>o.lines.length));
    assert.ok(page.wires.some(w=>w.kind==='gate'&&w.label==='condition'));
    assert.ok(page.wires.every(w=>w.kind!=='gate'||!w.label.includes('||')));
    assert.equal(page.wires.length,rich.wires.length);
    assert.equal(page.gates.length,rich.gates.length);
  }
  assert.deepEqual(rich,before);
});

test('alias arguments retain the exact producer invocation when a callee occurs twice',async()=>{
  const rich=await richPage('const first=make(a),second=make(b);const alias=first;return consume(alias);');
  const compact=compactPage(rich),make=rich.components.find(c=>c.label==='make');
  const producers=compact.calls.filter(call=>call.callee===make.index);
  const consumer=compact.components.find(c=>c.label==='consume');
  const use=compact.calls.find(call=>call.callee===consumer.index);
  assert.equal(producers.length,2);assert.notEqual(producers[0].column,producers[1].column);
  assert.equal(use.argumentCount,1);assert.ok(!use.arguments);
  const wire=compact.wires.find(w=>w.to===consumer.index&&w.label==='alias');
  assert.equal(wire.from,producers[0].instance);assert.notEqual(wire.from,producers[1].instance);
  assert.ok(compact.calls.every(call=>!call.resultUses&&!call.callable));
  const originalUse=rich.callBindings.find(call=>call.arguments[0]?.expression==='alias');
  assert.equal(originalUse.arguments[0].producers[0].site.column,producers[0].column);
});

test('visible boxes retain navigation while hidden descendants stay behind the click',()=>{
  for(const kind of ['root','file']) {
    const inventory=kind==='root'?'regions':'components';
    const compact=compactPage({index:kind==='root'?'0':'1.1',kind,destination:'graph',
      [inventory]:[{index:'1.1.1',label:'visible'}],children:[{index:'1.1.1',path:'core/a.mjs::visible',file:'core/a.mjs'},
        {index:'1.1.2',path:'core/a.mjs::extra',label:'extra'}]});
    assert.equal(compact[inventory][0].path,'core/a.mjs::visible');
    assert.ok(!('children' in compact));
    assert.ok(!JSON.stringify(compact).includes('core/a.mjs::extra'));
  }
});

test('source views preserve matching-source provenance, stale status and explicit unavailable recovery',()=>{
  const page={index:'1.1.1',path:'core/a.mjs::main',file:'core/a.mjs',kind:'function',line:3,endLine:5,
    destination:'code',code:true,source:'3\tfunction main(){\n4\treturn 1;\n5\t}',sourceKind:'snapshot',sourceSha256:'snapshot-hash',
    stale:{regenerate:'0',reason:'generation-dependencies-changed',files:['core/a.mjs'],deleted:['core/a.mjs']},
    calledFrom:[{index:'2.1.1',labels:['payload']}],couplings:[{index:'3.1.1',kind:'callback'}],
    unresolved:[{call:'callback',line:4,rule:'parameter-target'}],uncertainty:[{kind:'argument-origin',line:4}],
    components:[{index:'4.1.1'}],wires:[{from:'in1',to:'4.1.1'}]};
  const compact=compactPage(page,{code:true});
  for(const key of ['index','path','file','code','source','sourceKind','sourceSha256','stale','couplings','unresolved','uncertainty'])
    assert.deepEqual(compact[key],page[key]);
  assert.deepEqual(compact.calledFrom,[{index:'2.1.1'}]);
  assert.deepEqual(compact.range,[3,5]);assert.ok(!compact.components);assert.ok(!compact.wires);
  const unavailable=compactPage({...page,source:undefined,sourceKind:undefined,sourceUnavailable:true,regenerate:'0'},{code:true});
  assert.equal(unavailable.sourceUnavailable,true);assert.equal(unavailable.regenerate,'0');assert.ok(!('source' in unavailable));
});

test('automatic terminal reads keep boundary addresses without copying the other page context',async()=>{
  const rich=await richPage('return consume(a);');
  rich.destination='code';rich.code=true;rich.source='1\treturn consume(a);';
  rich.inputs[0].references=[{index:'2.1.1',line:9,column:4,expression:'seed',producers:[{endpoint:'in1',page:'2.1.1'}],unknown:true}];
  rich.outputs[0].references=[{index:'2.1.1',line:9,column:4,binding:{expression:'result'},uses:[{index:'3.1.1'}],usesUnknown:true}];
  const compact=compactPage(rich);
  assert.equal(compact.inputs[0].port,'in1');
  assert.equal(compact.outputs[0].port,'out1');
  assert.deepEqual(compact.inputs[0].references,[{index:'2.1.1',line:9,column:4,unknown:true}]);
  assert.deepEqual(compact.outputs[0].references,[{index:'2.1.1',line:9,column:4,usesUnknown:true}]);
  assert.ok(!compact.outputs[0].producers);
  const explicit=compactPage(rich,{code:true});assert.ok(!explicit.inputs);assert.ok(!explicit.outputs);
});

test('shared lean boundary references group caller sites with exact uncertainty counts and retain singleton addresses',()=>{
  const rich={index:'1.1.1',path:'core/a.mjs::stage',file:'core/a.mjs',kind:'function',line:8,endLine:12,
    sourceSpan:{file:'core/a.mjs',line:8,endLine:12},source:'8\texport function stage() {}',sourceKind:'snapshot',sourceSha256:'saved',
    inputs:[{port:'in1',name:'options',role:'input',position:1,pattern:'{items=[]}',default:'{}',references:[
      {index:'2.1.1',file:'core/b.mjs',line:10,column:4,expression:'first',producers:[{endpoint:'in1'}]},
      {index:'2.1.1',file:'core/b.mjs',line:10,column:30,expression:'...rest',unknown:true,positionUnknown:true,spread:true},
      {file:'skills/external.mjs',line:14,column:2,executionUnknown:true,possibleTarget:true}]}],
    outputs:[{port:'out1',name:'result',role:'return',producers:[{endpoint:'op1'}],references:[
      {index:'2.1.1',line:10,column:4,binding:{expression:'result'},usesUnknown:true,optional:true}]}],
    wires:[{from:'in1',to:'op1',toPort:'state',kind:'data',gate:0,provenance:'ast-collection'}],
    gates:[{kind:'if',text:'options.enabled'}],uncertainty:[{kind:'argument-origin',line:10}],
    stale:{regenerate:'0',reason:'generation-dependencies-changed',files:['core/a.mjs']}};
  const before=structuredClone(rich),shown=presentationPage(freeze(rich)),compact=compactPage(rich);
  assert.deepEqual(rich,before);
  const refs=[{index:'2.1.1',sites:2,flagCounts:{unknown:1,positionUnknown:1,spread:1}},
    {file:'skills/external.mjs',line:14,column:2,executionUnknown:true,possibleTarget:true}];
  assert.deepEqual(shown.inputs[0].references,refs);assert.deepEqual(compact.inputs[0].references,refs);
  assert.deepEqual(presentationPage(shown).inputs[0].references,refs,'shared reduction is idempotent');
  assert.equal(shown.inputs[0].name,'options');assert.equal(shown.inputs[0].role,'input');
  assert.ok(!shown.inputs[0].pattern);assert.ok(!shown.inputs[0].default);assert.ok(!shown.outputs[0].producers);
  assert.deepEqual(shown.outputs[0].references,[{index:'2.1.1',line:10,column:4,usesUnknown:true,optional:true}]);
  for(const key of ['wires','uncertainty','stale','sourceSpan','source','sourceKind','sourceSha256'])
    assert.deepEqual(shown[key],rich[key],key);
  assert.deepEqual(compact.range,[8,12]);assert.equal(compact.file,rich.file);
});

test('caller reduction separates identities, counts every affected site and never merges unidentified callers',()=>{
  const references=[
    {index:'2.1.1',line:1,column:2,optional:true,unknown:true,expression:'first'},
    {index:'2.1.1',line:2,column:3,optional:true,executionUnknown:true,expression:'second'},
    {index:'2.1.1',line:3,column:4,usesUnknown:true},
    {path:'skills/a.mjs::first',file:'skills/a.mjs',line:1,possibleTarget:true},
    {path:'skills/a.mjs::first',file:'skills/a.mjs',line:2},
    {path:'skills/a.mjs::second',file:'skills/a.mjs',line:3},
    {file:'skills/b.mjs',line:1,defaulted:true,omitted:true},
    {file:'skills/b.mjs',line:2,rest:true},
    {line:1,unknown:true},{line:2,unknown:true}
  ];
  const rich=freeze({inputs:[{port:'in1',name:'value',references}],outputs:[{port:'out1',name:'result',references}],
    components:[{index:'1.1.1',id:'1.1.1@1'},{index:'1.1.1',id:'1.1.1@2'}],wires:[{from:'1.1.1@1',to:'1.1.1@2',kind:'data'}]});
  const shown=presentationPage(rich),rows=shown.inputs[0].references;
  assert.equal(rows.length,6);assert.deepEqual(shown.outputs[0].references,rows);
  assert.deepEqual(rows[0],{index:'2.1.1',sites:3,flagCounts:{unknown:1,executionUnknown:1,usesUnknown:1,optional:2}});
  assert.deepEqual(rows[1],{path:'skills/a.mjs::first',file:'skills/a.mjs',sites:2,flagCounts:{possibleTarget:1}});
  assert.equal(rows[2].path,'skills/a.mjs::second');assert.equal(rows[2].line,3);
  assert.deepEqual(rows[3],{file:'skills/b.mjs',sites:2,flagCounts:{omitted:1,defaulted:1,rest:1}});
  assert.deepEqual(rows.slice(4),[{line:1,unknown:true},{line:2,unknown:true}]);
  assert.deepEqual(presentationPage(shown).inputs[0].references,rows);
  assert.deepEqual(shown.components,rich.components);assert.deepEqual(shown.wires,rich.wires);
  assert.equal(rich.inputs[0].references.length,10);assert.equal(rich.inputs[0].references[0].expression,'first');
});

test('shared operator boxes expose identity and source without repeating their implementation',async()=>{
  const rich=await richPage('let count=0;for(const x of a)cb?.({completed:++count,missing:unknown(x)});return consume(count);');
  const before=structuredClone(rich),shown=presentationPage(freeze(rich)),compact=compactPage(rich);
  assert.deepEqual(rich,before);
  const call=shown.operators.find(o=>o.kind==='invocation'),update=shown.operators.find(o=>o.kind==='update');
  assert.ok(!call.arguments);assert.equal(call.argumentUnknown,true);
  assert.equal(call.targetUnknown,true);assert.equal(call.optional,true);
  assert.equal(update.operation,'++');assert.ok(!('prefix' in update));assert.ok(!update.constants);
  assert.ok(shown.gates[update.gate]);assert.deepEqual(shown.wires,rich.wires.map(({expression,...wire})=>wire));
  assert.equal(compact.operators.find(o=>o.id===call.id).argumentUnknown,true);
  for(const op of shown.operators) {
    const original=rich.operators.find(o=>o.id===op.id);
    for(const key of ['id','kind','file','line','endLine','column','gate'])assert.equal(op[key],original[key]);
    for(const key of ['provenance','ports','test','arguments','alternatives','constants','initialConstants','minIterations','initial','projection','prefix'])
      assert.ok(!(key in op),key);
  }
  const transforms=presentationPage({operators:[
    {kind:'collection',operation:'create',collection:'map',initial:'new Map()'},
    {kind:'collection',operation:'create',collection:'array',initial:'[1,2]'},
    {kind:'collection',operation:'map',projection:'item=>item.id'},
    {kind:'iteration',initialConstants:['0'],minIterations:0}]}).operators;
  assert.ok(transforms.every(op=>!('initial' in op)&&!('projection' in op)&&!('initialConstants' in op)));
  assert.deepEqual(shown.uncertainty,rich.uncertainty);
});

test('return labels shorten only a whole call result and preserve arithmetic, member and literal meaning',async()=>{
  for(const [body,expected] of [
    ['return consume(a);','consume result'],
    ['const scheduled=consume(a);return scheduled;','scheduled'],
    ['return make(a)+7;','make(a)+7'],
    ['return make(a).value;','make(a).value'],
    ['return make(a)?a:b;','make(a)?a:b'],
    ['return 42;','42']
  ]) {
    const rich=await richPage(body),shown=presentationPage(rich),compact=compactPage(rich);
    assert.equal(shown.outputs[0].name,expected,body);assert.equal(compact.outputs[0].name,expected,body);
    assert.deepEqual(shown.wires,rich.wires.map(({expression,...wire})=>!wire.label||dataPathForTest.test(wire.label)?wire:
      wire.kind==='gate'||wire.toPort==='control'?{...wire,label:'condition'}:wire.fromPort==='selected'?{...wire,label:'selected result'}:wire));
    assert.equal(shown.gates.length,rich.gates.length);
    assert.equal(shown.outputs[0].role,rich.outputs[0].role);
    assert.deepEqual(shown.outputs[0].lines,rich.outputs[0].lines);
  }
});

test('awaited return labels shorten only an entire resolved call result',async()=>{
  for(const [body,expected] of [
    ['return await consume(a);','consume result'],
    ['return (await consume(a)).value;','(await consume(a)).value'],
    ['return await consume(a)+7;','await consume(a)+7']
  ]) {
    const source=`export const consume=x=>x;export async function main(a){${body}}`;
    const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
    const rich=flowPacket(context,`${file}::main`);
    assert.equal(presentationPage(rich).outputs[0].name,expected);
    assert.equal(compactPage(rich).outputs[0].name,expected);
  }
});

test('default choice wires and unresolved returned calls show roles while details retain expressions',async()=>{
  const source=`export function pick(){return {};}
export function requireThat(condition){if(!condition)throw Error('failed');}
export function main(dispatch,directory,development,onProgress,beforeCommit){const current=pick(),confirmed=pick();
requireThat(confirmed&&confirmed.checks.mode==='development'&&confirmed.current.planHash===current.current.planHash);
if(dispatch)return dispatch({directory,current,confirmed,development,onProgress,beforeCommit});return current.checks;}`;
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source}),rich=flowPacket(context,`${file}::main`);
  const shown=presentationPage(rich),compact=compactPage(rich),serialized=JSON.stringify(compact);
  assert.ok(rich.wires.some(w=>w.label?.includes("confirmed&&confirmed.checks.mode==='development'")));
  assert.ok(!serialized.includes('&&')&&!serialized.includes("==='development'"));
  assert.ok(shown.wires.some(w=>w.label==='confirmed.checks.mode'),'named property data remains visible');
  assert.ok(shown.wires.some(w=>w.label==='condition'));
  assert.ok(shown.wires.some(w=>w.label==='selected result'));
  assert.equal(shown.outputs.find(output=>output.name.startsWith('dispatch'))?.name,'dispatch result');
  assert.ok(shown.wires.some(w=>w.kind==='return'&&w.label==='dispatch result'));
  assert.ok(!shown.wires.some(w=>w.label?.includes('dispatch({')),'call payload stays behind source on return wires too');
  assert.ok(rich.outputs.some(output=>output.name.startsWith('dispatch({directory,current,confirmed')),'details retain the returned expression');
});

test('only AST-proven direct calls receive callable result labels',async()=>{
  const source=`export function direct(dispatch,input){return dispatch({input,first:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});}
export function compound(f,g,input){return f(input)+g(input)+f(input)+g(input)+f(input)+g(input)+f(input)+g(input)+f(input)+g(input);}
export function pattern(input){return /a\\(b\\)|c[)]/.test(input)&&/another-long-pattern-value-with-many-more-characters-to-clip-safely/.test(input);}
export function template(input){return \`a long template body that includes ( and ) and \${input} without being a call result\`;}`;
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const page=name=>flowPacket(context,`${file}::${name}`),shown=name=>presentationPage(page(name));
  assert.equal(page('direct').outputs[0].returnCall,'dispatch');assert.equal(shown('direct').outputs[0].name,'dispatch result');
  for(const name of ['compound','pattern','template']){
    assert.equal(page(name).outputs[0].returnCall,undefined,name);
    assert.equal(shown(name).outputs[0].name,'return value',name);
    assert.ok(page(name).outputs[0].name.endsWith('…'),'details retain clipped source evidence');
  }
});

test('default assertion stages retain source and condition producers without error prose or predicates',async()=>{
  const source=`export function requireThat(condition,message){if(!condition)throw Error(message);}
export const prepare=x=>x;export function main(input){const ready=prepare(input);
requireThat(ready.value>3,"private threshold message");
requireThat(input.mode==="private-mode","private mode message");return ready;}`;
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source}),rich=flowPacket(context,`${file}::main`);
  assert.equal(rich.requires.length,2);
  const compact=compactPage(rich),serialized=JSON.stringify(compact);
  assert.ok(!compact.requires);
  for(const text of ['private threshold message','private mode message','private-mode','ready.value>3'])assert.ok(!serialized.includes(text),text);
  const assertions=compact.components.filter(c=>c.shape==='assertion');assert.equal(assertions.length,2);
  for(const assertion of assertions){
    assert.ok(assertion.assertion.condition.source.range);
    assert.ok(compact.wires.some(w=>w.to===assertion.id&&w.toPort==='arg1'));
  }
});

test('default calls keep source slots and limits without duplicating expressions or producer traces',async()=>{
  const rich=await richPage('const result=make(a);consume(7,unknown(),result,...b);return result;');
  const compact=compactPage(rich),consume=compact.calls.find(call=>call.argumentCount===4);
  assert.deepEqual(consume.arguments,[{position:1,constant:true},{position:2,unknown:true},{position:4,spread:true,positionUnknown:true}]);
  assert.ok(compact.calls.every(call=>!call.resultUses&&!call.callable));
  assert.ok(compact.wires.every(w=>!('expression' in w)));
  assert.ok(compact.wires.some(w=>w.toPort==='arg3'));
  assert.ok(rich.callBindings.some(call=>call.arguments.some(arg=>arg.expression==='unknown()')));
  assert.deepEqual(presentationPage(presentationPage(rich)).gates,presentationPage(rich).gates);
});

test('compact nested gates retain opposite branch polarity without source predicates',async()=>{
  const rich=await richPage('if(a){if(b)return make(a);}else{if(b)return consume(a);}return null;');
  const shown=presentationPage(rich),compound=shown.gates.filter(g=>g.terms);
  assert.ok(compound.some(g=>g.terms.map(t=>t.branch).join()==='if,if'));
  assert.ok(compound.some(g=>g.terms.map(t=>t.branch).join()==='else,if'));
  assert.ok(compound.every(g=>g.terms.every(t=>t.name&&t.line>0&&!('text' in t))));
  assert.deepEqual(presentationPage(shown).gates,shown.gates);
});
