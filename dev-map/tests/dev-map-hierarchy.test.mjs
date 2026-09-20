import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {composePages,readCompositions} from '../lib/composition.mjs';
import {generate,readGenerated,readCode,storeStatus} from '../lib/store.mjs';

const path='core/work.mjs::run';
const nodes=['a','b','c'].map((label,i)=>({index:`1.1.${i+2}`,path:`core/work.mjs::${label}`,file:'core/work.mjs',label,line:i+1,endLine:i+1}));
const page={index:'1.1.1',path,file:'core/work.mjs',kind:'function',components:nodes,
  inputs:[{port:'in1',name:'input'}],outputs:[{port:'out1',name:'result'}],gates:[{text:'ready',kind:'if'}],
  wires:[{from:'in1',to:'1.1.2',kind:'data',label:'input'},
    {from:'1.1.2',to:'1.1.3',kind:'data',label:'prepared',gate:0},
    {from:'1.1.3',to:'1.1.4',kind:'data',label:'validated'},
    {from:'1.1.4',to:'out1',kind:'return',label:'result'}],unresolved:[],uncertainty:[]};
const config={schema:1,flows:[{path,groups:[{id:'job',members:nodes.map(n=>n.path),groups:[
  {id:'prepare',members:nodes.slice(0,2).map(n=>n.path)}]}]}]};

test('nested groups preserve canonical nodes and every crossing edge through each level',()=>{
  const result=composePages(new Map([[path,page]]),config,{});
  const parent=result.pages.get(path),job=result.groupPages.get('1.1.1.0.1'),prepare=result.groupPages.get('1.1.1.0.1.0.1');
  assert.equal(parent.components.length,1);
  assert.equal(prepare.parent,job.index);
  assert.deepEqual(job.components.map(n=>n.index),[prepare.index,'1.1.4']);
  assert.deepEqual(prepare.components,nodes.slice(0,2));
  assert.deepEqual(job.codeTargets,nodes.map(n=>n.path));
  for(const [outer,inner] of [[parent,job],[job,prepare]])for(const boundary of inner.boundary){
    const a=outer.wires.find(w=>w.edgeId===boundary.edgeId),b=inner.wires.find(w=>w.edgeId===boundary.edgeId);
    assert.ok(a&&b);assert.equal(a.label,b.label);assert.equal(a.kind,b.kind);assert.equal(a.gate,b.gate);
  }
  assert.equal(new Set([parent,job,prepare].flatMap(p=>p.wires.map(w=>w.edgeId))).size,page.wires.length);
  const invalid=structuredClone(config);invalid.flows[0].groups[0].groups[0].members=['core/elsewhere.mjs::outside'];
  assert.throws(()=>composePages(new Map([[path,page]]),invalid,{}),/Unknown composition member/);
});

test('composition fragments invalidate stored reads on add, edit and removal and preserve nested source access',async t=>{
  const repo=await mkdtemp(join(tmpdir(),'saam-map-hierarchy-'));
  t.after(()=>rm(repo,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  await mkdir(resolve(repo,'core'));await mkdir(resolve(repo,'dev-map/flows'),{recursive:true});
  const source='export const a=x=>x+1;\nexport const b=x=>a(x);\nexport const c=x=>b(x);\n';
  await writeFile(resolve(repo,'core/work.mjs'),source);
  await generate({repo});
  const fragment='dev-map/flows/core.json',spec={schema:1,flows:[{path:'core',groups:[{id:'job',members:['core/work.mjs'],groups:[{id:'prepare',members:['core/work.mjs::a','core/work.mjs::b']}]}]}]};
  await writeFile(resolve(repo,fragment),JSON.stringify(spec));
  assert.ok((await storeStatus({repo})).stale.inputs.includes(fragment));
  assert.equal((await readCompositions({repo})).flows[0].source,fragment);
  await generate({repo});
  const job=await readGenerated('core::@group/job',{repo});
  const child=await readGenerated(job.components.find(c=>c.kind==='group').index,{repo});
  assert.equal(child.composition.source,fragment);
  const code=await readCode(child.index,{repo});
  assert.match(code.sources.map(s=>s.source).join('\n'),/export const a/);
  assert.ok(!(await storeStatus({repo})).stale);
  spec.flows[0].groups[0].label='whole job';await writeFile(resolve(repo,fragment),JSON.stringify(spec));
  assert.ok((await storeStatus({repo})).stale.inputs.includes(fragment));
  await rm(resolve(repo,fragment));
  assert.ok((await storeStatus({repo})).stale.inputs.includes(fragment));
});
