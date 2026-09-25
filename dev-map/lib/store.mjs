// The stored map. AST scanning and link resolution happen only during explicit generation.
// Reads use stored relationships, enumerate/hash inputs for freshness, and return source at code
// destinations. Each retained file record keeps the hash of the source that produced its pages.
import {readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFlow,flowPacket} from './flow.mjs';
import {model,numberNodes} from './leaves.mjs';
import {readFacts,bindFacts} from './facts.mjs';
import {sourceFiles} from './graph.mjs';
import {scanRoots,outsideRootOf,isMapped,activeCallers} from './scope.mjs';
import {attachPortReferences} from './port-references.mjs';
import {TOP,treeFile,readTreeFile,placeTree,treeAccess,drawMap,numberTree,linkSet,treeFileOf,renumber,markRepeats} from './tree.mjs';
import {destinationFor} from './destination.mjs';
import {mapFindings} from './findings.mjs';
export {destinationFor} from './destination.mjs';

export const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
export const storeDir=repo=>resolve(repo,'dev-map/store');
const slug=f=>f.replace(/[^A-Za-z0-9]+/g,'_');
const sha=t=>createHash('sha256').update(t).digest('hex');
const order=(a,b)=>a<b?-1:a>b?1:0;
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const write=(path,value)=>writeFile(path,JSON.stringify(value,null,1)+'\n');
const byIndex=(a,b)=>{
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??-1)!==(y[i]??-1))return (x[i]??-1)-(y[i]??-1);
  return 0;
};

// ---- generation -------------------------------------------------------------------------
export async function generate({repo=repoRoot,readSource,files}={}) {
  const timings={},clock=async(key,run)=>{const t=Date.now();const out=await run();timings[key]=Date.now()-t;return out;};
  const generationInputs=await inputHashes(repo);
  const context=await clock('load',()=>loadFlow({repo,...(readSource?{readSource}:{}),...(files?{files}:{})}));
  Object.assign(timings,context.timings);
  const {graph,projection}=context;
  const dir=storeDir(repo);
  const m=model(graph,projection);

  // Internal identities: one number per declaration, then one per cluster. Published indexes
  // are the tree's, given below.
  const index=numberNodes(m);
  for(const n of projection.nodes.values())if(index.has(n.path))n.handle=index.get(n.path);

  const packets=new Map();
  await clock('pages',async()=>{for(const n of m.nodes)packets.set(n.path,flowPacket(context,n.path));});

  // A stored component names its node by file and label; its index is read back from the map so
  // a renumbered declaration is followed everywhere it is referenced.
  for(const packet of packets.values()) {
    packet.index=index.get(packet.path)??packet.index;
    for(const c of packet.components)c.index=index.get(`${c.file}::${c.label}`)??c.index;
    for(const f of packet.formulas)f.index=index.get(`${f.file}::${f.label}`)??f.index;
    for(const s of packet.state??[])s.ownerIndex=index.get(s.owner)??s.ownerIndex;
    for(const r of packet.requires)r.index=index.get(r.by)??r.index;
  }
  // Incoming calls invert actual call components. Class membership and closure containment
  // alone are not calls; treating them as callers invents execution relationships.
  const from=new Map();
  for(const packet of packets.values())for(const c of packet.components) {
    if(c.calls===0)continue;
    const list=from.get(`${c.file}::${c.label}`)??from.set(`${c.file}::${c.label}`,[]).get(`${c.file}::${c.label}`);
    const labels=[...new Set(packet.wires.filter(w=>w.to===c.index&&w.label).map(w=>w.label))].sort(order);
    list.push({index:packet.index,...(labels.length?{labels}:{})});
  }
  // A callable passed into a parameter is invoked by the page that names it as a parameter
  // target, though that page draws no box for it. The relationship is a caller either way.
  for(const packet of packets.values())for(const port of packet.inputs??[])for(const row of port.parameterTargets??[]) {
    const list=from.get(row.path)??from.set(row.path,[]).get(row.path);
    if(!list.some(entry=>entry.index===packet.index))list.push({index:packet.index,labels:[port.name]});
  }
  // Calls into mapped code from source the map does not cover. An active caller — code that runs
  // while a person makes a part or operates Studio — becomes a row on the callee's page carrying
  // its own declaration path; every other outside caller is one count per caller directory, so
  // the page still says how much test, demo and benchmark code depends on it.
  const outsideFrom=new Map();
  for(const c of m.calls) {
    if(c.from||!c.fromFile||isMapped(c.fromFile))continue;
    const list=outsideFrom.get(c.to.path)??outsideFrom.set(c.to.path,[]).get(c.to.path);
    const path=c.fromPath??c.fromFile;
    if(!list.some(row=>row.path===path))list.push({path,file:c.fromFile});
  }
  const coupled=new Map();
  for(const c of m.couplings) {
    const add=(node,other,direction)=>{
      if(!node)return;
      const list=coupled.get(node.path)??coupled.set(node.path,[]).get(node.path);
      const entry={kind:c.kind,direction,...(c.label?{label:c.label}:{}),
        ...(other?{index:index.get(other.path)??null,path:other.path}:{file:c[direction==='out'?'toFile':'fromFile']})};
      if(!list.some(x=>JSON.stringify(x)===JSON.stringify(entry)))list.push(entry);
    };
    add(c.from,c.to,'out');add(c.to,c.from,'in');
  }
  const dirOf=file=>file.slice(0,file.lastIndexOf('/'));
  for(const packet of packets.values()) {
    packet.calledFrom=(from.get(packet.path)??[]).sort((a,b)=>byIndex(a.index,b.index));
    const active=[],counted={};
    for(const row of outsideFrom.get(packet.path)??[]) {
      if(activeCallers(row.file))active.push({path:row.path,file:row.file,unmapped:true});
      else counted[dirOf(row.file)]=(counted[dirOf(row.file)]??0)+1;
    }
    if(active.length)packet.outsideCallerReferences=active.sort((a,b)=>order(a.path,b.path));
    else delete packet.outsideCallerReferences;
    if(Object.keys(counted).length)packet.outsideCallers=Object.fromEntries(Object.entries(counted).sort(([a],[b])=>order(a,b)));
    else delete packet.outsideCallers;
    packet.couplings=coupled.get(packet.path)??[];
  }

  attachPortReferences(packets,index);

  // The leaves, the links between them, and the tree the solver authored, placed in full.
  const leafOf=m.leafOf,leafPaths=new Set(leafOf.values());
  const pathAt=new Map([...index].map(([path,at])=>[at,path]));
  const links=leafLinks(packets,leafOf,pathAt);
  const tree=placeTree(await readTreeFile(repo),leafPaths,links);
  const access=treeAccess(tree),set=linkSet(links);
  const treeIndex=numberTree(tree,set);
  const clusterAt=new Map([...tree.clusters.keys()].map((id,i)=>[id,String(index.size+i+1)]));
  const at=id=>id===TOP?TOP:clusterAt.get(id)??index.get(id);

  // External facts. A row names a declaration this scan holds; anything else is an orphan,
  // carried in the store so a read and `check` both report it.
  const facts=await readFacts({repo});
  const {byTarget,orphans}=bindFacts(facts.rows,new Set(packets.keys()));

  // A leaf opens as its declaration's code, and a declaration folded into it adds its findings
  // and facts there, each row naming the declaration it is about.
  const leafPages=new Map();
  for(const path of [...leafPaths].sort(order)) {
    const page=packets.get(path);
    const held=byTarget.get(path);
    if(held)page.facts=held;else delete page.facts;
    leafPages.set(path,page);
  }
  for(const [path,leaf] of [...leafOf].sort(([a],[b])=>order(a,b))) {
    if(path===leaf)continue;
    const page=leafPages.get(leaf),inner=packets.get(path);
    (page.folded??=[]).push(path);
    page.calledFrom.push(...inner.calledFrom);
    for(const field of ['uncertainty','unresolved'])for(const row of inner[field]??[])(page[field]??=[]).push({...row,declaration:path});
    for(const fact of byTarget.get(path)??[])(page.facts??=[]).push({...fact,declaration:path});
  }
  // A leaf's callers are other leaves: its own code calling itself is no caller, and several
  // declarations of one calling leaf are that leaf once.
  for(const [path,page] of leafPages) {
    const callers=new Map();
    for(const ref of page.calledFrom) {
      const caller=leafOf.get(pathAt.get(ref.index));
      if(caller===path)continue;
      const at=index.get(caller)??ref.index,held=callers.get(at);
      if(held)held.labels=[...new Set([...held.labels??[],...ref.labels??[]])].sort(order);
      else callers.set(at,{...ref,index:at});
    }
    page.calledFrom=[...callers.values()].sort((a,b)=>byIndex(a.index,b.index));
  }

  // The top map and every cluster draw their homes and repeats and the links between them.
  const shared={m,tree,access,set,at,packets,leafOf,treeIndex};
  const root=containmentPage(TOP,shared);
  const groupPages=new Map([...tree.clusters.keys()].map(id=>[id,containmentPage(id,shared)]));
  const destinations=new Map([root,...leafPages.values(),...groupPages.values()].map(page=>[page.index,page]));
  for(const page of destinations.values()) {
    page.destination=destinationFor(page);
    if(page.destination==='code'){page.leaf=true;page.sourceSpan={file:page.file,line:page.line,endLine:page.endLine};}
  }
  for(const page of destinations.values()) {
    const owner=packets.get(page.owner)?.index??page.index;
    const shown=new Map();
    for(const component of page.components??[]) {
      shown.set(component.index,component.index);
      for(const member of component.members??[]) {
        const at=index.get(member);if(at)shown.set(at,component.index);
      }
    }
    const describe=ref=>{
      const caller=destinations.get(ref.index);
      return {...ref,...(caller?.path?{path:caller.path}:caller?.file?{file:caller.file}:{})};
    };
    const callerWires=[];
    const connect=(caller,callee,to)=>{
      const source=shown.get(caller);
      if(source===to&&caller!==callee)return; // Internal to a contracted group.
      const existing=(page.wires??[]).some(w=>w.from===source&&w.to===to&&
        (['call','construct'].includes(w.kind)||w.kinds?.call||w.kinds?.construct));
      if(!existing&&!callerWires.some(w=>w.from===source&&w.to===to&&w.caller===caller&&w.callee===callee))
        callerWires.push({from:source,to,kind:'call',provenance:'called-from',caller,callee});
    };
    // Own-page incoming callers stay at the boundary. A caller already drawn on this page
    // connects to that boundary instead of being repeated as an off-page red address.
    // Callers outside the mapped scope have no index and no box; the active ones are rows here,
    // beside the mapped ones, so a declaration page states every consequence of editing it.
    page.callerReferences=[...(page.calledFrom??[]).filter(ref=>!shown.has(ref.index)).map(describe),
      ...(page.outsideCallerReferences??[])];
    delete page.outsideCallerReferences;
    delete page.callerBoundary;
    for(const ref of page.calledFrom??[])if(shown.has(ref.index)) {
      const id=`page:${page.index}`;
      page.callerBoundary={id,index:page.index,label:page.path??page.file??page.index};
      connect(ref.index,page.index,id);
    }
    for(const component of [...(page.components??[]),...(page.children??[])]) {
      const target=destinations.get(component.index);if(!target)continue;
      component.destination=target.destination;
      if(target.sourceSpan)component.sourceSpan=target.sourceSpan;else delete component.sourceSpan;
      const targets=target.kind==='group'?(target.members??[]).map(member=>destinations.get(index.get(member))).filter(Boolean):[target];
      const references=new Map();
      for(const member of targets)for(const ref of member.calledFrom??[]) {
        if(ref.index===owner)continue;
        if(shown.has(ref.index)&&shown.has(member.index))connect(ref.index,member.index,shown.get(member.index));
        else references.set(ref.index??ref.path??ref.file,describe(ref));
      }
      if(references.size)component.callerReferences=[...references.values()];else delete component.callerReferences;
    }
    page.callerWires=callerWires;
  }

  // Findings follow the leaf. A map draws a leaf's box with the rows that belong on a map
  // (findings.mjs): what no leaf or link there stands for. A cluster box carries the number of
  // those nested in it, for navigation. The leaf's own read keeps every row.
  const onMaps=new Map([...leafPages].map(([path,page])=>[path,mapFindings(page,leafOf)]));
  const rowCount=rows=>[...rows.uncertainty,...rows.unresolved].reduce((n,row)=>n+(row.count??1),0);
  for(const page of [root,...groupPages.values()])for(const component of page.components) {
    if(component.kind==='group'){
      const count=access.leavesOf(component.cluster).reduce((n,leaf)=>n+rowCount(onMaps.get(leaf)),0);
      if(count)component.findings=count;
      continue;
    }
    const rows=onMaps.get(component.path);
    for(const field of ['uncertainty','unresolved'])if(rows[field].length)component[field]=rows[field];
  }

  // Publish tree indexes. A folded declaration's internal address is its leaf's.
  const published=new Map([[TOP,TOP],...[...index].map(([path,internal])=>[internal,treeIndex.get(leafOf.get(path))]),
    ...[...clusterAt].map(([id,internal])=>[internal,treeIndex.get(id)])]);
  const pages=[...destinations.values()];
  renumber(pages,published);
  // A state node names the declaration that owns the binding. That address is the tree's, like
  // every other address on the page, so it is published with them.
  for(const page of pages)for(const s of page.state??[])if(published.has(s.ownerIndex))s.ownerIndex=published.get(s.ownerIndex);
  markRepeats(new Map(pages.map(page=>[page.index,page])));
  const publishedGroups=Object.fromEntries([...groupPages.values()].map(page=>[page.index,page]).sort((a,b)=>byIndex(a[0],b[0])));
  const records=new Map();
  for(const f of graph.files.filter(f=>m.mapped.has(f.file)).sort((a,b)=>order(a.file,b.file))) {
    const file=f.file;
    const filePages=Object.fromEntries([...leafPages.values()].filter(p=>p.file===file).map(p=>[p.index,p]));
    // Retained declaration spans must keep the source bytes that produced them.
    const source=context.sources.get(file);
    records.set(file,{file,sha256:f.sha256,lines:f.lines,...(typeof source==='string'?{source}:{}),pages:filePages});
  }
  const fingerprint={sources:Object.fromEntries(graph.files.map(f=>[f.file,f.sha256]).sort(([a],[b])=>order(a,b))),
    inventory:files?'explicit':'disk',inputs:generationInputs};
  const stored={schema:6,generated:new Date().toISOString().slice(0,10),fingerprint,
    files:Object.fromEntries([...records.values()].map(r=>[r.file,{sha256:r.sha256,lines:r.lines}])),
    records:Object.fromEntries([...records.keys()].map(f=>[f,`${slug(f)}.json`])),
    nodes:Object.fromEntries([...leafPages.values()].map(p=>[p.index,{path:p.path,file:p.file}]).sort((a,b)=>byIndex(a[0],b[0]))),
    // A page is reachable by the durable name of what it is about: a declaration, whether its own
    // leaf or folded into one, or a cluster.
    byPath:Object.fromEntries([...[...leafOf].map(([path,leaf])=>[path,treeIndex.get(leaf)]),
      ...Object.values(publishedGroups).map(p=>[p.path,p.index])].sort((a,b)=>order(a[0],b[0]))),
    root,groupPages:publishedGroups,
    // What the scorer and the solver read: every leaf, the links between them, and the tree as
    // placed, with each cluster's index.
    leaves:Object.fromEntries([...leafPaths].sort(order).map(path=>[path,treeIndex.get(path)])),
    links,tree:treeFileOf(tree,treeIndex),
    treeIndex:Object.fromEntries([...tree.clusters.keys()].map(id=>[id,treeIndex.get(id)])),
    orphanFacts:orphans,factErrors:facts.errors};
  await clock('write',async()=>{
    await rm(resolve(dir,'files'),{recursive:true,force:true});
    await mkdir(resolve(dir,'files'),{recursive:true});
    for(const record of records.values())await write(resolve(dir,'files',`${slug(record.file)}.json`),record);
    await write(resolve(dir,'index.json'),stored);
  });
  return {timings,leaves:leafPaths.size,clusters:tree.clusters.size,links:links.length,files:records.size,
    facts:facts.rows.length-orphans.length,orphanFacts:orphans,factErrors:facts.errors};
}

// A fingerprint covers the scanner itself, its dependency resolution and the authored inputs.
// Reading it only enumerates and hashes files; it never invokes the AST scanner. Missing inputs
// are represented explicitly so creating an initially absent facts/grouping file invalidates it.
async function inputHashes(repo) {
  const generator=await readdir(resolve(repoRoot,'dev-map/lib'));
  const entries=await Promise.all(generator.filter(f=>f.endsWith('.mjs')).sort(order).map(async file=>
    [`generator:dev-map/lib/${file}`,sha(await readFile(resolve(repoRoot,'dev-map/lib',file)))]));
  for(const file of ['package-lock.json','dev-map/facts.tsv',treeFile,'DECISIONS.md']) {
    const contents=await readFile(resolve(repo,file)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    entries.push([file,contents===null?null:sha(contents)]);
  }
  return Object.fromEntries(entries);
}

// Freshness is conservative across the map: any scanner input can affect reverse relations or
// receiver resolution on another page. This deliberately over-invalidates instead of presenting
// stale consequences as fresh. `files` supports explicit in-memory inventories used by clients.
export async function storedFreshness(held,{repo=repoRoot,readSource=file=>readFile(resolve(repo,file),'utf8'),files}={}) {
  if(!held.fingerprint)return {regenerate:'0',files:[],reason:'missing-generation-fingerprint'};
  const expected=held.fingerprint.sources;
  const inventory=files??(held.fingerprint.inventory==='disk'?await sourceFiles(repo,scanRoots):Object.keys(expected));
  const current=new Set(inventory),added=inventory.filter(f=>!(f in expected)).sort(order);
  const deleted=Object.keys(expected).filter(f=>!current.has(f)).sort(order),changed=[];
  for(const file of Object.keys(expected)) {
    if(!current.has(file))continue;
    const text=await Promise.resolve().then(()=>readSource(file)).catch(()=>null);
    if(text==null){deleted.push(file);continue;}
    if(sha(text)!==expected[file])changed.push(file);
  }
  const inputs=await inputHashes(repo),inputChanges=[...new Set([...Object.keys(inputs),...Object.keys(held.fingerprint.inputs)])]
    .filter(file=>inputs[file]!==held.fingerprint.inputs[file]).sort(order);
  if(!added.length&&!deleted.length&&!changed.length&&!inputChanges.length)return null;
  return {regenerate:'0',reason:'generation-dependencies-changed',
    files:[...new Set([...added,...deleted,...changed])].sort(order),
    ...(added.length?{added}:{}),...(deleted.length?{deleted:[...new Set(deleted)].sort(order)}:{}),
    ...(changed.length?{changed:changed.sort(order)}:{}),...(inputChanges.length?{inputs:inputChanges}:{})};
}

const links=()=>{
  const wires=new Map(),ports=new Map();
  const add=(from,to,kind,label)=>{
    if(from===undefined||to===undefined||from===to)return;
    const key=`${from}\n${to}`,w=wires.get(key)??wires.set(key,{from,to,kinds:{},count:0,labels:new Set()}).get(key);
    w.kinds[kind]=(w.kinds[kind]??0)+1;w.count++;if(label)w.labels.add(label);
  };
  const port=(name,to,kind,label)=>{ports.set(name,{port:name,mechanism:name});add(name,to,kind,label);};
  // A call that leaves the mapped scope: the port names the scanned root it reaches, and the wire
  // runs out of the box. There is no box for outside code on this page.
  const portOut=(root,from,kind,label)=>{
    if(from===undefined)return;
    const name=`out:${root}`;
    ports.set(name,{port:name,mechanism:root,direction:'out',outside:true});add(from,name,kind,label);
  };
  const drawn=()=>({ports:[...ports.values()].sort((a,b)=>order(a.port,b.port)),
    wires:[...wires.values()].sort((a,b)=>order(a.from,b.from)||order(a.to,b.to))
      .map(w=>({from:w.from,to:w.to,kinds:w.kinds,count:w.count,...(w.count===1&&w.labels.size===1?{label:[...w.labels][0]}:{})}))});
  return {add,port,portOut,drawn};
};

// Module-level code belongs to no declaration: what it calls is reached through the `module`
// port, and its own findings are the top map's.
// `platform` is a call site with no target in any scanned root — a library, runtime or DOM
// operation. `outside` is a call site whose target is scanned source the map does not cover.
function moduleDiagnostics(m) {
  const sites=m.files.flatMap(file=>(m.moduleCallSites?.get(file)??[]).map(({state,...site})=>({...site,file,module:true,state})));
  return {unresolved:sites.filter(s=>s.state==='unresolved').map(({state,...s})=>s),
    platform:sites.filter(s=>s.state==='external').length,
    outside:m.outsideCalls.filter(c=>!c.from).length,
    moduleCallSites:sites};
}
// The top map or a cluster: the boxes it draws, homes and repeats, the links between them, and
// at its edge a boundary box for each node on another map that a link crosses to, the ways in
// from outside the map, and calls that leave the mapped scope. Module-level findings are the top
// map's. Addresses are internal here and published with every other page.
function containmentPage(map,{m,tree,access,set,at,packets,leafOf,treeIndex}) {
  const drawn=drawMap(map,access,set),isCluster=id=>tree.clusters.has(id);
  const leafBox=path=>{const n=packets.get(path);
    return {index:at(path),path,label:path.slice(n.file.length+2),file:n.file,line:n.line,endLine:n.endLine,lines:n.endLine-n.line+1,leaf:true};};
  const clusterBox=id=>({index:at(id),path:clusterPath(id),cluster:id,kind:'group',label:tree.clusters.get(id).label??NEEDS_LABEL,
    count:access.leavesOf(id).length});
  const components=drawn.members.map(id=>isCluster(id)?clusterBox(id):leafBox(id));
  const {add,port,portOut,drawn:ported}=links();
  for(const {from,to,link} of drawn.lifted)add(at(from),at(to),link.kind,null);
  // The other end of a crossing link is shown where this map and it meet: the box on their
  // nearest shared map that holds it.
  const chain=new Set();for(let p=map;p!==undefined;p=access.parentOf(p))chain.add(p);chain.add(TOP);
  const boundaryOf=leaf=>{let box=leaf;for(let p=access.parentOf(leaf);!chain.has(p);p=access.parentOf(p))box=p;return box;};
  const boundaries=new Map();
  for(const {link,inside,outside,out} of drawn.crossing) {
    const box=boundaryOf(outside),name=`boundary:${at(box)}`;
    boundaries.set(name,{port:name,mechanism:'boundary',index:at(box),
      label:isCluster(box)?tree.clusters.get(box).label??NEEDS_LABEL:box.slice(packets.get(box).file.length+2)});
    out?add(at(inside),name,link.kind,null):add(name,at(inside),link.kind,null);
  }
  // Ways in and calls out, from the leaves this map holds.
  const holds=path=>drawn.holder.get(leafOf.get(path));
  for(const n of m.nodes) {
    const box=holds(n.path);if(box===undefined)continue;
    for(const {mechanism,label} of m.reached.get(n.path)??[])port(mechanism,at(box),mechanism,label);
  }
  for(const c of m.outsideCalls)if(c.from){const box=holds(c.from.path);if(box!==undefined)portOut(c.root,at(box),'call',null);}
  const {ports,wires}=ported();
  const children=components.map(c=>({index:c.index,path:c.path,label:c.label}));
  if(map===TOP)return {flow:true,generated:true,index:TOP,path:TOP,kind:'root',leaves:access.leavesOf(TOP).length,
    ports:[...ports,...boundaries.values()],wires,...moduleDiagnostics(m),components,children};
  return {flow:true,generated:true,index:at(map),path:clusterPath(map),kind:'group',cluster:map,label:tree.clusters.get(map).label??NEEDS_LABEL,
    parent:at(access.parentOf(map)),leaves:access.leavesOf(map).length,codeTargets:access.leavesOf(map),ports:[...ports,...boundaries.values()],wires,components,children,
    unresolved:[],platform:0,outside:0};
}
export const NEEDS_LABEL='[needs label]';
const clusterPath=id=>`@cluster/${id}`;

// Links between leaves, once per pair and kind: each call a declaration makes, each value passed
// from one call's result into another call (directly or through operators), each indirect link.
// A declaration folded into a leaf links as that leaf, and a leaf's links to itself are dropped.
function leafLinks(packets,leafOf,pathAt) {
  const seen=new Set(),found=[];
  const add=(fromAt,toAt,kind)=>{
    const from=leafOf.get(pathAt.get(fromAt)),to=leafOf.get(pathAt.get(toAt)),key=`${from}>${to}>${kind}`;
    if(!from||!to||from===to||seen.has(key))return;
    seen.add(key);found.push({from,to,kind});
  };
  const nodeOf=box=>String(box).split('@')[0];
  for(const page of packets.values()) {
    const at=page.index;
    for(const box of page.components??[])add(at,box.index,'call');
    for(const link of page.couplings??[])if(link.index)
      link.direction==='in'?add(link.index,at,link.kind):add(at,link.index,link.kind);
    const next=new Map();
    for(const wire of page.wires??[])if(wire.kind==='data')
      (next.get(wire.from)??next.set(wire.from,[]).get(wire.from)).push(wire.to);
    const isBox=id=>pathAt.has(nodeOf(id));
    for(const start of next.keys()) {
      if(!isBox(start))continue;
      const stack=[...next.get(start)],passed=new Set();
      while(stack.length) {
        const to=stack.pop();
        if(passed.has(to))continue;
        passed.add(to);
        if(isBox(to))add(nodeOf(start),nodeOf(to),'data');
        else if(/^op\d/.test(to))stack.push(...next.get(to)??[]);
      }
    }
  }
  return found.sort((a,b)=>order(a.from,b.from)||order(a.to,b.to)||order(a.kind,b.kind));
}

// ---- reading ----------------------------------------------------------------------------
export async function readIndex(dir) {
  try {return await json(resolve(dir,'index.json'));} catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// Shared CLI/viewer selection: old spans may only be applied to matching source. Legacy
// records can use live source if its hash still matches the stored generation fingerprint.
export async function matchingSource(file,{repo=repoRoot,held,record,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const expected=held.files[file]?.sha256;
  const stored=record??(held.records[file]?await json(resolve(storeDir(repo),'files',held.records[file])):null);
  if(typeof stored?.source==='string'&&sha(stored.source)===expected)
    return {text:stored.source,sourceKind:'snapshot',sourceSha256:expected};
  const live=await Promise.resolve().then(()=>readSource(file)).catch(()=>null);
  if(typeof live==='string'&&sha(live)===expected)
    return {text:live,sourceKind:'matching-live',sourceSha256:expected};
  return {text:null,sourceUnavailable:true,regenerate:'0'};
}

// Every read hashes the source behind what it returns and says so in data when they differ.
export async function readGenerated(target,{repo=repoRoot,code=false,readSource=file=>readFile(resolve(repo,file),'utf8'),files}={}) {
  const dir=storeDir(repo),held=await readIndex(dir);
  if(!held)return {generated:true,stale:{regenerate:'0'}};
  const key=String(target).replaceAll('\\','/').replace(/\/$/,'');
  const at=/^\d+(\.\d+)*$/.test(key)?key:held.byPath[key];
  if(at===undefined)throw Error(`No node ${key}. Read 0 for the top map.`);
  const page=at==='0'?held.root:held.groupPages?.[at]??await nodePage(dir,held,at);
  if(!page)throw Error(`No node ${at}. Read 0 for the top map.`);
  const stale=await storedFreshness(held,{repo,readSource,files});
  const described={...page,destination:destinationFor(page),...(stale?{stale}:{})};
  if(code||described.destination==='code')return withSources(
    {...described,...await codeFor(page,held,dir),destination:'code'},file=>matchingSource(file,{repo,held,readSource}));
  return described;
}

async function nodePage(dir,held,at) {
  const node=held.nodes[at];if(!node)return null;
  const record=await json(resolve(dir,'files',held.records[node.file]));
  return record.pages[at]??null;
}

// The root cannot return the entire codebase. Every other scope returns exactly its contained
// code: source spans for a cluster, or its own declaration.
async function codeFor(page,held,dir) {
  if(page.kind==='root')
    throw Error(`Page ${page.index} is the top map; --code takes a cluster or leaf. Read 0 without --code.`);
  if(page.kind==='group') {
    const spans=[];
    for(const path of page.codeTargets??[]) {
      const target=await nodePage(dir,held,held.byPath[path]);
      if(!target)throw Error(`Cluster ${page.index} refers to missing code ${path}; regenerate 0.`);
      spans.push({file:target.file,line:target.line,endLine:target.endLine});
    }
    const merged=[];
    for(const span of spans.sort((a,b)=>order(a.file,b.file)||a.line-b.line||a.endLine-b.endLine)) {
      const last=merged.at(-1);
      if(last?.file===span.file&&span.line<=last.endLine)last.endLine=Math.max(last.endLine,span.endLine);
      else merged.push({...span});
    }
    return {generated:true,index:page.index,path:page.path,kind:page.kind,code:true,
      spans:merged.map(s=>({...s,lines:s.endLine-s.line+1}))};
  }
  return {generated:true,index:page.index,path:page.path,file:page.file,line:page.line,endLine:page.endLine,lines:page.lines,code:true};
}

export async function readCode(target,{repo=repoRoot,readSource=file=>readFile(resolve(repo,file),'utf8'),files}={}) {
  return readGenerated(target,{repo,code:true,readSource,files});
}

async function withSources(head,selectSource) {
  if(head.spans) {
    const texts=new Map(),sources=[];
    for(const span of head.spans) {
      if(!texts.has(span.file))texts.set(span.file,await selectSource(span.file));
      const {text,...provenance}=texts.get(span.file);
      if(text===null){sources.push({...span,...provenance});continue;}
      const source=text.split('\n').slice(span.line-1,span.endLine).map((line,i)=>`${span.line+i}\t${line}`).join('\n');
      sources.push({...span,...provenance,source});
    }
    const {spans,...scope}=head;
    return {...scope,sources};
  }
  const {text,...provenance}=await selectSource(head.file);
  if(text===null)return {...head,...provenance};
  const lines=text.split('\n').slice(head.line-1,head.endLine).map((line,i)=>`${head.line+i}\t${line}`);
  return {...head,...provenance,source:lines.join('\n')};
}

// ---- status ------------------------------------------------------------------------------
// What `check` reads: whether the store is there, whether the source has moved under it, the
// repo-wide link accounting the pages already carry, and the facts that name nothing.
export async function storeStatus({repo=repoRoot,readSource=file=>readFile(resolve(repo,file),'utf8'),files}={}) {
  const dir=storeDir(repo),held=await readIndex(dir);
  const facts=await readFacts({repo});
  if(!held)return {dir,missing:true,regenerate:'0',facts,orphanFacts:[]};
  const stale=await storedFreshness(held,{repo,readSource,files});
  const nodes=[];
  for(const record of Object.values(held.records))
    nodes.push(...Object.values((await json(resolve(dir,'files',record))).pages));
  const totals={leaves:Object.keys(held.leaves).length,clusters:Object.keys(held.groupPages).length,
    links:held.links.length,files:Object.keys(held.files).length,
    // Every linked call a page holds, whatever the drawing does with it: a box it draws, each
    // member of an authored group drawn as one box, plus the callables a caller passes into a
    // parameter this page invokes, which are drawn on the caller's page and named here as rows.
    // A box a leaf drew onto the map above it repeats a call already counted on the leaf's
    // own page; it is context there, not a relationship of its own.
    linked:nodes.reduce((n,p)=>n+p.components.filter(c=>!c.inlined)
        .reduce((calls,c)=>calls+(c.kind==='group'?(c.members?.length??c.count??1):1),0)
      +(p.inputs??[]).reduce((rows,port)=>rows+(port.parameterTargets?.length??0),0),0),
    unresolved:nodes.reduce((n,p)=>n+p.unresolved.length,0),
    outside:nodes.reduce((n,p)=>n+(p.outside??0),0),
    platform:nodes.reduce((n,p)=>n+(p.platform??0),0)};
  return {dir,missing:false,generated:held.generated,stale,totals,facts,orphanFacts:held.orphanFacts??[]};
}
