// The middle-out solver (plans/dev-maps.md#levels). The authored top-level nodes are fixed above
// and the computed leaves below; the solver groups each authored node's leaves into nested
// clusters and never moves a leaf across an authored boundary. Its objective is the map scorer's
// (lib/score.mjs: size, edge, hub, island and balance, no backflow) over one arrow per related
// pair of boxes (pairArrowsOf), annealed by lib/solve.mjs under the authored nodes. Higher-level
// arrows are derived only from leaf arrows. Labels come from label passes, never from here.
//
// Use:
//   node dev-map/influence/solve-middle.mjs --in ANALYSIS.json (--node ID... | --all)
//     [--authored DIR] [--seed N] [--start flat|file] [--max-stages N] [--out FILE] [--source-root DIR...]
//   node dev-map/influence/solve-middle.mjs --slice SLICE.json --out ENTRY.json
// The second is regenerate's (solved-set.mjs): one node's slice (nodeSlice) in, its kept solve
// (sliceEntry) out.
// ANALYSIS.json is what `run.mjs --out` writes: `leaves` (each callable a leaf holds, by `key`
// and display name) and `arrows` (fromKey, toKey, kind, count) between callables. Leaves are
// identified by key throughout (clusters, homes, output); output rows add `name` and a
// disambiguated `label`. DIR holds the authored set's
// architecture.json (nodes) and ownership.json (declaration owners); default 030-architecture.
// Keys are offsets in the text the analysis read; --source-root adds checkouts in which to find
// that text when this one has moved (analysedTexts); files found in none are `sourceChanged`.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse as acornParse} from 'acorn';
import {TOP,drawMap,linkSet,treeAccess} from '../lib/tree.mjs';
import {solveTree} from '../lib/solve.mjs';
import {scoreDrawn,INFLUENCE,SIZE,WEIGHT,weightOf} from '../lib/score.mjs';
import {pairArrowsOf} from './derive.mjs';
import {withChannels,boundaryFileStores} from './channels.mjs';
export {boundaryFileStores};

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const UNOWNED='(unowned)';
const order=(a,b)=>a<b?-1:a>b?1:0;

// Leaves and the arrows between them from an analysis result. A callable's identity is its exact
// key, `file:offset` (the start of its function, 0 for module load); its name, `file:line name`,
// is only a display label, which several callables may share (anonymous callbacks on one line,
// same-named methods). A leaf holds its own callable and those folded into it. A result without
// keys falls back to names as identity; callables that then collide are one leaf (`merged`).
// State nodes, process links and actor channels (channels.mjs) join the leaves and arrows first;
// `actors` are the authored set's actor ids (readAuthored).
export function leafModel(analysis,{actors}={}) {
  analysis=withChannels(analysis,{actors});
  const leafOf=new Map(),leaves=new Map();
  let merged=0;
  for(const {leaf:name,key=name,role,folded=[],foldedKeys=folded,readsState,state,channel,owner} of analysis.leaves) {
    if(leaves.has(key)){merged++;continue;}
    leaves.set(key,{id:key,name,role,folded:foldedKeys,foldedNames:folded,...(readsState!==undefined?{readsState}:{}),...(state?{state}:{}),...(channel?{channel,owner}:{})});
    leafOf.set(key,key);
  }
  for(const {id,folded} of leaves.values())for(const f of folded){if(leafOf.has(f)){if(leafOf.get(f)!==id)merged++;continue;}leafOf.set(f,id);}
  const arrows=new Map(),missing=new Set();
  for(const {from:fromName,to:toName,fromKey=fromName,toKey=toName,...a} of analysis.arrows) {
    const from=leafOf.get(fromKey),to=leafOf.get(toKey);
    if(from===undefined||to===undefined){missing.add(from===undefined?fromKey:toKey);continue;}
    if(from===to)continue;
    const key=`${from}\n${to}\n${a.kind}`,held=arrows.get(key);
    if(held)held.count+=a.count??1;else arrows.set(key,{from,to,kind:a.kind,count:a.count??1});
  }
  const named=new Map();for(const l of leaves.values())named.set(l.name,(named.get(l.name)??0)+1);
  const sharedNames=[...leaves.values()].filter(l=>named.get(l.name)>1).length;
  return {leaves:[...leaves.values()],arrows:[...arrows.values()],merged,sharedNames,unknownEnds:[...missing].sort(order),...(analysis.channels?{channels:analysis.channels}:{})};
}

// The text each file's keys were taken in. The analysis reads files as they are on disk, so a
// checkout's line endings, or an edit since, move every offset. Of each file under each source
// root, as read and with LF/CRLF swapped, the first in which every key (folded callables' too)
// is the start of a function, class or the module, on the line its name gives, is the analysed
// text. A file in which none fits has changed since the analysis; it is listed and its text under
// the first root used as read.
const keyAt=l=>{const k=/^(.*):(\d+)$/.exec(l.id),m=/^(.*?):(\d+) /.exec(l.name??'');
  return k&&m&&k[1]===m[1]?{file:k[1],offset:Number(k[2]),line:Number(m[2])}:null;};
const callableStarts=text=>{
  let ast=null;
  for(const sourceType of ['module','script']){try{ast=acornParse(text,{ecmaVersion:'latest',sourceType,allowHashBang:true});break;}catch{}}
  const starts=new Set([0]);if(!ast)return starts;
  const walk=n=>{if(/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassDeclaration|ClassExpression)$/.test(n.type))starts.add(n.start);
    for(const v of Object.values(n)){if(Array.isArray(v)){for(const c of v)if(c&&typeof c.type==='string')walk(c);}else if(v&&typeof v.type==='string')walk(v);}};
  walk(ast);return starts;
};
export function analysedTexts(leaves,{root=repo,roots=[root]}={}) {
  const keys=new Map(),texts=new Map(),changed=[];
  for(const l of leaves)for(const at of [keyAt(l),...(l.foldedNames??[]).map((name,i)=>keyAt({id:l.folded[i],name}))])
    if(at)(keys.get(at.file)??keys.set(at.file,[]).get(at.file)).push(at);
  const fits=(text,held)=>{const starts=[0];for(let i=text.indexOf('\n');i>=0;i=text.indexOf('\n',i+1))starts.push(i+1);
    if(!held.every(({offset,line})=>{let lo=0,hi=starts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid-1;}return lo+1===line;}))return false;
    const callable=callableStarts(text);return held.every(({offset})=>callable.has(offset));};
  for(const [file,held] of [...keys].sort(([a],[b])=>order(a,b))) {
    const read=roots.map(r=>{try{return readFileSync(resolve(r,file),'utf8');}catch{return null;}}).filter(t=>t!==null);
    const text=read.flatMap(disk=>{const lf=disk.replaceAll('\r\n','\n');return [disk,lf===disk?lf.replaceAll('\n','\r\n'):lf];}).find(t=>fits(t,held));
    if(text===undefined)changed.push(file);
    if(text!==undefined||read.length)texts.set(file,text??read[0]);
  }
  return {texts,changed};
}

// A leaf's display label: its name; `@line` where another leaf in its file has the same name,
// `@line:column` where one also starts on that line. Labels never identify a leaf: keys do.
export function leafLabels(leaves,{texts=new Map()}={}) {
  const parts=l=>{const m=/^(.*?):(\d+) (.*)$/.exec(l.name);return m?{file:m[1],line:m[2],short:m[3]}:{file:'',line:'',short:l.name};};
  const tally=key=>{const c=new Map();for(const l of leaves){const k=key(l);c.set(k,(c.get(k)??0)+1);}return c;};
  const perFile=tally(l=>{const p=parts(l);return p.file+'\n'+p.short;}),perLine=tally(l=>l.name);
  const labels=new Map();
  for(const l of leaves) {
    const {file,line,short}=parts(l),at=keyAt(l);
    if(perFile.get(file+'\n'+short)<2){labels.set(l.id,short);continue;}
    if(perLine.get(l.name)<2||!at){labels.set(l.id,`${short} @${line}`);continue;}
    const before=texts.get(file)?.slice(0,at.offset);
    labels.set(l.id,before===undefined?`${short} @${line}+${at.offset}`:`${short} @${line}:${at.offset-before.lastIndexOf('\n')}`);
  }
  return labels;
}

// The authored top level: map-0 nodes, and every authored node's map-0 node by its index.
export function readAuthored(dir) {
  const architecture=JSON.parse(readFileSync(resolve(dir,'architecture.json'),'utf8'));
  const ownership=JSON.parse(readFileSync(resolve(dir,'ownership.json'),'utf8'));
  const top=architecture.nodes.filter(n=>!String(n.index).includes('.'));
  const byIndex=new Map(top.map(n=>[String(n.index),n.id]));
  const topOf=new Map(architecture.nodes.map(n=>[n.id,byIndex.get(String(n.index).split('.')[0])]));
  const nodes=top.map(n=>({id:n.id,index:String(n.index),label:n.label})).sort((a,b)=>Number(a.index)-Number(b.index));
  // Outside actors (architecture.json `actors`) are map-0 boxes holding their channels
  // (channels.mjs), numbered after the nodes, then a generated box for outside contacts no
  // actor's channel takes.
  const actors=Object.keys(architecture.actors??{});
  let next=Math.max(...nodes.map(n=>Number(n.index)));
  for(const id of actors){nodes.push({id:`external:${id}`,index:String(++next),label:architecture.actors[id].label,actor:true});topOf.set(`external:${id}`,`external:${id}`);}
  nodes.push({id:'external:unassigned',index:String(++next),label:'Unassigned',actor:true,generated:true});topOf.set('external:unassigned','external:unassigned');
  return {nodes,topOf,owners:ownership.leaves??{},actors};
}

// Each leaf's map-0 owner. A leaf's callable is found among the declarations (lib/graph.mjs
// anchors, the names ownership.json uses) by its exact key: the innermost declaration holding its
// start offset; a leaf without a key falls back to the declarations at its line, by name. Its
// owner is the first owned anchor on that declaration and the declarations around it, nearest
// first (an anonymous body inherits its nearest stable declaration), else the module's for
// module-level code. A state node takes its class's owner when it is an instance, else its
// allocation's declaration, else the owner of the callable allocating it (module-level state:
// the module's). A leaf with no owned declaration, or whose owner is not under a map-0 node,
// is reported, not guessed. `texts` are the analysed texts (analysedTexts), so offsets agree.
export async function ownLeaves(leaves,authored,{root=repo,texts=analysedTexts(leaves,{root}).texts}={}) {
  const {extractGraph}=await import('../lib/graph.mjs');
  // A state node's key is its declaring site with a suffix (state.mjs); a channel has its actor.
  const parse=l=>{if(l.channel)return null;const m=/^(.*?):(\d+) (.*)$/.exec(l.name??l.id),k=/^(.*):(\d+)(?:\.\d+)?$/.exec(l.id);
    return m?{file:m[1],line:Number(m[2]),name:m[3],offset:k&&k[1]===m[1]?Number(k[2]):null}:null;};
  // A callable or class by its key, `file:offset` (state.mjs instanceOf, allocatedBy).
  const keyed=key=>{const m=/^(.*):(\d+)$/.exec(key??'');return m?{file:m[1],offset:Number(m[2])}:null;};
  const files=[...new Set(leaves.flatMap(l=>[parse(l)?.file,keyed(l.state?.instanceOf)?.file,keyed(l.state?.allocatedBy)?.file]).filter(Boolean))].sort(order);
  const graph=await extractGraph({repo:root,files,readSource:file=>texts.get(file)??readFileSync(resolve(root,file),'utf8')});
  const byId=new Map(graph.declarations.map(d=>[d.id,d])),atLine=new Map(),inFile=new Map();
  for(const d of graph.declarations){const key=`${d.file}:${d.line}`;(atLine.get(key)??atLine.set(key,[]).get(key)).push(d);
    (inFile.get(d.file)??inFile.set(d.file,[]).get(d.file)).push(d);}
  const holding=({file,offset})=>{let best=null;
    for(const d of inFile.get(file)??[])if(d.start<=offset&&offset<d.end&&(!best||d.end-d.start<best.end-best.start||d.end-d.start===best.end-best.start&&d.kind!=='variable'))best=d;
    return best;};
  const owned=anchor=>authored.owners[anchor]?.owner;
  const prefixes=anchor=>{const found=[];for(let a=anchor;a.includes('::');a=a.slice(0,a.lastIndexOf('::')))found.push(a);return found;};
  const declarationOf=({file,line,name,offset})=>{
    if(offset!==null&&offset!==undefined){const d=holding({file,offset});if(d)return d;}
    const here=(atLine.get(`${file}:${line}`)??[]);
    if(name==='(anonymous)')return here.find(d=>d.kind!=='variable'&&!d.anchor)??here.find(d=>d.kind!=='variable')??here[0];
    const want=name.split('.').pop().replace(/^#/,'');
    return here.find(d=>d.kind!=='variable'&&d.name===want)??here.find(d=>d.name===want)??here.find(d=>d.kind==='class')
      ??here.find(d=>d.name==='constructor')??here.find(d=>d.kind!=='variable');
  };
  // The anchors a declaration and the declarations around it carry, nearest first; the module's
  // when none does (module-level code).
  const anchorsOf=(d,file)=>{const found=[];for(let x=d;x;x=x.parent?byId.get(x.parent):null)if(x.anchor)found.push(...prefixes(x.anchor));
    return found.length?[...new Set(found)]:[`${file}::@module`];};
  // The anchors of the callable or class at a key: module load code is the module's.
  const anchorsAt=key=>{const at=keyed(key);if(!at)return [];if(at.offset===0)return [`${at.file}::@module`];
    const d=holding(at);return d?anchorsOf(d,at.file):[];};
  return leaves.map(leaf=>{
    if(leaf.channel)return {leaf:leaf.id,owner:leaf.owner??'external:unassigned',via:'channel'};
    const at=parse(leaf);
    if(!at)return {leaf:leaf.id,owner:null,gap:'unparsed leaf name'};
    let tried=[],d=null;
    // State (state.mjs) is owned through what allocates it: an instance by its class's
    // declaration (its fields are the class's, wherever `new` runs); otherwise the declaration
    // holding the allocation, then the callable that allocates it (module load code for
    // module-level state, owned by the module).
    const byClass=leaf.state?.instanceOf?anchorsAt(leaf.state.instanceOf):[];
    const byAllocator=leaf.state?.allocatedBy?anchorsAt(leaf.state.allocatedBy):[];
    if(at.name==='(module load)')tried=[`${at.file}::@module`];
    else {
      // A site in no declaration is module-level code, the module's.
      d=declarationOf(at);
      tried=d?anchorsOf(d,at.file):[`${at.file}::@module`];
    }
    const own=byClass.find(a=>owned(a))??tried.find(a=>owned(a))??byAllocator.find(a=>owned(a));
    const declaration=own??byClass[0]??tried[0]??byAllocator[0];
    if(!own)return {leaf:leaf.id,owner:null,declaration,gap:'no owned declaration'};
    const node=owned(declaration),owner=authored.topOf.get(node);
    const via=byClass.includes(declaration)?'instance class':!tried.includes(declaration)?'allocated by':at.name==='(module load)'||declaration===d?.anchor?'exact':'inherited';
    if(!owner)return {leaf:leaf.id,owner:null,declaration,ownerNode:node,via,gap:`owner ${node} is not under a map-0 node`};
    return {leaf:leaf.id,owner,declaration,ownerNode:node,via};
  });
}

// One arrow per related pair of boxes on a map, from the leaf arrows it draws.
const pairsOf=drawn=>pairArrowsOf(drawn.lifted.map(l=>l.link),leaf=>drawn.holder.get(leaf)).drawn.map(d=>[d.from,d.to]);
export const rateInfluence=(drawn,callers)=>scoreDrawn(drawn,callers,{pairsOf,...INFLUENCE});

// The starting tree for one authored node. Cold, its linked leaves flat (the default, which
// anneals lower), or grouped by source file (faster: about a third less time on core/path; the
// solver regroups freely). Warm, the node's last solve carried to its current leaves (`warm`,
// carry): its clusters and leaf homes, a cluster left with fewer than two boxes giving them to its
// parent. Leaves of other nodes that its leaves link to sit flat under their own fixed nodes, so a
// link leaving it lands on that node's box. A leaf with no arrow at all is set aside: no placement
// of it changes what any map says, so it is listed under its node as unlinked (dead code or an
// analysis gap), not drawn.
//
// Its uniform helpers (uniformLeaves), when there are at least two, start and stay in one fixed
// library cluster under it: the solver never moves them, and every map draws the library as one
// box with one arrow per consumer box.
function startTree(node,ownerOf,links,start,uniform=new Set(),warm=null) {
  const parent=new Map(),clusters=new Map([[node,{label:null}]]),fixed=new Set([node]);
  parent.set(node,TOP);
  const linked=new Set(links.flatMap(({from,to})=>[from,to]));
  const own=[...ownerOf].filter(([,o])=>o===node).map(([leaf])=>leaf).sort(order);
  const shared=own.filter(leaf=>linked.has(leaf)&&uniform.has(leaf)),library=shared.length>1?shared:[];
  const mine=own.filter(leaf=>linked.has(leaf)&&!library.includes(leaf)),unlinked=own.filter(leaf=>!linked.has(leaf));
  if(library.length){clusters.set(LIBRARY,{label:null});fixed.add(LIBRARY);parent.set(LIBRARY,node);for(const leaf of library)parent.set(leaf,LIBRARY);}
  if(warm) {
    const kept=[...warm.clusters].filter(([id])=>!clusters.has(id)&&id!==warm.library);
    for(const [id] of kept)clusters.set(id,{label:null});
    for(const [id,p] of kept)parent.set(id,clusters.has(p)&&!fixed.has(p)?p:node);
    for(const leaf of mine){const home=warm.homes.get(leaf);parent.set(leaf,clusters.has(home)&&!fixed.has(home)?home:node);}
    for(let thin=kept;thin.length;) {
      const boxes=new Map();for(const p of parent.values())boxes.set(p,(boxes.get(p)??0)+1);
      thin=[...clusters.keys()].filter(id=>!fixed.has(id)&&(boxes.get(id)??0)<2);
      for(const id of thin){const up=parent.get(id);for(const [x,p] of parent)if(p===id)parent.set(x,up);clusters.delete(id);parent.delete(id);}
    }
  }
  else {
    const byFile=new Map();
    for(const leaf of mine){const file=leaf.slice(0,leaf.indexOf(':'));(byFile.get(file)??byFile.set(file,[]).get(file)).push(leaf);}
    let next=1;
    for(const [,held] of byFile) {
      if(start!=='file'||held.length<2||byFile.size<2){for(const leaf of held)parent.set(leaf,node);continue;}
      const id=`c${next++}`;clusters.set(id,{label:null});parent.set(id,node);
      for(const leaf of held)parent.set(leaf,id);
    }
  }
  for(const {from,to} of links)for(const leaf of [from,to])if(!parent.has(leaf)) {
    const other=ownerOf.get(leaf)??UNOWNED;
    if(!clusters.has(other)){clusters.set(other,{label:null});fixed.add(other);parent.set(other,TOP);}
    parent.set(leaf,other);
  }
  return {tree:{parent,clusters,repeats:new Map()},fixed,leaves:mine,library,unlinked};
}
const LIBRARY='library';

// Uniform helpers (owner, 2026-10-04): a query several leaves call that reads no shared mutable
// state, directly or through the queries it calls, so it treats every caller the same way: its
// answer depends only on its arguments. The rule is a property of the leaf, never of its name. A
// leaf reads shared state when the analysis says so (a leaf's `readsState`); for a result that
// does not report it, a read of module-level bindings (an `initialises` arrow into it) counts as
// one, which may leave helpers reading only module constants out but never lets a stateful one in.
// Non-uniform leaves (commands, state readers) stay individually drawn with every arrow.
export function uniformLeaves(model) {
  const callers=new Map(),answersFrom=new Map(),reads=new Set();
  const add=(m,k,v)=>(m.get(k)??m.set(k,new Set()).get(k)).add(v);
  const reported=model.leaves.some(l=>l.readsState!==undefined);
  for(const a of model.arrows) {
    if(a.kind==='answer'){add(callers,a.from,a.to);add(answersFrom,a.to,a.from);}
    else if(a.kind==='initialises'&&!reported)reads.add(a.to);
  }
  const free=new Set(model.leaves.filter(l=>l.role==='query'&&!(reported?l.readsState:reads.has(l.id))).map(l=>l.id));
  for(let changed=true;changed;) {
    changed=false;
    for(const id of free)for(const from of answersFrom.get(id)??[])if(!free.has(from)){free.delete(id);changed=true;break;}
  }
  return new Set([...free].filter(id=>(callers.get(id)?.size??0)>1));
}

// A stage is at least this many moves (else as many as the region has nodes), and this many
// unchanged stages in a row end a solve.
export const STAGE_MOVES=0,PATIENCE=3;

// Solve one authored node. Returns its clusters (parent, label null) and leaf homes, ids local.
// `uniform` are the uniform helpers (uniformLeaves); this node's form its library cluster. Cold,
// it anneals from startTree's flat or by-file tree. Warm (`warm`: its last solve carried to its
// current leaves) it descends from that solve, taking only moves that lower the objective, so
// clusters change only where the objective gains.
export function solveNode(node,ownerOf,arrows,{seed=1,start='flat',maxStages=Infinity,stageMoves=STAGE_MOVES,patience=PATIENCE,onStage,uniform,warm=null}={}) {
  const clock=performance.now();
  const links=arrows.filter(a=>ownerOf.get(a.from)===node||ownerOf.get(a.to)===node);
  const {tree,fixed,leaves,library,unlinked}=startTree(node,ownerOf,links,start,uniform,warm);
  const shelf=library.length?{library:LIBRARY,libraryLeaves:library.length}:{library:null,libraryLeaves:0};
  if(leaves.length<2)return {node,leaves:leaves.length,unlinked,links:links.length,...shelf,warm:!!warm,
    clusters:new Map(library.length?[[LIBRARY,node]]:[]),homes:new Map([...leaves.map(l=>[l,node]),...library.map(l=>[l,LIBRARY])]),ms:0,stages:0,start:0,energy:0};
  let stages=0;
  const result=solveTree(tree,links,{seed,maxStages,stageMoves,patience,descend:!!warm,fixed,open:new Set([node]),repeats:false,score:rateInfluence,
    onStage:s=>{stages=s.stage+1;onStage?.(s);}});
  const inside=id=>{for(let p=id;p!==undefined;p=result.tree.parent.get(p))if(p===node)return true;return false;};
  const clusters=new Map([...result.tree.clusters.keys()].filter(id=>(!fixed.has(id)||id===LIBRARY)&&inside(id)).map(id=>[id,result.tree.parent.get(id)]));
  const homes=new Map([...leaves,...library].map(leaf=>[leaf,result.tree.parent.get(leaf)]));
  return {node,leaves:leaves.length,unlinked,links:links.length,...shelf,warm:!!warm,clusters,homes,ms:performance.now()-clock,stages,start:result.start,energy:result.energy};
}

// ---- one node's solve, kept by exactly what it reads --------------------------------------
// A node's slice is all solveNode reads of the model: its own leaves (sorted, as startTree takes
// them), its library leaves, and every leaf arrow touching its leaves, in model order, the far end
// of one leaving it collapsed to `outside:OWNER`. The solver cannot tell two outside leaves of one
// owner apart (both sit under that owner's fixed box, which no move enters), so the collapse
// changes nothing it does. `index` maps each slice arrow back to its model arrow.
const OUTSIDE='outside:';
export function nodeSlice(node,ownerOf,arrows,uniform) {
  const links=[],index=[];
  arrows.forEach((a,i)=>{
    const from=ownerOf.get(a.from)===node,to=ownerOf.get(a.to)===node;if(!from&&!to)return;
    const end=(leaf,mine)=>mine?leaf:OUTSIDE+(ownerOf.get(leaf)??UNOWNED);
    links.push({from:end(a.from,from),to:end(a.to,to),kind:a.kind});index.push(i);
  });
  const own=[...ownerOf].filter(([,o])=>o===node).map(([leaf])=>leaf).sort(order);
  const linked=new Set(links.flatMap(({from,to})=>[from,to])),shared=own.filter(leaf=>linked.has(leaf)&&uniform.has(leaf));
  return {node,own,library:shared.length>1?shared:[],links,index};
}

// The key a solve is kept by: the slice with each own leaf as its rank (its file and whether it is
// a library leaf kept), so an edit that only moves offsets without reordering them reuses the solve;
// the solve options; and the solver's code (these functions and the annealer and scorer modules).
let solverText=null;
const solverSource=()=>solverText??=[startTree,solveNode,carry,rateInfluence,pairsOf,pairArrowsOf].map(String).join('\n')
  +JSON.stringify({LIBRARY,UNOWNED,OUTSIDE,STAGE_MOVES,PATIENCE,SIZE,WEIGHT,INFLUENCE})
  +['dev-map/lib/solve.mjs','dev-map/lib/score.mjs','dev-map/lib/tree.mjs'].map(f=>readFileSync(resolve(repo,f),'utf8').replaceAll('\r\n','\n')).join('\n');
export function sliceHash(slice,{seed=1,start='flat',maxStages=Infinity}={}) {
  const rank=new Map(slice.own.map((leaf,i)=>[leaf,i])),library=new Set(slice.library),end=x=>rank.get(x)??x;
  return createHash('sha256').update(solverSource()).update(JSON.stringify({node:slice.node,seed,start,maxStages:String(maxStages),
    own:slice.own.map(leaf=>[leaf.slice(0,leaf.indexOf(':')),library.has(leaf)?1:0]),links:slice.links.map(a=>[end(a.from),end(a.to),a.kind])})).digest('hex');
}

// Solve a slice: outside ends sit under their owners' fixed boxes, as the full model's would.
// `warm`, the node's kept solve with the slice's leaf names ({entry, names}), starts it warm.
export function solveSlice(slice,{seed=1,start='flat',maxStages=Infinity,onStage,warm=null}={}) {
  const ownerOf=new Map(slice.own.map(leaf=>[leaf,slice.node]));
  for(const {from,to} of slice.links)for(const x of [from,to])if(x.startsWith(OUTSIDE)&&x!==OUTSIDE+UNOWNED)ownerOf.set(x,x.slice(OUTSIDE.length));
  const carried=warm&&carry(slice,warm.entry,warm.names);
  return solveNode(slice.node,ownerOf,slice.links,{seed,start,maxStages,uniform:new Set(slice.library),onStage,
    warm:carried&&{...carried,homes:new Map([...carried.homes].map(([r,c])=>[slice.own[r],c]))}});
}

// A kept solve (store/solve/NODE.json): clusters by solver id under the node, and leaf homes by
// the leaf's rank in `own`, so a later slice with the same key takes it over by rank.
export function sliceEntry(slice,s,{hash,names}) {
  const rank=new Map(slice.own.map((leaf,i)=>[leaf,i]));
  return {schema:2,node:slice.node,hash,generated:new Date().toISOString(),own:slice.own,names,library:s.library,
    clusters:[...s.clusters],homes:[...s.homes].map(([leaf,c])=>[rank.get(leaf),c]),
    summary:{node:s.node,leaves:s.leaves,library:s.libraryLeaves,unlinked:s.unlinked.length,arrows:s.links,clusters:s.clusters.size,
      start:s.warm?'warm':'cold',startEnergy:s.start,energy:s.energy,stages:s.stages,ms:Math.round(s.ms)}};
}
// A kept solve as assemble's `solved` entry for the slice it was kept for.
export const solvedOf=(entry,slice)=>({node:entry.node,library:entry.library,clusters:new Map(entry.clusters),
  homes:new Map(entry.homes.map(([r,c])=>[slice.own[r],c]))});

// The node's maps as the slice alone draws them (outside leaves one per owner), arrows as model
// indexes: what the assembled set must draw for this node.
export function sliceMaps(slice,solved) {
  const outside=[...new Set(slice.links.flatMap(({from,to})=>[from,to]).filter(x=>x.startsWith(OUTSIDE)))];
  const owners=[...slice.own.map(leaf=>({leaf,owner:slice.node})),
    ...outside.map(x=>({leaf:x,owner:x===OUTSIDE+UNOWNED?null:x.slice(OUTSIDE.length)}))];
  const nodes=[...new Set(owners.map(o=>o.owner).filter(Boolean))].map(id=>({id}));
  const {maps}=assemble({authored:{nodes},model:{leaves:owners.map(o=>({id:o.leaf})),arrows:slice.links},owners,solved:[solved]});
  return maps.filter(m=>m.id===slice.node||m.id.startsWith(slice.node+'/'))
    .map(m=>({...m,arrows:m.arrows.map(a=>({...a,leafArrows:a.leafArrows.map(i=>slice.index[i])}))}));
}

// A kept solve carried to a slice, for placing and for a warm solve's start. A leaf matched to one
// of its leaves (same file, name and order among same-named leaves there; line and offset may
// move) keeps its cluster; a library leaf goes to the library; any other leaf goes to the cluster
// holding most of its file's kept leaves, else under the node, and is `placed`. Emptied clusters
// go. Homes and placed leaves by rank.
const identities=(keys,names)=>{const seen=new Map();
  return keys.map((key,i)=>{const id=String(names?.[i]??key).replace(/^(.*?):\d+ /,'$1 '),n=seen.get(id)??0;seen.set(id,n+1);return `${id}\n${n}`;});};
function carry(slice,entry,names) {
  const was=new Map(identities(entry.own,entry.names).map((id,r)=>[id,r])),oldHome=new Map(entry.homes),oldPlaced=new Set(entry.placed??[]);
  const now=identities(slice.own,names),linked=new Set(slice.links.flatMap(({from,to})=>[from,to])),inLibrary=new Set(slice.library);
  const clusters=new Map(entry.clusters);let library=entry.library&&clusters.has(entry.library)?entry.library:null;
  const fileOf=leaf=>leaf.slice(0,leaf.indexOf(':')),homes=new Map(),placed=[],tally=new Map();
  slice.own.forEach((leaf,r)=>{
    if(!linked.has(leaf))return;
    if(library&&inLibrary.has(leaf)){homes.set(r,library);return;}
    const old=was.get(now[r]),home=old===undefined?undefined:oldHome.get(old);
    if(home===undefined||home===library)return;
    homes.set(r,home);if(oldPlaced.has(old))placed.push(r);
    const t=tally.get(fileOf(leaf))??tally.set(fileOf(leaf),new Map()).get(fileOf(leaf));t.set(home,(t.get(home)??0)+1);
  });
  slice.own.forEach((leaf,r)=>{
    if(!linked.has(leaf)||homes.has(r))return;
    const best=[...tally.get(fileOf(leaf))??[]].sort((a,b)=>b[1]-a[1]||order(a[0],b[0]))[0];
    homes.set(r,best?.[0]??slice.node);placed.push(r);
  });
  // Emptied clusters go, innermost first.
  for(let pruned=true;pruned;) {
    pruned=false;const used=new Set([...homes.values(),...clusters.values()]);
    for(const id of [...clusters.keys()])if(!used.has(id)){clusters.delete(id);pruned=true;}
  }
  if(library&&!clusters.has(library))library=null;
  return {clusters,library,homes,placed:placed.sort((a,b)=>a-b),linked};
}
// Placing without solving (map.json `"solve":"place"`): a changed node keeps its last solve's
// clusters (carry), its unmatched leaves marked placed (placement not solved) until it is next
// solved.
export function placeSlice(slice,entry,{hash,names}) {
  const {clusters,library,homes,placed,linked}=carry(slice,entry,names);
  const leaves=[...homes.values()].filter(h=>h!==library).length;
  return {...entry,hash,own:slice.own,names,library,clusters:[...clusters],homes:[...homes],placement:'not solved',placed,
    summary:{...entry.summary,leaves,library:homes.size-leaves,unlinked:slice.own.filter(l=>!linked.has(l)).length,arrows:slice.links.length,
      clusters:clusters.size,placement:'not solved',placedLeaves:placed.length}};
}

// A kept solve from before solves were kept by slice (schema 1: a whole `--out` result), as a
// kept solve keyed by the slice it was made from; regenerate reuses it when that key is current.
export function legacyEntry(j,node,{seed=1,start='flat',maxStages=Infinity}={}) {
  const same=j.seed===seed&&j.start===start&&maxStages===Infinity&&JSON.stringify([j.objective?.size,j.objective?.weight,j.objective?.backflow])===JSON.stringify([SIZE,WEIGHT,INFLUENCE.backflow]);
  const s=j.summary?.solved?.find(x=>x.node===node);
  if(!same||!s||!Array.isArray(j.leaves)||!Array.isArray(j.arrows)||!Array.isArray(j.clusters))return null;
  const under=j.clusters.filter(c=>c.id===node||c.id.startsWith(node+'/')),lib=under.find(c=>c.library);
  const slice=nodeSlice(node,new Map(j.leaves.filter(l=>l.owner).map(l=>[l.id,l.owner])),j.arrows,new Set(lib?.leaves??[]));
  const rank=new Map(slice.own.map((leaf,i)=>[leaf,i])),nameOf=new Map(j.leaves.map(l=>[l.id,l.name]));
  return {schema:2,node,hash:sliceHash(slice,{seed,start,maxStages}),generated:j.generated,own:slice.own,names:slice.own.map(l=>nameOf.get(l)),
    library:lib?.id??null,clusters:under.filter(c=>c.id!==node).map(c=>[c.id,c.parent]),
    homes:under.flatMap(c=>c.leaves.map(leaf=>[rank.get(leaf),c.id])),summary:s,legacy:true};
}

// The whole tree for a viewer: map 0 draws the authored nodes; each solved node nests its
// clusters down to leaves; an unsolved node holds its leaves flat; leaves with no arrow are listed
// under their node as unlinked and drawn nowhere. Clusters are numbered in
// depth-first order under their node (`toolpath/3`). Every map lists its members, its boundary
// boxes and one arrow per related pair with its ends and the leaf arrows it stands for.
export function assemble({authored,model,owners,solved}) {
  const ownerOf=new Map(owners.filter(o=>o.owner).map(o=>[o.leaf,o.owner]));
  const parent=new Map(),clusters=new Map(),rename=new Map();
  const nodes=[...authored.nodes.map(n=>n.id),...(owners.some(o=>!o.owner)?[UNOWNED]:[])];
  for(const id of nodes){clusters.set(id,{label:null});parent.set(id,TOP);}
  const linked=new Set(model.arrows.flatMap(({from,to})=>[from,to])),unlinked=new Map();
  for(const leaf of model.leaves) {
    const node=ownerOf.get(leaf.id)??UNOWNED;
    if(linked.has(leaf.id))parent.set(leaf.id,node);else (unlinked.get(node)??unlinked.set(node,[]).get(node)).push(leaf.id);
  }
  for(const s of solved) {
    const kids=new Map();
    for(const [id,p] of s.clusters)(kids.get(p)??kids.set(p,[]).get(p)).push(id);
    let n=0;const walk=p=>{for(const id of (kids.get(p)??[]).sort(order)){rename.set(id+'\n'+s.node,`${s.node}/${++n}`);walk(id);}};walk(s.node);
    const name=id=>id===s.node?id:rename.get(id+'\n'+s.node);
    for(const [id,p] of s.clusters){clusters.set(name(id),{label:null,...(id===s.library?{library:true}:{})});parent.set(name(id),name(p));}
    for(const [leaf,p] of s.homes)parent.set(leaf,name(p));
  }
  const tree={parent,clusters,repeats:new Map()},access=treeAccess(tree);
  const set=linkSet(model.arrows),index=new Map(model.arrows.map((a,i)=>[a,i]));
  const maps=[TOP,...clusters.keys()].map(map=>{
    const drawn=drawMap(map,access,set),boxOf=new Map(drawn.holder);
    for(const c of drawn.crossing)boxOf.set(c.outside,`boundary:${c.boundary}`);
    const touching=[...drawn.lifted.map(l=>l.link),...drawn.crossing.map(c=>c.link)];
    const {drawn:pairs}=pairArrowsOf(touching,leaf=>boxOf.get(leaf));
    const rated=map===TOP?null:rateInfluence(drawn,new Map());
    return {id:map,members:drawn.members,nested:drawn.nested.size,
      boundary:[...new Set(drawn.crossing.map(c=>c.boundary))].sort(order),
      arrows:pairs.map(p=>({from:p.from,to:p.to,ends:p.ends,leafArrows:p.arrows.map(a=>index.get(a))})),
      ...(rated?{weight:weightOf(drawn.nested.size),score:rated.score,badness:rated.badness}:{})};
  });
  const solvedIds=new Set(solved.map(s=>s.node));
  return {
    clusters:[...clusters.keys()].map(id=>({id,parent:parent.get(id),
      authored:authored.nodes.some(n=>n.id===id),solved:solvedIds.has(id)||undefined,
      label:authored.nodes.find(n=>n.id===id)?.label??null,...(clusters.get(id).library?{library:true}:{}),
      leaves:access.childrenOf(id).filter(c=>!clusters.has(c)).sort(order),
      ...(unlinked.has(id)?{unlinked:unlinked.get(id).sort(order)}:{})})),
    maps};
}

const argv=process.argv.slice(2);
const option=name=>{const at=argv.indexOf(name);return at<0?undefined:argv[at+1];};
const options=name=>{const found=[];argv.forEach((a,i)=>{if(a===name)found.push(argv[i+1]);});return found;};
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&option('--slice')) {
  const {slice,options:o,hash,names,warm}=JSON.parse(readFileSync(option('--slice'),'utf8'));
  const s=solveSlice(slice,{...o,maxStages:o.maxStages??Infinity,warm:warm&&{entry:warm,names},
    onStage:x=>{if(x.stage%25===0)process.stderr.write(`${slice.node} stage ${x.stage} energy ${x.energy.toFixed(4)} best ${x.best.toFixed(4)}\n`);}});
  writeFileSync(option('--out'),JSON.stringify(sliceEntry(slice,s,{hash,names})));
}
else if(main) {
  const input=option('--in'),all=argv.includes('--all'),picked=options('--node');
  if(!input||!all&&!picked.length)throw Error('Use: node dev-map/influence/solve-middle.mjs --in ANALYSIS.json (--node ID... | --all) [--authored DIR] [--seed N] [--start flat|file] [--max-stages N] [--out FILE]');
  const clock=performance.now();
  const authored=readAuthored(resolve(repo,option('--authored')??'dev-map/sets/030-architecture'));
  const analysis=JSON.parse(readFileSync(input,'utf8'));
  const model0=leafModel(analysis,{actors:authored.actors});
  const t1=performance.now();
  const {texts,changed:sourceChanged}=analysedTexts(model0.leaves,{roots:[repo,...options('--source-root').map(r=>resolve(r))]});
  const {model,owners}=boundaryFileStores(model0,await ownLeaves(model0.leaves,authored,{texts}),{nodes:authored.nodes});
  const t2=performance.now();
  const ownerOf=new Map(owners.filter(o=>o.owner).map(o=>[o.leaf,o.owner]));
  const known=new Set(authored.nodes.map(n=>n.id));
  for(const id of picked)if(!known.has(id))throw Error(`Not a map-0 node: ${id}. Nodes: ${[...known].join(', ')}`);
  const targets=all?authored.nodes.map(n=>n.id):picked;
  const seed=Number(option('--seed')??1),start=option('--start')??'flat',maxStages=Number(option('--max-stages')??Infinity);
  const solved=[],uniform=uniformLeaves(model);
  for(const node of targets) {
    const s=solveNode(node,ownerOf,model.arrows,{seed,start,maxStages,uniform,
      onStage:x=>{if(x.stage%25===0)process.stderr.write(`${node} stage ${x.stage} energy ${x.energy.toFixed(4)} best ${x.best.toFixed(4)} T ${x.temperature.toExponential(2)} changed ${x.changed}\n`);}});
    solved.push(s);
    process.stderr.write(`${node}: ${s.leaves} leaves (${s.libraryLeaves} more in its library, ${s.unlinked.length} unlinked set aside), ${s.links} arrows, ${s.clusters.size} clusters, energy ${s.start.toFixed(4)} -> ${s.energy.toFixed(4)}, ${s.stages} stages, ${Math.round(s.ms)} ms\n`);
  }
  const t3=performance.now();
  const {clusters,maps}=assemble({authored,model,owners,solved});
  const t4=performance.now();
  const gaps=owners.filter(o=>!o.owner);
  const count=(list,key)=>{const c={};for(const x of list){const k=key(x);c[k]=(c[k]??0)+1;}return c;};
  const summary={leaves:model.leaves.length,arrows:model.arrows.length,mergedLeaves:model.merged,sharedNames:model.sharedNames,sourceChanged,
    owned:count(owners.filter(o=>o.owner),o=>o.owner),ownedVia:count(owners.filter(o=>o.owner),o=>o.via),
    unowned:count(gaps,o=>o.gap),
    uniform:uniform.size,
    solved:solved.map(s=>({node:s.node,leaves:s.leaves,library:s.libraryLeaves,unlinked:s.unlinked.length,arrows:s.links,clusters:s.clusters.size,startEnergy:s.start,energy:s.energy,stages:s.stages,ms:Math.round(s.ms)})),
    timingsMs:{read:Math.round(t1-clock),ownership:Math.round(t2-t1),solve:Math.round(t3-t2),assemble:Math.round(t4-t3),total:Math.round(t4-clock)}};
  console.log(JSON.stringify(summary,null,1));
  const out=option('--out'),ownerRow=new Map(owners.map(o=>[o.leaf,o])),labels=out?leafLabels(model.leaves,{texts}):null;
  if(out)writeFileSync(out,JSON.stringify({schema:1,generated:new Date().toISOString(),input,seed,start,
    objective:{size:SIZE,weight:WEIGHT,...INFLUENCE,pairs:'one per related pair (pairArrowsOf)'},
    authored:authored.nodes,summary,
    leaves:model.leaves.map(l=>{const o=ownerRow.get(l.id);return {id:l.id,name:l.name,label:labels.get(l.id),role:l.role,folded:l.folded,foldedNames:l.foldedNames,owner:o?.owner??null,declaration:o?.declaration??null,via:o?.via,gap:o?.gap};}),
    arrows:model.arrows,clusters,maps,unowned:gaps},null,1));
}
