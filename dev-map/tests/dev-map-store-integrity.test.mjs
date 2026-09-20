import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {generate,readGenerated,readCode,readIndex,storeDir,storeStatus} from '../lib/store.mjs';
import {viewModel} from '../lib/generated-view.mjs';

async function fixture(t,sources) {
  const repo=await mkdtemp(resolve(tmpdir(),'saam-map-integrity-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  const put=async(file,text)=>{await mkdir(dirname(resolve(repo,file)),{recursive:true});await writeFile(resolve(repo,file),text);};
  for(const [file,text] of Object.entries(sources))await put(file,text);
  return {repo,put,run:region=>generate({repo,region}),page:target=>readGenerated(target,{repo}),
    status:()=>storeStatus({repo}),index:()=>readIndex(storeDir(repo)),remove:file=>rm(resolve(repo,file))};
}
const pair={
  'core/alpha/a.mjs':'export function alpha(x){const y=x;return y;}\n',
  'core/beta/b.mjs':'export function beta(x){const y=x+1;return y;}\n'
};

test('on-page callers become call wires, including callers inside authored groups',async t=>{
  const f=await fixture(t,{'core/callers.mjs':`export const leaf=x=>x;
export const first=x=>leaf(x);
export const second=x=>leaf(x);
export function main(x){return leaf(x)+first(x);}`});
  await f.put('dev-map/flows.json',JSON.stringify({schema:1,flows:[{path:'core/callers.mjs::main',groups:[
    {id:'first-stage',members:['core/callers.mjs::first']}
  ]}]}));
  await f.run();
  const main=await f.page('core/callers.mjs::main'),first=await f.page('core/callers.mjs::first');
  const leaf=await f.page('core/callers.mjs::leaf'),second=await f.page('core/callers.mjs::second');
  const group=main.components.find(c=>c.kind==='group');
  assert.deepEqual(main.components.find(c=>c.index===leaf.index).callerReferences.map(r=>r.index),[second.index]);
  assert.ok(main.callerWires.some(w=>w.from===group.index&&w.to===leaf.index&&w.caller===first.index&&w.callee===leaf.index));
  const file=await f.page('core/callers.mjs');
  assert.ok(file.components.every(c=>!c.callerReferences?.length),'visible declarations are not off-page callers');
});

test('class membership is not reported as an incoming method call',async t=>{
  const f=await fixture(t,{'core/bucket.mjs':`export class Bucket {
constructor(){this.values=[];}
add(value){this.values.push(value);}
finish(){return this.values;}
}
export function use(value){const bucket=new Bucket();bucket.add(value);return bucket.finish();}`});
  await f.run();
  const bucket=await f.page('core/bucket.mjs::Bucket'),use=await f.page('core/bucket.mjs::use');
  for(const method of ['add','finish']) {
    const page=await f.page(`core/bucket.mjs::Bucket::${method}`);
    assert.ok(!page.calledFrom.some(r=>r.index===bucket.index));
    assert.ok(page.calledFrom.some(r=>r.index===use.index));
  }
});

test('an on-page caller of the page owner connects to its boundary instead of an external reference',async t=>{
  const f=await fixture(t,{'core/cycle.mjs':`export const leaf=x=>x;
export function first(x){return second(x)+leaf(x);}
export function second(x){return first(x);}`});
  await f.run();
  const first=await f.page('core/cycle.mjs::first'),second=await f.page('core/cycle.mjs::second');
  assert.deepEqual(first.callerReferences,[]);
  assert.equal(first.callerBoundary.index,first.index);
  assert.ok(first.callerWires.some(w=>w.from===second.index&&w.to===first.callerBoundary.id));
});

test('local helper captures form reference connections without inventing execution edges; disconnected helpers open source',async t=>{
  const f=await fixture(t,{'core/heap.mjs':`export function schedule(items){
const first=()=>console.log(items);
const second=()=>console.log(items);
first();second();
}
export function detached(){
const first=()=>console.log('one');
const second=()=>console.log('two');
first();second();
}`});
  await f.run();
  const page=await f.page('core/heap.mjs::schedule');
  assert.equal(page.components.length,2);
  assert.equal(page.wires.length,2);
  assert.ok(page.wires.every(w=>w.kind==='capture'&&w.from==='in1'&&w.toPort==='capture:items'));
  assert.ok(!page.wires.some(w=>page.components.some(c=>c.index===w.from)),'capture edges do not imply helper execution order');
  assert.equal(page.destination,'graph');
  const detached=await f.page('core/heap.mjs::detached');
  assert.equal(detached.wires.length,0);assert.equal(detached.destination,'code');
  assert.match(detached.source,/export function detached/);
});

test('local collection flow remains a graph even when helper closures have no data connections',async t=>{
  const f=await fixture(t,{'core/heap.mjs':`export function schedule(items){
const ready=[],scheduled=[],nodes=items.map(item=>({item}));
const push=item=>{ready.push(item);};
const pop=()=>ready.pop();
for(const node of nodes)push(node);
while(ready.length)scheduled.push(pop());
return scheduled;
}`});
  await f.run();
  const page=await f.page('core/heap.mjs::schedule');
  assert.equal(page.components.length,2);
  const push=page.operators.find(op=>op.kind==='collection'&&op.operation==='push');
  assert.ok(push);
  assert.ok(page.wires.some(wire=>wire.to===push.id&&wire.toPort==='state'));
  assert.equal(page.destination,'graph');
});

test('scoped generation preserves the source hash of every retained page',async t=>{
  const f=await fixture(t,pair);await f.run();
  const before=await f.index();
  await f.put('core/beta/b.mjs',pair['core/beta/b.mjs']+'export function added(x){const y=x;return y;}\n');
  await f.run('1');
  const after=await f.index(),page=await f.page('core/beta/b.mjs');
  assert.equal(after.files['core/beta/b.mjs'].sha256,before.files['core/beta/b.mjs'].sha256);
  assert.equal(page.nodes,1);
  assert.deepEqual(page.stale.changed,['core/beta/b.mjs']);
  assert.equal((await f.status()).stale.regenerate,'0');
  await f.run();assert.equal((await f.status()).stale,null);
  assert.equal((await f.page('core/beta/b.mjs')).nodes,2);
});

test('scoped renumbering updates incoming component indexes, wires and declaration spans together',async t=>{
  const f=await fixture(t,{
    'core/alpha/a.mjs':'export function target(x){const y=x;return y;}\n',
    'core/beta/b.mjs':"import {target} from '../alpha/a.mjs';\nexport function caller(x){const y=target(x);return y;}\n"
  });await f.run();
  const old=await f.page('core/alpha/a.mjs::target');
  await f.put('core/alpha/a.mjs','export function earlier(x){const y=x;return y;}\nexport function target(x){const y=x;return y;}\n');
  await f.run('1');
  const target=await f.page('core/alpha/a.mjs::target'),caller=await f.page('core/beta/b.mjs::caller');
  assert.notEqual(target.index,old.index);
  assert.equal(caller.components[0].index,target.index);
  assert.equal(caller.components[0].line,target.line);
  assert.equal(caller.components[0].endLine,target.endLine);
  assert.ok(caller.wires.some(w=>w.to===target.index));
  assert.ok(!caller.wires.some(w=>w.from===old.index||w.to===old.index));
  assert.equal((await f.status()).stale,null);
});

test('full regeneration removes deleted file and region pages and their lookup paths',async t=>{
  const f=await fixture(t,pair);await f.run();
  await f.remove('core/alpha/a.mjs');await f.run();
  const held=await f.index();
  assert.deepEqual(Object.keys(held.regionPages),['1']);
  assert.equal(held.regionPages['1'].path,'core/beta');
  assert.deepEqual(Object.values(held.filePages).map(p=>p.file),['core/beta/b.mjs']);
  assert.ok(!Object.keys(held.byPath).some(p=>p.startsWith('core/alpha')));
  assert.deepEqual(Object.keys(held.files),['core/beta/b.mjs']);
});

test('hash-only reads detect new, deleted and outside-caller sources, including malformed edits',async t=>{
  const f=await fixture(t,{...pair,'skills/use.mjs':"import {alpha} from '../core/alpha/a.mjs'; export function use(x){return alpha(x);}"});
  await f.run();
  await f.put('skills/use.mjs','this is deliberately invalid JavaScript {');
  await f.put('core/alpha/new.mjs','also invalid syntax {');
  await f.remove('core/beta/b.mjs');
  const page=await f.page('core/alpha/a.mjs::alpha');
  assert.deepEqual(page.stale.added,['core/alpha/new.mjs']);
  assert.deepEqual(page.stale.deleted,['core/beta/b.mjs']);
  assert.deepEqual(page.stale.changed,['skills/use.mjs']);
  assert.deepEqual((await f.status()).stale,page.stale);
  const view=await viewModel({repo:f.repo});
  assert.deepEqual(view.stale[page.index],page.stale);
});

test('facts, authored grouping and generator/dependency fingerprints invalidate reads',async t=>{
  const f=await fixture(t,pair);await f.run();
  await f.put('dev-map/flows.json','{"schema":1,"flows":[]}');
  await f.put('dev-map/facts.tsv','target\tkind\tvalue\tsource\n');
  await f.put('package-lock.json','{"lockfileVersion":3}');
  const held=await f.index();
  const generator=Object.keys(held.fingerprint.inputs).find(k=>k.startsWith('generator:'));
  assert.ok(generator);
  held.fingerprint.inputs[generator]='old-generator';
  await writeFile(resolve(storeDir(f.repo),'index.json'),JSON.stringify(held));
  assert.deepEqual((await f.page('0')).stale.inputs.sort(),[generator,'dev-map/flows.json','dev-map/facts.tsv','package-lock.json'].sort());
});

test('scoped generation cannot silently certify new files in another region',async t=>{
  const f=await fixture(t,pair);await f.run();
  await f.put('core/beta/new.mjs','export function added(x){const y=x;return y;}');
  await f.run('1');
  assert.deepEqual((await f.status()).stale.added,['core/beta/new.mjs']);
  assert.ok(!(await f.index()).byPath['core/beta/new.mjs']);
});

test('a changed region inventory widens explicit regeneration without retaining obsolete addresses',async t=>{
  const f=await fixture(t,pair);await f.run();await f.remove('core/alpha/a.mjs');
  const result=await f.run('2');
  assert.equal(result.scope,'0');assert.equal(result.requestedScope,'2');
  assert.equal(result.widened,'region-inventory-or-store-schema');
  assert.deepEqual(Object.keys((await f.index()).regionPages),['1']);
  assert.equal((await f.status()).stale,null);
});

test('a legacy store announces missing generation provenance before returning stored pages',async t=>{
  const f=await fixture(t,pair);await f.run();
  const held=await f.index();delete held.fingerprint;held.schema=2;
  await writeFile(resolve(storeDir(f.repo),'index.json'),JSON.stringify(held));
  assert.equal((await f.page('0')).stale.reason,'missing-generation-fingerprint');
});

test('context groups retain source identities through storage, scoped recomposition, and code reads',async t=>{
  const f=await fixture(t,{
    'core/alpha/a.mjs':"import {finish} from './b.mjs';\nexport function start(x){const y=finish(x);return y;}\n",
    'core/alpha/b.mjs':'export function finish(x){const y=x+1;return y;}\n'
  });
  await f.put('dev-map/flows.json',JSON.stringify({schema:1,flows:[{path:'core/alpha',groups:[
    {id:'pipeline',label:'Pipeline',members:['core/alpha/a.mjs::start','core/alpha/b.mjs::finish']}
  ]}]}));
  await f.run();
  const group=await f.page('core/alpha::@group/pipeline');
  assert.equal(group.kind,'group');
  assert.deepEqual((await f.page(group.index)),group);
  assert.equal(group.components.length,2);
  const code=await readCode(group.index,{repo:f.repo});
  assert.deepEqual(code.sources.map(s=>s.file),['core/alpha/a.mjs','core/alpha/b.mjs']);
  assert.match(code.sources[0].source,/export function start/);
  assert.doesNotMatch(code.sources[0].source,/import /);
  const region=await readCode('core/alpha',{repo:f.repo});
  assert.match(region.sources[0].source,/import /);
  await assert.rejects(readCode('0',{repo:f.repo}),/root page/);
  assert.equal((await f.run('1')).scope,'1');
  assert.deepEqual(await f.page(group.index),group);
  assert.ok((await viewModel({repo:f.repo})).pages.some(p=>p.path===group.path));
});

test('terminal addresses open code directly with the same span and consequences as their graph box',async t=>{
  const f=await fixture(t,{
    'core/alpha/a.mjs':'export function leaf(x){const y=x;return y;}\nexport function parent(x){const y=leaf(x);return y;}\n',
    'core/alpha/constants.mjs':'export const amount=5;\n'
  });await f.run();
  const parent=await f.page('core/alpha/a.mjs::parent'),leaf=await f.page('core/alpha/a.mjs::leaf');
  assert.equal(parent.destination,'code');assert.equal(parent.code,true);
  assert.match(parent.source,/export function parent/);
  const box=parent.components.find(c=>c.label==='leaf');
  assert.equal(box.destination,'code');
  assert.equal(leaf.destination,'code');assert.equal(leaf.code,true);
  assert.match(leaf.source,/export function leaf/);
  assert.deepEqual(box.sourceSpan,leaf.sourceSpan);
  assert.equal(leaf.sourceSpan.line,leaf.line);
  assert.ok(leaf.calledFrom.some(c=>c.index===parent.index));
  assert.deepEqual((await readCode(leaf.index,{repo:f.repo})).calledFrom,leaf.calledFrom);
  assert.deepEqual(await f.page(leaf.index),leaf);
  const empty=await f.page('core/alpha/constants.mjs');
  assert.equal(empty.destination,'code');assert.match(empty.source,/export const amount/);
  assert.equal((await f.page('0')).destination,'graph');
});

test('a deleted terminal source returns its matching snapshot and explicit stale evidence',async t=>{
  const f=await fixture(t,pair);await f.run();await f.remove('core/alpha/a.mjs');
  const page=await f.page('core/alpha/a.mjs::alpha');
  assert.equal(page.sourceKind,'snapshot');
  assert.equal(page.source,`1\t${pair['core/alpha/a.mjs'].trimEnd()}`);
  assert.equal(page.path,'core/alpha/a.mjs::alpha');
  assert.deepEqual(page.stale.deleted,['core/alpha/a.mjs']);
});

test('stale code reads keep generated spans on matching source after line insertion and deletion',async t=>{
  const file='core/alpha/a.mjs',original='// before\nexport function alpha(x){\n  return x+1;\n}\n';
  const f=await fixture(t,{[file]:original});await f.run();
  const before=await f.page(`${file}::alpha`);
  for(const changed of [`// inserted\n// another\n${original}`,original.split('\n').slice(2).join('\n')]) {
    await f.put(file,changed);
    const terminal=await f.page(`${file}::alpha`),explicit=await readCode(terminal.index,{repo:f.repo});
    assert.equal(terminal.source,before.source);
    assert.equal(explicit.source,before.source);
    assert.equal(terminal.sourceKind,'snapshot');
    assert.deepEqual(terminal.stale.changed,[file]);
    const region=await readCode('core/alpha',{repo:f.repo});
    assert.equal(region.sources[0].sourceKind,'snapshot');
    assert.equal(region.sources[0].source,original.split('\n').map((line,i)=>`${i+1}\t${line}`).join('\n'));
    assert.equal((await viewModel({repo:f.repo})).sources[file],original);
  }
});

test('scoped generation refreshes only selected source snapshots',async t=>{
  const f=await fixture(t,pair);await f.run();
  const alpha='// moved alpha\n'+pair['core/alpha/a.mjs'],beta='// moved beta\n'+pair['core/beta/b.mjs'];
  await f.put('core/alpha/a.mjs',alpha);await f.put('core/beta/b.mjs',beta);await f.run('1');
  const view=await viewModel({repo:f.repo});
  assert.equal(view.sources['core/alpha/a.mjs'],alpha);
  assert.equal(view.sources['core/beta/b.mjs'],pair['core/beta/b.mjs']);
  assert.match((await f.page('core/alpha/a.mjs::alpha')).source,/^2\t/);
  assert.match((await f.page('core/beta/b.mjs::beta')).source,/^1\t/);
  assert.deepEqual((await f.status()).stale.changed,['core/beta/b.mjs']);
});

test('legacy records use only hash-matching live source and reject shifted or deleted source',async t=>{
  const file='core/alpha/a.mjs',f=await fixture(t,pair);await f.run();
  const held=await f.index(),path=resolve(storeDir(f.repo),'files',held.records[file]);
  const record=JSON.parse(await readFile(path,'utf8'));delete record.source;
  await writeFile(path,JSON.stringify(record));
  assert.equal((await f.page(`${file}::alpha`)).sourceKind,'matching-live');
  assert.equal((await viewModel({repo:f.repo})).sourceInfo[file].sourceKind,'matching-live');
  await f.put(file,'// shifted\n'+pair[file]);
  for(const remove of [false,true]) {
    if(remove)await f.remove(file);
    const page=await f.page(`${file}::alpha`),view=await viewModel({repo:f.repo});
    assert.equal(page.sourceUnavailable,true);assert.equal(page.regenerate,'0');
    assert.equal(page.source,undefined);assert.equal(view.sources[file],undefined);
    assert.equal(view.sourceInfo[file].sourceUnavailable,true);
    assert.ok(page.stale);
  }
});

test('changed authored structural scopes widen regeneration instead of mixing new nodes with old addresses',async t=>{
  const f=await fixture(t,pair);
  await f.put('dev-map/flows.json',JSON.stringify({schema:1,flows:[{path:'core/beta',groups:[
    {id:'beta',members:['core/beta/b.mjs']}
  ]}]}));
  await f.run();
  await f.put('core/beta/new.mjs','export function added(x){const y=x;return y;}');
  const result=await f.run('1');
  assert.equal(result.scope,'0');assert.equal(result.widened,'composition-source-dependencies');
  assert.equal((await f.status()).stale,null);
  const page=await f.page('core/beta');
  assert.ok(page.components.every(c=>typeof c.index==='string'));
  assert.ok(page.components.some(c=>c.path==='core/beta/new.mjs::added'));
});
