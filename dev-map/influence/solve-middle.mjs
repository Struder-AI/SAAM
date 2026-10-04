// The middle-out solver (plans/dev-maps.md#levels). The authored top-level nodes are fixed above
// and the computed leaves below; the solver groups each authored node's leaves into nested
// clusters and never moves a leaf across an authored boundary. Its objective is the map scorer's
// (lib/score.mjs: size, edge, hub, island and balance, no backflow) over one arrow per related
// pair of boxes (pairArrowsOf), annealed by lib/solve.mjs under the authored nodes. Higher-level
// arrows are derived only from leaf arrows. Labels come from label passes, never from here.
//
// Use (full solves run only when the owner asks):
//   node dev-map/influence/solve-middle.mjs --in ANALYSIS.json (--node ID... | --all)
//     [--authored DIR] [--seed N] [--start flat|file] [--max-stages N] [--out FILE]
// ANALYSIS.json is what `run.mjs --out` writes: `leaves` (each callable a leaf holds) and
// `arrows` (from, to, kind, count) between callables. DIR holds the authored set's
// architecture.json (nodes) and ownership.json (declaration owners); default 030-architecture.
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TOP,drawMap,linkSet,treeAccess} from '../lib/tree.mjs';
import {solveTree} from '../lib/solve.mjs';
import {scoreDrawn,INFLUENCE,SIZE,WEIGHT,weightOf} from '../lib/score.mjs';
import {pairArrowsOf} from './derive.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const UNOWNED='(unowned)';
const order=(a,b)=>a<b?-1:a>b?1:0;

// Leaves and the arrows between them from an analysis result. A callable is named
// `file:line name`; a leaf holds its own callable and those folded into it. Names are the only
// identity the result gives, so callables sharing one name are one leaf (counted in `merged`).
export function leafModel(analysis) {
  const leafOf=new Map(),leaves=new Map();
  let merged=0;
  for(const {leaf,role,folded=[]} of analysis.leaves) {
    if(leaves.has(leaf)){merged++;continue;}
    leaves.set(leaf,{id:leaf,role,folded});
    leafOf.set(leaf,leaf);
  }
  for(const {id,folded} of leaves.values())for(const f of folded){if(leafOf.has(f)){if(leafOf.get(f)!==id)merged++;continue;}leafOf.set(f,id);}
  const arrows=new Map(),missing=new Set();
  for(const a of analysis.arrows) {
    const from=leafOf.get(a.from),to=leafOf.get(a.to);
    if(from===undefined||to===undefined){missing.add(from===undefined?a.from:a.to);continue;}
    if(from===to)continue;
    const key=`${from}\n${to}\n${a.kind}`,held=arrows.get(key);
    if(held)held.count+=a.count??1;else arrows.set(key,{from,to,kind:a.kind,count:a.count??1});
  }
  return {leaves:[...leaves.values()],arrows:[...arrows.values()],merged,unknownEnds:[...missing].sort(order)};
}

// The authored top level: map-0 nodes, and every authored node's map-0 node by its index.
export function readAuthored(dir) {
  const architecture=JSON.parse(readFileSync(resolve(dir,'architecture.json'),'utf8'));
  const ownership=JSON.parse(readFileSync(resolve(dir,'ownership.json'),'utf8'));
  const top=architecture.nodes.filter(n=>!String(n.index).includes('.'));
  const byIndex=new Map(top.map(n=>[String(n.index),n.id]));
  const topOf=new Map(architecture.nodes.map(n=>[n.id,byIndex.get(String(n.index).split('.')[0])]));
  return {nodes:top.map(n=>({id:n.id,index:String(n.index),label:n.label})).sort((a,b)=>Number(a.index)-Number(b.index)),
    topOf,owners:ownership.leaves??{}};
}

// Each leaf's map-0 owner. A leaf's callable is found among the declarations at its line
// (lib/graph.mjs anchors, the names ownership.json uses); its owner is the first owned anchor on
// its declaration and the declarations around it, nearest first (an anonymous body inherits its
// nearest stable declaration), else the module's for module-level code. A leaf with no owned
// declaration, or whose owner is not under a map-0 node, is reported, not guessed.
export async function ownLeaves(leaves,authored,{root=repo}={}) {
  const {extractGraph}=await import('../lib/graph.mjs');
  const parse=id=>{const m=/^(.*?):(\d+) (.*)$/.exec(id);return m?{file:m[1],line:Number(m[2]),name:m[3]}:null;};
  const files=[...new Set(leaves.map(l=>parse(l.id)?.file).filter(Boolean))].sort(order);
  const graph=await extractGraph({repo:root,files});
  const byId=new Map(graph.declarations.map(d=>[d.id,d])),atLine=new Map();
  for(const d of graph.declarations){const key=`${d.file}:${d.line}`;(atLine.get(key)??atLine.set(key,[]).get(key)).push(d);}
  const owned=anchor=>authored.owners[anchor]?.owner;
  const prefixes=anchor=>{const found=[];for(let a=anchor;a.includes('::');a=a.slice(0,a.lastIndexOf('::')))found.push(a);return found;};
  const declarationOf=({file,line,name})=>{
    const here=(atLine.get(`${file}:${line}`)??[]);
    if(name==='(anonymous)')return here.find(d=>d.kind!=='variable'&&!d.anchor)??here.find(d=>d.kind!=='variable')??here[0];
    const want=name.split('.').pop().replace(/^#/,'');
    return here.find(d=>d.kind!=='variable'&&d.name===want)??here.find(d=>d.name===want)??here.find(d=>d.kind==='class')
      ??here.find(d=>d.name==='constructor')??here.find(d=>d.kind!=='variable');
  };
  return leaves.map(leaf=>{
    const at=parse(leaf.id);
    if(!at)return {leaf:leaf.id,owner:null,gap:'unparsed leaf name'};
    let tried=[],d=null;
    if(at.name==='(module load)')tried=[`${at.file}::@module`];
    else {
      d=declarationOf(at);
      if(!d)return {leaf:leaf.id,owner:null,gap:'no declaration at its line'};
      for(let x=d;x;x=x.parent?byId.get(x.parent):null)if(x.anchor)tried.push(...prefixes(x.anchor));
      tried=[...new Set(tried)];
      if(!tried.length)tried=[`${at.file}::@module`];
    }
    const declaration=tried.find(a=>owned(a));
    if(!declaration)return {leaf:leaf.id,owner:null,declaration:tried[0],gap:'no owned declaration'};
    const node=owned(declaration),owner=authored.topOf.get(node);
    const via=at.name==='(module load)'||declaration===d?.anchor?'exact':'inherited';
    if(!owner)return {leaf:leaf.id,owner:null,declaration,ownerNode:node,via,gap:`owner ${node} is not under a map-0 node`};
    return {leaf:leaf.id,owner,declaration,ownerNode:node,via};
  });
}

// One arrow per related pair of boxes on a map, from the leaf arrows it draws.
const pairsOf=drawn=>pairArrowsOf(drawn.lifted.map(l=>l.link),leaf=>drawn.holder.get(leaf)).drawn.map(d=>[d.from,d.to]);
export const rateInfluence=(drawn,callers)=>scoreDrawn(drawn,callers,{pairsOf,...INFLUENCE});

// The starting tree for one authored node: its linked leaves flat (the default, which anneals
// lower), or grouped by source file (faster: about a third less time on core/path; a
// warm start only; the solver regroups freely). Leaves of other nodes that its leaves link to sit
// flat under their own fixed nodes, so a link leaving it lands on that node's box. A leaf with no
// arrow at all is set aside: no placement of it changes what any map says, so it is listed under
// its node as unlinked (dead code or an analysis gap), not drawn.
function startTree(node,ownerOf,links,start) {
  const parent=new Map(),clusters=new Map([[node,{label:null}]]),fixed=new Set([node]);
  parent.set(node,TOP);
  const linked=new Set(links.flatMap(({from,to})=>[from,to]));
  const own=[...ownerOf].filter(([,o])=>o===node).map(([leaf])=>leaf).sort(order);
  const mine=own.filter(leaf=>linked.has(leaf)),unlinked=own.filter(leaf=>!linked.has(leaf));
  const byFile=new Map();
  for(const leaf of mine){const file=leaf.slice(0,leaf.indexOf(':'));(byFile.get(file)??byFile.set(file,[]).get(file)).push(leaf);}
  let next=1;
  for(const [,held] of byFile) {
    if(start!=='file'||held.length<2||byFile.size<2){for(const leaf of held)parent.set(leaf,node);continue;}
    const id=`c${next++}`;clusters.set(id,{label:null});parent.set(id,node);
    for(const leaf of held)parent.set(leaf,id);
  }
  for(const {from,to} of links)for(const leaf of [from,to])if(!parent.has(leaf)) {
    const other=ownerOf.get(leaf)??UNOWNED;
    if(!clusters.has(other)){clusters.set(other,{label:null});fixed.add(other);parent.set(other,TOP);}
    parent.set(leaf,other);
  }
  return {tree:{parent,clusters,repeats:new Map()},fixed,leaves:mine,unlinked};
}

// A stage is at least this many moves (else as many as the region has nodes), and this many
// unchanged stages in a row end a solve.
export const STAGE_MOVES=0,PATIENCE=3;

// Solve one authored node. Returns its clusters (parent, label null) and leaf homes, ids local.
export function solveNode(node,ownerOf,arrows,{seed=1,start='flat',maxStages=Infinity,stageMoves=STAGE_MOVES,patience=PATIENCE,onStage}={}) {
  const clock=performance.now();
  const links=arrows.filter(a=>ownerOf.get(a.from)===node||ownerOf.get(a.to)===node);
  const {tree,fixed,leaves,unlinked}=startTree(node,ownerOf,links,start);
  if(leaves.length<2)return {node,leaves:leaves.length,unlinked,links:links.length,clusters:new Map(),homes:new Map(leaves.map(l=>[l,node])),ms:0,stages:0,start:0,energy:0};
  let stages=0;
  const result=solveTree(tree,links,{seed,maxStages,stageMoves,patience,fixed,open:new Set([node]),repeats:false,score:rateInfluence,
    onStage:s=>{stages=s.stage+1;onStage?.(s);}});
  const inside=id=>{for(let p=id;p!==undefined;p=result.tree.parent.get(p))if(p===node)return true;return false;};
  const clusters=new Map([...result.tree.clusters.keys()].filter(id=>!fixed.has(id)&&inside(id)).map(id=>[id,result.tree.parent.get(id)]));
  const homes=new Map(leaves.map(leaf=>[leaf,result.tree.parent.get(leaf)]));
  return {node,leaves:leaves.length,unlinked,links:links.length,clusters,homes,ms:performance.now()-clock,stages,start:result.start,energy:result.energy};
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
    for(const [id,p] of s.clusters){clusters.set(name(id),{label:null});parent.set(name(id),name(p));}
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
      label:authored.nodes.find(n=>n.id===id)?.label??null,
      leaves:access.childrenOf(id).filter(c=>!clusters.has(c)).sort(order),
      ...(unlinked.has(id)?{unlinked:unlinked.get(id).sort(order)}:{})})),
    maps};
}

const argv=process.argv.slice(2);
const option=name=>{const at=argv.indexOf(name);return at<0?undefined:argv[at+1];};
const options=name=>{const found=[];argv.forEach((a,i)=>{if(a===name)found.push(argv[i+1]);});return found;};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const input=option('--in'),all=argv.includes('--all'),picked=options('--node');
  if(!input||!all&&!picked.length)throw Error('Use: node dev-map/influence/solve-middle.mjs --in ANALYSIS.json (--node ID... | --all) [--authored DIR] [--seed N] [--start flat|file] [--max-stages N] [--out FILE]');
  const clock=performance.now();
  const authored=readAuthored(resolve(repo,option('--authored')??'dev-map/sets/030-architecture'));
  const analysis=JSON.parse(readFileSync(input,'utf8'));
  const model=leafModel(analysis);
  const t1=performance.now();
  const owners=await ownLeaves(model.leaves,authored);
  const t2=performance.now();
  const ownerOf=new Map(owners.filter(o=>o.owner).map(o=>[o.leaf,o.owner]));
  const known=new Set(authored.nodes.map(n=>n.id));
  for(const id of picked)if(!known.has(id))throw Error(`Not a map-0 node: ${id}. Nodes: ${[...known].join(', ')}`);
  const targets=all?authored.nodes.map(n=>n.id):picked;
  const seed=Number(option('--seed')??1),start=option('--start')??'flat',maxStages=Number(option('--max-stages')??Infinity);
  const solved=[];
  for(const node of targets) {
    const s=solveNode(node,ownerOf,model.arrows,{seed,start,maxStages,
      onStage:x=>{if(x.stage%25===0)process.stderr.write(`${node} stage ${x.stage} energy ${x.energy.toFixed(4)} best ${x.best.toFixed(4)} T ${x.temperature.toExponential(2)} changed ${x.changed}\n`);}});
    solved.push(s);
    process.stderr.write(`${node}: ${s.leaves} leaves (${s.unlinked.length} unlinked set aside), ${s.links} arrows, ${s.clusters.size} clusters, energy ${s.start.toFixed(4)} -> ${s.energy.toFixed(4)}, ${s.stages} stages, ${Math.round(s.ms)} ms\n`);
  }
  const t3=performance.now();
  const {clusters,maps}=assemble({authored,model,owners,solved});
  const t4=performance.now();
  const gaps=owners.filter(o=>!o.owner);
  const count=(list,key)=>{const c={};for(const x of list){const k=key(x);c[k]=(c[k]??0)+1;}return c;};
  const summary={leaves:model.leaves.length,arrows:model.arrows.length,mergedNames:model.merged,
    owned:count(owners.filter(o=>o.owner),o=>o.owner),ownedVia:count(owners.filter(o=>o.owner),o=>o.via),
    unowned:count(gaps,o=>o.gap),
    solved:solved.map(s=>({node:s.node,leaves:s.leaves,unlinked:s.unlinked.length,arrows:s.links,clusters:s.clusters.size,startEnergy:s.start,energy:s.energy,stages:s.stages,ms:Math.round(s.ms)})),
    timingsMs:{read:Math.round(t1-clock),ownership:Math.round(t2-t1),solve:Math.round(t3-t2),assemble:Math.round(t4-t3),total:Math.round(t4-clock)}};
  console.log(JSON.stringify(summary,null,1));
  const out=option('--out'),ownerRow=new Map(owners.map(o=>[o.leaf,o]));
  if(out)writeFileSync(out,JSON.stringify({schema:1,generated:new Date().toISOString(),input,seed,start,
    objective:{size:SIZE,weight:WEIGHT,...INFLUENCE,pairs:'one per related pair (pairArrowsOf)'},
    authored:authored.nodes,summary,
    leaves:model.leaves.map(l=>{const o=ownerRow.get(l.id);return {id:l.id,role:l.role,folded:l.folded,owner:o?.owner??null,declaration:o?.declaration??null,via:o?.via,gap:o?.gap};}),
    arrows:model.arrows,clusters,maps,unowned:gaps},null,1));
}
