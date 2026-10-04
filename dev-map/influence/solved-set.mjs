// A solved influence map set (plans/dev-maps.md#levels): the authored top level of a design set,
// each authored node opened into the clusters the middle-out solver (solve-middle.mjs) groups
// its leaves into, nested down to leaves that open as source. Nothing in it is authored except
// the top level; cluster labels are provisional, derived mechanically from the leaves until label
// passes exist, and marked so.
//
// The set is a folder holding `map.json`:
//   {"mode":"influence","title":…,"analysis":FILE,"authored":DIR,"sourceRoots":[DIR…],
//    "preview":true?,"missing":[FILE…]?,"jobs":2?}
// `analysis` is a `run.mjs --out` result; `authored` the design set whose map 0 and ownership are
// fixed (default dev-map/sets/030-architecture); `sourceRoots` further checkouts holding the text
// the analysis read (solve-middle.mjs analysedTexts); `missing` the in-scope files the analysis did
// not cover, listed on map 0. Paths are absolute or relative to the repository.
//
//   node dev-map/cli.mjs --set-dir DIR regenerate     (or --set NAME for a set under dev-map/sets)
// solves each authored node whose inputs moved (`solve-middle.mjs`, `jobs` at a time, each in its
// own small-heap process, kept in store/solve/), writes store/model.json and draws view/. `read
// ADDRESS`, `build` and `check` read the stored model; reads never solve.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {pairArrowsOf} from './derive.mjs';
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
// Each authored node is solved in its own process, a few at a time, so heaps stay small. A
// node's stored solve is reused while the analysis, the authored set and the solver are as they
// were when it was made.
const solverFiles=['dev-map/influence/solve-middle.mjs','dev-map/influence/derive.mjs','dev-map/lib/solve.mjs','dev-map/lib/score.mjs','dev-map/lib/tree.mjs','dev-map/lib/graph.mjs'];
function solveInputs({analysis,authored,roots,maxStages}) {
  const h=createHash('sha256');
  for(const file of [analysis,resolve(authored,'architecture.json'),resolve(authored,'ownership.json'),...solverFiles.map(f=>resolve(repo,f))])h.update(lf(readFileSync(file,'utf8')));
  h.update(JSON.stringify(roots));if(maxStages)h.update(`maxStages ${maxStages}`);
  return h.digest('hex');
}

async function solveAll(nodes,paths,{jobs=2,log=()=>{}}={}) {
  const dir=here('store/solve');mkdirSync(dir,{recursive:true});
  const hash=solveInputs(paths);
  const stale=nodes.filter(id=>{try{return readFileSync(resolve(dir,`${id}.hash`),'utf8')!==hash;}catch{return true;}});
  const queue=[...stale],failures=[];
  const run=async()=>{for(let node=queue.shift();node;node=queue.shift()) {
    const started=Date.now();
    log(`solving ${node}`);
    const args=['--max-old-space-size=1536',resolve(repo,'dev-map/influence/solve-middle.mjs'),'--in',paths.analysis,'--node',node,
      '--authored',paths.authored,...paths.roots.flatMap(r=>['--source-root',r]),...(paths.maxStages?['--max-stages',String(paths.maxStages)]:[]),'--out',resolve(dir,`${node}.json`)];
    const code=await new Promise(done=>{const child=spawn(process.execPath,args,{cwd:repo,stdio:['ignore','ignore','pipe']});
      let err='';child.stderr.on('data',d=>{err+=d;if(err.length>20000)err=err.slice(-10000);});
      child.on('exit',c=>{if(c!==0)failures.push({node,code:c,stderr:err.slice(-2000)});done(c);});});
    if(code===0)writeFileSync(resolve(dir,`${node}.hash`),hash);
    log(`${node}: ${code===0?'solved':'failed'} in ${Math.round((Date.now()-started)/1000)} s`);
  }};
  await Promise.all(Array.from({length:Math.max(1,jobs)},run));
  if(failures.length)throw Error(`Solve failed: ${failures.map(f=>`${f.node} (exit ${f.code}): ${f.stderr}`).join('\n')}`);
  return {solved:stale,reused:nodes.filter(id=>!stale.includes(id)),hash};
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

// ---- writing --------------------------------------------------------------------------------
// The stored model: every map as a page the viewer draws and `read` projects, every placed leaf
// as a source page, and the leaf arrows each drawn arrow carries.
export async function writeModel({log=()=>{}}={}) {
  const sm=await import('./solve-middle.mjs');
  const paths=inputs(),{spec}=paths;
  const authored=sm.readAuthored(paths.authored);
  const model=sm.leafModel(JSON.parse(readFileSync(paths.analysis,'utf8')));
  const {texts,changed}=sm.analysedTexts(model.leaves,{roots:[repo,...paths.roots]});
  const labels=sm.leafLabels(model.leaves,{texts});
  const uniform=sm.uniformLeaves(model);
  const leafOf=new Map(model.leaves.map(l=>[l.id,l]));

  // The solver's per-node outputs, rebuilt as solve-middle's own `solved` entries (cluster ids
  // padded so assemble numbers them exactly as the solver did), and its maps kept for comparison.
  let owners=null;const solved=[],solverMaps=new Map(),summaries=[],ownerDisagreements=[];
  for(const n of authored.nodes) {
    const j=JSON.parse(readFileSync(here(`store/solve/${n.id}.json`),'utf8'));
    if(j.arrows.length!==model.arrows.length||j.leaves.length!==model.leaves.length||j.leaves.some(l=>!leafOf.has(l.id)))
      throw Error(`store/solve/${n.id}.json was solved from another analysis; run ${regenerateCommand}`);
    const rows=j.leaves.map(l=>({leaf:l.id,owner:l.owner,declaration:l.declaration,via:l.via,gap:l.gap}));
    if(!owners)owners=rows;
    else {const first=new Map(owners.map(o=>[o.leaf,o.owner]));for(const o of rows)if(first.get(o.leaf)!==o.owner)ownerDisagreements.push(o.leaf);}
    const s=j.summary.solved.find(x=>x.node===n.id);summaries.push({...s,generated:j.generated});
    const pad=id=>id===n.id?id:id.slice(n.id.length+1).padStart(6,'0');
    const under=j.clusters.filter(c=>c.id===n.id||c.id.startsWith(n.id+'/'));
    solved.push({node:n.id,library:under.find(c=>c.library)?pad(under.find(c=>c.library).id):null,
      clusters:new Map(under.filter(c=>c.id!==n.id).map(c=>[pad(c.id),pad(c.parent)])),
      homes:new Map(under.flatMap(c=>c.leaves.map(l=>[l,pad(c.id)])))});
    for(const m of j.maps)if(m.id===TOP||m.id===n.id||m.id.startsWith(n.id+'/'))solverMaps.set(`${n.id}\n${m.id}`,m);
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
    leafRow.set(l.id,{key:l.id,name:l.name,label:labels.get(l.id),role:l.role,file,line:shape?.line??Number(m?.[2]??1),endLine:shape?.endLine??Number(m?.[2]??1),
      ...(shape?{}:{rangeUnknown:true}),owner:o?.owner??null,...(o?.owner?{declaration:o.declaration,via:o.via}:{gap:o?.gap}),
      ...(uniform.has(l.id)?{uniform:true}:{}),...(uniform.has(l.id)&&shape?.modeArgument?{possiblyCallerDependent:true}:{}),
      ...(index.has(l.id)?{index:index.get(l.id)}:{unlinked:true}),
      folded:l.folded.map(k=>{const s=shapes.get(k);return {key:k,file:fileOf(k),...(s?{line:s.line,endLine:s.endLine}:{})};})});
  }

  // Labels. A cluster is named after the file holding most of its leaves and its best-connected
  // leaves there: provisional, mechanical, never authored.
  const degree=new Map();for(const a of model.arrows)for(const e of [a.from,a.to])degree.set(e,(degree.get(e)??0)+1);
  const leavesUnder=id=>cluster.has(id)?childrenOf(id).flatMap(leavesUnder):[id];
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
    else if(c.library)nameOf.set(c.id,{label:`library · ${base(dom)}${files.size>1?` +${files.size-1}`:''}: ${names.join(', ')}`,library:true,provisional:true});
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
      ?{index:index.get(id),kind:'group',path:`@cluster/${id}`,count:nested.get(id),...nameOf.get(id)}
      :(({key,label,role,file,line,endLine,uniform,possiblyCallerDependent})=>({index:index.get(id),kind:'leaf',path:key,
        label,role,file,line,endLine,...(uniform?{uniform}:{}),...(possiblyCallerDependent?{possiblyCallerDependent}:{})}))(leafRow.get(id)))
      .sort((a,b)=>order(a.index,b.index));
    const ports=m.boundary.map(id=>({port:`b:${index.get(id)}`,mechanism:'boundary',index:index.get(id),label:boxLabel(id),
      path:cluster.has(id)?`@cluster/${id}`:id}));
    const wires=m.arrows.map(a=>({from:box(a.from),to:box(a.to),ends:a.ends,count:a.leafArrows.length,kinds:kindCount(a.leafArrows),leafArrows:a.leafArrows}));
    const unlinked=cluster.get(m.id)?.unlinked;
    pages.push({index:idx,path:m.id===TOP?'0':`@cluster/${m.id}`,kind:m.id===TOP?'root':'group',
      label:m.id===TOP?spec.title:boxLabel(m.id),...(nameOf.get(m.id)??{}),
      parent:m.id===TOP?null:index.get(parentOf.get(m.id)),destination:'graph',leaves:m.nested,
      ...(m.score!==undefined?{score:m.score}:{}),components,ports,wires,...(unlinked?.length?{unlinked:[...unlinked].sort(keyOrder)}:{})});
  }
  for(const r of leafRow.values())if(r.index)pages.push({index:r.index,path:`${r.file}::${r.label}`,key:r.key,kind:'function',label:r.label,role:r.role,
    file:r.file,line:r.line,endLine:r.endLine,lines:r.endLine-r.line+1,destination:'code',parent:index.get(parentOf.get(r.key)),components:[],wires:[],
    foldedCode:r.folded.filter(f=>f.line).map(f=>({path:f.key,file:f.file,line:f.line,endLine:f.endLine}))});

  // Map 0 lists the in-scope files the analysis did not read; the unowned box's own map (map 0
  // when there is none) lists every leaf without a map-0 owner.
  const unowned=[...leafRow.values()].filter(r=>!r.owner);
  const unlinked=[...leafRow.values()].filter(r=>r.unlinked);
  const root=pages.find(p=>p.index==='0');
  if(spec.missing?.length)root.notAnalysed=[...spec.missing];
  if(unowned.length)(pages.find(p=>p.index===index.get(UNOWNED))??root).unowned=unowned.map(r=>r.key).sort(keyOrder);

  const files=[...texts.keys()].sort(order);
  const sources=Object.fromEntries(files.map(f=>[f,lf(texts.get(f))]));
  const sourceInfo=Object.fromEntries(files.map(f=>[f,{sourceKind:'snapshot',sourceSha256:sha(sources[f])}]));
  const stored={schema:1,mode:'influence',title:spec.title,generated:new Date().toISOString(),regenerate:regenerateCommand,
    notice:spec.preview?'PREVIEW · partial analysis · unreviewed solver output':'',
    inputs:{analysis:paths.analysis,authored:paths.authored,sourceRoots:paths.roots},sourceChanged:changed,
    summary:{leaves:model.leaves.length,merged:model.merged,sharedNames:model.sharedNames,arrows:model.arrows.length,drawn:model.leaves.length-unlinked.length,
      unlinked:unlinked.length,unowned:unowned.length,uniform:uniform.size,possiblyCallerDependent:[...leafRow.values()].filter(r=>r.possiblyCallerDependent).length,
      maps:pages.filter(p=>p.destination==='graph').length,rangeUnknown,ownerDisagreements:ownerDisagreements.length,solverMismatch,solved:summaries},
    arrows:model.arrows,leaves:Object.fromEntries(leafRow),pages,sources,sourceInfo};
  stored.snapshotId=sha(JSON.stringify([stored.summary,pages.length,model.arrows.length,Object.values(sourceInfo).map(s=>s.sourceSha256)]));
  stored.checks=verify(stored);
  mkdirSync(here('store'),{recursive:true});
  writeFileSync(here('store/model.json'),JSON.stringify(stored));
  log(`wrote ${here('store/model.json')}: ${stored.summary.maps} maps, ${stored.summary.drawn} drawn leaves`);
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
  return held=JSON.parse(readFileSync(file,'utf8'));
}
// The source behind the stored model, as this checkout has it now.
function staleness(model) {
  const files=Object.entries(model.sourceInfo).filter(([file,{sourceSha256}])=>{
    try{return sha(lf(readFileSync(resolve(repo,file),'utf8')))!==sourceSha256;}catch{return true;}}).map(([file])=>file);
  return files.length?{reason:'source changed since the analysis',files,regenerate:'rerun the analysis, then '+model.regenerate}:null;
}

// Map 0's boxes stand where the authored design set places its nodes: its architecture.json
// `layout["0"]`, keyed there by authored index and matched here by node id, so a renumbered set
// keeps its places. Positions come from here alone; when a person can drag boxes and keep them,
// this is what reads the kept positions instead. Generated placement stays for every other map.
export function mapZeroPositions(authoredDir=inputs().authored) {
  const architecture=JSON.parse(readFileSync(resolve(authoredDir,'architecture.json'),'utf8'));
  const idOf=new Map(architecture.nodes.filter(n=>!String(n.index).includes('.')).map(n=>[String(n.index),n.id]));
  return Object.fromEntries(Object.entries(architecture.layout?.[TOP]?.positions??{})
    .filter(([index])=>idOf.has(index)).map(([index,point])=>[idOf.get(index),point]));
}

// The viewer's model. Map 0 takes the authored positions (boxes they do not place, such as the
// unowned box, are set out below them and the page is fitted to all of it). What a page cannot
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
  const placed=mapZeroPositions();
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
    if(p.notAnalysed)markers.push({id:'list:not-analysed',label:`not analysed · ${p.notAnalysed.length} files`,note:p.notAnalysed.join('\n'),tone:'missing'});
    if(p.index===TOP&&m.sourceChanged?.length)markers.push({id:'list:source-moved',label:`source moved since the analysis · ${m.sourceChanged.length} files`,note:m.sourceChanged.join('\n'),tone:'missing'});
    Object.assign(p,{badges,markers});
    if(p.index===TOP)p.layout={frame:'all',route:'direct',positions:Object.fromEntries(p.components
      .map(c=>[c.index,placed[c.path.replace(/^@cluster\//,'')]]).filter(([,point])=>point))};
  }
  return {generated:m.generated,title:m.title,notice:m.notice,regenerate:m.regenerate,scores:{},snapshotId:m.snapshotId,
    influence:true,lists,pages,sources:m.sources,sourceInfo:m.sourceInfo,stale:{},changed:[],changedInputs:[]};
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
const LIST_UNLINKED='@unlinked',LIST_UNOWNED='@unowned';
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
      r.possiblyCallerDependent?'possibly caller-dependent':'',r.rangeUnknown?'range unknown':'',!r.owner&&!unownedPage?'unowned':''].filter(Boolean).join(' · ');};
  const byIndex=(a,b)=>{const x=a.index.split('.').map(Number),y=b.index.split('.').map(Number);
    for(let k=0;k<Math.min(x.length,y.length);k++)if(x[k]!==y[k])return x[k]-y[k];return x.length-y.length;};
  const boxes=Object.fromEntries([...page.components].sort(byIndex)
    .map(c=>[c.index,c.kind==='leaf'?leaf(c.path):`${c.label} · ${c.count} ${c.count===1?'leaf':'leaves'}`]));
  const top=page.index===TOP,unlinked=m.summary.unlinked,unowned=m.summary.unowned;
  return {index:page.index,label:page.label,...(top&&m.notice?{preview:m.notice}:{}),boxes,
    ...(page.ports.length?{boundary:Object.fromEntries(page.ports.map(p=>[p.port,p.label]))}:{}),
    ...(page.wires.length?{arrows:Object.fromEntries(page.wires.map(w=>[`${w.from} ${ARROW[w.ends]} ${w.to}`,w.count])),link:`@link/${page.index}/FROM/TO`}:{}),
    ...(top&&page.notAnalysed?.length?{notAnalysed:page.notAnalysed}:{}),...(top&&m.sourceChanged?.length?{sourceChanged:m.sourceChanged}:{}),
    ...(top&&(unlinked||unowned)?{lists:{...(unlinked?{[LIST_UNLINKED]:unlinked}:{}),...(unowned?{[LIST_UNOWNED]:unowned}:{})}}:{})};
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
const leafArrowText=(m,names,i)=>{const a=m.arrows[i];return `${names.get(a.from)} → ${names.get(a.to)} ${a.kind}${a.count>1?` ×${a.count}`:''}`;};
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
  const result=key.startsWith('@link/')?linkRead(m,key):key===LIST_UNLINKED||key===LIST_UNOWNED?listRead(m,key):mapRead(m,pageOf(m,key));
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
export async function influenceCommand(command,args) {
  const log=line=>process.stderr.write(line+'\n');
  if(command==='regenerate') {
    const paths=inputs(),{readAuthored}=await import('./solve-middle.mjs');
    const nodes=readAuthored(paths.authored).nodes.map(n=>n.id);
    const solve=await solveAll(nodes,paths,{jobs:mapSet.jobs??2,log});
    const model=await writeModel({log});held=model;
    const {buildGeneratedView}=await import('../lib/generated-view.mjs');
    const view=await buildGeneratedView({repo});
    console.log(JSON.stringify({mode:'influence',solved:solve.solved,reused:solve.reused,summary:model.summary,checks:model.checks,view:view.index},null,1));
    if(!model.checks.ok)process.exitCode=1;
    return;
  }
  if(command==='build') {
    const {buildGeneratedView}=await import('../lib/generated-view.mjs');
    const view=await buildGeneratedView({repo});
    console.log(JSON.stringify({mode:'influence',view:view.index,pages:view.pages,bytes:view.bytes}));
    return;
  }
  if(command==='check') {
    const m=stored(),checks=verify(m),reads=verifyReads(m),stale=staleness(m);
    console.log(JSON.stringify({mode:'influence',summary:m.summary,checks,reads,...(stale?{stale}:{})},null,1));
    if(!checks.ok||!reads.ok)process.exitCode=1;
    return;
  }
  throw Error('Influence sets support read, regenerate, build and check.');
}
