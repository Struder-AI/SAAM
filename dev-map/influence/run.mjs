// Milestone 1 of plans/dev-maps.md: run the influence analysis on a selection of SAAM source
// and time each phase. Usage:
//   node dev-map/influence/run.mjs [--closure] [--depth N] [--out FILE] [--platform FILE] PREFIX...
// PREFIX selects in-scope files by path prefix (`all` for the whole scope). --closure adds every
// in-scope module the selection imports, transitively, so the analysis sees whole programs.
// --depth sets how many call sites deep directly called functions are copied (default 1).
// --engine summary selects the compositional analysis (compile.mjs, compose.mjs) instead of the
// whole-program copies; --max-depth N and --max-instances N bound its call-path contexts, and
// --edit FILE (repeatable) then measures re-analysis after an edit to FILE.
// --platform writes the platform inventory: every call site reaching platform code, with the
// APIs it reaches and how each was modelled (platform-models.mjs).
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import * as acorn from 'acorn';
import {PointsTo} from './points-to.mjs';
import {buildConstraints,resolver,platformInventory} from './constraints.mjs';
import {derive,pairArrowsOf} from './derive.mjs';
import {compileModule} from './compile.mjs';
import {compose} from './compose.mjs';
import {importAliases} from '../lib/scope.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2);
const closure=argv.includes('--closure');
const depthAt=argv.indexOf('--depth');const depth=depthAt>=0?+argv[depthAt+1]:1;
const outAt=argv.indexOf('--out');const out=outAt>=0?argv[outAt+1]:null;
const drawAt=argv.indexOf('--draw');const drawName=drawAt>=0?argv[drawAt+1]:null;
const svgAt=argv.indexOf('--svg');const svgOut=svgAt>=0?argv[svgAt+1]:null;
const platAt=argv.indexOf('--platform');const platOut=platAt>=0?argv[platAt+1]:null;
const valueOf=flag=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:undefined;};
const engine=valueOf('--engine')??'copies';
const maxDepth=valueOf('--max-depth')!==undefined?+valueOf('--max-depth'):Infinity;
const maxInstances=valueOf('--max-instances')!==undefined?+valueOf('--max-instances'):Infinity;
const edits=argv.flatMap((a,i)=>a==='--edit'?[argv[i+1]]:[]);
const maxMs=valueOf('--max-ms')!==undefined?+valueOf('--max-ms'):undefined;
const valued=new Set(['--out','--platform','--depth','--draw','--svg','--engine','--max-depth','--max-instances','--edit','--max-ms']);
const prefixes=argv.filter((a,i)=>!a.startsWith('--')&&!valued.has(argv[i-1]));

// Scope: SAAM code that runs in use. Tests, demos, benchmarks and development tooling are out.
const ROOTS=/^(core|studio|skills|workspaces|packaging|scripts|adapters)\//;
const OUT=/(^|\/)(tests?|demos?|bench|benchmarks?|fixtures?|examples?|vendor|node_modules)\/|\.test\.|\.min\.|^scripts\/(bench|bambu-audit)|^packaging\/(windows|macos)\//;
const inScope=f=>/\.(mjs|js)$/.test(f)&&ROOTS.test(f)&&!OUT.test(f);

const clock=()=>process.hrtime.bigint();
const ms=(a,b)=>Number(b-a)/1e6;
const t0=clock();
const all=execFileSync('git',['ls-files'],{cwd:repo,encoding:'utf8'}).split('\n').filter(inScope);
let files=prefixes.includes('all')?all:all.filter(f=>prefixes.some(p=>f.startsWith(p)));
const resolveImport=resolver(all,{aliases:importAliases});

const parsed=new Map(),parseErrors=[];
async function parse(file) {
  if(parsed.has(file))return parsed.get(file);
  const text=await readFile(resolve(repo,file),'utf8');
  let ast=null;
  try{ast=acorn.parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true});}
  catch(e){try{ast=acorn.parse(text,{ecmaVersion:'latest',sourceType:'script',locations:true,allowHashBang:true});}catch{parseErrors.push({file,error:e.message});}}
  const mod=ast&&{file,text,ast};parsed.set(file,mod);return mod;
}
for(const f of files)await parse(f);
if(closure) {
  const queue=[...files];
  while(queue.length) {
    const mod=parsed.get(queue.pop());if(!mod)continue;
    const specs=[];
    for(const s of mod.ast.body)if((s.type==='ImportDeclaration'||s.type==='ExportAllDeclaration'||s.type==='ExportNamedDeclaration')&&s.source)specs.push(s.source.value);
    for(const spec of specs){const t=resolveImport(mod.file,spec);if(t&&!parsed.has(t)&&inScope(t)){await parse(t);queue.push(t);}}
  }
  files=[...parsed.keys()];
}
const modules=files.map(f=>parsed.get(f)).filter(Boolean);
const bytes=modules.reduce((s,m)=>s+m.text.length,0);
const t1=clock();

// Node built-ins load for real, so platform reads follow what they actually export.
const platformModules=new Map();
for(const m of modules)for(const s of m.ast.body)if(s.source&&/^node:/.test(s.source.value)&&!platformModules.has(s.source.value)) {
  try{platformModules.set(s.source.value,await import(s.source.value));}catch{}
}
let pt,built,units,t2,t3;
if(engine==='summary') {
  units=new Map();const notes=[];
  for(const m of modules){const u=compileModule(m,{resolveImport});units.set(m.file,u);notes.push(...u.notes);}
  t2=clock();
  pt=new PointsTo();
  built=compose(pt,units,{platformModules,debug:{maxMs}});built.unmodelled=[...notes,...built.unmodelled];
  t3=clock();
} else {
  pt=new PointsTo();
  built=buildConstraints(pt,modules,{resolveImport,platformModules,depth});
  t2=clock();
  pt.solve();
  t3=clock();
}
const result=derive(pt,built);
const t4=clock();

const count=(list,key)=>{const c={};for(const x of list){const k=key(x);c[k]=(c[k]??0)+1;}return Object.fromEntries(Object.entries(c).sort((a,b)=>b[1]-a[1]));};
let ptsTotal=0,ptsMax=0;for(const s of pt.pts){ptsTotal+=s.size;if(s.size>ptsMax)ptsMax=s.size;}
const summary={
  ...(built.stats?.stoppedEarly?{INCOMPLETE:`composition stopped at --max-ms ${maxMs} before settling; every count below is partial`}:{}),
  selection:prefixes,closure,engine,depth:engine==='summary'?{maxDepth,maxInstances}:depth,files:modules.length,bytes,parseErrors:parseErrors.length,
  timingsMs:engine==='summary'?{readParse:Math.round(ms(t0,t1)),compile:Math.round(ms(t1,t2)),composeAndSolve:Math.round(ms(t2,t3)),derive:Math.round(ms(t3,t4)),total:Math.round(ms(t0,t4))}
    :{readParse:Math.round(ms(t0,t1)),constraints:Math.round(ms(t1,t2)),solve:Math.round(ms(t2,t3)),derive:Math.round(ms(t3,t4)),total:Math.round(ms(t0,t4))},
  ...(engine==='summary'?{compose:built.stats}:{}),
  heapMB:Math.round(process.memoryUsage().heapUsed/1048576),
  pointsTo:{nodes:pt.pts.length,objects:pt.objects.length,fieldNodes:pt.fields.size,copyEdges:pt.edgeCount,propagations:pt.propagations,pointsToTotal:ptsTotal,largestSet:ptsMax},
  ...result.summary,
  unmodelled:count(built.unmodelled,u=>u.kind.startsWith('platform:')?'platform API without a model (sites)':u.kind),
  unresolvedImports:built.unresolvedImports.length,
  platformGettersAssumedPrimitive:[...built.accessorReads].sort()
};
// Platform use: call sites and the APIs they reach, by how each API was modelled.
const inventory=platformInventory(pt,built);
{
  const apis=new Map();
  for(const r of inventory)for(const [api,how] of Object.entries(r.apis))apis.set(api,how);
  summary.platform={sites:inventory.length,apis:apis.size,apisBy:count([...apis.values()],x=>x),
    sitesBy:count(inventory.flatMap(r=>Object.values(r.apis)),x=>x)};
}
console.log(JSON.stringify(summary,null,1));
if(platOut)await writeFile(platOut,JSON.stringify(inventory));

// --edit FILE: re-analyse after an edit to FILE, as a session that keeps compiled files would.
// The edit appends a callable that calls the file's first exported function with a fresh object,
// so the file's summaries and the composed result both change. Only FILE is recompiled.
for(const file of edits) {
  if(engine!=='summary')throw Error('--edit needs --engine summary');
  if(!units.has(file))throw Error(`${file} is not in the selection`);
  const e0=clock();
  const text=await readFile(resolve(repo,file),'utf8');
  const exported=[...(units.get(file).iface?Object.keys(units.get(file).iface.exports):[])].find(n=>n!=='default'&&units.get(file).iface.local[units.get(file).iface.exports[n]?.local]);
  const edited=text+`
export function devMapEdit(input){ const made={input}; ${exported?`return ${exported}(made);`:'return made;'} }
`;
  let ast;try{ast=acorn.parse(edited,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true});}catch{ast=acorn.parse(edited,{ecmaVersion:'latest',sourceType:'script',locations:true,allowHashBang:true});}
  const e1=clock();
  const before=JSON.stringify(units.get(file).functions.map(f=>[f.key,f.openOps.length,f.closedOps.length]));
  units.set(file,compileModule({file,text:edited,ast},{resolveImport}));
  const e2=clock();
  const pt2=new PointsTo();
  const built2=compose(pt2,units,{platformModules});built2.unmodelled=built.unmodelled;
  const e3=clock();
  const result2=derive(pt2,built2);
  const e4=clock();
  console.log(JSON.stringify({edit:file,appendedCall:exported??null,
    timingsMs:{parse:Math.round(ms(e0,e1)),compileFile:Math.round(ms(e1,e2)),composeAndSolve:Math.round(ms(e2,e3)),derive:Math.round(ms(e3,e4)),total:Math.round(ms(e0,e4))},
    summariesChanged:before!==JSON.stringify(units.get(file).functions.map(f=>[f.key,f.openOps.length,f.closedOps.length])),
    callEdges:result2.summary.callEdges,arrows:result2.summary.arrows,heapMB:Math.round(process.memoryUsage().heapUsed/1048576)}));
  units.set(file,compileModule(parsed.get(file),{resolveImport}));
}
if(out) {
  const fn=result.home;const fns=built.functions;
  const name=f=>`${f.file}:${f.line} ${f.name??'(anonymous)'}`;
  await writeFile(out,JSON.stringify({summary,parseErrors,
    unresolvedImports:built.unresolvedImports,
    unmodelled:built.unmodelled,
    answersAndActs:result.both.map(name),
    answersAndActsKeys:result.both.map(f=>f.key),
    uncalledUnexported:result.uncalled.map(name),
    uncalledUnexportedKeys:result.uncalled.map(f=>f.key),
    arrows:result.arrows.map(a=>({from:name(fns[a.from]),to:name(fns[a.to]),fromKey:fns[a.from].key,toKey:fns[a.to].key,kind:a.kind,count:a.count})),
    leaves:[...result.leaves].map(i=>{const folded=fns.filter(f=>f.id!==i&&!f.inClone&&fn[f.id]!==f.id&&(()=>{let x=f.id;while(fn[x]!==x)x=fn[x];return x;})()===i);
      return {leaf:name(fns[i]),key:fns[i].key,role:result.command[i]?'command':'query',folded:folded.map(name),foldedKeys:folded.map(f=>f.key)};})
  },null,1));
}

// --draw NAME --svg FILE: the callable NAME with its direct callers and callees, one arrow per
// pair in the dev-map notation, drawn by the shared renderer.
if(drawName) {
  const fns=built.functions;
  const root=fns.find(f=>!f.inClone&&f.name===drawName);
  if(!root)throw Error(`No callable named ${drawName}.`);
  const near=new Set([root.id]);
  for(const e of result.edges)if(e.from===root.id||e.to===root.id){near.add(e.from);near.add(e.to);}
  const {drawn}=pairArrowsOf(result.arrows.filter(a=>near.has(a.from)&&near.has(a.to)),x=>x);
  const kinds=d=>[...new Set(d.arrows.map(a=>a.kind))].join(' + ');
  const spec={title:`${root.name} · influence`,subtitle:`${root.file}:${root.line} and its direct callers and callees`,
    nodes:[...near].map(id=>({id:String(id),label:fns[id].name??'(anonymous)',kind:id===root.id?'state':'stage',
      note:`${fns[id].file}:${fns[id].line} · ${result.command[id]?'command':'query'}`})),
    edges:drawn.map(d=>({from:String(d.from),to:String(d.to),ends:d.ends,label:kinds(d)}))};
  const run=spawnSync(process.env.PYTHON??'python',[resolve(repo,'dev-map/influence/draw.py')],{input:JSON.stringify(spec),encoding:'utf8',maxBuffer:64*1024*1024});
  if(run.status!==0)throw Error(run.stderr);
  await writeFile(svgOut??`${drawName}.svg`,run.stdout);
}
