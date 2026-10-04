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
    if(c.authored){nameOf.set(c.id,{label:c.label,description:'authored node',authored:true});continue;}
    if(c.id===UNOWNED){nameOf.set(c.id,{label:'(unowned) · preview',description:'no map-0 owner; grouped by file, not solved'});continue;}
    const held=leavesUnder(c.id),files=new Map();for(const l of held)files.set(fileOf(l),(files.get(fileOf(l))??0)+1);
    const [dom]=[...files].sort((a,b)=>b[1]-a[1]||order(a[0],b[0]))[0];
    const names=held.filter(l=>fileOf(l)===dom).sort((a,b)=>(degree.get(b)??0)-(degree.get(a)??0)||keyOrder(a,b)).slice(0,3).map(l=>labels.get(l));
    const top=c.id.split('/')[0];
    if(top===UNOWNED)nameOf.set(c.id,{label:`${dom} · unowned`,description:'unowned, grouped by file (not solved)',byFile:true});
    else if(c.library)nameOf.set(c.id,{label:`library · ${base(dom)}${files.size>1?` +${files.size-1}`:''}: ${names.join(', ')}`,description:'uniform helpers · provisional label',library:true,provisional:true});
    else nameOf.set(c.id,{label:`≈ ${base(dom)}${files.size>1?` +${files.size-1}`:''}: ${names.join(', ')}`,description:'provisional label',provisional:true});
  }
  const boxLabel=id=>nameOf.get(id)?.label??leafRow.get(id)?.label??id;
  const leafText=key=>{const r=leafRow.get(key);return `${r.label} (${base(r.file)})`;};

  // Pages.
  const kindCount=list=>{const c={};for(const i of list)c[model.arrows[i].kind]=(c[model.arrows[i].kind]??0)+1;return c;};
  const glyph={one:'→',ack:'•→',both:'↔'};
  const pages=[];
  for(const m of maps) {
    const idx=index.get(m.id);if(idx===undefined)continue;
    const box=id=>id.startsWith('boundary:')?`b:${index.get(id.slice(9))}`:index.get(id);
    const components=m.members.map(id=>cluster.has(id)
      ?{index:index.get(id),kind:'group',path:`@cluster/${id}`,count:nested.get(id),...nameOf.get(id)}
      :(({key,label,role,file,line,endLine,uniform,possiblyCallerDependent})=>({index:index.get(id),kind:'leaf',path:key,
        label:label+(role==='command'?' · command':'')+(possiblyCallerDependent?' · mode arg?':''),role,file,line,endLine,
        ...(uniform?{uniform}:{}),...(possiblyCallerDependent?{possiblyCallerDependent}:{})}))(leafRow.get(id)))
      .sort((a,b)=>order(a.index,b.index));
    const ports=m.boundary.map(id=>({port:`b:${index.get(id)}`,mechanism:'boundary',index:index.get(id),label:boxLabel(id),
      path:cluster.has(id)?`@cluster/${id}`:id}));
    const wires=m.arrows.map(a=>({from:box(a.from),to:box(a.to),ends:a.ends,count:a.leafArrows.length,kinds:kindCount(a.leafArrows),leafArrows:a.leafArrows}));
    const named=id=>id.startsWith('b:')?`[${ports.find(p=>p.port===id)?.index}] ${ports.find(p=>p.port===id)?.label}`:`${id} ${components.find(c=>c.index===id)?.label}`;
    const sections=[{title:`arrows: ${wires.length} pairs carrying ${wires.reduce((n,w)=>n+w.count,0)} leaf arrows`,
      items:wires.flatMap(w=>[{text:`${named(w.from)} ${glyph[w.ends]} ${named(w.to)} · ${w.count} leaf arrows · ${Object.entries(w.kinds).map(([k,n])=>`${k}×${n}`).join(' ')}`,style:'note'},
        ...w.leafArrows.map(i=>{const a=model.arrows[i];return {text:`    ${leafText(a.from)} → ${leafText(a.to)} · ${a.kind}${a.count>1?` ×${a.count}`:''}`,go:leafRow.get(a.from).index??''};})])}];
    const c=cluster.get(m.id);
    if(c?.unlinked?.length)sections.push({title:`unlinked leaves (${c.unlinked.length}): no arrow, so not drawn; dead code or an analysis gap`,
      items:c.unlinked.map(k=>{const r=leafRow.get(k);return {text:`${r.label}  ${r.file}:${r.line}-${r.endLine}  ${r.role}`};})});
    const flagged=components.filter(x=>x.possiblyCallerDependent);
    if(flagged.length)sections.push({title:`possibly caller-dependent (${flagged.length}): uniform helpers taking a boolean or string-literal mode argument; review`,
      items:flagged.map(x=>({text:`${x.index} ${x.label}  ${x.file}:${x.line}`,go:x.index}))});
    pages.push({index:idx,path:m.id===TOP?'0':`@cluster/${m.id}`,kind:m.id===TOP?'root':'group',
      label:m.id===TOP?spec.title:boxLabel(m.id),description:nameOf.get(m.id)?.description??'',...(nameOf.get(m.id)??{}),
      parent:m.id===TOP?null:index.get(parentOf.get(m.id)),destination:'graph',leaves:m.nested,
      ...(m.score!==undefined?{score:m.score}:{}),components,ports,wires,sections});
  }
  for(const r of leafRow.values())if(r.index)pages.push({index:r.index,path:`${r.file}::${r.label}`,key:r.key,kind:'function',label:r.label,role:r.role,
    file:r.file,line:r.line,endLine:r.endLine,lines:r.endLine-r.line+1,destination:'code',parent:index.get(parentOf.get(r.key)),components:[],wires:[],
    foldedCode:r.folded.filter(f=>f.line).map(f=>({path:f.key,file:f.file,line:f.line,endLine:f.endLine}))});

  // Map 0 says what this is: a preview of partial analysis, and every leaf it does not draw.
  const unowned=[...leafRow.values()].filter(r=>!r.owner);
  const unlinked=[...leafRow.values()].filter(r=>r.unlinked);
  const root=pages.find(p=>p.index==='0');
  const notes=[
    `Generated ${new Date().toISOString().slice(0,16)}Z from ${basename(paths.analysis)} by the middle-out solver; nothing below map 0 is reviewed.`,
    `Leaves: ${model.leaves.length} (by exact key; ${model.merged} merged), drawn ${model.leaves.length-unlinked.length}, unlinked ${unlinked.length}, unowned ${unowned.length}. Leaf arrows: ${model.arrows.length}.`,
    `Cluster labels are provisional (≈): the file holding most of a cluster's leaves and its best-connected leaves there. Label passes do not exist yet.`,
    `Libraries hold uniform helpers (${uniform.size}): queries several leaves call that read no shared state; the analysis does not yet report state reads, so any module-level read counts as one.`,
    ...(changed.length?[`Source moved since the analysis for ${changed.length} files (ranges there may be off): ${changed.join(', ')}.`]:[]),
    ...(solverMismatch.length?[`The assembled set differs from the solver's own drawing on ${solverMismatch.length} maps: ${solverMismatch.slice(0,8).join('; ')}.`]:[]),
  ];
  root.sections.unshift({title:`PREVIEW: partial influence analysis, solver output, unreviewed`,items:notes.map(text=>({text,style:'note'}))});
  if(spec.missing?.length)root.sections.splice(1,0,{title:`not analysed (${spec.missing.length} in-scope files): their leaves and arrows are absent`,items:spec.missing.map(text=>({text}))});
  root.sections.push({title:`unowned leaves (${unowned.length}): no map-0 owner in ${basename(paths.authored)} ownership; drawn under ${index.get(UNOWNED)} when linked`,
    items:unowned.sort((a,b)=>keyOrder(a.key,b.key)).map(r=>({text:`${r.label}  ${r.file}:${r.line}-${r.endLine}  · ${r.gap}${r.declaration?` · ${r.declaration}`:''}${r.unlinked?' · unlinked':''}`,go:r.index??''}))});
  root.sections.push({title:`unlinked leaves by node (${unlinked.length}): listed on each node's map`,
    items:[...authored.nodes.map(n=>n.id),UNOWNED].map(id=>({text:`${index.get(id)} ${boxLabel(id)}: ${cluster.get(id)?.unlinked?.length??0}`,go:index.get(id)}))});
  root.sections.push({title:'solver',items:summaries.map(s=>({text:`${s.node}: ${s.leaves} leaves solved + ${s.library??0} in its library, ${s.clusters} clusters, energy ${s.startEnergy?.toFixed(3)} → ${s.energy?.toFixed(3)}, ${s.stages} stages, ${s.ms} ms, ${s.generated}`}))});

  const files=[...texts.keys()].sort(order);
  const sources=Object.fromEntries(files.map(f=>[f,lf(texts.get(f))]));
  const sourceInfo=Object.fromEntries(files.map(f=>[f,{sourceKind:'snapshot',sourceSha256:sha(sources[f])}]));
  const stored={schema:1,mode:'influence',title:spec.title,generated:new Date().toISOString(),regenerate:regenerateCommand,
    notice:spec.preview?`PREVIEW · partial analysis${spec.missing?.length?` (${spec.missing.length} in-scope files missing)`:''} · solver output, unreviewed · provisional labels · ${unowned.length} unowned, ${unlinked.length} unlinked leaves`:'',
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

export function solvedModel() {
  const m=stored();
  return {generated:m.generated,title:m.title,notice:m.notice,regenerate:m.regenerate,scores:{},snapshotId:m.snapshotId,
    pages:m.pages,sources:m.sources,sourceInfo:m.sourceInfo,stale:{},changed:[],changedInputs:[]};
}

// The CLI read: a map's boxes (leaves with their source ranges), boundary boxes and one arrow per
// related pair with every leaf arrow it stands for. Leaves are not maps.
export function readSolved(address='0') {
  const m=stored(),key=String(address);
  const page=m.pages.find(p=>p.index===key||p.path===key||p.key===key)??(m.leaves[key]?.index?m.pages.find(p=>p.index===m.leaves[key].index):null);
  if(!page)throw Error(`No map ${key}. Read 0 for the top map.`);
  if(page.destination==='code')throw Error(`Source leaf ${key} is not a map. Use normal file tools at the source ranges shown on its containing map.`);
  const leaf=k=>m.leaves[k];
  const sources=r=>[{file:r.file,range:[r.line,r.endLine]},...r.folded.filter(f=>f.line).map(f=>({file:f.file,range:[f.line,f.endLine]}))];
  const stale=staleness(m);
  return {index:page.index,path:page.path,kind:page.kind,label:page.label,description:page.description,
    ...(page.provisional?{provisional:true}:{}),...(page.library?{library:true}:{}),parent:page.parent,leaves:page.leaves,
    components:page.components.map(c=>c.kind==='leaf'
      ?{index:c.index,path:c.path,label:c.label,kind:'leaf',role:c.role,...(c.uniform?{uniform:true}:{}),...(c.possiblyCallerDependent?{possiblyCallerDependent:true}:{}),destination:'source',sources:sources(leaf(c.path))}
      :{index:c.index,path:c.path,label:c.label,kind:'cluster',count:c.count,...(c.provisional?{provisional:true}:{}),...(c.library?{library:true}:{}),...(c.authored?{authored:true}:{}),destination:'graph'}),
    boundary:page.ports.map(p=>({box:p.port,index:p.index,path:p.path,label:p.label})),
    arrows:page.wires.map(w=>({from:w.from,to:w.to,ends:w.ends,count:w.count,kinds:w.kinds,
      leafArrows:w.leafArrows.map(i=>{const a=m.arrows[i];return {from:a.from,to:a.to,kind:a.kind,count:a.count};})})),
    ...(page.index==='0'?{preview:{notice:m.notice,summary:m.summary,sourceChanged:m.sourceChanged,sections:page.sections.filter(s=>!s.title.startsWith('arrows:'))}}
      :page.sections.some(s=>s.title.startsWith('unlinked'))?{unlinked:page.sections.find(s=>s.title.startsWith('unlinked')).items.map(i=>i.text)}:{}),
    ...(stale?{stale}:{})};
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
    const m=stored(),checks=verify(m),stale=staleness(m);
    console.log(JSON.stringify({mode:'influence',summary:m.summary,checks,...(stale?{stale}:{})},null,1));
    if(!checks.ok)process.exitCode=1;
    return;
  }
  throw Error('Influence sets support read, regenerate, build and check.');
}
