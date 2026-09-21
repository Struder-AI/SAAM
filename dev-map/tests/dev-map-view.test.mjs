// The owner's view of the stored map: one drawing per stored page, every click resolving to a
// page that exists, a breadcrumb that reaches 0, and a page that says so when its source moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createContext,runInContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {generate,readCode,storeDir} from '../lib/store.mjs';
import {buildGeneratedView,viewModel} from '../lib/generated-view.mjs';

const sources={
  'core/alpha/entry.mjs':`import {helper} from '../beta/helper.mjs';
import {Box} from '../beta/box.mjs';
export function main(input){
  const box=new Box();
  if(input.length){const out=helper(input,box);return out;}
  throw new Error('nothing to do');
}
`,
  'core/beta/helper.mjs':`export function helper(list,box){
  box.add(list);
  box.seal(list.length);
  return box.value();
}
`,
  'core/beta/box.mjs':`export class Box{
  constructor(){this.items=[];this.count=0;}
  add(list){this.items=list;}
  seal(n){this.count=n;}
  value(){const out=this.items;return out;}
}
`};

const built=async(t,source=sources,flows=null)=>{
  const repo=await mkdtemp(resolve(tmpdir(),'saam-view-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  const held={...source},read=file=>held[file];
  if(flows){await mkdir(resolve(repo,'dev-map'));await writeFile(resolve(repo,'dev-map/flows.json'),JSON.stringify({schema:1,flows}));}
  await generate({repo,files:Object.keys(held),readSource:read});
  const out=resolve(repo,'out');
  const result=await buildGeneratedView({repo,out,readSource:read});
  return {repo,held,read,out,result,rebuild:()=>buildGeneratedView({repo,out,readSource:read})};
};
const drawings=async out=>{
  const pages=new Map();
  for(const file of await readdir(resolve(out,'svg'))) {
    const text=await readFile(resolve(out,'svg',file),'utf8');
    pages.set(file.replace(/\.js$/,''),JSON.parse(text.slice(text.indexOf(',')+1,-1)));
  }
  return pages;
};

test('region drawings expose diagnostic totals and links to affected immediate groups',async t=>{
  const fixture=await built(t,{'core/example.mjs':`export function work(x){return x;} export function main(input){input.work(input);return missing(input.secret+1);}`},
    [{path:'core',groups:[{id:'work',members:['core/example.mjs::main']}]}]);
  const {pages}=await viewModel({repo:fixture.repo,readSource:fixture.read});
  const region=pages.find(p=>p.kind==='region'),group=region.components.find(c=>c.kind==='group');
  const svg=(await drawings(fixture.out)).get(region.index);
  for(const category of ['uncertainty','unresolved']) {
    const summary=region[`${category}Summary`];
    assert.ok(summary?.count>0,`${category}: ${JSON.stringify(region)}`);
    assert.ok(svg.includes(`${category} (${summary.count})`));
    for(const source of summary.sources){
      assert.ok(svg.includes(`${source.index} · ${source.count}`));
      assert.deepEqual(Object.keys(source),['index','count']);
    }
  }
  assert.ok(svg.includes(`data-go="${group.index}"`));
  assert.ok(!svg.includes('input.secret+1'));
});

test('closure capture diagnostics draw every binding with the original finding count',async t=>{
  const fixture=await built(t,{'core/state.mjs':`export function factory(){let alpha=0,beta=0,gamma=0;function write(){alpha++;beta++;gamma++;}function read(){return [alpha,beta,gamma];}return {write,read};}`});
  const {pages}=await viewModel({repo:fixture.repo,readSource:fixture.read}),page=pages.find(p=>p.path==='core/state.mjs::factory');
  const captureGroups=page.uncertainty.filter(u=>u.kind==='closure-capture'&&u.bindings);
  assert.equal(captureGroups.length,2);
  const count=page.uncertainty.reduce((sum,u)=>sum+(u.count??1),0),svg=(await drawings(fixture.out)).get(page.index);
  assert.ok(svg.includes(`uncertainty (${count})`));
  assert.ok(svg.includes('read-write: alpha, beta, gamma'));
  assert.ok(svg.includes('read: alpha, beta, gamma'));
  for(const label of ['write','read']){
    const closure=pages.find(p=>p.path===`core/state.mjs::factory::${label}`);
    assert.ok(svg.includes(`closure-capture ${closure.index}`));
  }
});

test('repeated stages draw separate instances that open the same source declaration',async t=>{
  const {out,repo,read}=await built(t,{'core/stages.mjs':'export const move=x=>x; export function main(input){const up=move(input),across=move(up),down=move(across);return down;}'});
  const model=await viewModel({repo,readSource:read}),page=model.pages.find(p=>p.path==='core/stages.mjs::main');
  const svg=(await drawings(out)).get(page.index);
  assert.equal(page.components.length,3);
  for(const component of page.components){assert.ok(svg.includes(`data-id="${component.id}"`));assert.ok(svg.includes(component.binding));}
  const target=page.components[0].index;
  assert.ok(svg.includes(`data-go="${target}"`));
  assert.ok(page.wires.some(w=>w.from===page.components[0].id&&w.to===page.components[1].id));
});

test('resolved outside calls are green source-addressable stages with real argument and result wires',async t=>{
  const fixture=await built(t,{
    'core/caller.mjs':`import {outside} from '../skills/example/process.mjs';export const next=x=>x;export function main(x){return next(outside(x));}`,
    'skills/example/process.mjs':'export const outside=x=>x;'
  });
  const {pages}=await stored(fixture.repo),page=[...pages.values()].find(p=>p.path==='core/caller.mjs::main');
  const op=page.operators.find(o=>o.scope==='outside'),next=page.components.find(c=>c.label==='next');
  assert.ok(op);assert.equal(op.targetUnknown,undefined);
  assert.equal(op.targets[0].file,'skills/example/process.mjs');assert.equal(op.targets[0].index,undefined);
  assert.ok(page.wires.some(w=>w.from==='in1'&&w.to===op.id&&w.toPort==='arg1'));
  assert.ok(page.wires.some(w=>w.from===op.id&&w.to===next.index));
  const svg=(await drawings(fixture.out)).get(page.index);
  assert.ok(svg.includes(`data-id="${op.id}" data-kind="outside"`));
  assert.ok(svg.includes('>outside · call</text>'));assert.ok(!svg.includes('unresolved'));
  assert.ok(svg.includes('data-ref="core/caller.mjs:1-1"'));
});
const pageIndex=async out=>JSON.parse((await readFile(resolve(out,'index.html'),'utf8'))
  .match(/const PAGES=(\{.*?\});\r?\n/s)[1].replaceAll('<\\/','</'));
const stored=async repo=>{
  const held=JSON.parse(await readFile(resolve(storeDir(repo),'index.json'),'utf8'));
  const kinds=new Map([['0',held.root]]);
  for(const [at,page] of [...Object.entries(held.regionPages),...Object.entries(held.filePages)])kinds.set(at,page);
  for(const record of Object.values(held.records))
    for(const page of Object.values(JSON.parse(await readFile(resolve(storeDir(repo),'files',record),'utf8')).pages))
      kinds.set(page.index,page);
  return {held,pages:kinds};
};

test('single possible calls and unknown callback execution are marked on their drawn boxes',async t=>{
  const fixture=await built(t,{'core/targets.mjs':`const a=x=>x;const b=x=>x;const c=x=>x;
export function main(flag,x){const fn=flag?a:b;const y=fn(x);x.map(v=>c(v));return y;}`});
  const model=await viewModel({repo:fixture.repo,readSource:fixture.read});
  const page=model.pages.find(p=>p.path==='core/targets.mjs::main'),svg=(await drawings(fixture.out)).get(page.index);
  for(const component of page.components) {
    const block=svg.split('<g class="fm-node"').slice(1).find(s=>s.startsWith(` data-id="${component.index}"`));
    assert.ok(block,component.label);
    assert.ok(block.includes(component.label==='c'?'execution unknown':'possible target'));
    assert.ok(block.includes(`data-go="${component.index}"`));
  }
});

test('returned record boxes hide expressions and open their exact source span',async t=>{
  const fixture=await built(t,{'core/record.mjs':`const first=x=>x;const second=x=>x;
export function main(flag,x){
const a=first(x),b=second(a);
return {a,b,decision:flag?"secret-left":"secret-right",...x,[x.key]:b};
}`});
  const model=await viewModel({repo:fixture.repo,readSource:fixture.read});
  const page=model.pages.find(p=>p.path==='core/record.mjs::main'),svg=(await drawings(fixture.out)).get(page.index);
  assert.equal(page.outputs[0].name,'{a, b, decision, …}');
  assert.ok(svg.includes('{a, b, decision, …}'));
  assert.ok(!svg.includes('secret-left'));assert.ok(!svg.includes('secret-right'));
  const block=svg.split('<g class="fm-node"').slice(1).find(s=>s.startsWith(' data-id="out1"'));
  assert.ok(block.includes('spread'));assert.ok(block.includes('computed keys'));
  assert.ok(block.includes('data-ref="core/record.mjs:4-4"'));
});

test('exception control is connected and its predicate opens source instead of printing on the map',async t=>{
  const fixture=await built(t,{'core/decode.mjs':`export const first=x=>x;
export const second=x=>x;
export function decode(plan){
if(plan.output==="specific-format")return first(plan);
else if(plan.output==="another-format")return second(plan);
else throw new Error("Unsupported: "+plan.output);
}`});
  const {pages}=await stored(fixture.repo),page=[...pages.values()].find(p=>p.path==='core/decode.mjs::decode');
  const out=page.outputs.find(o=>o.kind==='throw'),svg=(await drawings(fixture.out)).get(page.index);
  assert.ok(page.wires.some(w=>w.kind==='gate'&&w.to===out.port&&w.from==='in1'));
  assert.ok(!svg.includes('specific-format'));assert.ok(!svg.includes('another-format'));
  assert.ok(svg.includes('plan.output · else'));
  const block=svg.split('<g class="fm-node"').slice(1).find(s=>s.startsWith(` data-id="${out.port}"`));
  assert.ok(block.includes('data-ref="core/decode.mjs:4-6"'));
  const app=viewerRuntime(await readFile(resolve(fixture.out,'index.html'),'utf8'),fixture.held,'#'+page.index);
  app.click({dataset:{ref:'core/decode.mjs:4-6'},closest(selector){return selector==='.fm-node[data-ref]'?this:null;}});
  assert.equal(app.elements.get('codepane').classList.contains('on'),true);
  assert.ok(app.elements.get('codepane').innerHTML.includes('specific-format'));
  assert.equal(app.run('cur'),page.index);
});

// Exercise emitted navigation without browser packages. Drawing/source scripts resolve through
// the same callbacks as file:// loads; history emits popstate for map visits.
const viewerRuntime=(html,sources,hash='#0',initialState=null)=>{
  const elements=new Map(),events=new Map(),location={hash},historyEntries=[];
  let historyAt=-1,context,hit=null;
  const element=id=>{
    if(elements.has(id))return elements.get(id);
    const classes=new Set(),el={id,style:{},value:'',innerHTML:'',disabled:false,listeners:new Map(),
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),
        toggle:k=>classes.has(k)?classes.delete(k):classes.add(k)},
      addEventListener(type,fn){this.listeners.set(type,fn);},querySelectorAll:()=>[],closest:()=>null,
      getBoundingClientRect:()=>({width:1200,height:800,left:0,top:0}),
      firstElementChild:{width:{baseVal:{value:800}},height:{baseVal:{value:600}}}};
    elements.set(id,el);return el;
  };
  const dispatch=(type,event)=>{for(const fn of events.get(type)||[])fn(event);};
  const history={
    get state(){return historyEntries[historyAt]?.state??initialState;},
    pushState(state,_title,url){historyEntries.splice(++historyAt);historyEntries.push({state,url});location.hash=url;},
    replaceState(state,_title,url){if(historyAt<0)historyAt=0;historyEntries[historyAt]={state,url};location.hash=url;},
    back(){if(historyAt>0){const entry=historyEntries[--historyAt];location.hash=entry.url;dispatch('popstate',{state:entry.state});}},
    forward(){if(historyAt+1<historyEntries.length){const entry=historyEntries[++historyAt];location.hash=entry.url;dispatch('popstate',{state:entry.state});}}
  };
  const document={getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},elementFromPoint:()=>hit,
    createElement:()=>({remove(){}}),head:{appendChild(script){
      if(script.src.startsWith('svg/'))context.svgAt(script.src.slice(4).split('.js')[0],'<svg/>');
      else if(script.src.startsWith('sources.js'))context.srcAll(sources);
      script.onload();
    }}};
  context=createContext({document,location,history,CSS:{escape:v=>v},setInterval(){},
    requestAnimationFrame:fn=>fn(),navigator:{clipboard:{writeText(){}}},
    addEventListener(type,fn){events.set(type,[...(events.get(type)||[]),fn]);}});
  runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],context);
  return {run:code=>runInContext(code,context),elements,dispatch,history,location,
    click(target){hit=target;element('stage').listeners.get('click')({target,clientX:10,clientY:10});}};
};

test('graph destinations are drawn once; terminal destinations open source with shared metadata',async t=>{
  const fixture=await built(t);
  const {pages}=await stored(fixture.repo),drawn=await drawings(fixture.out);
  assert.deepEqual([...drawn.keys()].sort(),[...pages.values()].filter(p=>p.destination==='graph').map(p=>p.index).sort());
  assert.equal(fixture.result.pages,pages.size);
  const kinds=list=>{const out={};for(const p of list)out[p.kind]=(out[p.kind]??0)+1;return out;};
  const meta=await pageIndex(fixture.out);
  assert.deepEqual(kinds([...pages.values()]),kinds(Object.values(meta).map(m=>({kind:m.k}))));
  // A class retains its useful graph; a terminal has no redundant self-box drawing.
  const classAt=[...pages.values()].find(p=>p.kind==='class');
  const leaf=[...pages.values()].find(p=>p.destination==='code'&&p.kind!=='class');
  assert.ok(classAt&&leaf,'the fixture holds a class page and a leaf page');
  assert.ok(drawn.get(classAt.index).includes('<g class="fm-node"'));
  assert.equal(drawn.has(leaf.index),false);
  assert.equal(meta[leaf.index].destination,'code');
  assert.equal(meta[leaf.index].r,`${leaf.sourceSpan.file}:${leaf.sourceSpan.line}-${leaf.sourceSpan.endLine}`);
  for(const key of ['calledFrom','couplings','unresolved','uncertainty'])
    if(leaf[key]!==undefined)assert.deepEqual(meta[leaf.index].metadata[key],leaf[key]);
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  assert.ok(html.includes("if(p.destination==='code')openCode(p.r,key)"));
  assert.ok(!html.includes(`<a data-key="${leaf.index}"`),'terminal source is not a page in the left index');
  assert.ok(html.includes(`<a data-key="${classAt.index}"`),'graph destination remains in the left index');
  assert.ok(html.includes('PAGES[k].d===q'),'canonical paths remain directly addressable');
});

test('live freshness expires, rejects a different snapshot and marks source without replacing it',async t=>{
  const fixture=await built(t),html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  const app=viewerRuntime(html,fixture.held,'#0');
  assert.match(app.elements.get('freshness-status').textContent,/unavailable/);
  app.run("freshnessAt({schema:1,snapshotId:SNAPSHOT_ID,checkedAt:new Date().toISOString(),validForMs:10000,state:'current'})");
  assert.match(app.elements.get('freshness-status').textContent,/current with the code/);
  app.run("freshnessAt({schema:1,snapshotId:SNAPSHOT_ID,checkedAt:new Date().toISOString(),validForMs:10000,state:'stale',stale:{regenerate:'2'}})");
  assert.match(app.elements.get('stale').textContent,/STALE.*regenerate 2/);
  app.run("openCode('core/alpha/entry.mjs:1-7')");
  assert.ok(app.elements.get('codepane').innerHTML.includes('STALE snapshot source'));
  assert.ok(app.elements.get('codepane').innerHTML.includes('nothing to do'));
  app.run("freshnessAt({schema:1,snapshotId:'different-generation',checkedAt:new Date().toISOString(),validForMs:10000,state:'current'})");
  assert.match(app.elements.get('stale').textContent,/generation changed/);
  assert.ok(app.elements.get('codepane').classList.contains('on'));
  app.run("freshnessAt({schema:1,snapshotId:SNAPSHOT_ID,checkedAt:new Date(Date.now()-20000).toISOString(),validForMs:10000,state:'current'})");
  assert.match(app.elements.get('freshness-status').textContent,/unavailable/);
  app.run("freshnessAt({schema:1,snapshotId:SNAPSHOT_ID,checkedAt:new Date().toISOString(),validForMs:10000,state:'error'})");
  assert.match(app.elements.get('freshness-status').textContent,/error/);
  assert.ok(app.elements.get('codepane').innerHTML.includes('nothing to do'));
});

test('every clickable target is a page that was emitted, and every breadcrumb reaches 0',async t=>{
  const fixture=await built(t);
  const drawn=await drawings(fixture.out),meta=await pageIndex(fixture.out);
  let targets=0;
  for(const [at,svg] of drawn)for(const [,go] of svg.matchAll(/data-go="([^"]*)"/g)) {
    targets++;
    assert.ok(meta[go],`${at} links to ${go}, which has no destination`);
    assert.ok(drawn.has(go)||meta[go].destination==='code',`${at} links to absent graph ${go}`);
  }
  assert.ok(targets>drawn.size,'the pages link to each other');
  for(const at of drawn.keys()) {
    const trail=[];
    for(let k=at;k!==null&&k!==undefined;k=meta[k].p) {
      assert.ok(!trail.includes(k),`${at} has a breadcrumb loop`);
      trail.push(k);
    }
    assert.equal(trail.at(-1),'0',`${at} does not reach 0`);
  }
  // The viewer opens from the filesystem: sidecars arrive as scripts, never through fetch.
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  assert.ok(!/\bfetch\(|XMLHttpRequest|type="module"/.test(html));
  assert.ok(html.includes("s.src='svg/'+key+'.js?'")&&html.includes("s.src='sources.js'"));
  // The index rows open their page, and an open viewer follows the next build by its stamp.
  assert.ok(html.includes("#tree [data-go]"));
  const stamp=(await readFile(resolve(fixture.out,'stamp.js'),'utf8')).match(/^stampAt\("(.+)"\)$/)?.[1];
  assert.ok(stamp&&html.includes(`const BUILT="${stamp}"`));
});

test('source destinations use a distinct box color instead of leaf text',async t=>{
  const fixture=await built(t),meta=await pageIndex(fixture.out),drawn=await drawings(fixture.out);
  let checked=0;
  for(const svg of drawn.values())for(const block of svg.split('<g class="fm-node"').slice(1)) {
    const [,id]=block.match(/data-id="([^"]+)"/),body=block.slice(block.indexOf('>')+1);
    if(meta[id]?.destination!=='code')continue;
    assert.ok(body.includes('fill="#fff7ed"')&&body.includes('stroke="#c2410c"'),`${id}: ${body}`);
    assert.ok(!/>leaf<|· leaf/.test(body));checked++;
  }
  assert.ok(checked>0);
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  assert.ok(html.includes('opens the matching source directly'));
});

test('Back follows maps only and never opens or closes the independent source overlay',async t=>{
  const fixture=await built(t),meta=await pageIndex(fixture.out);
  const helper=Object.keys(meta).find(k=>meta[k].d==='core/beta/helper.mjs::helper');
  const leaf=Object.keys(meta).find(k=>meta[k].d==='core/beta/box.mjs::Box::value');
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8'),app=viewerRuntime(html,sources);
  assert.ok(html.includes('id="back" onclick="goBack()" disabled'));
  assert.equal(app.elements.get('back').disabled,true);
  app.run(`show(${JSON.stringify(helper)})`);
  app.run(`show(${JSON.stringify(leaf)})`);
  assert.equal(app.run('cur'),helper);
  assert.equal(app.run('graphCur'),helper,'code opened against actual caller, not canonical file');
  assert.equal(app.elements.get('codepane').classList.contains('on'),true);
  app.run('dismissCode();goBack()');
  assert.equal(app.run('cur'),'0','map → code → close → Back returns previous map');
  assert.equal(app.elements.get('codepane').classList.contains('on'),false);
  app.history.forward();
  assert.equal(app.run('cur'),helper);
  assert.equal(app.run('graphCur'),helper);
  assert.equal(app.elements.get('codepane').classList.contains('on'),false,'Forward does not replay a source opening');
  app.run('pageCode()');
  const sourceBody=app.elements.get('codepane').innerHTML;
  assert.equal(app.elements.get('codepane').classList.contains('on'),true);
  app.run('goBack()');
  assert.equal(app.run('cur'),'0','Source button does not add a history visit');
  assert.equal(app.elements.get('codepane').classList.contains('on'),true);
  assert.equal(app.elements.get('codepane').innerHTML,sourceBody,'Back does not replace, close or reopen source');
  app.history.forward();
  assert.equal(app.elements.get('codepane').innerHTML,sourceBody,'Forward also preserves source');
  app.run(`openCode(${JSON.stringify(meta[leaf].r)})`);
  assert.ok(app.elements.get('codepane').innerHTML.includes('return out'));
  app.run('dismissCode();goBack()');
  assert.equal(app.run('cur'),'0');
  assert.equal(app.elements.get('back').disabled,true);
  const direct=viewerRuntime(html,sources,'#'+leaf);
  assert.equal(direct.elements.get('back').disabled,true,'deep link has no in-app predecessor');
  assert.equal(direct.run('cur'),meta[leaf].p);
  assert.equal(direct.elements.get('codepane').classList.contains('on'),true,'direct source address remains supported');
});

test('regeneration follows declaration identity and falls back to a surviving parent after removal',async t=>{
  const source='export const first=x=>x;export const second=x=>x;export function main(x){return second(first(x));}';
  const old=await built(t,{'core/reindex.mjs':source});
  const next=await built(t,{'core/reindex.mjs':'export const inserted=x=>x;'+source});
  const oldMeta=await pageIndex(old.out),nextMeta=await pageIndex(next.out);
  const oldKey=Object.keys(oldMeta).find(k=>oldMeta[k].d==='core/reindex.mjs::main');
  const nextKey=Object.keys(nextMeta).find(k=>nextMeta[k].d==='core/reindex.mjs::main');
  assert.notEqual(oldKey,nextKey);
  const before=viewerRuntime(await readFile(resolve(old.out,'index.html'),'utf8'),old.held,'#'+oldKey);
  const state=before.history.state;
  assert.equal(state.mapPaths[0],'core/reindex.mjs::main');
  const after=viewerRuntime(await readFile(resolve(next.out,'index.html'),'utf8'),next.held,'#'+oldKey,state);
  assert.equal(after.run('cur'),nextKey);
  assert.equal(after.location.hash,'#'+nextKey);
  assert.equal(after.elements.get('codepane').classList.contains('on'),false,'reindexed old number must not open another declaration');
  const gone=await built(t,{'core/reindex.mjs':'export const replacement=x=>x;'});
  const goneMeta=await pageIndex(gone.out),parent=Object.keys(goneMeta).find(k=>goneMeta[k].d==='core/reindex.mjs');
  const fallback=viewerRuntime(await readFile(resolve(gone.out,'index.html'),'utf8'),gone.held,'#'+oldKey,state);
  assert.equal(fallback.run(`navigationKey(${JSON.stringify(state)},${JSON.stringify(oldKey)})`),parent);
  const direct=viewerRuntime(await readFile(resolve(next.out,'index.html'),'utf8'),next.held,'#0',state);
  assert.equal(direct.run('cur'),'0','a deliberate different hash does not inherit old identity');
});

test('Escape closes source while search has focus and native source scrolling remains untouched',async t=>{
  const fixture=await built(t),html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  const meta=await pageIndex(fixture.out),leaf=Object.keys(meta).find(k=>meta[k].destination==='code');
  const app=viewerRuntime(html,sources,'#'+leaf);
  let prevented=false;
  app.dispatch('keydown',{key:'Escape',target:app.elements.get('filter'),preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(app.elements.get('codepane').classList.contains('on'),false);
  assert.equal(app.run('cur'),app.run('graphCur'));
  assert.ok(html.includes("'wheel',e=>{if(e.target.closest('#codepane,#legendpane'))return;e.preventDefault()"));
  assert.ok(html.includes("'pointerdown',e=>{if(e.target.closest('#codepane,#legendpane'))return;"));
});

test('a page whose source moved says so on its own drawing and names what to run',async t=>{
  const fixture=await built(t);
  const before=await drawings(fixture.out);
  assert.ok(![...before.values()].some(svg=>svg.includes('STALE')));
  const at=resolve(storeDir(fixture.repo),'index.json');
  const held=JSON.parse(await readFile(at,'utf8'));
  fixture.held['core/beta/box.mjs']+='\n// source changed after generation\n';
  const result=await fixture.rebuild();
  assert.deepEqual(result.changed,['core/beta/box.mjs']);
  assert.ok(result.stale>0);
  const drawn=await drawings(fixture.out),region=held.files['core/beta/box.mjs'].region;
  const marked=[...drawn].filter(([,svg])=>svg.includes('STALE'));
  const meta=await pageIndex(fixture.out);
  assert.equal(marked.length,Object.values(meta).filter(p=>p.x&&p.destination==='graph').length);
  assert.equal(Object.values(meta).filter(p=>p.x).length,result.stale);
  for(const [,svg] of marked)
    assert.ok(svg.includes(`Run: node scripts/agent-toolkit.mjs regenerate ${region}`)
      ||svg.includes('Run: node scripts/agent-toolkit.mjs regenerate 0'));
  // Page 0 is behind every file, so it is always among them.
  assert.ok(drawn.get('0').includes('STALE'));
});

test('with no store there is nothing to draw: the build refuses and names the command',async t=>{
  const empty=await mkdtemp(resolve(tmpdir(),'saam-view-'));
  t.after(()=>rm(empty,{recursive:true,force:true}));
  await assert.rejects(viewModel({repo:empty}),/regenerate/);
  await assert.rejects(buildGeneratedView({repo:empty,out:resolve(empty,'out')}),
    /No stored map at .*Run: node scripts\/agent-toolkit\.mjs regenerate/s);
});

test('rebuilt stale viewer and CLI present identical generated source after live lines move or disappear',async t=>{
  const fixture=await built(t),file='core/beta/box.mjs',target=`${file}::Box::value`;
  const initial=await readCode(target,{repo:fixture.repo,readSource:fixture.read});
  for(const edited of [`// inserted\n// another line\n${sources[file]}`,undefined]) {
    if(edited===undefined)delete fixture.held[file];else fixture.held[file]=edited;
    await fixture.rebuild();
    const emitted=await readFile(resolve(fixture.out,'sources.js'),'utf8');
    const viewSources=JSON.parse(emitted.slice('srcAll('.length,-1).replaceAll('<\\/','</'));
    assert.equal(viewSources[file],sources[file]);
    const cli=await readCode(target,{repo:fixture.repo,readSource:fixture.read});
    const viewCode=viewSources[file].split('\n').slice(cli.line-1,cli.endLine)
      .map((line,i)=>`${cli.line+i}\t${line}`).join('\n');
    assert.equal(cli.source,initial.source);assert.equal(cli.source,viewCode);
    assert.ok((await pageIndex(fixture.out))[cli.index].x);
  }
});

test('shared state hub bodies open matching generated source after live source moves or disappears',async t=>{
  const file='core/state.mjs',source=`export class State {
  static value=8;
  constructor(){this.value=7;}
  read(){return this.value;}
  static write(){this.value++;}
  static readStatic(){return this.value;}
}
export function run(){return new State();}`;
  const fixture=await built(t,{[file]:source}),{pages}=await stored(fixture.repo);
  const page=[...pages.values()].find(p=>p.path===`${file}::State`);
  const baseline=await readCode(page.path,{repo:fixture.repo,readSource:fixture.read});
  const ids=new Set(page.stateFields.map(f=>f.id));assert.equal(ids.size,2);
  for(const live of [`// inserted lines\n// shifted\n${source.replace('value=7','value=99')}`,undefined]){
    if(live===undefined)delete fixture.held[file];else fixture.held[file]=live;
    await fixture.rebuild();
    const emitted=await readFile(resolve(fixture.out,'sources.js'),'utf8');
    const snapshots=JSON.parse(emitted.slice('srcAll('.length,-1).replaceAll('<\\/','</'));
    const cli=await readCode(page.path,{repo:fixture.repo,readSource:fixture.read});
    assert.equal(cli.source,baseline.source);assert.equal(snapshots[file],source);
    assert.ok((await pageIndex(fixture.out))[page.index].x);
    const svg=(await drawings(fixture.out)).get(page.index);
    const app=viewerRuntime(await readFile(resolve(fixture.out,'index.html'),'utf8'),snapshots,'#'+page.index);
    for(const field of page.stateFields){
      const at=field.source,ref=`${file}:${at.line}-${at.endLine}`;
      const hub=svg.split('<g class="fm-node"').slice(1).find(s=>s.startsWith(` data-id="${field.id}"`));
      assert.ok(hub,`drawn hub ${field.id}`);assert.ok(hub.split('>')[0].includes(`data-ref="${ref}"`));
      app.click({dataset:{ref},closest(selector){return selector==='.fm-node[data-ref]'?this:null;}});
      assert.equal(app.elements.get('codepane').classList.contains('on'),true);
      const code=app.elements.get('codepane').innerHTML;
      assert.ok(code.includes(field.receiver==='static'?'value=8':'value=7'));
      assert.ok(!code.includes('value=99'));
      assert.equal(app.run('cur'),page.index,'source opens without losing the owning class graph');
    }
    const caller=page.ports.find(p=>p.label==='run');
    assert.ok(page.wires.some(w=>w.from===caller.index&&w.callKind==='construct'));
    assert.ok(svg.includes(`data-go="${caller.index}"`),'proved caller remains navigable');
  }
});

test('a branch-only operator keeps its choice and connected alternatives without repeating its implementation',async t=>{
  const fixture=await built(t,{'core/choice.mjs':'export function choose(flag,a,b){return flag?a:b;}'});
  const {pages}=await stored(fixture.repo),page=[...pages.values()].find(p=>p.path==='core/choice.mjs::choose');
  assert.equal(page.components.length,0);assert.equal(page.operators.length,1);
  assert.equal(page.destination,'graph');assert.ok(!page.leaf);
  const drawn=await drawings(fixture.out),svg=drawn.get(page.index);
  assert.ok(svg.includes(`data-id="${page.operators[0].id}"`));
  assert.ok(svg.includes('>choose</text>'));
  assert.ok(!svg.includes('true: a'));assert.ok(!svg.includes('false: b'));
  assert.ok(svg.includes('a (true)'));assert.ok(svg.includes('b (false)'));
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  assert.ok(html.includes('#codepane .cb{min-width:0;min-height:0;overflow:auto}'));
  assert.ok(!html.includes('body+=`<details open>'),'code metadata is collapsed by default');
  assert.ok(html.includes("'wheel',e=>{if(e.target.closest('#codepane,#legendpane'))return;e.preventDefault()"));
  assert.ok(html.includes("'pointerdown',e=>{if(e.target.closest('#codepane,#legendpane'))return;"));
  assert.ok(html.includes("'click',e=>{if(e.target.closest('#codepane,#legendpane')||moved)return;"));
});

test('code-leaf callers are shared page evidence and individually linked red map references',async t=>{
  const fixture=await built(t,{'core/callers.mjs':`export const leaf=x=>x;
export const first=x=>leaf(x);
export const second=x=>leaf(x);
export function main(x){return leaf(x)+first(x);}
export const outside=x=>main(x);`});
  const {pages}=await stored(fixture.repo),byName=name=>[...pages.values()].find(p=>p.path===`core/callers.mjs::${name}`);
  const main=byName('main'),leaf=byName('leaf'),first=byName('first'),second=byName('second'),outside=byName('outside');
  assert.equal(leaf.destination,'code');
  const reference=main.components.find(c=>c.index===leaf.index);
  assert.deepEqual(reference.callerReferences.map(r=>r.index),[second.index]);
  assert.ok(reference.callerReferences.every(r=>r.path&&r.path.startsWith('core/callers.mjs::')));
  assert.ok(main.callerWires.some(w=>w.from===first.index&&w.to===leaf.index&&w.kind==='call'));
  const drawn=await drawings(fixture.out),svg=drawn.get(main.index);
  assert.ok(svg.includes('class="fm-caller-arrow"'));assert.ok(svg.includes('stroke="#dc2626"'));
  for(const caller of [second,outside])
    assert.ok(svg.includes(`class="fm-go fm-caller-reference" data-go="${caller.index}"`));
  assert.ok(!svg.includes(`class="fm-go fm-caller-reference" data-go="${first.index}"`));
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  assert.ok(!html.includes('JSON.stringify(value,null,2)'),'source pane does not append raw metadata');
});

test('busy component callers draw one canonical summary and its code pane retains linked full evidence',async t=>{
  const callers=Array.from({length:6},(_,i)=>`export const caller${i}=x=>leaf(x);`).join('\n');
  const fixture=await built(t,{'core/many-callers.mjs':`export const leaf=x=>x;\n${callers}\nexport function main(x){return x?leaf(x):x;}`});
  const {pages}=await stored(fixture.repo),byName=name=>[...pages.values()].find(p=>p.path===`core/many-callers.mjs::${name}`);
  const main=byName('main'),leaf=byName('leaf');
  const svg=(await drawings(fixture.out)).get(main.index);
  assert.ok(svg.includes(`6 callers → ${leaf.index}`));
  assert.equal((svg.match(/class="fm-go fm-caller-reference"/g)||[]).length,1);
  assert.ok(svg.includes(`data-go="${leaf.index}"`));
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8');
  assert.ok(html.includes('callerEvidence(page)'));
  assert.ok(html.includes("e.target.closest('#codepane [data-go]')"));
  const meta=await pageIndex(fixture.out);
  assert.equal(meta[leaf.index].metadata.calledFrom.length,7);
  assert.ok(meta[leaf.index].metadata.calledFrom.every(row=>row.index&&meta[row.index]));
  const app=viewerRuntime(html,fixture.held,'#'+main.index);
  app.click({dataset:{go:leaf.index},closest(selector){return selector==='[data-go]'?this:null;}});
  const pane=app.elements.get('codepane');
  assert.ok(pane.classList.contains('on'));
  assert.ok(pane.innerHTML.includes('called from · 7'));
  for(const row of meta[leaf.index].metadata.calledFrom)assert.ok(pane.innerHTML.includes(`data-go="${row.index}"`));
});

test('on-page call evidence draws red connecting arrows and a port for the page owner',async t=>{
  const fixture=await built(t,{'core/cycle.mjs':`export const leaf=x=>x;
export function first(x){return second(x)+leaf(x);}
export function second(x){return first(x);}`});
  const {pages}=await stored(fixture.repo),page=[...pages.values()].find(p=>p.path==='core/cycle.mjs::first');
  const drawn=await drawings(fixture.out),svg=drawn.get(page.index);
  assert.ok(page.callerBoundary&&page.callerWires.length);
  for(const wire of page.callerWires) {
    const arrow=[...svg.matchAll(/<path class="fm-edge"[^>]+>/g)].map(m=>m[0]).find(s=>
      s.includes(`data-a="${wire.from}"`)&&s.includes(`data-b="${wire.to}"`)&&s.includes('stroke="#dc2626"'));
    assert.ok(arrow,`${wire.from} → ${wire.to} is drawn as a call`);
    assert.ok(arrow.includes('stroke-dasharray="2 3"'));
  }
  assert.ok(svg.includes('>calls</text>'));
  assert.ok(svg.includes(`data-id="${page.callerBoundary.id}" data-kind="caller"`));
  assert.ok(!svg.includes('called from ·'),'the visible caller is not repeated as an off-page reference');
});

test('parameter callback invocation shows identity and unresolved marker with implementation under source',async t=>{
  const fixture=await built(t,{'core/progress.mjs':`export function report(completed,onProgress){
onProgress?.({stage:'composition',completed,unknown:external()});
return completed;
}`});
  const {pages}=await stored(fixture.repo),page=[...pages.values()].find(p=>p.path==='core/progress.mjs::report');
  const op=page.operators.find(o=>o.kind==='invocation');
  assert.ok(op);assert.equal(page.destination,'graph');
  const svg=(await drawings(fixture.out)).get(page.index);
  assert.ok(svg.includes(`data-id="${op.id}" data-kind="invocation"`));
  assert.ok(svg.includes('>onProgress · call</text>'));
  assert.ok(svg.includes('>unresolved</text>'));
  assert.ok(!svg.includes('arg1: {stage, completed, unknown}'));
  assert.ok(!svg.includes('unknown fields: unknown'));
  assert.ok(!svg.includes("stage:'composition'"),'payload displays field names rather than object implementation');
  assert.ok(!svg.includes('onProgress !== null &amp;&amp; onProgress !== undefined'));
  assert.ok(svg.includes('data-ref="core/progress.mjs:2-2"'));
});

test('compatible value wires draw once with all named values while stored wires remain distinct',async t=>{
  const fixture=await built(t,{'core/values.mjs':`export const produce=x=>({state:x,actions:[x]});
export const consume=(state,actions)=>({state,actions});
export function main(x){const result=produce(x);return consume(result.state,result.actions);}`});
  const {pages}=await stored(fixture.repo),find=name=>[...pages.values()].find(p=>p.path===`core/values.mjs::${name}`);
  const main=find('main'),produce=find('produce'),consume=find('consume');
  const raw=main.wires.filter(w=>w.from===produce.index&&w.to===consume.index);
  assert.equal(raw.length,2);assert.deepEqual(raw.map(w=>w.label).sort(),['result.actions','result.state']);
  const svg=(await drawings(fixture.out)).get(main.index);
  const paths=[...svg.matchAll(/<path class="fm-edge"[^>]+>/g)].map(m=>m[0]).filter(path=>
    path.includes(`data-a="${produce.index}"`)&&path.includes(`data-b="${consume.index}"`));
  assert.equal(paths.length,1);
  const labels=[...svg.matchAll(/<g class="fm-elab"[^>]+>([\s\S]*?)<\/g>/g)].map(m=>m[0]);
  assert.ok(labels.some(label=>label.includes('>result.state (arg1)</text>')&&label.includes('>result.actions (arg2)</text>')));
  assert.equal((await stored(fixture.repo)).pages.get(main.index).wires.filter(w=>w.from===produce.index&&w.to===consume.index).length,2);
});

test('a called stage condition opens its caller predicate source without navigating to the callee',async t=>{
  const fixture=await built(t,{'core/gated-stage.mjs':`export const stage=x=>x;export const prepare=x=>x;
export function main(input){
const prepared=prepare(input);
if(input.enabled)return stage(prepared);
return null;
}`});
  const {pages}=await stored(fixture.repo),main=[...pages.values()].find(p=>p.path==='core/gated-stage.mjs::main');
  const svg=(await drawings(fixture.out)).get(main.index);
  const hit=svg.match(/class="fm-src fm-gate-source" data-ref="([^"]+)"/);
  assert.ok(hit,'condition has an independent source target');
  assert.equal(hit[1],'core/gated-stage.mjs:4-4');
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8'),app=viewerRuntime(html,fixture.held,'#'+main.index);
  const node={dataset:{ref:hit[1]},closest(selector){return selector==='.fm-src'?this:null;}};
  app.click(node);
  assert.ok(app.elements.get('codepane').innerHTML.includes('lines 4–4'));
  assert.ok(app.elements.get('codepane').innerHTML.includes('input.enabled'));
  assert.equal(app.run('cur'),main.index);
  assert.equal(app.elements.get('back').disabled,true);
});

test('assertions draw as connected source-addressable gates without repeating predicates or error prose',async t=>{
  const fixture=await built(t,{'core/assertions.mjs':`export function requireThat(condition,message){if(!condition)throw Error(message);}
export const prepare=x=>x;
export function main(input){
const ready=prepare(input);
requireThat(ready.value>3,"private threshold message");
requireThat(input.mode==="private-mode","private mode message");
return ready;
}`});
  const {pages}=await stored(fixture.repo),raw=[...pages.values()].find(p=>p.path==='core/assertions.mjs::main');
  assert.equal(raw.requires.length,2,'rich source requirements remain available');
  const model=await viewModel({repo:fixture.repo,readSource:fixture.read}),page=model.pages.find(p=>p.path===raw.path);
  assert.equal(page.requires.length,0,'default graph contains gates instead of duplicate prose rows');
  const gates=page.components.filter(c=>c.shape==='assertion');
  assert.equal(gates.length,2);assert.notEqual(gates[0].id,gates[1].id);
  const svg=(await drawings(fixture.out)).get(raw.index);
  for(const gate of gates)assert.ok(page.wires.some(w=>w.to===gate.id),'each gate keeps actual input producers');
  for(const line of [5,6])assert.ok(svg.includes(`class="fm-src fm-gate-source" data-ref="core/assertions.mjs:${line}-${line}"`));
  for(const text of ['private threshold message','private mode message','private-mode','ready.value&gt;3'])assert.ok(!svg.includes(text),text);
  assert.ok(svg.includes('rx="15"'),'assertion gate shape differs from an ordinary stage');
});

test('returned function values show capture wires separately from execution and expose mutable capture limits',async t=>{
  const fixture=await built(t,{'core/capture-view.mjs':`export const prepare=x=>x;
export function factory(input){const prepared=prepare(input);let disposed=false;
function sample(){if(disposed)throw Error("disposed");return prepared;}
function dispose(){disposed=true;}
return {sample,dispose};}`});
  const model=await viewModel({repo:fixture.repo,readSource:fixture.read}),page=model.pages.find(p=>p.path==='core/capture-view.mjs::factory');
  const sample=page.components.find(c=>c.label==='factory::sample'),dispose=page.components.find(c=>c.label==='factory::dispose');
  assert.ok(sample&&dispose);
  assert.ok(page.wires.some(w=>w.to===sample.index&&w.kind==='capture'&&w.label==='prepared'));
  for(const child of [sample,dispose])assert.ok(page.wires.some(w=>w.from===child.index&&w.to==='out1'&&w.fromPort==='callable'));
  assert.ok(sample.captures.some(c=>c.name==='disposed'&&c.valueUnknown&&c.lifetimeUnknown));
  assert.ok(sample.captures.every(c=>!c.source),'capture declaration spans stay under details');
  const svg=(await drawings(fixture.out)).get(page.index);
  assert.ok(svg.includes('function value'));
  assert.ok(svg.includes('disposed · origin unknown, lifetime unknown'));
  assert.ok(svg.includes('stroke="#0369a1"')&&svg.includes('stroke-dasharray="3 3"'));
});

test('value bundling preserves separate conditions, operator roles and call semantics',()=>{
  const base={from:'a',to:'b',kind:'data',label:'state'};
  const cases=[
    {...base,label:'actions',expression:'result.actions'},
    {...base,gate:0},{...base,gate:1},
    {...base,fromPort:'current'},{...base,fromPort:'final'},
    {...base,toPort:'initial'},{...base,toPort:'next'},
    {...base,toPort:'arg1'},{...base,toPort:'arg2'},
    {...base,kind:'call'},{...base,kind:'return'},
    {...base,provenance:'ast-choice'},{...base,provenance:'ast-iteration'},
    {...base,kind:'state',order:'source'}
  ];
  const wires=[base,...cases];
  const probe=spawnSync('python',['-c',
    'import importlib.util,json,sys; sys.path.insert(0,"dev-map/lib"); s=importlib.util.spec_from_file_location("generated_view","dev-map/lib/generated-view.py"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); wires=json.loads(sys.argv[1]); before=json.dumps(wires); out=m.value_bundles(wires); print(json.dumps({"out":out,"unchanged":before==json.dumps(wires)}))',
    JSON.stringify(wires)],{cwd:resolve(import.meta.dirname,'../..'),encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr);
  const result=JSON.parse(probe.stdout);
  assert.equal(result.unchanged,true);
  assert.equal(result.out.length,wires.length-2,'ordinary compatible values and source argument slots combine');
  assert.equal(result.out[0].label,'state\nactions');
  const argumentsBundle=result.out.find(w=>w.argumentValues);
  assert.deepEqual(argumentsBundle.argumentValues,[{label:'state',toPort:'arg1'},{label:'state',toPort:'arg2'}]);
  assert.deepEqual(result.out.slice(1).filter(w=>!w.argumentValues),cases.slice(1).filter(w=>!/^arg\d+$/.test(w.toPort??'')));
});

test('off-page reference arrows leave shared boxes while the expanded owner has plain caller links',async t=>{
  const fixture=await built(t,{'core/references.mjs':`export const shared=x=>x;
export const step=x=>x+1;
export const other=x=>shared(x);
export function main(x){return step(shared(x));}
export const outside=x=>main(x);`});
  const {pages}=await stored(fixture.repo),main=[...pages.values()].find(p=>p.path==='core/references.mjs::main');
  const svg=(await drawings(fixture.out)).get(main.index);
  const body=svg.split('<g class="fm-node"').slice(1).find(s=>s.includes('class="fm-caller-arrow"'));
  assert.ok(body);
  const arrow=body.match(/class="fm-caller-arrow" d="M([\d.]+),([\d.]+) L([\d.]+),([\d.]+)"/);
  assert.ok(arrow);assert.equal(arrow[1],arrow[3]);assert.ok(+arrow[4]>+arrow[2]);
  const boxes=[...body.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]+/g)];
  assert.ok(boxes.some(b=>Math.abs(+b[2]+ +b[4]- +arrow[2])<0.11&&+arrow[1]>=+b[1]&&+arrow[1]<=+b[1]+ +b[3]),'reference starts exactly on shared box boundary');
  const frame=svg.match(/class="fm-owner-frame"[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/);
  assert.ok(frame);assert.ok(!svg.includes('fm-owner-reference'));
  assert.ok(svg.includes('class="fm-owner-callers"'));
  assert.ok(svg.includes(`data-owner="${main.index}"`));
});

test('default ports show direct caller links and uncertainty while rich store retains the trace',async t=>{
  const fixture=await built(t,{'core/boundaries.mjs':`export const make=x=>x;
export const sink=(a,b)=>a+b;
export function stage(value=1){const prepared=make(value);return sink(prepared,value);}
export function caller(seed){const first=stage(seed);const second=stage(2);return sink(first,second);}
export function spread(args){return stage(...args);}
export function omitted(){return stage();}`});
  const {pages}=await stored(fixture.repo),find=name=>[...pages.values()].find(p=>p.path===`core/boundaries.mjs::${name}`);
  const stage=find('stage'),caller=find('caller'),sink=find('sink'),spread=find('spread'),omitted=find('omitted');
  const input=stage.inputs[0],output=stage.outputs[0];
  assert.equal(input.references.length,4,'multiple invocations in the same caller stay separate');
  const svg=(await drawings(fixture.out)).get(stage.index);
  assert.ok(svg.includes('>value</text>'));
  assert.ok(svg.includes('from caller '));assert.ok(svg.includes('to caller '));
  for(const target of [caller,spread,omitted])
    assert.ok(svg.includes(`class="fm-go fm-port-reference" data-go="${target.index}"`));
  for(const text of ['position unknown','origin unknown','defaulted'])
    assert.ok(svg.includes(text),text);
  for(const text of ['>input 1</text>','>default: 1</text>','argument 1: seed','result: first','producer ','consumer '])
    assert.ok(!svg.includes(text),`default presentation omits ${text}`);
  const model=await viewModel({repo:fixture.repo,readSource:fixture.read});
  const shown=model.pages.find(p=>p.index===stage.index);
  assert.equal(shown.inputs[0].references.length,3,'one default row per caller');
  assert.deepEqual(shown.inputs[0].references.find(r=>r.index===caller.index),{index:caller.index,sites:2});
  assert.ok(svg.includes(' · 2 sites'));
  for(const ref of input.references.filter(r=>r.index===caller.index))
    assert.ok(!svg.includes(`>${caller.index}:${ref.line}:${ref.column}</text>`),'multi-site caller has no arbitrary representative address');
  assert.ok(output.references.some(r=>r.uses.some(u=>u.index===sink.index)));
  assert.ok(input.references.some(r=>r.expression==='seed'));
  assert.equal(input.default,'1');
  assert.deepEqual(input.references.find(r=>r.index===spread.index).producers,[]);
  assert.ok(!svg.includes('"references":'),'port evidence is not a metadata dump');
});

test('drawn boundary caller groups count partial uncertainty instead of marking every site unknown',async t=>{
  const fixture=await built(t,{'core/caller-groups.mjs':`const make=x=>x;const sink=x=>x;
export function stage(value){const prepared=make(value);return sink(prepared);}
export function caller(seed,items){const first=stage(seed),second=stage(...items);return [first,second];}`});
  const {pages}=await stored(fixture.repo),raw=[...pages.values()].find(p=>p.path==='core/caller-groups.mjs::stage');
  const model=await viewModel({repo:fixture.repo,readSource:fixture.read}),page=model.pages.find(p=>p.index===raw.index);
  const ref=page.inputs[0].references[0],svg=(await drawings(fixture.out)).get(raw.index);
  assert.equal(raw.inputs[0].references.length,2);assert.equal(page.inputs[0].references.length,1);
  assert.equal(ref.sites,2);assert.equal(ref.flagCounts.unknown,1);assert.equal(ref.flagCounts.positionUnknown,1);
  assert.ok(svg.includes('origin unknown 1/2'));assert.ok(svg.includes('position unknown 1/2'));assert.ok(svg.includes(' · 2 sites'));
  assert.ok(svg.includes(`class="fm-go fm-port-reference" data-go="${ref.index}"`));
});

test('operator boxes show identity and source only while wires and rich implementation remain available',async t=>{
  const fixture=await built(t,{'core/local-state-view.mjs':`export function main(items,callback){
const counts=new Map();let count=0;
for(const item of items){counts.set(item,(counts.get(item)??0)+1);callback?.(++count);}
return {count,size:counts.size};
}`});
  const {pages}=await stored(fixture.repo),page=[...pages.values()].find(p=>p.path==='core/local-state-view.mjs::main');
  const svg=(await drawings(fixture.out)).get(page.index),blocks=svg.split('<g class="fm-node"').slice(1);
  const body=op=>blocks.find(b=>b.startsWith(` data-id="${op.id}"`)).split('</g>')[0];
  const set=page.operators.find(o=>o.kind==='collection'&&o.operation==='set');
  const update=page.operators.find(o=>o.kind==='update');
  const loop=page.operators.find(o=>o.kind==='iteration'&&o.binding==='count');
  assert.ok(set&&update&&loop);
  assert.equal(set.arguments.find(a=>a.port==='value').expression,'(counts.get(item)??0)+1');
  assert.ok(body(set).includes('>counts · set</text>'));
  assert.deepEqual(update.constants.value,['1']);
  assert.ok(body(update).includes('>count · ++</text>'));
  assert.deepEqual(loop.initialConstants,['0']);
  assert.ok(body(loop).includes('>count · loop</text>'));
  for(const op of page.operators) {
    assert.ok(body(op).includes(`data-ref="${op.file}:${op.line}-${op.endLine}"`));
    for(const text of ['value:','key:','(constant)','>prefix</text>','>gate:','initial constants:',
      'min iterations:','of items','present:','nullish:','arg1:','callback !== null','counts.get(item)'])
      assert.ok(!body(op).includes(text),`${op.id} shows its implementation only under source: ${text}`);
  }
  const paths=[...svg.matchAll(/<path class="fm-edge"[^>]+>/g)].map(m=>m[0]);
  for(const wire of page.wires)assert.ok(paths.some(path=>path.includes(`data-a="${wire.from}"`)&&path.includes(`data-b="${wire.to}"`)),
    `${wire.from} → ${wire.to} remains drawn`);
  for(const text of ['ast-collection','ast-update','ast-iteration','inputs: state','outputs: next','>new Map()</text>'])
    assert.ok(!svg.includes(text),`default presentation omits ${text}`);
  const html=await readFile(resolve(fixture.out,'index.html'),'utf8'),app=viewerRuntime(html,fixture.held,'#'+page.index);
  for(const op of page.operators) {
    const node={dataset:{ref:`${op.file}:${op.line}-${op.endLine}`},closest(selector){
      return selector==='.fm-node[data-ref]'?this:null;
    }};
    app.click(node);
    assert.equal(app.elements.get('codepane').classList.contains('on'),true,'whole operator body opens source');
    assert.ok(app.elements.get('codepane').innerHTML.includes(`lines ${op.line}–${op.endLine}`));
    assert.equal(app.run('cur'),page.index,'operator source creates no synthetic map or map-history entry');
    assert.equal(app.elements.get('back').disabled,true);
    app.run('dismissCode()');
  }
});
