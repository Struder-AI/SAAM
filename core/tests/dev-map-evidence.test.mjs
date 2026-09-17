import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {extractGraph,sourceFiles} from '../../scripts/dev-map/graph.mjs';
import {compareEvidence} from '../../scripts/dev-map/evidence.mjs';
import {loadModel,root} from '../../scripts/dev-map/model.mjs';

async function fixture(t,sources) {
  const repo=await mkdtemp(join(tmpdir(),'saam-evidence-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  for(const [path,text] of Object.entries(sources)) {await mkdir(dirname(join(repo,path)),{recursive:true});await writeFile(join(repo,path),text);}
  return extractGraph({repo,files:Object.keys(sources)});
}
const declaration=(g,anchor)=>g.declarations.find(d=>d.anchor===anchor);
const callsTo=(g,anchor)=>g.relations.filter(e=>e.kind==='call'&&e.to===declaration(g,anchor)?.id);

test('imports, namespace/default/re-export aliases resolve by scope, not spelling',async t=>{
  const g=await fixture(t,{
    'core/a.mjs':'export function target() {} export default function other() {}',
    'core/re.mjs':"export {target as forwarded} from './a.mjs';",
    'core/use.mjs':`import other, {target as renamed} from './a.mjs'; import * as ns from './re.mjs';
      const alias=renamed;
      export function use(){alias();ns.forwarded();other();}
      export function shadow(renamed){renamed();}
      export function block(){ { const alias=()=>{};alias(); } alias(); }
      const words='target()'; // target()
      function target(){} export function local(){target();}`
  });
  assert.equal(callsTo(g,'core/a.mjs::target').length,3);
  assert.equal(callsTo(g,'core/a.mjs::other').length,1);
  assert.equal(callsTo(g,'core/use.mjs::target').length,1);
  assert.equal(g.unresolved.filter(u=>u.reason==='parameter-target').length,1);
  assert.ok(g.unresolved.some(u=>u.site.text==='renamed()'));
  for(const e of g.relations)for(const site of e.evidence)assert.ok(site.end>site.start&&site.line>0&&site.column>0);
});

test('mutable/destructuring writes, catch and loop shadowing never borrow outer callable',async t=>{
  const g=await fixture(t,{'core/a.mjs':`function target(){} let mutable=target;mutable();
    function replaced(){} ({replaced}=source);replaced();
    function run(){try{}catch(target){target();}for(const target of list){target();}target();}
    function args(target=()=>{}){target();}`});
  assert.equal(callsTo(g,'core/a.mjs::target').length,1);
  assert.equal(callsTo(g,'core/a.mjs::replaced').length,0);
  assert.ok(g.unresolved.some(u=>u.reason==='mutated-binding'));
});

test('value flow retains producer and consumer sites; sibling calls do not establish control sequence',async t=>{
  const g=await fixture(t,{'core/a.mjs':`function produce(){return 3;}function consume(x){} async function run(){const x=await produce();consume(x);consume(produce());}`});
  const flow=g.relations.filter(e=>e.kind==='value-flow');
  assert.equal(flow.length,2);
  assert.ok(flow.every(e=>e.from===declaration(g,'core/a.mjs::produce').id&&e.to===declaration(g,'core/a.mjs::consume').id));
  assert.ok(flow.every(e=>e.evidence.length===2&&e.path.length===2));
  assert.equal(g.relations.filter(e=>e.kind==='control-sequence').length,0);
});

test('literal Worker argument binds both directions; same spelling and dynamic URLs do not',async t=>{
  const sources={
    'studio/client.mjs':`export function session(worker){function rpc(){worker.postMessage({type:'load'});}worker.onmessage=({data})=>receive(data);return rpc;} function receive(x){}`,
    'studio/app.mjs':`import {session as open} from './client.mjs';open(new Worker('/studio/worker.mjs'));open(new Worker(dynamicURL));function fake(Worker){open(new Worker('/studio/other.mjs'));}`,
    'studio/worker.mjs':`function fetchSource(){}self.onmessage=()=>{fetchSource();self.postMessage({ok:true});};`,
    'studio/other.mjs':`self.onmessage=()=>{};`
  };
  const g=await fixture(t,sources),handoffs=g.relations.filter(e=>e.kind==='worker-handoff');
  assert.equal(g.workerLinks.length,1);assert.equal(handoffs.length,2);
  assert.ok(handoffs.every(e=>e.evidence.length===4));
  assert.ok(handoffs.every(e=>!e.to.startsWith('studio/other')));
  assert.equal(g.relations.filter(e=>e.kind==='call'&&e.from.startsWith('studio/client')&&e.to.startsWith('studio/worker')).length,0);
});

test('report separates enclosed code, missing relationships, unsupported claims and unknown targets',async t=>{
  const g=await fixture(t,{'core/a.mjs':`export function root(){function hidden(){a();} a(); dynamic.run();}export function a(){}export function b(){}export function outside(){a();}`});
  const node=(id,num,anchor)=>({id,num,anchor:`core/a.mjs::${anchor}`,label:id});
  const model={pages:[{key:'pilot',nodes:[node('root','1','root'),node('a','2','a'),node('again','3','a'),node('b','4','b')],edges:[{src:'b',dst:'a',kind:'data'},{src:'root',dst:'b',kind:'gate'}]}]};
  const r=compareEvidence(model,g,{pilotPages:['pilot']});
  assert.equal(r.inventory.find(d=>d.anchor==='core/a.mjs::root::hidden').status,'enclosed');
  assert.equal(r.inventory.find(d=>d.anchor==='core/a.mjs::outside').status,'unrepresented');
  assert.equal(r.pilot[0].claims[0].status,'unsupported');
  assert.equal(r.pilot[0].claims[1].status,'unresolved');
  assert.ok(r.pilot[0].omitted.some(e=>e.src==='root'&&e.dst==='a'));
  const shared=r.sharedUses.find(s=>s.anchor==='core/a.mjs::a');
  assert.deepEqual(shared.occurrences[0].otherMappedIndexes,[{page:'pilot',address:'3'}]);
  assert.ok(shared.unmappedCallers.some(c=>c.from===declaration(g,'core/a.mjs::outside').id));
  assert.ok(shared.unmappedCallers.every(c=>c.mappedOccurrences.length===0));
});

test('repository maps keep source evidence, finite dispatch and explicit worker state',async()=>{
  const model=await loadModel();
  const before=JSON.stringify(model);
  const g=await extractGraph({repo:root,files:await sourceFiles(root),importAliases:{'studio/app.mjs:./studio/machine-session.mjs':'studio/machine-session.mjs'}});
  const r=compareEvidence(model,g);
  assert.equal(JSON.stringify(model),before);
  for(const n of model.pages.flatMap(p=>p.nodes).filter(n=>n.anchor))assert.ok(g.declarations.some(d=>d.anchor===n.anchor&&!d.ambiguousAnchor),n.anchor);
  const core=r.pilot.find(p=>p.page==='6_output'),studio=r.pilot.find(p=>p.page==='7b_source');
  assert.ok(core.generated.some(e=>e.src==='pipeline'&&e.dst==='dispatch'&&e.kind==='call'));
  assert.ok(core.generated.some(e=>e.src==='pipeline'&&e.dst==='cartesian'&&e.kind==='call'));
  assert.ok(core.generated.some(e=>e.src==='pipeline'&&e.dst==='robot'&&e.kind==='call'));
  assert.ok(!core.unresolved.some(u=>u.site.text.startsWith('adapter.export(')));
  assert.ok(studio.generated.some(e=>e.src==='fetch'&&e.dst==='decode'&&e.kind==='value-flow'));
  assert.ok(studio.generated.some(e=>e.src==='session'&&e.dst==='worker'&&e.kinds.includes('worker-handoff')));
  assert.ok(studio.generated.some(e=>e.src==='decode'&&e.dst==='program'&&e.kind==='state-write'));
  assert.ok(studio.generated.some(e=>e.src==='program'&&e.dst==='bind'&&e.kind==='state-read'));
  const edges=new Set(g.relations.map(e=>e.id));
  for(const p of r.pilot)for(const e of p.generated)for(const path of e.paths)for(const id of path)assert.ok(edges.has(id));
  assert.ok(r.sharedUses.some(s=>s.unmappedCallers.some(c=>c.status==='outside-map-scope')));
});

test('finite returned registries resolve possible targets without cross-dialect value flow',async t=>{
  const g=await fixture(t,{'core/registry.mjs':`
    function writeA(){} function readA(bytes){} function writeB(){} function readB(bytes){}
    const adapters={a:{write:writeA,read:readA},b:{write:writeB,read:readB}};
    function select(key){return adapters[key];}
    export function run(key){const adapter=select(key);const bytes=adapter.write();return adapter.read(bytes);}
  `});
  for(const target of ['writeA','writeB','readA','readB'])assert.ok(callsTo(g,`core/registry.mjs::${target}`).some(e=>e.possible));
  const flows=g.relations.filter(e=>e.kind==='value-flow');
  for(const [a,b] of [['writeA','readA'],['writeB','readB']])assert.ok(flows.some(e=>e.from===declaration(g,`core/registry.mjs::${a}`).id&&e.to===declaration(g,`core/registry.mjs::${b}`).id));
  assert.ok(!flows.some(e=>e.from===declaration(g,'core/registry.mjs::writeA').id&&e.to===declaration(g,'core/registry.mjs::readB').id));
  assert.ok(callsTo(g,'core/registry.mjs::writeA')[0].resolution.some(s=>s.text.includes('adapters[key]')));
});

test('known alternatives do not erase unknown targets; mutations through aliases invalidate literal dispatch',async t=>{
  const g=await fixture(t,{'core/choices.mjs':`
    function target(){} const object={run:target};const alias=object;alias.run=external;object.run();
    const choice=condition?target:unknown;choice();
    const registry={known:target,unknown:external};registry[key]();
  `});
  assert.ok(g.unresolved.some(u=>u.site.text==='object.run()'));
  assert.ok(g.unresolved.some(u=>u.site.text==='choice()'&&u.reason==='partially-resolved-target'));
  assert.ok(g.unresolved.some(u=>u.site.text==='registry[key]()'&&u.reason==='partially-resolved-target'));
  assert.equal(callsTo(g,'core/choices.mjs::target').length,2);
});

test('class instances and lexical this resolve methods, but shadowing and replaced methods do not',async t=>{
  const g=await fixture(t,{'core/class.mjs':`
    class Builder {move(){} run(){this.move();const arrow=()=>this.move();arrow();function nested(){this.move();}}}
    export function run(){const b=new Builder();b.position=1;b.run();}
    export function replaced(){const b=new Builder();b.move=unknown;b.move();}
  `});
  assert.equal(callsTo(g,'core/class.mjs::Builder::move').length,2);
  assert.equal(callsTo(g,'core/class.mjs::Builder::run').length,1);
  assert.ok(g.unresolved.some(u=>u.site.text==='b.move()'));
  assert.ok(g.unresolved.some(u=>u.site.text==='this.move()'));
});

test('mutable program dependencies retain storage and never claim sequence or correlation',async t=>{
  const g=await fixture(t,{'studio/worker.mjs':`
    let program;function decode(){}function bind(){consume(program);}function load(){program=decode();bind();}
  `});
  assert.ok(g.relations.some(e=>e.kind==='state-write'&&e.from===declaration(g,'studio/worker.mjs::decode').id&&e.to===declaration(g,'studio/worker.mjs::program').id));
  assert.ok(g.relations.some(e=>e.kind==='state-read'&&e.from===declaration(g,'studio/worker.mjs::program').id&&e.to===declaration(g,'studio/worker.mjs::bind').id));
  assert.ok(!g.relations.some(e=>e.kind==='control-sequence'));
});

test('default parameter environments and anonymous/computed functions keep distinct owners',async t=>{
  const g=await fixture(t,{
    'core/source.mjs':'export default function() {}',
    'core/use.mjs':`import anonymous from './source.mjs';
      function target(){} function run(x=target()){var target=()=>{};target();}
      const obj={['key']:()=>anonymous()};
      async function discard(){await anonymous();}`
  });
  assert.equal(callsTo(g,'core/use.mjs::target').length,1);
  assert.ok(g.declarations.some(d=>d.file==='core/source.mjs'&&d.kind==='function'));
  assert.ok(g.relations.filter(e=>e.kind==='call').every(e=>g.declarations.some(d=>d.id===e.to)));
  const discard=declaration(g,'core/use.mjs::discard');
  assert.equal(g.relations.filter(e=>e.kind==='return-value'&&e.to===discard.id).length,0);
});

test('reassigned worker parameters cannot establish a channel',async t=>{
  const g=await fixture(t,{
    'studio/app.mjs':`function session(worker){worker=other;worker.postMessage({});worker.onmessage=()=>{};}session(new Worker('/studio/worker.mjs'));`,
    'studio/worker.mjs':'self.onmessage=()=>{};'
  });
  assert.equal(g.workerLinks.length,0);
  assert.equal(g.relations.filter(e=>e.kind==='worker-handoff').length,0);
});
