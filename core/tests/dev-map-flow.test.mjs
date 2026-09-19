import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGraph} from '../../scripts/dev-map/graph.mjs';
import {loadFlow,flowPacket,flowPage} from '../../scripts/dev-map/flow.mjs';

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
  finish(){const out=this.list;return out;}
}
export class Other{place(item){return item;}}
`,
  'core/prep.mjs':`export function prepare(list){const out=clean(list);return out;}
export function clean(list){return list.slice();}
`};
const files=Object.keys(sources),readSource=file=>sources[file];
const graph=options=>extractGraph({repo:'',files,readSource,...options});
const anchors=g=>new Map(g.declarations.map(d=>[d.id,d.anchor]));

test('a receiver resolves through its value; a method name alone links nothing',async()=>{
  const g=await graph({literalCouplings:true,receiverCalls:true}),name=anchors(g);
  const added=g.relations.filter(r=>r.resolvedBy).map(r=>[r.resolvedBy,name.get(r.from),name.get(r.to)]);
  // `tool` is a parameter; its value comes from the caller's argument.
  assert.deepEqual(added,[
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::begin'],
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::heat'],
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::place'],
    ['receiver-value','core/main.mjs::run','core/tool.mjs::Tool::finish']]);
  // `place` and `finish` are declared in mapped code and the receiver is unknown: both stay
  // unresolved. Neither is linked by name alone, and neither is called external.
  assert.ok(!g.relations.some(r=>name.get(r.from)==='core/main.mjs::detached'));
  assert.deepEqual(g.callSites.unresolved.map(u=>[name.get(u.from),u.name,u.reason]),
    [['core/main.mjs::detached','place','member-receiver-unresolved'],
      ['core/main.mjs::lone','finish','member-receiver-unresolved']]);
  // `list.push` and `list.slice` carry names no mapped declaration carries: external, not linked.
  assert.deepEqual(g.callSites.external,{'member-name-not-in-mapped-code':2});
  assert.deepEqual(g.callSites.linked,{'ast-call-site':4,'receiver-value':4,'value-follow':0});
  assert.equal(g.callSites.states.linked+g.callSites.states.external+g.callSites.states.unresolved,12);
});

test('receiver resolution is opt-in and leaves the relations before it identical',async()=>{
  const base=await graph({literalCouplings:true}),with_=await graph({literalCouplings:true,receiverCalls:true});
  assert.ok(!('callSites' in base));
  assert.deepEqual(with_.relations.slice(0,base.relations.length),base.relations);
  assert.equal(with_.relations.length-base.relations.length,4);
  await assert.rejects(graph({receiverCalls:true}),/needs literalCouplings/);
});

// Every EXTERNAL rule, with the negative case beside it: a same-named mapped method plus an
// unknown receiver is UNRESOLVED, never external and never linked.
const external={
  'core/rules.mjs':`import {readFile} from 'node:fs/promises';
import {local} from './held.mjs';
export function byName(bag){return bag.notAMappedName(1);}
export function byGlobal(){return Math.hold(1,2);}
export function byLiteral(){return [1,2].hold();}
export function byNewUnbound(){const m=new Map();return m.hold();}
export function byPackageImport(){return readFile('x');}
export function byExternalCallResult(){const t=Date.now();return t.hold();}
export function byUnboundCallee(){return setTimeout(1);}
export function byPackageCallee(){return readFile('y');}
export function unknownHost(bag){return bag.hold(2);}
export function mapped(){return local.hold();}
`,
  'core/held.mjs':`export const local={hold(n){return n;}};
`};
test('each external rule fires on its own shape, and a same-named mapped method is not external',async()=>{
  const g=await extractGraph({repo:'',files:Object.keys(external),readSource:f=>external[f],literalCouplings:true,receiverCalls:true});
  const name=anchors(g),rules={};
  for(const [key,rule] of Object.entries(g.callSites.unlinked))rules[key.split(':')[1]]=rule;
  const of=fn=>{const d=g.declarations.find(d=>d.anchor===`core/rules.mjs::${fn}`);
    return Object.entries(g.callSites.unlinked).filter(([k])=>{const at=Number(k.split(':')[1]);return at>=d.start&&at<d.end;}).map(([,r])=>r);};
  assert.deepEqual(of('byName'),['member-name-not-in-mapped-code']);
  assert.deepEqual(of('byGlobal'),['unbound-receiver-root']);
  assert.deepEqual(of('byLiteral'),['receiver-literal']);
  assert.deepEqual(of('byNewUnbound'),['unbound-callee','receiver-new-of-unbound-class']);
  assert.deepEqual(of('byPackageImport'),['callee-package-import']);
  assert.deepEqual(of('byExternalCallResult'),['member-name-not-in-mapped-code','receiver-external-call-result']);
  assert.deepEqual(of('byUnboundCallee'),['unbound-callee']);
  assert.deepEqual(of('byPackageCallee'),['callee-package-import']);
  // `hold` is carried by core/held.mjs, so an unknown receiver cannot be called external.
  assert.deepEqual(of('unknownHost'),['member-receiver-unresolved']);
  assert.deepEqual(g.callSites.unresolved.map(u=>[name.get(u.from),u.name]),[['core/rules.mjs::unknownHost','hold']]);
  // The same member name on a receiver that does resolve is linked instead.
  assert.deepEqual(g.relations.filter(r=>r.kind==='call'&&name.get(r.from)==='core/rules.mjs::mapped').map(r=>name.get(r.to)),
    ['core/held.mjs::local::hold']);
});

const factory={
  'core/session.mjs':`function load(id){return id;}
function save(id){return id;}
export function sourceSession(){return {load,save};}
export function pickSession(flag){return flag?sourceSession():otherSession();}
export function otherSession(){return {load:loadTwice};}
function loadTwice(id){return id;}
`,
  'core/use.mjs':`import {sourceSession,pickSession} from './session.mjs';
export function direct(){const s=sourceSession();return s.load(1);}
export function destructured(){const {save}=sourceSession();return save(2);}
export function twoDefinitions(flag){const {load}=pickSession(flag);return load(3);}
`};
test('a factory-returned object links its members, through a name, a destructuring or two definitions',async()=>{
  const g=await extractGraph({repo:'',files:Object.keys(factory),readSource:f=>factory[f],literalCouplings:true,receiverCalls:true});
  const name=anchors(g);
  const links=g.relations.filter(r=>['call','construct'].includes(r.kind)&&name.get(r.from)?.startsWith('core/use.mjs'))
    .map(r=>[name.get(r.from),name.get(r.to),r.resolvedBy??'ast-call-site',!!r.possible]);
  assert.deepEqual(links.filter(l=>l[0]==='core/use.mjs::direct'),
    [['core/use.mjs::direct','core/session.mjs::sourceSession','ast-call-site',false],
      ['core/use.mjs::direct','core/session.mjs::load','ast-call-site',false]]);
  // `const {save}=sourceSession()` — the binding is followed back to the object it came from.
  assert.deepEqual(links.filter(l=>l[0]==='core/use.mjs::destructured'),
    [['core/use.mjs::destructured','core/session.mjs::sourceSession','ast-call-site',false],
      ['core/use.mjs::destructured','core/session.mjs::save','value-follow',false]]);
  // Two reaching definitions of the destructured name give two links, both flagged possible.
  assert.deepEqual(links.filter(l=>l[0]==='core/use.mjs::twoDefinitions'&&l[2]!=='ast-call-site').sort(),
    [['core/use.mjs::twoDefinitions','core/session.mjs::load','value-follow',true],
      ['core/use.mjs::twoDefinitions','core/session.mjs::loadTwice','value-follow',true]]);
});

const page=async(target,files,sources)=>flowPage(await loadFlow({repo:'',files,readSource:f=>sources[f]}),target);
const packet=async(target,options)=>flowPacket(await loadFlow({repo:'',files,readSource}),target,options);

test('a function body reads as a flow: parameters in, callees in call order, returns out',async()=>{
  const p=await page('core/main.mjs::run',files,sources);
  assert.deepEqual(p.inputs,['tool','items','limit'].map((name,i)=>({port:`in${i+1}`,name,position:i+1,pattern:name,provenance:'ast-param'})));
  // Order is the first call site, not the declaration order of the callees.
  assert.deepEqual(p.components.map(c=>[c.order,c.label,c.calls,c.links.join()]),[[1,'prepare',1,'ast-call-site'],
    [2,'begin',1,'receiver-value'],[3,'heat',1,'receiver-value'],[4,'place',1,'receiver-value'],[5,'finish',1,'receiver-value']]);
  assert.deepEqual(p.outputs,[{port:'out1',name:'tool.finish()',kind:'return',lines:[11],provenance:'ast-return'}]);
  assert.ok(p.components.every(c=>c.foot===`${c.file.split('/').pop()}:${c.line}-${c.endLine}`));
  assert.ok(p.components.every(c=>c.lines===c.endLine-c.line+1));
});

test('wires retain local def-use and every gate; uncertain receiver execution order is explicit',async()=>{
  const p=await page('core/main.mjs::run',files,sources),path=n=>`core/tool.mjs::Tool::${n}`;
  const wire=(from,to)=>p.wires.filter(w=>w.from===from&&w.to===to).map(w=>[w.label,w.kind,w.provenance,w.gate?.text??null]);
  assert.deepEqual(wire('in2','core/prep.mjs::prepare'),[['items','data','ast-param',null]]);
  // `ready` is the result of prepare bound to a name and passed on, twice over.
  assert.deepEqual(wire('core/prep.mjs::prepare',path('begin')),[['ready','data','ast-def-use',null]]);
  const iteration=p.operators.find(o=>o.kind==='iteration'&&o.item==='item');
  assert.deepEqual(wire('core/prep.mjs::prepare',iteration.id),[['ready','data','ast-iteration',null]]);
  assert.deepEqual(wire(iteration.id,path('heat')),[['item','data','ast-def-use','(of ready) ∧ (item.hot)']]);
  assert.ok(p.wires.find(w=>w.from===iteration.id&&w.to===path('heat')).fromPort==='item');
  assert.deepEqual(wire('in3',path('heat')),[['limit','data','ast-param','(of ready) ∧ (item.hot)']]);
  assert.deepEqual(p.wires.filter(w=>w.kind==='state'),[]);
  assert.ok(p.uncertainty.some(u=>u.kind==='receiver-state-order'&&u.receiver==='tool'));
  assert.deepEqual(wire(path('finish'),'out1'),[['','return','ast-return']].map(w=>[...w,null]));
  // The gate a component carries is the gate every one of its call sites is under.
  assert.deepEqual(p.components.map(c=>c.gate?.text??null),[null,null,'(of ready) ∧ (item.hot)','of ready',null]);
  assert.ok(p.components.every(c=>!c.gate||c.gate.provenance==='ast-guard'));
});

const shadow={
  'core/shadow.mjs':`import {first,second,sink} from './parts.mjs';
export function shadowed(input){
  const value=first(input);
  for(const item of input){
    const value=second(item);
    sink(value);
  }
  return value;
}
`,
  'core/parts.mjs':`export function first(x){const a=x;return a;}
export function second(x){const b=x;return b;}
export function sink(x){const c=x;return c;}
`};
test('def-use follows the binding, so a shadowed name carries nothing from the outer one',async()=>{
  const p=await page('core/shadow.mjs::shadowed',Object.keys(shadow),shadow);
  const into=to=>p.wires.filter(w=>w.to===to).map(w=>[w.from,w.label]);
  // `value` inside the loop is the result of `second`; the outer `value` never reaches `sink`.
  assert.deepEqual(into('core/parts.mjs::sink'),[['core/parts.mjs::second','value']]);
  assert.deepEqual(into('out1'),[['core/parts.mjs::first','value']]);
});

const exits={
  'core/exits.mjs':`import {check,build} from './work.mjs';
export function guarded(plan){
  if(!plan)return null;
  if(plan.bad)throw new Error('bad plan');
  const made=build(plan);
  if(!check(made))throw new TypeError(made.reason);
  return made;
}
`,
  'core/work.mjs':`export function check(x){const ok=!!x;return ok;}
export function build(x){const made=x;return made;}
`};
test('every return and every throw is an output port carrying the test it is written under',async()=>{
  const p=await page('core/exits.mjs::guarded',Object.keys(exits),exits);
  assert.deepEqual(p.outputs.map(o=>[o.port,o.name,o.kind,o.gate?.text??null,o.lines.join()]),
    [['out1','null','return','!plan','3'],
      ['out2',"Error('bad plan')",'throw','plan.bad','4'],
      ['out3','TypeError','throw','!check(made)','6'],
      ['out4','made','return',null,'7']]);
  assert.ok(p.outputs.every(o=>o.provenance===(o.kind==='throw'?'ast-throw':'ast-return')));
  // Neither component runs under a test of its own, and no negated gate is synthesized for the
  // early-exit guards they are written after.
  assert.deepEqual(p.components.map(c=>[c.label,c.gate?.text??null]),[['build',null],['check',null]]);
  assert.deepEqual(p.wires.filter(w=>w.to==='out4').map(w=>[w.from,w.label]),[['core/work.mjs::build','made']]);
});

test('every element of a flow page names the mechanism that produced it',async()=>{
  const p=await page('core/main.mjs::run',files,sources);
  const elements=[...p.inputs,...p.outputs,...p.components,...(p.operators??[]),...p.components.flatMap(c=>c.sites),...p.wires];
  assert.ok(elements.length>0&&elements.every(e=>typeof e.provenance==='string'&&e.provenance));
  const allowed=new Set(['ast-call-site','ast-closure','ast-def-use','ast-param','ast-return','ast-throw','ast-guard',
    'receiver-value','value-follow','state-thread','ast-nested-call','ast-member','ast-assertion','ast-choice','ast-iteration']);
  assert.ok(elements.every(e=>allowed.has(e.provenance)));
  assert.ok(p.components.flatMap(c=>c.sites).every(s=>allowed.has(s.link)));
  assert.ok(p.wires.every(w=>!w.gate||w.gate.provenance==='ast-guard'));
  // A call the scanner cannot name is listed; a call it can prove external is listed separately.
  assert.deepEqual(p.unresolved,[]);
  assert.deepEqual(p.external,[]);
  const clean=await page('core/prep.mjs::clean',files,sources);
  assert.deepEqual(clean.external,[{call:'list.slice',line:2,column:36,state:'external',rule:'member-name-not-in-mapped-code'}]);
  assert.deepEqual(p.authored,[]);
});

test('the agent packet keys everything by index, states each gate once and carries no sentences',async()=>{
  const p=await packet('core/main.mjs::run');
  const handles=new Set(p.components.map(c=>c.index));
  assert.equal(handles.size,p.components.length);
  // Wires name handles and ports, nothing else; no declaration path is repeated.
  const ports=new Set([...p.inputs.map(i=>i.port),...p.outputs.map(o=>o.port),...(p.operators??[]).map(o=>o.id)]);
  assert.ok(p.wires.every(w=>(handles.has(w.from)||ports.has(w.from))&&(handles.has(w.to)||ports.has(w.to))));
  assert.ok(p.components.every(c=>!('path' in c)&&!('foot' in c)&&!('order' in c)&&!('sites' in c)));
  // A component's path is its file and its label; the round trip is exact.
  const full=await page('core/main.mjs::run',files,sources);
  assert.deepEqual(p.components.map(c=>`${c.file}::${c.label}`),full.components.map(c=>c.path));
  assert.deepEqual(p.components.map(c=>c.index),full.components.map(c=>c.handle));
  // Gates are stated once and referenced by index.
  const predicate=g=>({text:g.text,kind:g.kind,...(g.terms?{terms:g.terms.map(predicate)}:{})});
  assert.deepEqual(p.gates.map(predicate),[{text:'(of ready) ∧ (item.hot)',kind:'all',terms:[{text:'of ready',kind:'loop'},{text:'item.hot',kind:'if'}]},
    {text:'of ready',kind:'loop'}]);
  assert.ok(p.wires.filter(w=>'gate' in w).every(w=>typeof w.gate==='number'&&p.gates[w.gate]));
  // Provenance survives only where the mechanism is not the plain AST default.
  assert.ok(p.wires.filter(w=>w.kind==='state').every(w=>w.provenance==='state-thread'));
  assert.ok(p.wires.every(w=>!('provenance' in w)||['state-thread','ast-choice','ast-iteration'].includes(w.provenance)));
  assert.ok(p.wires.some(w=>!('provenance' in w)));
  assert.ok(!('limits' in p)&&!('weak' in p)&&!('withheldWires' in p)&&!('vocabulary' in p)&&!('heuristics' in p));
  // No sentences: every string is a source slice, a path, a handle or a rule name. The longest
  // gate or exit slice on this page bounds what a packet string may contain.
  const strings=[],collect=v=>{if(typeof v==='string')strings.push(v);
    else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};
  collect(p);
  const slices=[...p.gates.map(g=>g.text),...p.outputs.map(o=>o.name)];
  const longest=Math.max(...slices.map(s=>s.length));
  assert.ok(strings.every(s=>!s.includes(' ')||slices.includes(s)||s.length<=longest));
  assert.ok(strings.every(s=>!/[.!?] /.test(s)));
});

test('the audit read adds the call sites and the external sites the packet only counts',async()=>{
  const lean=await packet('core/main.mjs::run'),full=await packet('core/main.mjs::run',{evidence:true});
  assert.ok(full.components.every(c=>Array.isArray(c.sites)&&c.sites.every(s=>typeof s.line==='number'&&typeof s.column==='number'&&s.link)));
  assert.deepEqual(full.components.map(c=>c.sites.map(s=>s.link).join()),['ast-call-site','receiver-value','receiver-value','receiver-value','receiver-value']);
  assert.equal(typeof lean.external,'number');
  assert.ok('externalSites' in full&&!('externalSites' in lean));
  assert.ok(JSON.stringify(full).length>JSON.stringify(lean).length);
});

// ---- shapes ------------------------------------------------------------------------------
const shaped={
  'core/alpha/entry.mjs':`import {helper,take} from './helper.mjs';
import {shared} from '../beta/shared.mjs';
export function main(input){
  const plan=helper(input);
  shared(plan);
  return take(plan);
}
`,
  'core/alpha/helper.mjs':`import {guardThat} from '../beta/guards.mjs';
import {scale} from '../beta/math.mjs';
export function helper(input){
  guardThat(input.length>0,'needs input');
  const size=scale(input,2);
  return take(size);
}
export function take(v){const out=v;return out;}
`,
  'core/beta/shared.mjs':`export function shared(plan){const seen=plan;return seen;}
export function ping(){const a=pong();return a;}
export function pong(){const b=ping();return b;}
`,
  'core/beta/guards.mjs':`export function guardThat(ok,why){ if(!ok) throw new Error(why); }
export function alsoThrows(ok,why){ const n=ok?1:2; if(!n) throw new Error(why); return n; }
`,
  'core/beta/math.mjs':`export function scale(v,by){return v.map(x=>x*by);}
export class Box{
  constructor(){this.n=0;}
  bump(v){return this.n+=v;}
  value(){const v=this.n;return v;}
}
`};
const shapedFiles=Object.keys(shaped);
const shapedContext=()=>loadFlow({repo:'',files:shapedFiles,readSource:f=>shaped[f]});

test('an assertion keeps its connected call and detailed requirement evidence',async()=>{
  const context=await shapedContext();
  assert.deepEqual([...context.shapes.assertions.keys()],['core/beta/guards.mjs::guardThat']);
  // A function that throws and also does work is not an assertion.
  assert.ok(!context.shapes.assertions.has('core/beta/guards.mjs::alsoThrows'));
  const p=flowPacket(context,'core/alpha/helper.mjs::helper');
  assert.deepEqual(p.requires,[{text:'input.length>0',message:'needs input',line:4,
    by:'core/beta/guards.mjs::guardThat',index:p.requires[0].index}]);
  const guard=p.components.find(c=>c.label==='guardThat');assert.equal(guard.shape,'assertion');
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===guard.index&&w.toPort==='arg1'));
});

test('an external method call is not certified as a formula, even in one returned expression',async()=>{
  const context=await shapedContext();
  assert.ok(!context.shapes.formulas.has('core/beta/math.mjs::scale'));
  // A one-line body that mutates is not a formula, whatever it returns.
  assert.ok(!context.shapes.formulas.has('core/beta/math.mjs::Box::bump'));
  const p=flowPacket(context,'core/alpha/helper.mjs::helper');
  const scale=p.components.find(c=>c.label==='scale').index;
  // A caller can discover this operation; the unknown receiver's map method may have effects.
  const into=p.components.find(c=>c.label==='take').index;
  assert.deepEqual(p.wires.filter(w=>w.to===into).map(w=>[w.from,w.label]),[[scale,'size']]);
});

// ---- the stored map ----------------------------------------------------------------------
import {mkdtemp,rm,readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {generate,readGenerated,readCode,storeDir} from '../../scripts/dev-map/store.mjs';

const fixtureStore=async(t,source=shaped)=>{
  const repo=await mkdtemp(resolve(tmpdir(),'saam-map-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  const held={...source};
  const read=file=>held[file];
  const run=(region=null)=>generate({repo,region,files:Object.keys(held),readSource:read});
  return {repo,held,read,run,page:(key,options={})=>readGenerated(key,{repo,readSource:read,...options}),
    code:key=>readCode(key,{repo,readSource:read})};
};
const snapshot=async dir=>{
  const out=new Map();
  const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})) {
    const at=resolve(d,e.name);
    if(e.isDirectory())await walk(at);
    else out.set(at.slice(dir.length+1).replaceAll('\\','/'),createHash('sha256').update(await readFile(at)).digest('hex'));
  }};
  await walk(dir);return out;
};

test('the store round-trips: a read returns the stored page and never scans',async t=>{
  const fixture=await fixtureStore(t);
  const result=await fixture.run();
  assert.equal(result.regions,2);
  const root=await fixture.page('0');
  assert.deepEqual(root.regions.map(r=>[r.index,r.path]),[['1','core/alpha'],['2','core/beta']]);
  const main=await fixture.page('core/alpha/entry.mjs::main');
  const entryFile=await fixture.page('core/alpha/entry.mjs');
  assert.equal(entryFile.kind,'file');
  assert.equal(main.index,entryFile.components.find(c=>c.label==='main').index);
  // The region page holds the region's files, in sorted path order.
  assert.deepEqual((await fixture.page('1')).components.map(c=>[c.index,c.file]),
    [['1.1','core/alpha/entry.mjs'],['1.2','core/alpha/helper.mjs']]);
  // The same page comes back by index and by declaration path.
  assert.deepEqual(await fixture.page(main.index),main);
  assert.ok(!('stale' in main));
  // A read with no store at all asks for a full generation and returns no page.
  const empty=await mkdtemp(resolve(tmpdir(),'saam-map-'));
  t.after(()=>rm(empty,{recursive:true,force:true}));
  assert.deepEqual(await readGenerated('0',{repo:empty}),{generated:true,stale:{regenerate:'0'}});
});

test('a scoped regeneration equals a full one, and leaves every other region byte-identical',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const dir=storeDir(fixture.repo),base=await snapshot(dir);
  // With no source change, regenerating each region in turn changes nothing at all.
  for(const region of ['1','2']) {
    await fixture.run(region);
    assert.deepEqual([...await snapshot(dir)].sort(),[...base].sort());
  }
  // One file changes: the scoped regeneration of its region matches a full one exactly.
  fixture.held['core/alpha/helper.mjs']=fixture.held['core/alpha/helper.mjs'].replace('scale(input,2)','scale(input,3)');
  await fixture.run('1');
  const scoped=await snapshot(dir);
  await fixture.run();
  assert.deepEqual([...await snapshot(dir)].sort(),[...scoped].sort());
});

test('a read marks changed generation inputs on every potentially dependent page',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  fixture.held['core/alpha/helper.mjs']+='export function later(x){const y=x;return y;}\n';
  const page=await fixture.page('core/alpha/helper.mjs::helper');
  const stale={regenerate:'0',reason:'generation-dependencies-changed',files:['core/alpha/helper.mjs'],changed:['core/alpha/helper.mjs']};
  assert.deepEqual(page.stale,stale);
  assert.ok(page.components.length,'the stored page is still returned');
  // Page 0 hashes every file behind the regions it shows.
  assert.deepEqual((await fixture.page('0')).stale,stale);
  assert.deepEqual((await fixture.page('2')).stale,stale);
});

test('numbering is region-local: a change in one region leaves the other indexes alone',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const index=async()=>JSON.parse(await readFile(resolve(storeDir(fixture.repo),'index.json'),'utf8'));
  const before=(await fixture.page('2')).components.map(c=>[c.index,c.label]);
  const beforePaths=Object.entries((await index()).byPath).filter(([,at])=>at.split('.')[0]==='2');
  fixture.held['core/alpha/entry.mjs']='export function extra(x){const y=x;return y;}\n'+fixture.held['core/alpha/entry.mjs'];
  await fixture.run('1');
  assert.deepEqual((await fixture.page('2')).components.map(c=>[c.index,c.label]),before);
  assert.deepEqual(Object.entries((await index()).byPath).filter(([,at])=>at.split('.')[0]==='2'),beforePaths);
});

test('a node called from two pages carries one canonical index, and calledFrom is their inverse',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const main=await fixture.page('core/alpha/entry.mjs::main'),helper=await fixture.page('core/alpha/helper.mjs::helper');
  const take=await fixture.page('core/alpha/helper.mjs::take');
  assert.equal(main.components.find(c=>c.label==='take').index,take.index);
  assert.equal(helper.components.find(c=>c.label==='take').index,take.index);
  assert.deepEqual(take.calledFrom.map(c=>c.index).sort(),[helper.index,main.index].sort());
  // Incoming callers invert call components, not class/closure containment.
  const held=JSON.parse(await readFile(resolve(storeDir(fixture.repo),'index.json'),'utf8'));
  const pages=[];
  for(const record of Object.values(held.records))
    pages.push(...Object.values(JSON.parse(await readFile(resolve(storeDir(fixture.repo),'files',record),'utf8')).pages));
  const forward=new Set(pages.flatMap(p=>p.components.filter(c=>c.calls!==0).map(c=>`${held.byPath[`${c.file}::${c.label}`]}<-${p.index}`)));
  const back=new Set(pages.flatMap(p=>p.calledFrom.map(c=>`${p.index}<-${c.index}`)));
  assert.deepEqual([...forward].sort(),[...back].sort());
});

test('every declaration stays on its own file page even when no entry calls it',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const shared=await fixture.page('core/beta/shared.mjs');
  assert.deepEqual(shared.components.map(n=>n.label).sort(),['ping','pong','shared']);
  const ping=await fixture.page('core/beta/shared.mjs::ping'),pong=await fixture.page('core/beta/shared.mjs::pong');
  assert.equal(ping.components.find(c=>c.label==='pong').index,pong.index);
  assert.equal(pong.components.find(c=>c.label==='ping').index,ping.index);
  // Every node of the region is reachable by walking down from its file's boxes.
  const held=JSON.parse(await readFile(resolve(storeDir(fixture.repo),'index.json'),'utf8'));
  const inRegion=Object.entries(held.nodes).filter(([at])=>at.split('.')[0]==='2').map(([at])=>at);
  const roots=[];
  for(const at of Object.keys(held.filePages))if(at.split('.')[0]==='2') {
    const file=await fixture.page(at);
    roots.push(...[...file.components,...file.unreached.nodes].map(c=>c.index));
  }
  assert.ok(inRegion.every(at=>roots.some(root=>at===root||at.startsWith(root+'.'))));
});

test('the code read answers a declaration span or all files in a region, and refuses root',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const code=await fixture.code('core/alpha/entry.mjs::main');
  assert.equal(code.code,true);
  assert.equal(code.source.split('\n').length,code.endLine-code.line+1);
  assert.match(code.source.split('\n')[0],/^3\texport function main\(input\)/);
  const leaf=await fixture.code('core/alpha/helper.mjs::take');
  assert.equal(leaf.code,true);
  assert.match(leaf.source,/export function take/);
  await assert.rejects(fixture.code('0'),/root page/);
  const region=await fixture.code('1');
  assert.equal(region.kind,'region');
  assert.deepEqual(region.sources.map(s=>s.file),['core/alpha/entry.mjs','core/alpha/helper.mjs']);
  for(const source of region.sources)assert.equal(source.source.split('\n').length,source.lines);
});

test('no packet in the store carries a sentence',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const held=JSON.parse(await readFile(resolve(storeDir(fixture.repo),'index.json'),'utf8'));
  const strings=[],collect=v=>{if(typeof v==='string')strings.push(v);
    else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};
  collect(held.root);collect(held.regionPages);
  for(const record of Object.values(held.records)) {
    const stored=JSON.parse(await readFile(resolve(storeDir(fixture.repo),'files',record),'utf8'));
    collect(stored.pages);collect(stored.sourcePages??{});
  }
  assert.ok(strings.length>200);
  assert.ok(strings.every(s=>!/[.!?] [A-Z]/.test(s)),'no sentence boundaries');
  assert.ok(strings.every(s=>s.split(' ').length<=12));
});

// ---- shapes tightened, and every node listed ----------------------------------------------
const tightened={
  'core/shape/use.mjs':`import {plain,waits,builds,blocky,loose} from './forms.mjs';
export function useAll(x){return [plain(x),waits(x),builds(x),blocky(x),loose(x)];}
`,
  'core/shape/forms.mjs':`export const plain=x=>x+1;
export const waits=async x=>await plain(x);
export const builds=x=>new Error(x);
export const blocky=x=>[x].map(v=>{return v+1;});
export const loose=x=>x.reach(1);
export class Holder{reach(n){return n;}}
`};

test('a formula only computes: async, await, new, a block-bodied callback or an unresolved call is not one',async()=>{
  const context=await loadFlow({repo:'',files:Object.keys(tightened),readSource:f=>tightened[f]});
  const has=n=>context.shapes.formulas.has(`core/shape/forms.mjs::${n}`);
  assert.ok(has('plain'));
  for(const n of ['waits','builds','blocky','loose'])assert.ok(!has(n),`${n} is not a formula`);
  // `loose` is rejected by the call it makes, not by its own body shape: the receiver is a
  // parameter and `reach` is a name mapped code carries, so the site stays UNRESOLVED.
  assert.equal(context.graph.callSites.unresolved.find(u=>u.name==='reach').reason,'member-receiver-unresolved');
  const p=flowPacket(context,'core/shape/use.mjs::useAll');
  assert.deepEqual(p.formulas,[]);
  assert.deepEqual(p.components.map(c=>c.label).sort(),['blocky','builds','loose','plain','waits']);
  const plain=p.components.find(c=>c.label==='plain');
  assert.equal(plain.shape,'formula');
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===plain.index));
  assert.ok(p.wires.some(w=>w.from===plain.index&&w.to==='out1'));
});

test('pure planning stages remain visible with their own result wires',async()=>{
  const source={'core/planning/stages.mjs':`export const planContext=(state,context)=>({...state,context});
export const planFan=(state,fan)=>({...state,fan});
export const planDwell=(state,seconds)=>({...state,seconds});
export function plan(state,context,fan,seconds){
  const contextual=planContext(state,context);
  const cooled=planFan(contextual,fan);
  const held=planDwell(cooled,seconds);
  return held;
}`};
  const context=await loadFlow({repo:'',files:Object.keys(source),readSource:f=>source[f]});
  const p=flowPacket(context,'core/planning/stages.mjs::plan'),at=Object.fromEntries(p.components.map(c=>[c.label,c.index]));
  assert.deepEqual(p.components.map(c=>c.label),['planContext','planFan','planDwell']);
  assert.ok(p.components.every(c=>c.shape==='formula'));
  for(const [from,to,label] of [['in1',at.planContext,'state'],[at.planContext,at.planFan,'contextual'],
    [at.planFan,at.planDwell,'cooled'],[at.planDwell,'out1','held']])
    assert.ok(p.wires.some(w=>w.from===from&&w.to===to&&w.label===label),`${from} → ${to} carries ${label}`);
  assert.ok(!p.wires.some(w=>w.from==='in1'&&w.to==='out1'),'pure transformations do not become passthrough wires');
});

const nullish={
  'core/shape/pick.mjs':`import {fallback} from './other.mjs';
export function pick(a){return a.chosen??fallback(a);}
`,
  'core/shape/other.mjs':`export function fallback(a){const out=a;return out;}
`};

test('a nullish gate is the left operand as written, not a synthesized null test',async()=>{
  const context=await loadFlow({repo:'',files:Object.keys(nullish),readSource:f=>nullish[f]});
  const p=flowPacket(context,'core/shape/pick.mjs::pick');
  assert.deepEqual(p.gates.map(({text,kind})=>({text,kind})),[{text:'a.chosen',kind:'??'}]);
  assert.equal(p.gates[0].name,'a.chosen');assert.equal(p.gates[0].source.file,'core/shape/pick.mjs');
  const source=nullish['core/shape/pick.mjs'];
  assert.ok(p.gates.every(g=>source.includes(g.text)),'every gate is a slice of the source');
});

// ---- the file level -----------------------------------------------------------------------
test('a region holds its files, a file holds its entries, and every node is reachable from 0',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const region=await fixture.page('1');
  assert.equal(region.kind,'region');
  assert.deepEqual(region.components.map(c=>[c.index,c.file]),
    [['1.1','core/alpha/entry.mjs'],['1.2','core/alpha/helper.mjs']]);
  const file=await fixture.page('1.2');
  assert.equal(file.kind,'file');
  assert.equal(file.file,'core/alpha/helper.mjs');
  assert.ok(file.components.every(c=>c.index.startsWith('1.2.')));
  // Following the lists from 0 reaches every node the store holds.
  const held=JSON.parse(await readFile(resolve(storeDir(fixture.repo),'index.json'),'utf8'));
  const reached=new Set(),queue=[];
  const see=at=>{if(at!==undefined&&at!==null&&!reached.has(String(at))){reached.add(String(at));queue.push(String(at));}};
  for(const r of held.root.regions)see(r.index);
  while(queue.length) {
    const at=queue.shift(),page=await fixture.page(at);
    for(const list of [page.regions,page.components,page.formulas,page.unreached?.nodes])for(const x of list??[])see(x.index);
    for(const r of page.requires??[])see(r.index);
  }
  assert.deepEqual(Object.keys(held.nodes).filter(at=>!reached.has(at)),[]);
});

test('a file page answers --code with the whole file; only the root refuses',async t=>{
  const fixture=await fixtureStore(t);
  await fixture.run();
  const code=await fixture.code('core/alpha/helper.mjs');
  assert.equal(code.code,true);
  assert.equal(code.kind,'file');
  assert.equal(code.line,1);
  assert.equal(code.source.split('\n').length,code.lines);
  assert.match(code.source.split('\n')[0],/^1\timport \{guardThat\}/);
  await assert.rejects(fixture.code('0'),/root page/);
  assert.equal((await fixture.code('1')).sources.length,2);
  // Every box on a file page states its size before it is read.
  const file=await fixture.page('core/alpha/helper.mjs');
  assert.ok(file.components.every(c=>typeof c.lines==='number'));
});

// ---- classes, outside roots and registrations ---------------------------------------------
const klass={
  'core/cls/box.mjs':`export class Box{
  constructor(){this.total=0;this.log=[];}
  add(v){this.total+=v;this.note(v);}
  note(v){this.log.push(v);}
  read(){const t=this.total;return t;}
}
`,
  'core/cls/use.mjs':`import {Box} from './box.mjs';
export function tally(list){const b=new Box();for(const v of list)b.add(v);return b.read();}
`};

test('a class page is its members, the calls between them, the fields they share and who calls in',async()=>{
  const context=await loadFlow({repo:'',files:Object.keys(klass),readSource:f=>klass[f]});
  const p=flowPacket(context,'core/cls/box.mjs::Box');
  const at=new Map(p.components.map(c=>[c.label.split('::').at(-1),c.index]));
  assert.deepEqual([...at.keys()],['constructor','add','note','read']);
  const wire=(from,to,kind,label)=>p.wires.some(w=>w.from===at.get(from)&&w.to===at.get(to)&&w.kind===kind&&(label===undefined||w.label===label));
  assert.ok(wire('add','note','call'),'a method calling another is a wire');
  assert.ok(wire('constructor','read','state','total'),'a field written in one member and read in another is a state wire');
  assert.ok(wire('constructor','note','state','log'));
  assert.ok(!wire('read','note','state'),'members sharing no field are not wired');
  assert.deepEqual(p.ports.map(x=>x.label),['tally']);
});

test('an outside root is a port, not a region',async t=>{
  const fixture=await fixtureStore(t,{...shaped,
    'scripts/cli.mjs':`import {main} from '../core/alpha/entry.mjs';\nexport function run(x){return main(x);}\n`});
  await fixture.run();
  const root=await fixture.page('0');
  assert.ok(!root.regions.some(r=>r.path.startsWith('scripts')),'scripts is mapped as no region');
  assert.ok(root.ports.some(p=>p.port==='scripts'),'scripts reaches the map as a port');
  assert.ok(root.wires.some(w=>w.from==='scripts'&&w.to==='1'));
  const file=await fixture.page('core/alpha/entry.mjs');
  assert.ok(file.ports.some(p=>p.port==='scripts'));
});

const events={
  'core/ev/host.mjs':`export function attach(bus,name){
  bus.on('ready',handleReady);
  bus.once('tick',handleTick);
  bus.send('ready',plainValue);
  bus.on(name,handleReady);
  bus.on('late',plainValue);
  return bus;
}
export function handleReady(e){const x=e;return x;}
export function handleTick(){const y=1;return y;}
const plainValue=1;
`};

test('a registration shape makes its handler an entry; a non-literal or non-function does not',async t=>{
  const g=await extractGraph({repo:'',files:Object.keys(events),readSource:f=>events[f],
    literalCouplings:true,receiverCalls:true});
  const name=anchors(g);
  // `send` is handed no function, `bus.on(name,…)` no literal and `bus.on('late',plainValue)` no
  // function value: the call shape decides, and the method's spelling never does.
  assert.deepEqual(g.relations.filter(r=>r.kind==='event-listener').map(r=>[r.receiver,r.label,name.get(r.to)]),
    [['on','ready','core/ev/host.mjs::handleReady'],['once','tick','core/ev/host.mjs::handleTick']]);
  const fixture=await fixtureStore(t,events);
  await fixture.run();
  const file=await fixture.page('core/ev/host.mjs');
  assert.ok(file.ports.some(p=>p.port==='event-listener'));
  const handler=await fixture.page('core/ev/host.mjs::handleReady');
  assert.deepEqual(file.wires.filter(w=>w.to===handler.index&&w.from==='event-listener').map(w=>w.label),['ready']);
});

// ---- external facts ------------------------------------------------------------------------
import {readFacts,factsPath} from '../../scripts/dev-map/facts.mjs';
import {storeStatus} from '../../scripts/dev-map/store.mjs';

const writeFacts=async(repo,rows)=>{
  await mkdir(resolve(repo,'maps'),{recursive:true});
  await writeFile(resolve(repo,factsPath),['declaration\tkind\tfact\tsource\tdate',...rows].join('\n')+'\n','utf8');
};
const writeDecisions=repo=>writeFile(resolve(repo,'DECISIONS.md'),
  '# Decisions\n\n## D-007 — Keep the nozzle warm between operations\n\n- Status: accepted\n','utf8');

test('an external fact attaches to the page of the declaration or file it names',async t=>{
  const fixture=await fixtureStore(t);
  await writeFacts(fixture.repo,[
    'core/alpha/entry.mjs::main\tmeasurement\t0.42 mm bead at 12 mm/s\tDEVLOG.md\t2026-09-18',
    'core/alpha/entry.mjs::main\tvendor\tfirmware 01.08 rejects M204 above 8000\tvendor note\t2026-09-01',
    'core/alpha/helper.mjs\tmeasurement\t3.1 s median over 20 runs\tDEVLOG.md\t2026-09-10']);
  const result=await fixture.run();
  assert.equal(result.facts,3);
  assert.deepEqual(result.orphanFacts,[]);
  assert.deepEqual(result.factErrors,[]);
  const main=await fixture.page('core/alpha/entry.mjs::main');
  assert.deepEqual(main.facts,[
    {kind:'measurement',fact:'0.42 mm bead at 12 mm/s',source:'DEVLOG.md',date:'2026-09-18'},
    {kind:'vendor',fact:'firmware 01.08 rejects M204 above 8000',source:'vendor note',date:'2026-09-01'}]);
  const file=await fixture.page('core/alpha/helper.mjs');
  assert.equal(file.kind,'file');
  assert.deepEqual(file.facts,[{kind:'measurement',fact:'3.1 s median over 20 runs',source:'DEVLOG.md',date:'2026-09-10'}]);
  // A page no row names carries no facts key at all.
  assert.ok(!('facts' in await fixture.page('core/alpha/helper.mjs::take')));
  // Removing the row removes the fact from the page.
  await writeFacts(fixture.repo,[]);
  await fixture.run();
  assert.ok(!('facts' in await fixture.page('core/alpha/entry.mjs::main')));
});

test('a fact that names nothing the map holds is reported, never dropped',async t=>{
  const fixture=await fixtureStore(t);
  await writeFacts(fixture.repo,[
    'core/alpha/entry.mjs::gone\tmeasurement\t9.5 N peel force\tDEVLOG.md\t2026-08-02',
    'core/alpha/entry.mjs::main\tmeasurement\tkept\tDEVLOG.md\t2026-08-03']);
  const result=await fixture.run();
  assert.equal(result.facts,1);
  assert.deepEqual(result.orphanFacts,[{line:2,declaration:'core/alpha/entry.mjs::gone',kind:'measurement',
    fact:'9.5 N peel force',source:'DEVLOG.md',date:'2026-08-02'}]);
  const status=await storeStatus({repo:fixture.repo,readSource:fixture.read});
  assert.deepEqual(status.orphanFacts,result.orphanFacts);
  assert.deepEqual(status.facts.errors,[]);
});

test('a malformed row is named by its line and does not remove the rows around it',async t=>{
  const fixture=await fixtureStore(t);
  await writeFacts(fixture.repo,[
    'core/alpha/entry.mjs::main\tmeasurement\tfirst\tDEVLOG.md\t2026-08-03',
    'core/alpha/entry.mjs::main\thearsay\tunknown kind\tDEVLOG.md\t2026-08-04',
    'core/alpha/entry.mjs::main\tmeasurement\tmissing a field\tDEVLOG.md',
    'core/alpha/entry.mjs::main\tmeasurement\tbad date\tDEVLOG.md\tlast August',
    'core/alpha/entry.mjs::main\tmeasurement\t\tDEVLOG.md\t2026-08-05',
    'core/alpha/entry.mjs::main\tmeasurement\tlast\tDEVLOG.md\t2026-08-06']);
  const facts=await readFacts({repo:fixture.repo});
  assert.deepEqual(facts.rows.map(r=>r.fact),['first','last']);
  assert.deepEqual(facts.errors.map(e=>[e.line,e.reason]),[
    [3,'Unknown kind hearsay; use measurement, vendor, decision.'],
    [4,'4 tab-separated fields; 5 are required.'],
    [5,'Date last August is not an ISO date.'],
    [6,'Empty fact.']]);
  assert.ok(facts.errors.every(e=>e.row.includes('core/alpha/entry.mjs::main')));
  // A header that is not the header is itself named.
  await writeFile(resolve(fixture.repo,factsPath),'declaration\tfact\n','utf8');
  assert.match((await readFacts({repo:fixture.repo})).errors[0].reason,/First row must be the header/);
  // A missing file is reported rather than read as an empty one.
  await rm(resolve(fixture.repo,factsPath));
  assert.deepEqual((await readFacts({repo:fixture.repo})).errors,[{line:0,row:'',reason:'Missing maps/facts.tsv.'}]);
});

test('a decision fact must cite an anchor that exists in DECISIONS.md',async t=>{
  const fixture=await fixtureStore(t);
  await writeDecisions(fixture.repo);
  const anchor='d-007--keep-the-nozzle-warm-between-operations';
  await writeFacts(fixture.repo,[
    `core/alpha/entry.mjs::main\tdecision\tstationary deposition stays opt-in\t${anchor}\t2026-07-01`,
    'core/alpha/entry.mjs::main\tdecision\tno record of this\td-404--invented\t2026-07-02']);
  const facts=await readFacts({repo:fixture.repo});
  assert.deepEqual(facts.rows.map(r=>r.source),[anchor]);
  assert.deepEqual(facts.errors.map(e=>[e.line,e.reason]),[[3,'No DECISIONS.md anchor d-404--invented.']]);
  const result=await fixture.run();
  assert.deepEqual(result.factErrors.map(e=>e.line),[3]);
  assert.deepEqual((await fixture.page('core/alpha/entry.mjs::main')).facts,
    [{kind:'decision',fact:'stationary deposition stays opt-in',source:anchor,date:'2026-07-01'}]);
  const status=await storeStatus({repo:fixture.repo,readSource:fixture.read});
  assert.deepEqual(status.facts.errors.map(e=>e.line),[3]);
});
