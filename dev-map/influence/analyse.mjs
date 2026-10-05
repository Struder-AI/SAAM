// The analysis step of an influence set's `regenerate` (solved-set.mjs): the whole scope
// (scope.mjs) analysed soundly from the current source and merged into one `run.mjs --out`
// shaped result, which the solver then reads.
//
// No sound run covers the whole scope yet, so the scope is split into import closures: one
// `run.mjs --closure` per root (an in-scope file no in-scope file imports), smallest first, each
// in its own process. A closure that fails (out of memory at the heap cap, or past its time) is
// replaced by the closures of the files it imports directly, and a root whose closure contains a
// failed one is not run but replaced the same way, so every file is analysed in the largest
// closure that can be. Files no successful closure holds are not analysed and are listed.
//
// Each closure's result is kept with a hash of what it was made from (its files' text as on disk,
// the analyser's own modules, Node and acorn), so an unchanged closure is reused and only the
// closures holding an edited file run again; failures are kept the same way, until the heap cap or
// time limit is raised. The merged result is rewritten only when a closure's result changed, so
// an unchanged scope leaves the solver's inputs as they were.
//
// Merging: a callable in several closures takes its leaf (the leaf it folds into, or itself) and
// role from the largest closure holding it (files, then callables, then root path), since a larger
// closure sees more of its callers. Arrows map onto those leaves; arrows inside one leaf drop; an
// arrow's site count is the largest any one closure gives it. State facts (state.mjs) unite per
// allocation site and contacts (channels.mjs) take each site from the largest closure holding it;
// the callable keys in both map onto the same leaves, and the solver makes state nodes, process
// links and actor channels from them (channels.mjs withChannels).
//
//   node dev-map/influence/analyse.mjs --out FILE [--max-heap-mb N]
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {importGraph,closureOf,parseModule,staticImports} from './scope.mjs';
import {mergeStateFacts} from './state.mjs';
import {mergeContactFacts} from './channels.mjs';

// The single switch: true once one sound run can cover the whole scope (plans/dev-maps.md). The
// whole scope is then tried first as one closure, and the closure split is only the fallback.
export const PREFER_WHOLE_SCOPE=false;

const here=dirname(fileURLToPath(import.meta.url));
const repoOf=resolve(here,'../..');
const sha=text=>createHash('sha256').update(text).digest('hex');
const order=(a,b)=>a<b?-1:a>b?1:0;
const MB=1048576;

// The analyser: run.mjs and every module it imports by relative path, with Node and acorn, whose
// change invalidates every kept closure.
function analyserHash(repo) {
  const seen=new Set(),queue=[resolve(here,'run.mjs')],h=createHash('sha256');
  while(queue.length) {
    const file=queue.pop();if(seen.has(file))continue;seen.add(file);
    const text=readFileSync(file,'utf8'),ast=parseModule(text);
    for(const spec of ast?staticImports(ast):[])if(spec.startsWith('.'))queue.push(resolve(dirname(file),spec));
  }
  for(const file of [...seen].sort(order))h.update(relative(repo,file).replaceAll('\\','/')+'\n'+readFileSync(file,'utf8'));
  h.update(process.version);
  try{h.update(JSON.parse(readFileSync(resolve(repo,'node_modules/acorn/package.json'),'utf8')).version);}catch{}
  return h.digest('hex');
}

// ---- running one closure --------------------------------------------------------------------
// A closure runs at `startHeapMB`, and again at the cap only when it ran out of memory. Its time
// limit grows with its size. The child reports its peak memory on exit.
const PEAK=`data:text/javascript,process.on('exit',()=>process.stderr.write('\\n@peakRssKB '+process.resourceUsage().maxRSS+'\\n'))`;
const timeLimit=files=>Math.min(900e3,60e3+files*2e3);
const outOfMemory=(code,err)=>/heap out of memory|Allocation failed|Last few GCs/.test(err)||code===134;

function runOnce(repo,{root,out,heapMB,timeoutMs}) {
  return new Promise(done=>{
    const started=Date.now();
    const args=['--import',PEAK,`--max-old-space-size=${heapMB}`,resolve(here,'run.mjs'),'--closure','--out',out,root];
    const child=spawn(process.execPath,args,{cwd:repo,stdio:['ignore','ignore','pipe']});
    let err='',timedOut=false;
    child.stderr.on('data',d=>{err+=d;if(err.length>40000)err=err.slice(-20000);});
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
    child.on('exit',code=>{clearTimeout(timer);
      const peak=/@peakRssKB (\d+)/.exec(err);
      done({code,timedOut,err,secs:(Date.now()-started)/1000,peakRssMB:peak?Math.round(Number(peak[1])/1024):null});});
  });
}

async function runClosure(repo,{root,files,out,startHeapMB,maxHeapMB}) {
  const timeoutMs=timeLimit(files);
  const heaps=[...new Set([Math.min(startHeapMB,maxHeapMB),maxHeapMB])];
  let r,secs=0,peakRssMB=null;
  for(const heapMB of heaps) {
    r=await runOnce(repo,{root,out,heapMB,timeoutMs});secs+=r.secs;peakRssMB=Math.max(peakRssMB??0,r.peakRssMB??0)||null;
    if(r.code===0&&!r.timedOut)return {status:'ok',heapMB,secs,peakRssMB,timeoutMs};
    if(r.timedOut||!outOfMemory(r.code,r.err))break;
  }
  const oom=!r.timedOut&&outOfMemory(r.code,r.err);
  const reason=r.timedOut?`over the time limit of ${Math.round(timeoutMs/1000)} s`
    :oom?`out of memory at ${maxHeapMB} MB`
    :`exit ${r.code}${r.err.replace(/@peakRssKB \d+/g,'').trim()?`: ${r.err.replace(/@peakRssKB \d+/g,'').trim().split('\n').slice(-3).join(' ').slice(0,300)}`:' with no message (crashed or killed)'}`;
  return {status:'failed',reason,heapMB:maxHeapMB,secs,peakRssMB,timeoutMs,...(oom?{oom}:{}),...(r.timedOut?{timedOut:true}:{})};
}

// ---- the closure plan -------------------------------------------------------------------------
const nameOf=root=>root==='all'?'_scope':root.replace(/[\/.]/g,'_');

export async function analyse({repo=repoOf,out,maxHeapMB=4096,startHeapMB=2048,log=()=>{}}={}) {
  if(!out)throw Error('analyse needs an output file.');
  const started=Date.now();
  const dir=resolve(dirname(out),'closures');mkdirSync(dir,{recursive:true});
  const graph=await importGraph(repo),{files,deps,texts}=graph;
  const analyser=analyserHash(repo);
  const closures=new Map(files.map(f=>[f,closureOf(f,deps)]));
  closures.set('all',new Set(files));
  const hashOf=root=>{const h=createHash('sha256');h.update(analyser+'\n'+root+'\n');
    for(const f of [...closures.get(root)].sort(order))h.update(f+'\n'+texts.get(f)+'\n');return h.digest('hex');};

  const runs=[],failed=[],attempts=[],tried=new Set(),covered=new Set();
  const attempt=async root=>{
    tried.add(root);
    const closure=closures.get(root),size=closure.size,name=nameOf(root);
    const within=failed.find(f=>[...f.closure].every(x=>closure.has(x)));
    if(within&&root!=='all'){attempts.push({root,files:size,status:'skipped',reason:`contains failed closure ${within.root}`});failed.push({root,closure});return false;}
    const hash=hashOf(root),metaFile=resolve(dir,`${name}.meta.json`),outFile=resolve(dir,`${name}.json`);
    let meta=null;try{meta=JSON.parse(readFileSync(metaFile,'utf8'));}catch{}
    const reusable=meta?.hash===hash&&(meta.status==='ok'?existsSync(outFile):meta.maxHeapMB>=maxHeapMB&&meta.timeoutMs>=timeLimit(size));
    let result;
    if(reusable)result={...meta,cached:true};
    else {
      log(`analysing ${root} (${size} files)`);
      // A closure holding one that came near the start heap starts at the cap.
      const heavy=attempts.some(a=>a.status==='ok'&&a.peakRssMB>startHeapMB/2&&a.root!==root&&closure.has(a.root));
      result={...await runClosure(repo,{root,files:size,out:outFile,startHeapMB:heavy?maxHeapMB:startHeapMB,maxHeapMB}),cached:false};
      // Out of memory and out of time are kept; any other failure (a crash, a killed process) is
      // not, so the next regenerate runs the closure again.
      if(result.status==='ok'||result.oom||result.timedOut)writeFileSync(metaFile,JSON.stringify({hash,root,files:size,maxHeapMB,...result,cached:undefined}));
      else rmSync(metaFile,{force:true});
      log(`${root}: ${result.status==='ok'?'ok':result.reason} in ${Math.round(result.secs)} s${result.peakRssMB?`, peak ${result.peakRssMB} MB`:''}`);
    }
    attempts.push({root,files:size,status:result.status,...(result.reason?{reason:result.reason}:{}),cached:result.cached,
      secs:result.secs,heapMB:result.heapMB,peakRssMB:result.peakRssMB});
    if(result.status==='ok'){runs.push({root,hash,file:outFile});for(const f of closure)covered.add(f);return true;}
    failed.push({root,closure});return false;
  };

  let whole=false;
  if(PREFER_WHOLE_SCOPE)whole=await attempt('all');
  if(!whole) {
    const importers=new Map(files.map(f=>[f,0]));for(const d of deps.values())for(const t of d)importers.set(t,importers.get(t)+1);
    const pending=new Set(files.filter(f=>!importers.get(f)));
    for(;;) {
      const next=[...pending].filter(f=>!tried.has(f)&&!covered.has(f)).sort((a,b)=>closures.get(a).size-closures.get(b).size||order(a,b))[0];
      if(next===undefined) {
        // Files in an import cycle no outside file imports have no root; they start one now.
        const left=files.filter(f=>!tried.has(f)&&!covered.has(f));
        if(!left.length)break;
        for(const f of left)pending.add(f);continue;
      }
      pending.delete(next);
      if(!await attempt(next))for(const d of deps.get(next)??[])if(!covered.has(d)&&!tried.has(d))pending.add(d);
    }
  }
  // Kept results of closures no longer in the plan are dropped.
  const planned=new Set(attempts.map(a=>nameOf(a.root)));
  for(const f of readdirSync(dir)){const n=f.replace(/(\.meta)?\.json$/,'');if(!planned.has(n))rmSync(resolve(dir,f));}

  // ---- merging ----
  const inputHash=sha(JSON.stringify([analyser,...[fileURLToPath(import.meta.url),resolve(here,'state.mjs'),resolve(here,'channels.mjs')].map(f=>sha(readFileSync(f,'utf8'))),files,graph.unparsed,runs.map(r=>[r.root,r.hash]).sort(),
    attempts.filter(a=>a.status!=='ok').map(a=>[a.root,a.status,a.reason]).sort()]));
  // The merge's inputs are kept beside the result, not in it: a result that comes out the same
  // (an edit that moves no key, such as a comment at a file's end) is left untouched, so the
  // solves keyed on it stay reused.
  const hashFile=`${out}.inputs`;
  let previous=null;try{previous=readFileSync(out,'utf8');}catch{}
  let merged,reusedMerge=false;
  if(previous!==null&&existsSync(hashFile)&&readFileSync(hashFile,'utf8')===inputHash){merged=JSON.parse(previous);reusedMerge=true;}
  else {
    merged=merge(runs.map(r=>({root:r.root,result:JSON.parse(readFileSync(r.file,'utf8'))})));
    const unparsed=[...new Set([...graph.unparsed,...merged.parseErrors])].sort(order);
    const notAnalysed=[...new Set([...files.filter(f=>!covered.has(f)),...unparsed])].sort(order);
    merged={schema:1,scope:{files:files.length},
      closures:attempts.map(({root,files,status,reason})=>({root,files,status,...(reason?{reason}:{})})).sort((a,b)=>order(a.root,b.root)),
      notAnalysed,unparsed,summary:merged.summary,leaves:merged.leaves,arrows:merged.arrows,unmodelled:merged.unmodelled,
      ...(merged.state?{state:merged.state}:{}),...(merged.contacts?{contacts:merged.contacts}:{})};
    if(merged.summary.checkErrors.length)throw Error(`Merged analysis is inconsistent: ${merged.summary.checkErrors.slice(0,5).join('; ')}`);
    const text=JSON.stringify(merged);
    if(text!==previous){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,text);}
    else reusedMerge='same result';
    writeFileSync(hashFile,inputHash);
  }
  const report={file:out,whole,scopeFiles:files.length,closures:attempts.length,ran:attempts.filter(a=>a.cached===false).length,
    reused:attempts.filter(a=>a.cached).length,skipped:attempts.filter(a=>a.status==='skipped').length,
    failed:attempts.filter(a=>a.status!=='ok').map(({root,files,status,reason})=>({root,files,status,reason})),
    notAnalysed:merged.notAnalysed,mergeReused:reusedMerge,
    leaves:merged.leaves.length,arrows:merged.arrows.length,stateObjects:merged.state?.length??0,contacts:merged.contacts?.contacts.length??0,
    secs:Math.round((Date.now()-started)/100)/10,runSecs:Math.round(attempts.reduce((s,a)=>s+(a.cached?0:a.secs??0),0)),
    peakChildRssMB:Math.max(0,...attempts.filter(a=>a.cached===false).map(a=>a.peakRssMB??0))||null,
    parentRssMB:Math.round(process.resourceUsage().maxRSS/1024)};
  writeFileSync(resolve(dirname(out),'report.json'),JSON.stringify({...report,attempts},null,1));
  return report;
}

function unmodelledSites(parsed,fileOf) {
  const from=new Map();
  for(const r of parsed)for(const k of r.assign.keys())if(!from.has(fileOf(k)))from.set(fileOf(k),r);
  const seen=new Map();
  for(const r of parsed)for(const {kind,file,line} of r.unmodelled)if(from.get(file)===r)seen.set(`${kind}|${file}|${line}`,{kind,file,line:line??null});
  return [...seen.values()].sort((a,b)=>order(a.file,b.file)||(a.line??0)-(b.line??0)||order(a.kind,b.kind));
}

// Each run: {root, result} with result a `run.mjs --out` object.
export function merge(runs) {
  const parsed=runs.map(({root,result:j})=>{
    const assign=new Map(),role=new Map(),names=new Map();
    for(const l of j.leaves){assign.set(l.key,l.key);role.set(l.key,l.role);names.set(l.key,l.leaf);
      l.foldedKeys.forEach((k,i)=>{assign.set(k,l.key);names.set(k,l.folded[i]);});}
    return {root,files:j.summary.files,callables:assign.size,assign,role,names,arrows:j.arrows,parseErrors:j.parseErrors??[],unmodelled:j.unmodelled??[],state:j.state,contacts:j.contacts};
  }).sort((a,b)=>b.files-a.files||b.callables-a.callables||order(a.root,b.root));
  const best=new Map(),nameOf=new Map();
  for(const r of parsed)for(const [k,v] of r.assign)if(!best.has(k)){best.set(k,{to:v,run:r});nameOf.set(k,r.names.get(k));}
  // Follow assignments to a leaf; a cycle between closures' choices keeps the entered callable as a leaf.
  let cycles=0;const final=new Map();
  const leafOf=k=>{if(final.has(k))return final.get(k);const path=[k],seen=new Set([k]);let x=k;
    for(;;){const t=best.get(x).to;if(t===x)break;if(final.has(t)){x=final.get(t);break;}
      if(seen.has(t)||!best.has(t)){cycles++;best.set(x,{to:x,run:best.get(x).run});break;}seen.add(t);path.push(t);x=t;}
    for(const p of path)final.set(p,x);return x;};
  for(const k of [...best.keys()])leafOf(k);
  const leaves=[...best.keys()].filter(k=>best.get(k).to===k).sort(order);
  const leafSet=new Set(leaves),members=new Map(leaves.map(l=>[l,[]]));
  for(const [k,l] of final)if(k!==l)members.get(l).push(k);
  for(const m of members.values())m.sort(order);
  const fileOf=k=>k.slice(0,k.lastIndexOf(':'));
  const errors=[];
  for(const k of best.keys())if(!leafSet.has(final.get(k)))errors.push(`not a leaf ${k}`);
  for(const l of leaves)for(const k of members.get(l))if(fileOf(k)!==fileOf(l))errors.push(`cross-file fold ${k} -> ${l}`);
  const arrows=new Map(),unknownEnds=new Set();let internal=0;
  for(const r of parsed) {
    const per=new Map();
    for(const a of r.arrows) {
      const f=final.get(a.fromKey),t=final.get(a.toKey);
      if(f===undefined||t===undefined){unknownEnds.add(f===undefined?a.fromKey:a.toKey);continue;}
      if(f===t){internal++;continue;}
      const key=`${f}\n${t}\n${a.kind}`;per.set(key,(per.get(key)??0)+(a.count??1));
    }
    for(const [key,c] of per){const h=arrows.get(key);if(!h){const [f,t,kind]=key.split('\n');arrows.set(key,{from:nameOf.get(f),to:nameOf.get(t),fromKey:f,toKey:t,kind,count:c});}else h.count=Math.max(h.count,c);}
  }
  const roleOf=l=>best.get(l).run.role.get(l)??'query';
  // State facts (state.mjs) unite per allocation site; contacts (channels.mjs) take each site from
  // the largest closure holding it. Callable keys in both map onto the merged leaves, as arrows do;
  // a key no closure has a leaf for stays as it is and is listed.
  const unknownFactKeys=new Set();
  const toLeaf=k=>{const l=final.get(k);if(l===undefined){unknownFactKeys.add(k);return k;}return l;};
  const leafList=keys=>[...new Set((keys??[]).map(toLeaf))].sort(order);
  const hasFacts=parsed.some(r=>r.state||r.contacts);
  const state=hasFacts?mergeStateFacts(parsed.map(r=>r.state)).map(s=>({...s,writers:leafList(s.writers),readers:leafList(s.readers),
    ...(s.allocatedBy?{allocatedBy:toLeaf(s.allocatedBy)}:{})})).sort((a,b)=>order(a.site,b.site)):null;
  const facts=hasFacts?mergeContactFacts(parsed.map(r=>r.contacts)):null;
  const contacts=facts?{contacts:facts.contacts.map(c=>({...c,key:toLeaf(c.key),...(c.handlers?{handlers:leafList(c.handlers)}:{})}))
    .sort((a,b)=>order(a.site??'',b.site??'')||order(a.kind,b.kind)||order(JSON.stringify(a),JSON.stringify(b))),
    imports:Object.fromEntries(Object.entries(facts.imports).sort(([a],[b])=>order(a,b)))}:null;
  const out={
    leaves:leaves.map(l=>({leaf:nameOf.get(l),key:l,role:roleOf(l),folded:members.get(l).map(k=>nameOf.get(k)),foldedKeys:members.get(l)})),
    arrows:[...arrows.values()].sort((a,b)=>order(a.fromKey,b.fromKey)||order(a.toKey,b.toKey)||order(a.kind,b.kind)),
    ...(state?{state}:{}),...(contacts?{contacts}:{}),
    // Shapes the analysis does not model (plans/dev-maps.md#what-saam-code-is), each file's from the
    // largest closure holding it, as its callables are.
    unmodelled:unmodelledSites(parsed,fileOf),
    parseErrors:[...new Set(parsed.flatMap(r=>r.parseErrors.map(e=>e.file)))]};
  const kinds={};for(const a of out.arrows)kinds[a.kind]=(kinds[a.kind]??0)+1;
  out.summary={closures:parsed.length,callables:best.size,leaves:leaves.length,folded:best.size-leaves.length,foldCycles:cycles,
    leafRoles:{command:leaves.filter(l=>roleOf(l)==='command').length,query:leaves.filter(l=>roleOf(l)!=='command').length},
    arrows:out.arrows.length,arrowKinds:kinds,internalArrowInstancesDropped:internal,unknownArrowEnds:[...unknownEnds].sort(order),
    ...(hasFacts?{stateObjects:state.length,contacts:contacts.contacts.length,unknownFactKeys:[...unknownFactKeys].sort(order)}:{}),checkErrors:errors};
  return out;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const argv=process.argv.slice(2),value=flag=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:undefined;};
  const report=await analyse({out:resolve(value('--out')??'analysis.json'),maxHeapMB:Number(value('--max-heap-mb')??4096),log:line=>process.stderr.write(line+'\n')});
  console.log(JSON.stringify(report,null,1));
}
