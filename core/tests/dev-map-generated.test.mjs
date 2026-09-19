import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGraph} from '../../scripts/dev-map/graph.mjs';
import {projectGraph,generatedContext,select,importingTests} from '../../scripts/dev-map/projection.mjs';

const sources={
  'core/main.mjs':`import {alpha} from './a/one.mjs';\nexport function main(){return alpha([],1);}\n`,
  'core/a/one.mjs':`import {helper} from '../b/two.mjs';
const LIMIT=3;
export function alpha(items,count){const local=x=>x+LIMIT;return items.map(v=>helper(local(v),count));}
export class Box{open(lid){return alpha(lid,1);}}
const el={};
el.onclick=()=>alpha([],0);
el.onclick=()=>alpha([],1);
[1].forEach(function(){function inner(){return helper(1,2);}inner();});
`,
  'core/b/two.mjs':`export function helper(value,n){return value*n;}\n`,
  'skills/s/skill.mjs':`import {alpha} from '../../core/a/one.mjs';\nexport function run(list){const out=alpha(list,2);return out;}\n`
};
const project=async files=>projectGraph(await extractGraph({repo:'',files,readSource:file=>sources[file]}));
const one='core/a/one.mjs',sorted=list=>list.map(item=>JSON.stringify(item)).sort();

test('named unique callables are nodes; ambiguous, positional, anonymous and variable code is enclosed',async()=>{
  const p=await project(Object.keys(sources));
  assert.deepEqual(p.all.filter(n=>n.file===one).map(n=>[n.path,n.kind]),[[one,'module'],[`${one}::alpha`,'function'],
    [`${one}::alpha::local`,'function'],[`${one}::Box`,'class'],[`${one}::Box::open`,'method']]);
  assert.ok(![...p.nodes.keys()].some(k=>k.includes('onclick')||k.includes('<callback@')||k.includes('inner')||k.startsWith('skills/')));
  // LIMIT, el, two onclick handlers, the forEach callback and its inner function.
  assert.equal(p.nodes.get(one).enclosedCount,6);
  assert.equal(p.nodes.get(`${one}::alpha`).enclosedCount,1);
  const page=generatedContext(p,one),edge=(src,dst)=>page.edges.find(e=>e.src===src&&e.dst===dst);
  assert.deepEqual(edge('2.1.0 one.mjs','2.1.1 alpha'),{src:'2.1.0 one.mjs',dst:'2.1.1 alpha',label:'items, count',kinds:['call']});
  assert.deepEqual(edge('2.1.1 alpha','2.1.1.1 local'),{src:'2.1.1 alpha',dst:'2.1.1.1 local',label:'x',kinds:['call']});
  assert.ok(!('prose' in page)&&!('claims' in page));
  // A path is the file plus nested labels; it is emitted once per file.
  assert.deepEqual(page.files,[{file:one,handle:'2.1',nodes:[{handle:'2.1.0',label:'one.mjs',kind:'module',line:1,endLine:9,enclosedCount:6},
    {handle:'2.1.1',label:'alpha',kind:'function',line:3,endLine:3,enclosedCount:1,nodes:[{handle:'2.1.1.1',label:'local',kind:'function',line:3,endLine:3,enclosedCount:0}]},
    {handle:'2.1.2',label:'Box',kind:'class',line:4,endLine:4,enclosedCount:0,nodes:[{handle:'2.1.2.1',label:'open',kind:'method',line:4,endLine:4,enclosedCount:0}]}]}]);
});

test('handles follow sorted pages, files and source position regardless of scan order',async()=>{
  const a=await project(Object.keys(sources)),b=await project(Object.keys(sources).reverse());
  const handles=p=>p.all.map(n=>[n.path,n.handle]);
  assert.deepEqual(handles(a),handles(b));
  assert.deepEqual(Object.fromEntries(handles(a)),{'core/main.mjs::main':'1.1.1',[one]:'2.1.0',[`${one}::alpha`]:'2.1.1',
    [`${one}::alpha::local`]:'2.1.1.1',[`${one}::Box`]:'2.1.2',[`${one}::Box::open`]:'2.1.2.1','core/b/two.mjs::helper':'3.1.1'});
  assert.deepEqual([...a.pages.values()].map(p=>[p.key,p.handle,p.parent]),[['.','0',null],['core','1','.'],['core/a','2','core'],['core/b','3','core']]);
});

test('boundaries are the edges crossing a directory page, including enclosed and external callers',async()=>{
  const p=await project(Object.keys(sources)),file=generatedContext(p,one);
  assert.deepEqual(sorted(file.boundary.out.map(e=>[e.node,e.path,e.handle,e.label,e.kinds.join()])),sorted([
    ['2.1.0 one.mjs','core/b/two.mjs::helper','3.1.1','value, n','call'],['2.1.1 alpha','core/main.mjs::main','1.1.1','','return-value'],
    ['2.1.1 alpha','core/b/two.mjs::helper','3.1.1','value, n','call'],['2.1.1 alpha','skills/s/skill.mjs',undefined,'out','return-value'],
    ['2.1.1.1 local','core/b/two.mjs::helper','3.1.1','value','value-flow']]));
  assert.deepEqual(sorted(file.boundary.in.map(e=>[e.node,e.path,e.label,e.kinds.join()])),sorted([
    ['2.1.0 one.mjs','core/b/two.mjs::helper','','return-value'],['2.1.1 alpha','core/main.mjs::main','items, count','call'],['2.1.1 alpha','skills/s/skill.mjs','items, count','call']]));
  // A page read is an index: file-level edges and page-level boundary, with relation counts per kind.
  const page=generatedContext(p,'core/a');
  assert.deepEqual(page.edges,[]);
  assert.deepEqual(sorted(page.boundary.out),sorted([{page:'3 core/b',kinds:{call:2,'value-flow':1}},{page:'1 core',kinds:{'return-value':1}},{external:'skills/s',kinds:{'return-value':1}}]));
  assert.deepEqual(sorted(page.boundary.in),sorted([{page:'1 core',kinds:{call:1}},{external:'skills/s',kinds:{call:1}},{page:'3 core/b',kinds:{'return-value':1}}]));
  const parent=generatedContext(p,'core');
  assert.deepEqual(parent.children,[{page:'core/a',handle:'2'},{page:'core/b',handle:'3'}]);
  assert.deepEqual(sorted(parent.edges),sorted([{src:'1.1 main.mjs',dst:'2 core/a',kinds:{call:1}},{src:'2 core/a',dst:'3 core/b',kinds:{call:2,'value-flow':1}},
    {src:'2 core/a',dst:'1.1 main.mjs',kinds:{'return-value':1}},{src:'3 core/b',dst:'2 core/a',kinds:{'return-value':1}}]));
  assert.deepEqual(parent.boundary.in,[{external:'skills/s',kinds:{call:1}}]);
  assert.ok(generatedContext(p,one,{evidence:true}).edges.every(e=>e.evidence.every(r=>r.sites.length)));
  assert.ok(JSON.stringify(page).length<JSON.stringify(file).length);
});

test('selection accepts a page key, declaration path, file or numeric handle',async()=>{
  const p=await project(Object.keys(sources));
  assert.equal(generatedContext(p,'3').page,'core/b');
  assert.equal(generatedContext(p,'core\\a\\').page,'core/a');
  const byPath=generatedContext(p,`${one}::Box`),byHandle=generatedContext(p,'2.1.2');
  assert.deepEqual(byPath,byHandle);
  assert.deepEqual(byPath.files[0].nodes.map(n=>[n.handle,n.nodes.map(c=>c.handle)]),[['2.1.2',['2.1.2.1']]]);
  assert.deepEqual(byPath.edges.map(e=>[e.src,e.dst]),[['2.1.2.1 open','2.1.1 alpha'],['2.1.1 alpha','2.1.2.1 open']]);
  assert.deepEqual(generatedContext(p,'2.1').files[0].nodes.length,3);
  assert.deepEqual(generatedContext(p,'2.1'),generatedContext(p,one));
  assert.equal(select(p,'3.1.1').node.path,'core/b/two.mjs::helper');
  assert.throws(()=>select(p,`${one}::onclick`),/ambiguous, position-based or enclosed/);
  assert.throws(()=>select(p,'2.1.9'),/Unknown generated handle/);
});

const coupled=async sources=>{
  const graph=await extractGraph({repo:'',files:Object.keys(sources),literalCouplings:true,readSource:file=>sources[file]});
  const byId=new Map(graph.declarations.map(d=>[d.id,d])),name=id=>byId.get(id)?.anchor??id.replace(/:\d+:\w+$/,':<enclosed>');
  const links=kind=>graph.relations.filter(r=>r.kind===kind).map(r=>[r.label,name(r.from),name(r.to)]);
  return {graph,links,reasons:kind=>graph.couplings.unlinked.filter(u=>u.kind===kind).map(u=>u.reason).sort()};
};

test('worker message types link sender and dispatcher on one worker link; id replies link to the id reader',async()=>{
  const {graph,links,reasons}=await coupled({
    'studio/page.mjs':`import {session} from './session.mjs';\nexport function open(){return session(new Worker('/studio/work.mjs',{type:'module'}));}\n`,
    'studio/session.mjs':`export function session(worker){
  function rpc(type,fields={}){worker.postMessage({id:1,type,...fields});}
  worker.onmessage=({data})=>{const call=data.id;return call;};
  return {load(state){return rpc('load',{state});},other(kind){return rpc(kind);},loose(extra){worker.postMessage({type:'load',...extra});}};
}\n`,
    'studio/work.mjs':`self.onmessage=({data})=>{const {id,type}=data;if(type==='load')self.postMessage({id,ok:true});else if(type==='never')self.postMessage({id});};\n`,
    'studio/job.mjs':`import {Worker} from 'node:worker_threads';
export class Job{constructor({create}){this.worker=create();this.worker.on('message',message=>this.receive(message));}
  receive(message){if(message.type!=='done')return;}
  go(){this.worker.postMessage({type:'go'});}}
export const start=()=>new Job({create:()=>new Worker(new URL('./node-work.mjs',import.meta.url))});\n`,
    'studio/node-work.mjs':`import {parentPort} from 'node:worker_threads';\nparentPort.on('message',message=>{switch(message.type){case 'go':parentPort.postMessage({type:'done'});}});\n`});
  assert.deepEqual(sorted(links('worker-message')),sorted([['load','studio/session.mjs::session::load','studio/work.mjs::onmessage'],
    ['id','studio/work.mjs::onmessage','studio/session.mjs::session::onmessage'],['id','studio/work.mjs::onmessage','studio/session.mjs::session::onmessage'],
    ['go','studio/job.mjs::Job::go','studio/node-work.mjs:<enclosed>'],['done','studio/node-work.mjs:<enclosed>','studio/job.mjs::Job::receive']]));
  // A type that arrives through an unresolved parameter, or may be replaced by a later spread, is not linked.
  assert.deepEqual(reasons('worker-message'),['later-spread-may-replace-type','no-sender-of-this-type','type-not-literal']);
  assert.ok(graph.relations.filter(r=>r.kind==='worker-message').every(r=>r.evidence.length>=3&&r.label));
});

test('HTTP requests link to the route test with the same literal method and path',async()=>{
  const {links,reasons}=await coupled({
    'studio/server.mjs':`export function serve(req,url,send){
  if(req.method==='GET'&&url.pathname==='/api/state'){send(1);return;}
  if(req.method==='GET'&&url.pathname==='/api/tour'){send(2);return;}
  if(req.method!=='POST'||!url.pathname.startsWith('/api/')){send(404);return;}
  if(url.pathname==='/api/tour'){send(3);return;}
  if(url.pathname==='/api/unused'){send(4);return;}
}\n`,
    'studio/ui.mjs':`export function createUI({post}){return {advance(){return post('tour',{});},load(){return fetch('/api/tour');}};}\n`,
    'studio/app.mjs':`import {createUI} from './ui.mjs';
async function api(route,data){return fetch('/api/'+route,{method:'POST',body:JSON.stringify(data)});}
export function refresh(query){return fetch('/api/state?'+query);}
export function dynamic(route){return api(route,{});}
export function verb(method){return fetch('/api/state',{method});}
export const ui=createUI({post:api});\n`});
  assert.deepEqual(sorted(links('http-route')),sorted([['GET /api/state','studio/app.mjs::refresh','studio/server.mjs::serve'],
    ['GET /api/tour','studio/ui.mjs::createUI::load','studio/server.mjs::serve'],['POST /api/tour','studio/ui.mjs::createUI::advance','studio/server.mjs::serve']]));
  assert.deepEqual(reasons('http-route'),['no-literal-request-for-route','request-method-not-literal','request-path-not-literal']);
});

test('a file name links its writer to its reader only when both spell the same literal',async()=>{
  const {links,reasons}=await coupled({
    'core/names.mjs':`export const PLAN='plan.json';\n`,
    'core/write.mjs':`import {writeFile,rename} from 'node:fs/promises';\nimport {resolve} from 'node:path';\nimport {PLAN} from './names.mjs';
async function save(file,value){await writeFile(file+'.tmp',value);await rename(file+'.tmp',file);}
export async function create(dir,plan){await save(resolve(dir,PLAN),plan);await save(resolve(dir,'review.json'),{});}
export async function exportCode(dir,plan,code){await save(resolve(dir,plan.exportName),code);}\n`,
    'studio/read.mjs':`import {readFile} from 'node:fs/promises';\nimport {resolve} from 'node:path';
export const load=dir=>Promise.all(['plan.json','checks.json'].map(name=>readFile(resolve(dir,name),'utf8')));
export const code=(dir,plan)=>readFile(resolve(dir,plan.exportName));\n`});
  assert.deepEqual(links('file'),[['plan.json','core/write.mjs::create','studio/read.mjs::load']]);
  assert.ok(['read-path-not-literal','read-without-literal-writer','write-path-not-literal','write-without-literal-reader'].every(r=>reasons('file').includes(r)));
});

test('registry entries pair the callables held under one literal key',async()=>{
  const {links}=await coupled({
    'core/a.mjs':`export function exportA(){}\nexport function interpretA(){}\n`,
    'core/b.mjs':`export function exportB(){}\nexport function interpretB(){}\n`,
    'core/registry.mjs':`import {exportA,interpretA} from './a.mjs';\nimport {exportB,interpretB} from './b.mjs';
const adapters={'a-code':{export:exportA,interpret:interpretA},'b-code':{export:exportB,interpret:interpretB}};
const single={report:{first:exportA,second:interpretB}};
export const run=(id,path)=>adapters[id].export(path);\n`});
  assert.deepEqual(links('registry-entry'),[['a-code: export, interpret','core/a.mjs::exportA','core/a.mjs::interpretA'],['b-code: export, interpret','core/b.mjs::exportB','core/b.mjs::interpretB']]);
});

test('literal couplings are opt-in and leave the authored graph unchanged',async()=>{
  const files=Object.keys(sources),base=await extractGraph({repo:'',files,readSource:file=>sources[file]});
  const withCouplings=await extractGraph({repo:'',files,literalCouplings:true,readSource:file=>sources[file]});
  assert.ok(!('couplings' in base));
  assert.deepEqual(withCouplings.relations.slice(0,base.relations.length),base.relations);
});

test('tests are an on-demand import query and never nodes',async()=>{
  const all={...sources,'core/index.mjs':`export {alpha as first} from './a/one.mjs';\n`,
    'core/tests/one.test.mjs':`import {alpha} from '../a/one.mjs';\n`,'core/tests/box.test.mjs':`import * as one from '../a/one.mjs';\none.Box;\n`,
    'core/tests/index.test.mjs':`import {first} from '../index.mjs';\n`,'core/tests/two.test.mjs':`import {helper} from '../b/two.mjs';\n`};
  const p=await project(Object.keys(sources)),tests=Object.keys(all).filter(f=>f.includes('/tests/')),options={files:tests,readSource:file=>all[file]};
  assert.deepEqual(await importingTests(p,`${one}::alpha`,options),[{file:'core/tests/index.test.mjs',imports:['alpha']},{file:'core/tests/one.test.mjs',imports:['alpha']}]);
  assert.deepEqual((await importingTests(p,`${one}::Box::open`,options)).map(t=>t.file),['core/tests/box.test.mjs']);
  assert.deepEqual((await importingTests(p,one,options)).map(t=>t.file),['core/tests/box.test.mjs','core/tests/index.test.mjs','core/tests/one.test.mjs']);
  await assert.rejects(importingTests(p,'core/a',options),/not a page/);
  assert.ok(!('tests' in generatedContext(p,one))&&![...p.nodes.keys()].some(k=>k.includes('/tests/')));
});
