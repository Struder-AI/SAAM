// The owner's view of the stored map: one drawing per stored page, every click resolving to a
// page that exists, a breadcrumb that reaches 0, and a page that says so when its source moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {generate,storeDir} from '../../scripts/dev-map/store.mjs';
import {buildGeneratedView,viewModel} from '../../scripts/dev-map/generated-view.mjs';

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

const built=async t=>{
  const repo=await mkdtemp(resolve(tmpdir(),'saam-view-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  const held={...sources},read=file=>held[file];
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

test('every stored page is drawn once, including a leaf and a class',async t=>{
  const fixture=await built(t);
  const {pages}=await stored(fixture.repo),drawn=await drawings(fixture.out);
  assert.deepEqual([...drawn.keys()].sort(),[...pages.keys()].sort());
  assert.equal(fixture.result.pages,pages.size);
  const kinds=list=>{const out={};for(const p of list)out[p.kind]=(out[p.kind]??0)+1;return out;};
  const meta=await pageIndex(fixture.out);
  assert.deepEqual(kinds([...pages.values()]),kinds(Object.values(meta).map(m=>({kind:m.k}))));
  // A class page and a leaf page are both there, and both drew boxes.
  const classAt=[...pages.values()].find(p=>p.kind==='class');
  const leaf=[...pages.values()].find(p=>p.leaf&&p.kind!=='class');
  assert.ok(classAt&&leaf,'the fixture holds a class page and a leaf page');
  for(const page of [classAt,leaf])
    assert.ok(drawn.get(page.index).includes('<g class="fm-node"'),`${page.index} drew no box`);
  // The leaf calls nothing, so its own box, its ports and its callers are what it has.
  const svg=drawn.get(leaf.index);
  assert.ok(svg.includes(`data-id="${leaf.index}"`),'a leaf draws the function it is');
  assert.equal([...svg.matchAll(/<path class="fm-edge"/g)].length,
    leaf.inputs.length+leaf.outputs.length+leaf.calledFrom.length);
});

test('every clickable target is a page that was emitted, and every breadcrumb reaches 0',async t=>{
  const fixture=await built(t);
  const drawn=await drawings(fixture.out),meta=await pageIndex(fixture.out);
  let targets=0;
  for(const [at,svg] of drawn)for(const [,go] of svg.matchAll(/data-go="([^"]*)"/g)) {
    targets++;
    assert.ok(drawn.has(go),`${at} links to ${go}, which was not emitted`);
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
  assert.ok(html.includes("s.src='svg/'+key+'.js'")&&html.includes("s.src='sources.js'"));
});

test('a page whose source moved says so on its own drawing and names what to run',async t=>{
  const fixture=await built(t);
  const before=await drawings(fixture.out);
  assert.ok(![...before.values()].some(svg=>svg.includes('STALE')));
  const at=resolve(storeDir(fixture.repo),'index.json');
  const held=JSON.parse(await readFile(at,'utf8'));
  held.files['core/beta/box.mjs'].sha256='0'.repeat(64);
  await writeFile(at,JSON.stringify(held,null,1));
  const result=await fixture.rebuild();
  assert.deepEqual(result.changed,['core/beta/box.mjs']);
  assert.ok(result.stale>0);
  const drawn=await drawings(fixture.out),region=held.files['core/beta/box.mjs'].region;
  const marked=[...drawn].filter(([,svg])=>svg.includes('STALE'));
  assert.equal(marked.length,result.stale);
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
