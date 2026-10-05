// A solved influence map set (plans/dev-maps.md#levels): the authored top level of a design set,
// each authored node opened into the clusters the middle-out solver (solve-middle.mjs) groups
// its leaves into, nested down to leaves that open as source. Nothing in it is authored except
// the top level, positions and cluster labels (placement.mjs); a cluster without an authored label
// shows one derived mechanically from its leaves, marked `≈`.
//
// The set is a folder holding `map.json`:
//   {"mode":"influence","title":…,"analysis":FILE,"analyse":{"maxHeapMB":4096}?,"authored":DIR,
//    "sourceRoots":[DIR…],"preview":true?,"missing":[FILE…]?,"jobs":2?,"solve":"changed"|"place"?}
// `analysis` is a `run.mjs --out` result. With `analyse` it is made by regenerate itself
// (analyse.mjs, from the current source, kept under the set's store); without it, it is a result
// made elsewhere. `authored` is the design set whose map 0 and ownership are fixed (default
// dev-map/sets/030-architecture); `sourceRoots` further checkouts holding the text the analysis
// read (solve-middle.mjs analysedTexts); `missing` the in-scope files an analysis made elsewhere
// did not cover (analyse.mjs lists its own), listed on map 0. Paths are absolute or relative to
// the repository.
//
//   node dev-map/cli.mjs --set-dir DIR regenerate     (or --set NAME for a set under dev-map/sets)
// analyses the scope when the set says `analyse` (only closures whose files moved run again),
// solves each authored node whose slice moved (`solve-middle.mjs`, `jobs` at a time, each in its
// own small-heap process, kept in store/solve/; `solve` below), writes store/model.json and draws
// view/. `"solve":"place"` places a changed node's new leaves without solving it. `read
// ADDRESS`, `build` and `check` read the stored model; reads never solve.
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parse} from 'acorn';
import {pairArrowsOf} from './derive.mjs';
import {readPlacement,pageIdentities,placePages,leafIdentities,readLayoutFile,writeLayout,namedClusters,renamedLayout,signaturesFor} from './placement.mjs';
import {assignIdentities,storedClusters,isCluster,isLegacy,nodeOf} from './cluster-identity.mjs';
import {setFile,setName,setDir,mapSet} from '../lib/map-set.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const here=file=>resolve(repo,setFile(file));
const order=(a,b)=>a<b?-1:a>b?1:0;
const sha=text=>createHash('sha256').update(text).digest('hex');
const lf=text=>text.replaceAll('\r\n','\n');
const TOP='0',UNOWNED='(unowned)';
const regenerateCommand=`node dev-map/cli.mjs ${setDir?`--set-dir ${setDir}`:`--set ${setName}`} regenerate`;
const keyParts=key=>{const at=key.lastIndexOf(':');return {file:key.slice(0,at),offset:Number(key.slice(at+1))};};
const fileOf=key=>keyParts(key).file;

function inputs() {
  const spec=mapSet;
  return {spec,analysis:resolve(repo,spec.analysis),authored:resolve(repo,spec.authored??'dev-map/sets/030-architecture'),
    roots:(spec.sourceRoots??[]).map(r=>resolve(repo,r)),maxStages:spec.maxStages};
}

// ---- solving ------------------------------------------------------------------------------
// The model, its texts and every leaf's owner, made once for the solves and the stored model.
async function prepare(paths) {
  const sm=await import('./solve-middle.mjs');
  const authored=sm.readAuthored(paths.authored);
  const analysis=JSON.parse(readFileSync(paths.analysis,'utf8'));
  const model0=sm.leafModel(analysis,{actors:authored.actors});
  const {texts,changed}=sm.analysedTexts(model0.leaves,{roots:[repo,...paths.roots]});
  // SAAM's own file contacts become their boundary's file state once leaves have owners.
  const {model,owners}=sm.boundaryFileStores(model0,await sm.ownLeaves(model0.leaves,authored,{texts}),{nodes:authored.nodes});
  const ownerOf=new Map(owners.filter(o=>o.owner).map(o=>[o.leaf,o.owner])),uniform=sm.uniformLeaves(model);
  const options={seed:1,start:'flat',maxStages:paths.maxStages??Infinity};
  // Each node's slice (solve-middle.mjs nodeSlice) and the key its solve is kept by.
  const slices=new Map(authored.nodes.map(n=>{const slice=sm.nodeSlice(n.id,ownerOf,model.arrows,uniform);
    return [n.id,{slice,hash:sm.sliceHash(slice,options)}];}));
  return {sm,authored,analysis,model,texts,changed,owners,uniform,options,slices};
}

// Each authored node's solve is kept in store/solve/ by a hash of exactly what it reads (its
// slice, the options and the solver's code), so a node solves again only when that changed. A
// node to solve is solved cold (annealed from flat) and, when it has a kept solve, also warm from
// it (solve-middle.mjs solveNode), each in its own small-heap process, `jobs` at a time. The warm
// result is kept unless the cold one's energy is lower by COLD_MARGIN of it, or the node is named
// in `cold`: a cold result reshuffles clusters (new identities, labels to author), so it must
// clearly gain. The kept summary names the other result as `rival`. With map.json
// `"solve":"place"` a changed node with a kept solve is not solved: new leaves are placed in their
// file's cluster and marked `placement not solved` (solve-middle.mjs placeSlice) until a
// `"changed"` regenerate (the default) solves it.
export const COLD_MARGIN=0.03;
const entryFile=id=>`${id.replace(/[^A-Za-z0-9_.-]/g,c=>`~${c.charCodeAt(0).toString(16)}`)}.json`;
function readEntry(dir,id,sm,options) {
  for(const file of [entryFile(id),`${id}.json`]) {
    let j;try{j=JSON.parse(readFileSync(resolve(dir,file),'utf8'));}catch{continue;}
    if(j.schema===2&&j.node===id)return j;
    if(j.schema===1&&existsSync(resolve(dir,`${id}.hash`)))return sm.legacyEntry(j,id,options);
  }
  return null;
}
function keepEntry(dir,entry) {
  const {legacy,...kept}=entry;
  writeFileSync(resolve(dir,entryFile(entry.node)),JSON.stringify(kept));
  // A solve kept before slices (a whole result named by the raw id) is replaced.
  for(const file of [`${entry.node}.hash`,...(`${entry.node}.json`!==entryFile(entry.node)?[`${entry.node}.json`]:[])])try{rmSync(resolve(dir,file),{force:true});}catch{}
  return kept;
}

async function solveAll(prep,{jobs=2,mode='changed',cold=[],log=()=>{}}={}) {
  const {sm,authored,model,slices,options}=prep;
  if(!['changed','place'].includes(mode))throw Error(`map.json "solve" is "changed" (default) or "place", not ${JSON.stringify(mode)}.`);
  const unknown=cold.filter(id=>!slices.has(id));
  if(unknown.length)throw Error(`--cold names no authored node: ${unknown.join(', ')}. Nodes: ${[...slices.keys()].join(', ')}`);
  const dir=here('store/solve');mkdirSync(resolve(dir,'pending'),{recursive:true});
  const nameOf=new Map(model.leaves.map(l=>[l.id,l.name]));
  const entries=new Map(),queue=[],solved={},reused=[],placed=[],failures=[];
  for(const {id} of authored.nodes) {
    const {slice,hash}=slices.get(id),names=slice.own.map(key=>nameOf.get(key)),entry=readEntry(dir,id,sm,options),forced=cold.includes(id);
    if(!forced&&entry?.hash===hash&&(entry.placement!=='not solved'||mode==='place')){entries.set(id,entry.legacy?keepEntry(dir,entry):entry);reused.push(id);continue;}
    if(!forced&&mode==='place'&&entry){entries.set(id,keepEntry(dir,sm.placeSlice(slice,entry,{hash,names})));placed.push(id);
      log(`${id}: placed ${entries.get(id).placed.length} leaves without solving`);continue;}
    const node={id,slice,hash,names,forced,results:{},solves:entry?2:1};
    queue.push({node,start:'cold'},...(entry?[{node,start:'warm',warm:entry}]:[]));
  }
  // Cold solves first (they take longest), the largest slices first in each.
  queue.sort((a,b)=>(a.start==='cold'?0:1)-(b.start==='cold'?0:1)||b.node.slice.links.length-a.node.slice.links.length);
  const run=async()=>{for(let job=queue.shift();job;job=queue.shift()) {
    const {node,start}=job,{id,slice,hash,names,results}=node,started=Date.now();
    const input=resolve(dir,'pending',`${entryFile(id)}.${start}`),out=`${input}.out`;
    writeFileSync(input,JSON.stringify({slice,options,hash,names,warm:job.warm??null}));
    const args=['--max-old-space-size=1536',resolve(repo,'dev-map/influence/solve-middle.mjs'),'--slice',input,'--out',out];
    const code=await new Promise(done=>{const child=spawn(process.execPath,args,{cwd:repo,stdio:['ignore','ignore','pipe']});
      let err='';child.stderr.on('data',d=>{err+=d;if(err.length>20000)err=err.slice(-10000);});
      child.on('exit',c=>{if(c!==0)failures.push({node:`${id} ${start}`,code:c,stderr:err.slice(-2000)});done(c);});});
    if(code===0)results[start]={entry:JSON.parse(readFileSync(out,'utf8')),seconds:Math.round((Date.now()-started)/1000)};
    rmSync(input,{force:true});rmSync(out,{force:true});
    if(code!==0){log(`${id}: ${start} solve failed`);continue;}
    if(Object.keys(results).length<node.solves)continue;
    // Both done: keep the better.
    const {warm,cold:c}=results,e=x=>x.entry.summary.energy;
    const keep=!warm||node.forced||e(c)<e(warm)-COLD_MARGIN*Math.abs(e(warm))?'cold':'warm',[kept,rival]=keep==='cold'?[c,warm]:[warm,c];
    if(rival)kept.entry.summary.rival={start:rival.entry.summary.start,energy:e(rival),ms:rival.entry.summary.ms};
    entries.set(id,keepEntry(dir,kept.entry));
    solved[id]={warm:warm?e(warm):null,cold:e(c),kept:keep,...(node.forced?{forced:true}:{}),seconds:{...(warm?{warm:warm.seconds}:{}),cold:c.seconds}};
    log(`${id}: warm ${warm?`${e(warm).toFixed(4)} (${warm.seconds} s)`:'none'}, cold ${e(c).toFixed(4)} (${c.seconds} s): kept ${keep}${node.forced?' (--cold)':''}`);
  }};
  await Promise.all(Array.from({length:Math.max(1,jobs)},run));
  if(failures.length)throw Error(`Solve failed: ${failures.map(f=>`${f.node} (exit ${f.code}): ${f.stderr}`).join('\n')}`);
  return {solved:Object.fromEntries(authored.nodes.filter(n=>solved[n.id]).map(n=>[n.id,solved[n.id]])),reused,placed,entries};
}

// ---- source ranges ------------------------------------------------------------------------
// The function, class or module a key names, in the analysed text: its line range, and whether
// it takes a mode argument (a parameter defaulting to, or compared with, a boolean or string
// literal, or switched on), which may make a uniform helper treat callers differently.
function sourceShapes(texts,keysByFile) {
  const shapes=new Map();
  const isFn=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassDeclaration|ClassExpression|Program)$/.test(n.type);
  for(const [file,keys] of keysByFile) {
    const text=texts.get(file);if(text===undefined)continue;
    let ast;
    for(const sourceType of ['module','script']){try{ast=parse(text,{ecmaVersion:'latest',sourceType,locations:true,allowHashBang:true});break;}catch{}}
    if(!ast)continue;
    const want=new Set(keys.map(k=>keyParts(k).offset)),found=new Map();
    const walk=n=>{if(!n||typeof n.type!=='string')return;
      if(isFn(n)&&want.has(n.start)&&!found.has(n.start))found.set(n.start,n);
      for(const v of Object.values(n)){if(Array.isArray(v))for(const c of v)walk(c);else if(v&&typeof v.type==='string')walk(v);}};
    walk(ast);
    for(const key of keys) {
      const n=found.get(keyParts(key).offset);if(!n)continue;
      shapes.set(key,{line:n.loc.start.line,endLine:n.loc.end.line,modeArgument:modeArgument(n)});
    }
  }
  return shapes;
}
function modeArgument(fn) {
  if(!fn.params)return false;
  const names=new Set();
  const literal=n=>n?.type==='Literal'&&(typeof n.value==='boolean'||typeof n.value==='string');
  let mode=false;
  for(const p of fn.params) {
    const id=p.type==='AssignmentPattern'?p.left:p;
    if(id.type==='Identifier')names.add(id.name);
    if(p.type==='AssignmentPattern'&&literal(p.right))mode=true;
  }
  const isParam=n=>n?.type==='Identifier'&&names.has(n.name);
  const walk=n=>{if(mode||!n||typeof n.type!=='string')return;
    if(n.type==='BinaryExpression'&&/^[!=]==?$/.test(n.operator)&&(isParam(n.left)&&literal(n.right)||isParam(n.right)&&literal(n.left)))mode=true;
    if(n.type==='SwitchStatement'&&isParam(n.discriminant))mode=true;
    for(const v of Object.values(n)){if(Array.isArray(v))for(const c of v)walk(c);else if(v&&typeof v.type==='string')walk(v);}};
  walk(fn.body);
  return mode;
}

// ---- cluster identities ---------------------------------------------------------------------
// Each solved cluster's identity (cluster-identity.mjs), matched against what came before: the
// clusters of the stored model being replaced, by their leaves; layout.json's clusters that model
// lacks, by the signatures layout.json keeps; and layout.json keys of the solver's old numbering
// (`NODE/3`), through the earlier model's solver ids or, without an earlier model, this solve's
// numbering. Returns the identities, the retired ones with why (this run's, and earlier ones
// layout.json still names), the report, and the layout.json update to make once the model is
// written: keys migrated, signatures refreshed.
function identities({clusters,leafRow,leavesUnder}) {
  const leafIdent=leafIdentities({leaves:Object.fromEntries(leafRow)});
  const now=clusters.filter(c=>isCluster(c.id)).map(c=>({id:c.id,node:nodeOf(c.id),parent:c.parent,library:!!c.library,
    members:new Set(leavesUnder(c.id).map(l=>leafIdent.get(l)??l))}));
  let prev=null;
  try{prev=JSON.parse(readFileSync(here('store/model.json'),'utf8'));}catch{}
  const earlier=prev?.pages&&prev?.leaves?storedClusters(prev,leafIdentities(prev)):new Map();
  const layoutFile=here('layout.json'),layout=readLayoutFile(layoutFile),referenced=namedClusters(layout);
  const before=[],alias=new Map();
  for(const c of earlier.values()) {
    if(c.library){if(isLegacy(c.identity))alias.set(c.identity,`${c.node}/library`);continue;}
    before.push({identity:c.identity,node:c.node,members:c.members});
    if(c.solverId!==c.identity)alias.set(c.solverId,c.identity);
  }
  const numbered=new Map(now.map(c=>[c.id,c]));
  for(const id of referenced) {
    if(earlier.has(id)||alias.has(id))continue;
    const sig=layout.clusters[id],at=numbered.get(id);
    if(sig?.minhash&&!isLegacy(id))before.push({identity:id,node:nodeOf(id),signature:sig});
    else if(isLegacy(id)&&!prev&&at){if(at.library)alias.set(id,`${at.node}/library`);else before.push({identity:id,node:at.node,members:at.members});}
  }
  const a=assignIdentities({now,before}),current=new Set(a.identity.values()),renamed=new Map(a.renamed);
  for(const [key,was] of alias){const to=current.has(was)?was:a.renamed.get(was);if(to&&to!==key)renamed.set(key,to);}
  const retired=Object.fromEntries(a.retired);
  for(const id of referenced) {
    if(current.has(id)||renamed.has(id)||retired[id])continue;
    const why=prev?.identity?.retired?.[id]??(alias.has(id)?retired[alias.get(id)]:null);
    if(why)retired[id]=why;
  }
  const named=namedClusters(renamedLayout(layout,renamed));
  const {migrated,...report}=a.report;
  Object.assign(report,{migratedClusters:migrated.length,layout:{
    migrated:[...referenced].filter(id=>renamed.has(id)).sort(order).map(id=>({from:id,to:renamed.get(id)})),
    retired:[...named].filter(id=>!current.has(id)).sort(order).map(id=>({identity:id,why:retired[id]??'not a cluster of this model'}))}});
  // Applied to layout.json as it is when the model is written, so a drop saved meanwhile stays.
  const update=()=>{
    if(!existsSync(layoutFile))return false;
    const fresh=renamedLayout(readLayoutFile(layoutFile),renamed);
    return writeLayout(layoutFile,{...fresh,clusters:signaturesFor(fresh,id=>a.signatures.get(id))});
  };
  return {identity:a.identity,signatures:a.signatures,retired,report,writeLayout:update};
}
// The signature of each cluster in the stored model, by identity (layout.json keeps the ones it
// places: placement.mjs).
let signatureIndex=null;
export function clusterSignatures() {
  const m=stored();
  if(signatureIndex?.model!==m)signatureIndex={model:m,map:new Map(m.pages.filter(p=>p.signature).map(p=>[p.path.slice(9),p.signature]))};
  return signatureIndex.map;
}

// ---- writing --------------------------------------------------------------------------------
// The stored model: every map as a page the viewer draws and `read` projects, every placed leaf
// as a source page, and the leaf arrows each drawn arrow carries.
export async function writeModel({log=()=>{},prep=null,entries=null}={}) {
  const paths=inputs(),{spec}=paths;
  prep??=await prepare(paths);
  const {sm,authored,analysis,model,texts,changed,owners,uniform,slices}=prep;
  const labels=sm.leafLabels(model.leaves,{texts});

  // Each node's kept solve (solveAll), taken over by its slice as assemble's `solved` entry, and
  // the node's maps as its slice alone draws them, for comparison with the assembled set.
  const dir=here('store/solve'),solved=[],solverMaps=new Map(),summaries=[],placedLeaves=new Set();
  for(const n of authored.nodes) {
    const {slice,hash}=slices.get(n.id),e=entries?.get(n.id)??readEntry(dir,n.id,sm,prep.options);
    if(e?.hash!==hash)throw Error(`store/solve/${entryFile(n.id)} is not ${n.id}'s solve for the current analysis; run ${regenerateCommand}`);
    const s=sm.solvedOf(e,slice);solved.push(s);
    summaries.push({...e.summary,generated:e.generated});
    for(const r of e.placed??[])placedLeaves.add(slice.own[r]);
    for(const m of sm.sliceMaps(slice,s))solverMaps.set(`${n.id}\n${m.id}`,m);
  }
  // Leaves with no map-0 owner are not solved; they are grouped by file for review, so the
  // unowned box opens onto maps a person can read, and listed in full on map 0.
  const linked=new Set(model.arrows.flatMap(a=>[a.from,a.to]));
  const stray=owners.filter(o=>!o.owner&&linked.has(o.leaf)).map(o=>o.leaf);
  const strayFiles=new Map();for(const leaf of stray)(strayFiles.get(fileOf(leaf))??strayFiles.set(fileOf(leaf),[]).get(fileOf(leaf))).push(leaf);
  if(strayFiles.size>1) {
    const clusters=new Map(),homes=new Map();let k=0;
    for(const [file,held] of [...strayFiles].sort(([a],[b])=>order(a,b))) {
      if(held.length<2){for(const leaf of held)homes.set(leaf,UNOWNED);continue;}
      const id=String(++k).padStart(6,'0');clusters.set(id,UNOWNED);for(const leaf of held)homes.set(leaf,id);
    }
    solved.push({node:UNOWNED,library:null,clusters,homes,byFile:true});
  }
  const {clusters,maps}=sm.assemble({authored,model,owners,solved});

  // The solver's own drawing of each node must be what the assembled set draws.
  const norm=m=>JSON.stringify({members:[...m.members].sort(order),boundary:[...m.boundary].sort(order),
    arrows:m.arrows.map(a=>`${a.from}>${a.to}:${a.ends}:${[...a.leafArrows].sort((x,y)=>x-y).join(',')}`).sort(order)});
  const mapById=new Map(maps.map(m=>[m.id,m])),solverMismatch=[];
  for(const [key,m] of solverMaps){const id=key.split('\n')[1];if(!mapById.has(id)||norm(mapById.get(id))!==norm(m))solverMismatch.push(key.replace('\n',' map '));}

  // Indexes: map 0's boxes keep their authored indexes; inside, clusters (largest first, the
  // library last) then leaves in source order are numbered under their map.
  const cluster=new Map(clusters.map(c=>[c.id,c])),kids=new Map();
  for(const c of clusters)(kids.get(c.parent)??kids.set(c.parent,[]).get(c.parent)).push(c.id);
  const nested=new Map(maps.map(m=>[m.id,m.nested]));
  const index=new Map([[TOP,'0'],...authored.nodes.map(n=>[n.id,n.index])]);
  index.set(UNOWNED,String(Math.max(...authored.nodes.map(n=>Number(n.index)))+1));
  const keyOrder=(a,b)=>order(fileOf(a),fileOf(b))||keyParts(a).offset-keyParts(b).offset;
  const childrenOf=id=>[...(kids.get(id)??[]).sort((a,b)=>(cluster.get(a).library?1:0)-(cluster.get(b).library?1:0)||nested.get(b)-nested.get(a)||order(a,b)),
    ...[...cluster.get(id)?.leaves??[]].sort(keyOrder)];
  const parentOf=new Map();
  const number=id=>{let k=0;for(const child of childrenOf(id)){index.set(child,`${index.get(id)}.${++k}`);parentOf.set(child,id);if(cluster.has(child))number(child);}};
  for(const id of [...authored.nodes.map(n=>n.id),UNOWNED])if(cluster.has(id)){parentOf.set(id,TOP);number(id);}

  // Leaves: source ranges and mode arguments from the analysed text.
  const keysByFile=new Map();
  for(const l of model.leaves)for(const key of [l.id,...l.folded])(keysByFile.get(fileOf(key))??keysByFile.set(fileOf(key),[]).get(fileOf(key))).push(key);
  const shapes=sourceShapes(texts,keysByFile);
  const ownerRow=new Map(owners.map(o=>[o.leaf,o]));
  const leafRow=new Map();let rangeUnknown=0;
  for(const l of model.leaves) {
    const m=/^(.*?):(\d+) (.*)$/.exec(l.name),file=fileOf(l.id),shape=shapes.get(l.id);
    if(!shape)rangeUnknown++;
    const o=ownerRow.get(l.id);
    // A state node opens at its declaring line; a channel and a boundary's files have no source
    // (channels.mjs).
    const made=l.state||l.channel;
    leafRow.set(l.id,{key:l.id,name:l.name,label:labels.get(l.id),role:l.role,file:l.channel||l.state?.store?null:made?m?.[1]??file:file,line:shape?.line??Number(m?.[2]??1),endLine:shape?.endLine??Number(m?.[2]??1),
      ...(shape||made?{}:{rangeUnknown:true}),...(l.state?{state:l.state}:{}),...(l.channel?{channel:l.channel}:{}),owner:o?.owner??null,...(o?.owner?{declaration:o.declaration,via:o.via}:{gap:o?.gap}),
      ...(uniform.has(l.id)?{uniform:true}:{}),...(uniform.has(l.id)&&shape?.modeArgument?{possiblyCallerDependent:true}:{}),...(placedLeaves.has(l.id)?{placementNotSolved:true}:{}),
      ...(index.has(l.id)?{index:index.get(l.id)}:{unlinked:true}),
      folded:l.folded.map(k=>{const s=shapes.get(k);return {key:k,file:fileOf(k),...(s?{line:s.line,endLine:s.endLine}:{})};})});
  }

  // Identities (cluster-identity.mjs): each solved cluster's, carried from the stored model this
  // one replaces (or, without it, from the signatures layout.json keeps) by leaf overlap. The
  // owner's layout.json follows: keys of the solver's old numbering migrate, signatures refresh.
  const leavesUnder=id=>cluster.has(id)?childrenOf(id).flatMap(leavesUnder):[id];
  const ident=identities({clusters,leafRow,leavesUnder});
  const pathOf=id=>`@cluster/${ident.identity.get(id)??id}`;

  // Generated labels: a cluster is named after the file holding most of its leaves and its
  // best-connected leaves there. Authored labels are laid over them as the model loads (labelled).
  const degree=new Map();for(const a of model.arrows)for(const e of [a.from,a.to])degree.set(e,(degree.get(e)??0)+1);
  const base=file=>basename(file).replace(/\.m?js$/,'');
  const nameOf=new Map();
  for(const c of clusters) {
    if(index.get(c.id)===undefined)continue;
    if(c.authored){nameOf.set(c.id,{label:c.label,authored:true});continue;}
    if(c.id===UNOWNED){nameOf.set(c.id,{label:'unowned'});continue;}
    const held=leavesUnder(c.id),files=new Map();for(const l of held)files.set(fileOf(l),(files.get(fileOf(l))??0)+1);
    const [dom]=[...files].sort((a,b)=>b[1]-a[1]||order(a[0],b[0]))[0];
    const names=held.filter(l=>fileOf(l)===dom).sort((a,b)=>(degree.get(b)??0)-(degree.get(a)??0)||keyOrder(a,b)).slice(0,3).map(l=>labels.get(l));
    const top=c.id.split('/')[0];
    if(top===UNOWNED)nameOf.set(c.id,{label:`${dom} · unowned`,byFile:true});
    else if(c.library)nameOf.set(c.id,{label:`library · ≈ ${base(dom)}${files.size>1?` +${files.size-1}`:''}: ${names.join(', ')}`,library:true,provisional:true});
    else nameOf.set(c.id,{label:`≈ ${base(dom)}${files.size>1?` +${files.size-1}`:''}: ${names.join(', ')}`,provisional:true});
  }
  const boxLabel=id=>nameOf.get(id)?.label??leafRow.get(id)?.label??id;

  // Pages. Beside its boxes and arrows a page holds only what the drawing cannot show: its node's
  // unlinked leaves, and on map 0 the files the analysis did not read and (on the unowned box's
  // own map) the leaves no map-0 node owns. Everything else is drawn, or derivable from what is.
  const kindCount=list=>{const c={};for(const i of list)c[model.arrows[i].kind]=(c[model.arrows[i].kind]??0)+1;return c;};
  const pages=[];
  for(const m of maps) {
    const idx=index.get(m.id);if(idx===undefined)continue;
    const box=id=>id.startsWith('boundary:')?`b:${index.get(id.slice(9))}`:index.get(id);
    const components=m.members.map(id=>cluster.has(id)
      ?{index:index.get(id),kind:'group',path:pathOf(id),count:nested.get(id),...nameOf.get(id)}
      :(({key,label,role,file,line,endLine,uniform,possiblyCallerDependent,placementNotSolved})=>({index:index.get(id),kind:'leaf',path:key,
        label,role,file,line,endLine,...(uniform?{uniform}:{}),...(possiblyCallerDependent?{possiblyCallerDependent}:{}),...(placementNotSolved?{placementNotSolved}:{})}))(leafRow.get(id)))
      .sort((a,b)=>order(a.index,b.index));
    const ports=m.boundary.map(id=>({port:`b:${index.get(id)}`,mechanism:'boundary',index:index.get(id),label:boxLabel(id),
      path:cluster.has(id)?pathOf(id):id}));
    const wires=m.arrows.map(a=>({from:box(a.from),to:box(a.to),ends:a.ends,count:a.leafArrows.length,kinds:kindCount(a.leafArrows),leafArrows:a.leafArrows}));
    const unlinked=cluster.get(m.id)?.unlinked;
    // A solved cluster's page keeps its solver id (this solve's numbering, which a layout key
    // from before identities names) and its signature.
    const sig=isCluster(m.id)?ident.signatures.get(ident.identity.get(m.id)):null;
    pages.push({index:idx,path:m.id===TOP?'0':pathOf(m.id),kind:m.id===TOP?'root':'group',
      label:m.id===TOP?spec.title:boxLabel(m.id),...(nameOf.get(m.id)??{}),...(sig?{solverId:m.id,signature:sig}:{}),
      parent:m.id===TOP?null:index.get(parentOf.get(m.id)),destination:'graph',leaves:m.nested,
      ...(m.score!==undefined?{score:m.score}:{}),components,ports,wires,...(unlinked?.length?{unlinked:[...unlinked].sort(keyOrder)}:{})});
  }
  for(const r of leafRow.values())if(r.index)pages.push({index:r.index,path:`${r.file??(r.state?'@store':'@channel')}::${r.label}`,key:r.key,kind:r.state?'state':r.channel?'channel':'function',label:r.label,role:r.role,
    file:r.file,line:r.line,endLine:r.endLine,lines:r.endLine-r.line+1,destination:'code',parent:index.get(parentOf.get(r.key)),components:[],wires:[],
    foldedCode:r.folded.filter(f=>f.line).map(f=>({path:f.key,file:f.file,line:f.line,endLine:f.endLine}))});

  // Map 0 lists the in-scope files the analysis did not read; the unowned box's own map (map 0
  // when there is none) lists every leaf without a map-0 owner.
  const unowned=[...leafRow.values()].filter(r=>!r.owner);
  const unlinked=[...leafRow.values()].filter(r=>r.unlinked);
  const root=pages.find(p=>p.index==='0');
  const notAnalysed=analysis.notAnalysed??spec.missing;
  if(notAnalysed?.length)root.notAnalysed=[...notAnalysed];
  // State nodes read or written from more than one map-0 owner, other than Bundle's (shared part
  // state): an architecture finding, listed on map 0. Unresolved channel ends, likewise.
  const crossOwnerState=[];
  for(const r of leafRow.values()) {
    if(!r.state||r.owner==='bundle')continue;
    const touched={};for(const a of model.arrows)if(a.to===r.key&&a.kind==='writes'||a.from===r.key&&a.kind==='reads'){const o=leafRow.get(a.to===r.key?a.from:a.to)?.owner??UNOWNED;touched[o]=(touched[o]??0)+1;}
    if(Object.keys(touched).length>1)crossOwnerState.push({key:r.key,label:r.label,owner:r.owner,touchedBy:touched});
  }
  if(crossOwnerState.length)root.crossOwnerState=crossOwnerState;
  if(model.channels)root.channels=model.channels;
  if(unowned.length)(pages.find(p=>p.index===index.get(UNOWNED))??root).unowned=unowned.map(r=>r.key).sort(keyOrder);

  const files=[...texts.keys()].sort(order);
  const sources=Object.fromEntries(files.map(f=>[f,lf(texts.get(f))]));
  const sourceInfo=Object.fromEntries(files.map(f=>[f,{sourceKind:'snapshot',sourceSha256:sha(sources[f])}]));
  const stored={schema:1,mode:'influence',title:spec.title,generated:new Date().toISOString(),regenerate:regenerateCommand,
    notice:spec.preview?`PREVIEW · ${notAnalysed?.length?'partial analysis · ':''}unreviewed solver output`:'',
    inputs:{analysis:paths.analysis,authored:paths.authored,sourceRoots:paths.roots},sourceChanged:changed,
    summary:{leaves:model.leaves.length,merged:model.merged,sharedNames:model.sharedNames,arrows:model.arrows.length,drawn:model.leaves.length-unlinked.length,
      unlinked:unlinked.length,unowned:unowned.length,uniform:uniform.size,possiblyCallerDependent:[...leafRow.values()].filter(r=>r.possiblyCallerDependent).length,
      maps:pages.filter(p=>p.destination==='graph').length,rangeUnknown,placementNotSolved:placedLeaves.size,solverMismatch,solved:summaries,clusterIdentity:ident.report,
      ...(model.channels?{channels:{...model.channels.summary,stateNodes:[...leafRow.values()].filter(r=>r.state).length,crossOwnerState:crossOwnerState.length}}:{})},
    identity:{retired:ident.retired},arrows:model.arrows,leaves:Object.fromEntries(leafRow),pages,sources,sourceInfo};
  stored.snapshotId=sha(JSON.stringify([stored.summary,pages.length,model.arrows.length,Object.values(sourceInfo).map(s=>s.sourceSha256)]));
  stored.checks=verify(stored);
  mkdirSync(here('store'),{recursive:true});
  writeFileSync(here('store/model.json'),JSON.stringify(stored));
  log(`wrote ${here('store/model.json')}: ${stored.summary.maps} maps, ${stored.summary.drawn} drawn leaves`);
  const r=ident.report,layoutChanged=ident.writeLayout();
  log(`cluster identities: ${r.kept} kept, ${r.rematched.length} rematched, ${r.split.length} split, ${r.merged.length} merged, ${r.retired.length} retired, ${r.new.length} new${r.migratedClusters?`, ${r.migratedClusters} migrated from solver numbering`:''}`
    +`${r.layout.migrated.length?`; layout.json keys migrated: ${r.layout.migrated.length}`:''}${r.layout.retired.length?`; layout.json names retired clusters: ${r.layout.retired.map(x=>x.identity).join(', ')}`:''}${layoutChanged?' (layout.json updated)':''}`);
  return stored;
}

// ---- checking -----------------------------------------------------------------------------
// From the stored pages alone: every leaf with an arrow is drawn exactly once and every other
// leaf nowhere, no two leaves share a key, and each map's arrows are exactly the pairs its leaf
// arrows make: an arrow between two of its boxes, or to the boundary box (the node on an
// enclosing map) for an arrow leaving it, each with the leaf arrows it stands for and its ends.
export function verify(model) {
  const graph=model.pages.filter(p=>p.destination==='graph'),byIndex=new Map(model.pages.map(p=>[p.index,p]));
  const errors=[],placed=new Map();
  for(const p of graph)for(const c of p.components)if(c.kind==='leaf')placed.set(c.path,(placed.get(c.path)??0)+1);
  const keys=Object.keys(model.leaves);
  if(new Set(keys).size!==keys.length)errors.push('duplicate leaf keys');
  const linked=new Set(model.arrows.flatMap(a=>[a.from,a.to]));
  let twice=0,missing=0,stray=0;
  for(const key of keys){const n=placed.get(key)??0;if(linked.has(key)){if(n===0)missing++;if(n>1)twice++;}else if(n)stray++;}
  if(twice)errors.push(`${twice} leaves drawn more than once`);
  if(missing)errors.push(`${missing} linked leaves not drawn`);
  if(stray)errors.push(`${stray} unlinked leaves drawn`);
  const chain=new Map();
  const chainOf=idx=>{if(chain.has(idx))return chain.get(idx);const p=byIndex.get(idx)?.parent;const c=p===null||p===undefined?[idx]:[...chainOf(p),idx];chain.set(idx,c);return c;};
  const leafIndex=key=>model.leaves[key].index;
  let pagesWrong=0,arrowsChecked=0;
  for(const p of graph) {
    const up=new Set(chainOf(p.index));
    const boxOf=key=>{const c=chainOf(leafIndex(key)),at=c.indexOf(p.index);
      return at>=0?c[at+1]:p.index==='0'?undefined:`b:${c.find(x=>!up.has(x))}`;};
    const touching=[];
    model.arrows.forEach((a,i)=>{if(model.leaves[a.from].index===undefined||model.leaves[a.to].index===undefined)return;
      const x=boxOf(a.from),y=boxOf(a.to);if(x===undefined||y===undefined||x===y||x.startsWith('b:')&&y.startsWith('b:'))return;touching.push({...a,i});});
    const boxes=new Map(touching.flatMap(a=>[[a.from,boxOf(a.from)],[a.to,boxOf(a.to)]]));
    // A two-headed arrow has no direction to compare: its ends are compared as a pair.
    const pairKey=(from,to,ends,arrows)=>`${ends==='both'?[from,to].sort(order).join('<>'):`${from}>${to}`}:${ends}:${[...arrows].sort((x,y)=>x-y).join(',')}`;
    const expect=pairArrowsOf(touching,key=>boxes.get(key)).drawn.map(d=>pairKey(d.from,d.to,d.ends,d.arrows.map(a=>a.i))).sort(order);
    const got=p.wires.map(w=>pairKey(w.from,w.to,w.ends,w.leafArrows)).sort(order);
    arrowsChecked+=touching.length;
    const ports=new Set(p.ports.map(x=>x.port)),used=new Set(p.wires.flatMap(w=>[w.from,w.to]).filter(x=>x.startsWith('b:')));
    if(JSON.stringify(expect)!==JSON.stringify(got)||[...used].some(x=>!ports.has(x))||ports.size!==used.size){pagesWrong++;if(errors.length<20)errors.push(`map ${p.index}: arrows differ from its leaf arrows`);}
  }
  return {ok:!errors.length,errors,maps:graph.length,leaves:keys.length,drawn:[...placed.values()].length,unlinked:keys.filter(k=>!linked.has(k)).length,
    pagesWrong,leafArrowPlacementsChecked:arrowsChecked};
}

// ---- reading ------------------------------------------------------------------------------
let held=null;
function stored() {
  if(held)return held;
  const file=here('store/model.json');
  if(!existsSync(file))throw Error(`No stored map at ${here('store')}. Run: ${regenerateCommand}`);
  return held=labelled(JSON.parse(readFileSync(file,'utf8')));
}
// Label passes name solved clusters by identity in layout.json `labels` (placement.mjs); a cluster
// without one keeps its generated label. They are laid over the stored model as it is loaded, so
// every read and drawing carries them and an edited label shows without a regenerate. A label
// naming no cluster of this model is reported (`labels.missing`) with what became of it.
function labelled(m) {
  const {labels}=readLayoutFile(here('layout.json')),retired=m.identity?.retired??{},drawn=new Set();
  const relabel=x=>{const id=x.path?.startsWith('@cluster/')?x.path.slice(9):null;
    if(!isCluster(id)||labels[id]===undefined)return;
    x.label=id.endsWith('/library')?`library · ${labels[id]}`:labels[id];delete x.provisional;};
  for(const p of m.pages) {
    if(p.destination!=='graph')continue;
    if(p.path.startsWith('@cluster/'))drawn.add(p.path.slice(9));
    relabel(p);for(const c of p.components)relabel(c);for(const x of p.ports)relabel(x);
  }
  const missing=Object.keys(labels).filter(id=>!drawn.has(id)).sort(order)
    .map(id=>({cluster:id,label:labels[id],why:retired[id]?`cluster retired, ${retired[id]}`:'not a cluster of this model'}));
  m.labels={applied:Object.keys(labels).length-missing.length,missing};
  return m;
}
// The source behind the stored model, as this checkout has it now.
function staleness(model) {
  const files=Object.entries(model.sourceInfo).filter(([file,{sourceSha256}])=>{
    try{return sha(lf(readFileSync(resolve(repo,file),'utf8')))!==sourceSha256;}catch{return true;}}).map(([file])=>file);
  return files.length?{reason:'source changed since the analysis',files,regenerate:model.regenerate}:null;
}

// Authored placement (placement.mjs): map 0's nodes stand where the authored design set places
// them (architecture.json `layout["0"]`, by authored index, matched by node id so a renumbered set
// keeps its places); every other box the owner placed is in this set's layout.json by map path and
// box identity. The authoring server (author-server.mjs) writes both.
export const placementFiles=()=>({authored:inputs().authored,layout:here('layout.json'),repo});

// The viewer's model. Map 0 takes the authored positions (boxes they do not place, such as the
// unowned box, are set out below them and the page is fitted to all of it); any other map takes
// the positions placed on it over its solved layout. What a page cannot
// draw is a count that opens its list: a badge on the box whose map holds the list, and a marker
// box on that map; files the analysis did not read are a marked list on map 0.
export function solvedModel() {
  const m=stored(),lists={},pages=m.pages.map(p=>p.destination==='graph'?{...p}:p);
  const byIndex=new Map(pages.map(p=>[p.index,p]));
  const item=(key,note)=>{const r=m.leaves[key];
    return {t:r.label,ref:`${r.file}:${r.line}-${r.endLine}`,...(r.index?{go:r.index}:{}),...(note?{n:note}:{})};};
  for(const p of pages) {
    if(p.unlinked)lists[`unlinked:${p.index}`]={title:`${p.index} ${p.label} · unlinked: no arrow, so not drawn`,items:p.unlinked.map(k=>item(k))};
    if(p.unowned)lists.unowned={title:'unowned: no map-0 owner',items:p.unowned.map(k=>item(k,m.leaves[k].gap+(m.leaves[k].unlinked?' · unlinked':'')))};
  }
  const placement=readPlacement(placementFiles());
  for(const p of pages) {
    if(p.destination!=='graph')continue;
    const badges=[],markers=[];
    for(const c of p.components) {
      const own=c.kind==='group'&&byIndex.get(c.index);if(!own)continue;
      if(own.unowned)badges.push({index:c.index,text:`${own.unowned.length} unowned`,tone:'unowned',list:'unowned'});
      if(own.unlinked)badges.push({index:c.index,text:`${own.unlinked.length} unlinked`,tone:'link',list:`unlinked:${own.index}`});
    }
    if(p.unlinked)markers.push({id:'list:unlinked',label:`${p.unlinked.length} unlinked`,tone:'link',list:`unlinked:${p.index}`});
    if(p.unowned)markers.push({id:'list:unowned',label:`${p.unowned.length} unowned`,tone:'unowned',list:'unowned'});
    // A finding list is a box the size of its name that opens the list in the side pane; its
    // rows as box text would draw it thousands of pixels tall for one readable line.
    const listMarker=(name,label,title,items)=>{lists[name]={title,items};markers.push({id:`list:${name}`,label,tone:'missing',list:name});};
    if(p.crossOwnerState)listMarker('cross-owner-state',`state shared across owners · ${p.crossOwnerState.length}`,'state shared across owners: read or written from more than one map-0 owner',
      p.crossOwnerState.map(x=>item(x.key,`(${x.owner}): ${Object.keys(x.touchedBy).join(', ')}`)));
    if(p.channels){const u=p.channels.unresolved,n=Object.values(u).reduce((t,l)=>t+l.length,0);
      if(n)listMarker('unresolved-channels',`unresolved channel ends · ${n}`,'unresolved channel ends',Object.entries(u).flatMap(([k,l])=>l.map(x=>{
        if(typeof x==='string')return {t:`${k}: ${x}`};
        const at=/^(.*):(\d+)$/.exec(x.at??'');
        const n=[at?'':x.at,x.note].filter(Boolean).join(' · ');
        return {t:`${k}: ${x.url??x.route??x.entry??x.kind??''}`,...(at?{ref:`${at[1]}:${at[2]}-${at[2]}`}:{}),...(n?{n}:{})};})));}
    if(p.notAnalysed)listMarker('not-analysed',`not analysed · ${p.notAnalysed.length} files`,'not analysed: in-scope files the analysis did not read',p.notAnalysed.map(f=>({t:f})));
    if(p.index===TOP&&m.sourceChanged?.length)listMarker('source-moved',`source moved since the analysis · ${m.sourceChanged.length} files`,'source moved since the analysis',m.sourceChanged.map(f=>({t:f})));
    Object.assign(p,{badges,markers,links:viewerLinks(m,p),idents:pageIdentities(m,p,markers)});
  }
  // Positions whose map or box is no longer drawn stay in their file; map 0 lists them.
  const graph=pages.filter(p=>p.destination==='graph'),root=graph.find(p=>p.index===TOP);
  const {positions,missing,applied}=placePages(graph,placement.maps,placement.unknown);
  // A position on a retired cluster says what became of it (cluster-identity.mjs).
  const retired=m.identity?.retired??{};
  for(const x of missing) {
    const key=(x.why==='map not drawn'?x.map:x.box)?.replace(/^b:/,''),id=key?.startsWith('@cluster/')?key.slice(9):null;
    if(id&&retired[id])x.why+=`: cluster ${id} retired, ${retired[id]}`;
    else if(id&&isLegacy(id))x.why+=`: ${id} is the solver's old numbering; regenerate migrates it`;
  }
  const items=[...missing.map(x=>({t:`${x.map} · ${x.box}`,n:x.why??`not a node or actor in ${x.file}`})),
    ...m.labels.missing.map(x=>({t:`label ${x.cluster} · ${x.label}`,n:x.why}))];
  if(items.length) {
    const id='list:authored-missing';
    lists['authored-missing']={title:'authored positions and labels whose box is no longer drawn: kept in their file until moved again or removed',items};
    root.markers.push({id,label:`authored positions or labels not found · ${items.length}`,tone:'missing',list:'authored-missing'});
    root.idents[id]=id;
  }
  for(const p of graph) {
    const at=positions.get(p.index)??{};
    if(p.index===TOP)p.layout={frame:'all',route:'direct',positions:at};
    else if(Object.keys(at).length)p.layout={overlay:true,positions:at};
  }
  return {generated:m.generated,title:m.title,notice:m.notice,regenerate:m.regenerate,scores:{},snapshotId:m.snapshotId,
    influence:true,authoring:{set:setName,maps:placement.maps},placement:{applied,missing,labels:m.labels},lists,pages,sources:m.sources,sourceInfo:m.sourceInfo,stale:{},changed:[],changedInputs:[]};
}

// The CLI read: enough to choose what to read next, each fact once, never code. Agents see a
// leaf as `NAME FILE:LINES` (`#K` added when two leaves would read alike); exact keys stay in the
// store. A map read gives `boxes` by index (a cluster: label and leaf count; a leaf: its name and
// range, then only what is set: `command` or `command returning data`, `folded` helper ranges
// outside its own, `possibly caller-dependent`, `range unknown`), `boundary` names by `b:` box,
// and `arrows`: the drawn pairs, `FROM → TO` (`•→` a dot at the tail, `↔` two heads) to their
// leaf-arrow count, each read in full at `link` with FROM and TO filled in. Map 0 alone adds the
// preview note, `notAnalysed` files, changed sources and the `lists` addresses with their counts.
// A link read is that one arrow's leaf arrows, `FROM → TO KIND ×N` grouped by box direction;
// `@unlinked` and `@unowned` are the lists. Leaves are not maps.
const range=(a,b)=>a===b?`${a}`:`${a}-${b}`;
const ARROW={one:'→',ack:'•→',both:'↔'};
const LIST_UNLINKED='@unlinked',LIST_UNOWNED='@unowned',LIST_SHARED='@cross-owner-state',LIST_CHANNELS='@unresolved-channels';
const byKey=(a,b)=>order(fileOf(a),fileOf(b))||keyParts(a).offset-keyParts(b).offset;
const named=new WeakMap();
function leafNames(m) {
  if(named.has(m))return named.get(m);
  const plain=r=>`${r.label} ${r.file}:${range(r.line,r.endLine)}`,groups=new Map();
  for(const r of Object.values(m.leaves))(groups.get(plain(r))??groups.set(plain(r),[]).get(plain(r))).push(r.key);
  const names=new Map();
  for(const [name,keys] of groups)keys.sort((a,b)=>keyParts(a).offset-keyParts(b).offset)
    .forEach((key,k)=>names.set(key,keys.length>1?`${name} #${k+1}`:name));
  named.set(m,names);return names;
}
function pageOf(m,key) {
  const page=m.pages.find(p=>p.index===key||p.path===key||p.key===key)??(m.leaves[key]?.index?m.pages.find(p=>p.index===m.leaves[key].index):null);
  if(!page)throw Error(`No map ${key}. Read 0 for the top map.`);
  if(page.destination==='code')throw Error(`Source leaf ${key} is not a map. Use normal file tools at the source ranges shown on its containing map.`);
  return page;
}
const underUnowned=(m,page)=>{const top=m.pages.find(p=>p.path===`@cluster/${UNOWNED}`)?.index;
  return top!==undefined&&(page.index===top||page.index.startsWith(top+'.'));};

function mapRead(m,page) {
  const names=leafNames(m);
  const returnsData=new Set(m.arrows.filter(a=>a.kind==='both').map(a=>a.to)),unownedPage=underUnowned(m,page);
  // A folded helper inside the leaf's range, or inside another listed helper, is not restated.
  const within=(f,g)=>f.file===g.file&&f.line>=g.line&&f.endLine<=g.endLine&&(f.line!==g.line||f.endLine!==g.endLine);
  const leaf=key=>{const r=m.leaves[key],outside=r.folded.filter(f=>f.line&&!(f.file===r.file&&f.line>=r.line&&f.endLine<=r.endLine));
    const folded=[...new Set(outside.filter(f=>!outside.some(g=>within(f,g)))
      .map(f=>`${f.file===r.file?'':`${f.file}:`}${range(f.line,f.endLine)}`))];
    return [names.get(key),returnsData.has(key)?'command returning data':r.role==='command'?'command':'',folded.length?`folded ${folded.join(', ')}`:'',
      r.possiblyCallerDependent?'possibly caller-dependent':'',r.placementNotSolved?'placement not solved':'',r.rangeUnknown?'range unknown':'',!r.owner&&!unownedPage?'unowned':''].filter(Boolean).join(' · ');};
  const byIndex=(a,b)=>{const x=a.index.split('.').map(Number),y=b.index.split('.').map(Number);
    for(let k=0;k<Math.min(x.length,y.length);k++)if(x[k]!==y[k])return x[k]-y[k];return x.length-y.length;};
  const boxes=Object.fromEntries([...page.components].sort(byIndex)
    .map(c=>[c.index,c.kind==='leaf'?leaf(c.path):`${c.label} · ${c.count} ${c.count===1?'leaf':'leaves'}`]));
  const top=page.index===TOP,unlinked=m.summary.unlinked,unowned=m.summary.unowned;
  return {index:page.index,label:page.label,...(top?{}:{address:page.path}),...(top&&m.notice?{preview:m.notice}:{}),boxes,
    ...(page.ports.length?{boundary:Object.fromEntries(page.ports.map(p=>[p.port,names.get(p.path)??p.label]))}:{}),
    ...(page.wires.length?{arrows:Object.fromEntries(page.wires.map(w=>[`${w.from} ${ARROW[w.ends]} ${w.to}`,w.count])),link:`@link/${page.index}/FROM/TO`}:{}),
    ...(top&&page.notAnalysed?.length?{notAnalysed:page.notAnalysed}:{}),...(top&&m.sourceChanged?.length?{sourceChanged:m.sourceChanged}:{}),
    ...(top&&(unlinked||unowned||page.crossOwnerState||page.channels)?{lists:{...(unlinked?{[LIST_UNLINKED]:unlinked}:{}),...(unowned?{[LIST_UNOWNED]:unowned}:{}),
      ...(page.crossOwnerState?{[LIST_SHARED]:page.crossOwnerState.length}:{}),...(page.channels?{[LIST_CHANNELS]:Object.values(page.channels.unresolved).reduce((t,l)=>t+l.length,0)}:{})}}:{})};
}

// One drawn arrow's leaf arrows, as indexes into the stored arrows grouped `FROM → TO` by the
// boxes each runs between. The read renders it; the check compares it with the drawn pair.
function linkGroups(m,page,wire) {
  const chainOf=idx=>idx.split('.').map((_,k,parts)=>parts.slice(0,k+1).join('.'));
  const here=new Set(page.components.map(c=>c.index));
  const boxOf=key=>{const chain=chainOf(m.leaves[key].index),box=chain.find(i=>here.has(i));
    if(box)return box;const port=page.ports.find(p=>chain.includes(p.index));return port?.port;};
  const groups=new Map(),arrows=[...wire.leafArrows].sort((i,j)=>byKey(m.arrows[i].from,m.arrows[j].from)||byKey(m.arrows[i].to,m.arrows[j].to));
  for(const i of arrows) {
    const a=m.arrows[i],key=`${boxOf(a.from)} → ${boxOf(a.to)}`;
    (groups.get(key)??groups.set(key,[]).get(key)).push(i);
  }
  return groups;
}
// One leaf arrow as a link read and the viewer's pane both give it: `FROM → TO TAIL`, the ends
// by name (`NAME FILE:LINES`) and the tail its kind and count.
const leafArrowParts=(m,names,i)=>{const a=m.arrows[i];return {from:a.from,to:a.to,fromName:names.get(a.from),toName:names.get(a.to),tail:`${a.kind}${a.count>1?` ×${a.count}`:''}`};};
const leafArrowText=(m,names,i)=>{const x=leafArrowParts(m,names,i);return `${x.fromName} → ${x.toName} ${x.tail}`;};
// A page's link reads for the viewer, compact: its leaves once each as [NAME, FILE:LINE-END or
// '', leaf page or ''], then for each drawn arrow `FROM/TO` its groups as the read groups them,
// each leaf arrow [FROM LEAF, TO LEAF, TAIL] by position in that leaf list.
function viewerLinks(m,page) {
  const names=leafNames(m),leaves=[],at=new Map(),wires={};
  const leaf=key=>{if(!at.has(key)){const r=m.leaves[key];at.set(key,leaves.length);
    leaves.push([names.get(key),r.file?`${r.file}:${r.line}-${r.endLine}`:'',r.index??'']);}return at.get(key);};
  for(const w of page.wires)wires[`${w.from}/${w.to}`]=[...linkGroups(m,page,w)].map(([dir,list])=>[dir,list.map(i=>{
    const x=leafArrowParts(m,names,i);return [leaf(x.from),leaf(x.to),x.tail];})]);
  return {leaves,wires};
}
function linkRead(m,address) {
  const [,pageIndex,from,to]=/^@link\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(address)??[];
  if(!pageIndex)throw Error(`Link addresses read @link/MAP/FROM/TO, as a map read's \`link\` gives them.`);
  const page=pageOf(m,pageIndex);
  const wire=page.wires.find(w=>w.from===from&&w.to===to||w.from===to&&w.to===from);
  if(!wire)throw Error(`Map ${page.index} draws no arrow between ${from} and ${to}.`);
  const names=leafNames(m);
  return {map:page.index,leafArrows:Object.fromEntries([...linkGroups(m,page,wire)].map(([k,list])=>[k,list.map(i=>leafArrowText(m,names,i))]))};
}
function listRead(m,address) {
  const names=leafNames(m),leaves=Object.values(m.leaves).sort((a,b)=>byKey(a.key,b.key));
  if(address===LIST_UNOWNED)return {unowned:Object.fromEntries(leaves.filter(r=>!r.owner).map(r=>[names.get(r.key),`${r.gap??'no owner'}${r.unlinked?' · unlinked':''}`]))};
  const indexOf=new Map(m.pages.map(p=>[p.path,p.index])),groups={};
  for(const r of leaves.filter(r=>r.unlinked)){const node=r.owner?indexOf.get(`@cluster/${r.owner}`)??r.owner:'unowned';(groups[node]??=[]).push(names.get(r.key));}
  return {unlinked:groups};
}

export function readSolved(address='0') {
  const m=stored(),key=String(address),stale=staleness(m);
  const root=m.pages.find(p=>p.index===TOP);
  const result=key.startsWith('@link/')?linkRead(m,key):key===LIST_UNLINKED||key===LIST_UNOWNED?listRead(m,key)
    :key===LIST_SHARED?{crossOwnerState:root.crossOwnerState??[]}:key===LIST_CHANNELS?{unresolvedChannels:root.channels?.unresolved??{}}:mapRead(m,pageOf(m,key));
  return {...result,...(stale?{stale}:{})};
}

// Each map read presents the drawing's picture: its arrows are the drawn pairs (same boxes,
// ends and counts, one per pair, every boundary box an arrow uses named), and the link reads of
// its arrows, parsed back to exact keys, are exactly the leaf arrows each drawn pair stands for.
export function verifyReads(m) {
  const names=leafNames(m),keyOf=new Map([...names].map(([key,name])=>[name,key])),errors=[];
  const fail=(p,why)=>{if(errors.length<20)errors.push(`map ${p.index}: ${why}`);};
  if(keyOf.size!==names.size)errors.push('two leaves read alike');
  let maps=0,arrows=0,leafArrows=0;
  for(const p of m.pages.filter(p=>p.destination==='graph')) {
    maps++;
    const read=mapRead(m,p),drawn=p.wires.map(w=>`${w.from} ${ARROW[w.ends]} ${w.to}`);
    const pairs=new Set(p.wires.map(w=>[w.from,w.to].sort(order).join('\u0000')));
    if(pairs.size!==p.wires.length)fail(p,'two arrows join one pair');
    if(JSON.stringify(Object.entries(read.arrows??{}))!==JSON.stringify(p.wires.map((w,k)=>[drawn[k],w.count])))fail(p,'arrows differ from the drawn pairs');
    const used=new Set(p.wires.flatMap(w=>[w.from,w.to]).filter(x=>x.startsWith('b:')));
    if(used.size!==Object.keys(read.boundary??{}).length||[...used].some(b=>!(b in (read.boundary??{}))))fail(p,'boundary boxes differ from the arrows using them');
    for(const w of p.wires) {
      arrows++;
      const groups=linkRead(m,`@link/${p.index}/${w.from}/${w.to}`).leafArrows,got=[];
      for(const [dir,list] of Object.entries(groups)) {
        const [x,y]=dir.split(' → ');
        if(![w.from,w.to].includes(x)||![w.from,w.to].includes(y)||x===y)fail(p,`link ${w.from}/${w.to} groups ${dir}`);
        for(const text of list) {
          const count=/ ×(\d+)$/.exec(text)?.[1]??1,[,fromName,toName,kind]=/^(.*?) → (.*) (\S+)$/.exec(text.replace(/ ×\d+$/,''))??[];
          got.push(`${keyOf.get(fromName)}>${keyOf.get(toName)}:${kind}:${count}`);
        }
      }
      const want=w.leafArrows.map(i=>{const a=m.arrows[i];return `${a.from}>${a.to}:${a.kind}:${a.count}`;});
      leafArrows+=want.length;
      if(JSON.stringify(got.sort(order))!==JSON.stringify(want.sort(order)))fail(p,`link ${w.from}/${w.to} differs from its leaf arrows`);
    }
  }
  return {ok:!errors.length,errors,maps,arrows,leafArrows};
}

// ---- commands -----------------------------------------------------------------------------
// `regenerate [--solve changed|place] [--cold NODE[,NODE]…]…`: `--solve` overrides map.json
// `solve` for one run, so a full solve between sessions needs no edit; `--cold` solves the named
// nodes even when unchanged and keeps their cold results (solveAll). Each node where cold beat
// warm is listed in `relabel` with the new cluster identities it brought, which have no labels.
// `serve [--port N]` is the authoring server (author-server.mjs); `import-layout FILE` applies a
// viewer's Export layout file to the layout files.
export async function influenceCommand(command,args) {
  const log=line=>process.stderr.write(line+'\n');
  if(command==='regenerate') {
    const {values}=parseArgs({args,allowPositionals:true,options:{solve:{type:'string'},cold:{type:'string',multiple:true}}});
    if(values.solve!==undefined&&!['changed','place'].includes(values.solve))throw Error('--solve is changed or place.');
    const cold=(values.cold??[]).flatMap(v=>v.split(',')).map(v=>v.trim()).filter(Boolean);
    const paths=inputs(),clock=Date.now(),seconds=()=>Math.round((Date.now()-clock)/1000);
    let analysed=null;
    if(mapSet.analyse) {
      const {analyse}=await import('./analyse.mjs');
      analysed=await analyse({repo,out:paths.analysis,...mapSet.analyse,log});
    }
    const prep=await prepare(paths);log(`model and owners ready at ${seconds()} s`);
    const solve=await solveAll(prep,{jobs:mapSet.jobs??2,mode:values.solve??mapSet.solve??'changed',cold,log});log(`solves ready at ${seconds()} s`);
    const model=await writeModel({log,prep,entries:solve.entries});held=labelled(model);
    const fresh=[...model.summary.clusterIdentity.new,...model.summary.clusterIdentity.split.flatMap(s=>s.parts)];
    const coldKept=Object.keys(solve.solved).filter(id=>solve.solved[id].kept==='cold'&&solve.solved[id].warm!==null);
    const relabel=Object.fromEntries(coldKept.map(id=>[id,fresh.filter(x=>nodeOf(x)===id).sort(order)]).filter(([,l])=>l.length));
    if(Object.keys(solve.solved).length)log(`best of warm and cold: kept cold for ${coldKept.join(', ')||'no node'}`
      +(Object.keys(relabel).length?`; new clusters to label: ${Object.entries(relabel).map(([id,l])=>`${id} ${l.length}`).join(', ')}`:''));
    const {buildGeneratedView}=await import('../lib/generated-view.mjs');
    const view=await buildGeneratedView({repo});
    // Every regeneration proves the reads say what the drawings draw, as `check` does.
    const reads=verifyReads(model);
    // The code checks (code-checks.mjs) report; the maps are written whatever they find.
    const {setErrors,errorSummary}=await import('./code-checks.mjs'),code=errorSummary(setErrors(model,paths));
    log(`code errors: ${code.errors} (${Object.entries(code.byRule).map(([r,n])=>`${r} ${n}`).join(', ')}); list them with: node dev-map/cli.mjs --set ${setName} check`);
    console.log(JSON.stringify({mode:'influence',...(analysed?{analysis:analysed}:{}),solved:solve.solved,...(Object.keys(relabel).length?{relabel}:{}),reused:solve.reused,...(solve.placed.length?{placed:solve.placed}:{}),summary:model.summary,checks:model.checks,reads,code,view:view.index,placement:view.placement},null,1));
    if(!model.checks.ok||!reads.ok)process.exitCode=1;
    return;
  }
  if(command==='build') {
    const {buildGeneratedView}=await import('../lib/generated-view.mjs');
    const view=await buildGeneratedView({repo});
    console.log(JSON.stringify({mode:'influence',view:view.index,pages:view.pages,bytes:view.bytes,placement:view.placement}));
    return;
  }
  if(command==='check') {
    const m=stored(),checks=verify(m),reads=verifyReads(m),stale=staleness(m),{placement}=solvedModel();
    const {setErrors,errorSummary,errorLine}=await import('./code-checks.mjs'),errors=setErrors(m,inputs());
    for(const e of errors)console.error(errorLine(e));
    console.log(JSON.stringify({mode:'influence',summary:m.summary,checks,reads,code:errorSummary(errors),placement,...(stale?{stale}:{})},null,1));
    if(!checks.ok||!reads.ok||errors.length)process.exitCode=1;
    return;
  }
  if(command==='serve') {
    const {values}=parseArgs({args,options:{port:{type:'string',default:'8768'}}});
    const {serve}=await import('./author-server.mjs');
    await serve({port:Number(values.port),files:placementFiles(),view:here('view'),set:setName,log});
    return;
  }
  if(command==='import-layout') {
    const {positionals}=parseArgs({args,allowPositionals:true,options:{}});
    if(positionals.length!==1)throw Error('Use: import-layout FILE (a file the viewer\'s Export layout wrote).');
    const {importLayout}=await import('./placement.mjs');
    const result=importLayout({...placementFiles(),file:resolve(positionals[0])});
    const {buildGeneratedView}=await import('../lib/generated-view.mjs');
    const view=await buildGeneratedView({repo});
    console.log(JSON.stringify({mode:'influence',imported:result,view:view.index,placement:view.placement},null,1));
    return;
  }
  throw Error('Influence sets support read, regenerate [--solve changed|place] [--cold NODE], build, check, serve [--port N] and import-layout FILE.');
}
