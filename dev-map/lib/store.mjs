// The stored map. AST scanning and link resolution happen only during explicit generation.
// Reads use stored relationships, enumerate/hash inputs for freshness, and return source at code
// destinations. Each retained file record keeps the hash of the source that produced its pages.
import {readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFlow,flowPacket} from './flow.mjs';
import {model,numberNodes} from './entries.mjs';
import {readFacts,bindFacts} from './facts.mjs';
import {sourceFiles} from './graph.mjs';
import {scanRoots,outsideRootOf,isMapped,activeCallers} from './scope.mjs';
import {readCompositions,compositionFiles,composePages} from './composition.mjs';
import {attachPortReferences} from './port-references.mjs';
import {attachOverviewAnchors} from './overview.mjs';
import {treeNumbering,renumber,markRepeats,drawChains} from './tree.mjs';
import {destinationFor} from './destination.mjs';
export {drawnShape,destinationFor} from './destination.mjs';

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
  const config=await readCompositions({repo});
  const context=await clock('load',()=>loadFlow({repo,...(readSource?{readSource}:{}),...(files?{files}:{})}));
  Object.assign(timings,context.timings);
  const {graph,projection}=context;
  const dir=storeDir(repo);
  const m=model(graph,projection);

  // Numbering: internal identities, renumbered into the map tree before publishing.
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
  const leafOf=path=>packets.has(path)&&destinationFor(packets.get(path))==='code';
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
    for(const c of packet.components){if(leafOf(`${c.file}::${c.label}`))c.leaf=true;else delete c.leaf;}
  }

  attachPortReferences(packets,index);

  // The top map. A file is where code is written, not a place in the map: it is no box, no page
  // and no member.
  const root=topPage(m,index,packets);

  // External facts. A row names a declaration this scan holds; anything else is an orphan,
  // carried in the store so a read and `check` both report it.
  const facts=await readFacts({repo});
  const {byTarget,orphans}=bindFacts(facts.rows,new Set(packets.keys()));
  for(const packet of packets.values()) {
    const held=byTarget.get(packet.path);
    if(held)packet.facts=held;else delete packet.facts;
  }

  // Keep canonical packets beside their presentation: a drawing collapsed by clusters has lost
  // the internal wires a cluster solver reads.
  const sourcePackets=new Map([...packets].map(([path,page])=>[path,structuredClone(page)]));
  const composed=composePages(new Map([...packets,[root.path,root]]),config,{model:m,index,packets});
  for(const [path,page] of composed.pages)if(packets.has(path))packets.set(path,page);
  const top=composed.pages.get(root.path);
  const groupPages=Object.fromEntries(composed.groupPages);
  const destinations=new Map([top,...packets.values(),...Object.values(groupPages)].map(page=>[page.index,page]));
  for(const page of destinations.values()) {
    page.destination=destinationFor(page);
    if(!['root','group'].includes(page.kind)) {
      if(page.destination==='code')page.leaf=true;else delete page.leaf;
    }
    if(page.destination==='code')page.sourceSpan={file:page.file,line:page.line,endLine:page.endLine};
    else delete page.sourceSpan;
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

  // Findings follow the node. A containment map draws a node; that node's own rows are attached
  // to its box, exactly as the node's own page shows them, and nothing is rolled up into a count
  // by kind. A group box is not a node: it carries the number of findings inside it, for
  // navigation, and nothing else.
  const packetsUnder=new Map();
  for(const packet of packets.values()) {
    // A declaration written inside another is homed on that declaration's page, so its findings
    // are inside any group that holds the holder; the count a group box carries says so.
    for(let at=packet.path;at.includes('::');at=at.slice(0,at.lastIndexOf('::')))
      (packetsUnder.get(at)??packetsUnder.set(at,[]).get(at)).push(packet);
  }
  const rowCount=pages=>pages.reduce((n,p)=>n+[...(p.uncertainty??[]),...(p.unresolved??[])]
    .reduce((rows,row)=>rows+(row.count??1),0),0);
  const nodeOf=component=>{
    const path=component.path??(component.file&&component.label?`${component.file}::${component.label}`:null);
    return path?packets.get(path)??null:null;
  };
  const heldRows=component=>rowCount(component.kind==='group'
    ?(component.members??[]).flatMap(member=>packetsUnder.get(member)??[]):[]);
  // This runs after the chains are drawn, so a box a leaf brought onto the top map or a group
  // carries the rows of the node it draws like every other box on that page.
  const attachContainmentFindings=pages=>{
    for(const page of pages) {
      if(page.kind!=='root'&&!(page.kind==='group'&&page.structural))continue;
      for(const component of page.components??[]) {
        const node=nodeOf(component);
        if(node) {
          for(const field of ['uncertainty','unresolved']) {
            if(node[field]?.length)component[field]=node[field];else delete component[field];
          }
          continue;
        }
        const count=heldRows(component);
        if(count)component.findings=count;else delete component.findings;
      }
    }
  };
  // A function, method, handler or class page is a drawing too, so the same rule holds there: the
  // box says how many findings the declaration it draws has, and the rows are listed once per
  // node below the drawing however many boxes repeat that node. The page's own rows stay where
  // they are and are never repeated into that list. This runs after the chains are drawn, so a
  // box a leaf brought onto the map carries its count like every other box.
  const attachNodeFindings=pages=>{
    for(const page of pages) {
      if(['root','group'].includes(page.kind)||page.destination!=='graph')continue;
      const sections=new Map();
      for(const component of page.components??[]) {
        const node=nodeOf(component),count=node?rowCount([node]):heldRows(component);
        if(count)component.findings=count;else delete component.findings;
        if(node&&count&&node.path!==page.path&&!sections.has(node.path))sections.set(node.path,{index:component.index,path:node.path,
          ...Object.fromEntries(['uncertainty','unresolved'].filter(field=>node[field]?.length).map(field=>[field,node[field]]))});
      }
      if(sections.size)page.nodeFindings=[...sections.values()];else delete page.nodeFindings;
    }
  };

  attachOverviewAnchors(destinations,index);

  // Publish tree indexes. A page that no map shows is not published.
  const {tree,chains}=treeNumbering(destinations);
  drawChains(destinations,chains);
  attachContainmentFindings(destinations.values());
  attachNodeFindings(destinations.values());
  const placed=new Set([...destinations].filter(([at])=>tree.has(at)).map(([,page])=>page));
  const unplaced=[...destinations.values()].filter(page=>!placed.has(page)).map(page=>page.path??page.file).sort(order);
  renumber([...placed],tree);
  // A state node names the declaration that owns the binding. That address is the tree's, like
  // every other address on the page, so it is published with them.
  for(const page of placed)for(const s of page.state??[])if(tree.has(s.ownerIndex))s.ownerIndex=tree.get(s.ownerIndex);
  for(const [path,page] of packets)if(!placed.has(page))packets.delete(path);
  const publishedGroups=Object.fromEntries(Object.values(groupPages).filter(page=>placed.has(page))
    .map(page=>[page.index,page]).sort((a,b)=>byIndex(a[0],b[0])));
  markRepeats(new Map([...placed].map(page=>[page.index,page])));
  // Source pages keep internal addresses; the cluster solver reads them by declaration path.
  const records=new Map();
  for(const f of graph.files.filter(f=>m.mapped.has(f.file)).sort((a,b)=>order(a.file,b.file))) {
    const file=f.file;
    const pages=Object.fromEntries([...packets.values()].filter(p=>p.file===file).map(p=>[p.index,p]));
    const sourcePages=Object.fromEntries([...sourcePackets.values()].filter(p=>p.file===file).map(p=>[p.index,p]));
    // Retained declaration spans must keep the source bytes that produced them.
    const source=context.sources.get(file);
    records.set(file,{file,sha256:f.sha256,lines:f.lines,...(typeof source==='string'?{source}:{}),pages,sourcePages});
  }
  const fingerprint={sources:Object.fromEntries(graph.files.map(f=>[f.file,f.sha256]).sort(([a],[b])=>order(a,b))),
    inventory:files?'explicit':'disk',inputs:generationInputs};
  const stored={schema:5,generated:new Date().toISOString().slice(0,10),fingerprint,
    files:Object.fromEntries([...records.values()].map(r=>[r.file,{sha256:r.sha256,lines:r.lines}])),
    records:Object.fromEntries([...records.keys()].map(f=>[f,`${slug(f)}.json`])),
    nodes:Object.fromEntries([...packets.values()].map(p=>[p.index,{path:p.path,file:p.file}]).sort((a,b)=>byIndex(a[0],b[0]))),
    // A page is reachable by the durable name of what it is about: a declaration or cluster path.
    byPath:Object.fromEntries([...[...packets.values()].map(p=>[p.path,p.index]),
      ...Object.values(publishedGroups).map(p=>[p.path,p.index])].sort((a,b)=>order(a[0],b[0]))),
    root:top,groupPages:publishedGroups,
    unplaced,orphanFacts:orphans,factErrors:facts.errors};
  await clock('write',async()=>{
    await rm(resolve(dir,'files'),{recursive:true,force:true});
    await mkdir(resolve(dir,'files'),{recursive:true});
    for(const record of records.values())await write(resolve(dir,'files',`${slug(record.file)}.json`),record);
    await write(resolve(dir,'index.json'),stored);
  });
  return {timings,entries:m.entries.length,pages:packets.size,files:records.size,
    ...(unplaced.length?{unplaced}:{}),
    facts:facts.rows.length-orphans.length,orphanFacts:orphans,factErrors:facts.errors};
}

// A fingerprint covers the scanner itself, its dependency resolution and the authored inputs.
// Reading it only enumerates and hashes files; it never invokes the AST scanner. Missing inputs
// are represented explicitly so creating an initially absent facts/grouping file invalidates it.
async function inputHashes(repo) {
  const generator=await readdir(resolve(repoRoot,'dev-map/lib'));
  const entries=await Promise.all(generator.filter(f=>f.endsWith('.mjs')).sort(order).map(async file=>
    [`generator:dev-map/lib/${file}`,sha(await readFile(resolve(repoRoot,'dev-map/lib',file)))]));
  for(const file of ['package-lock.json','dev-map/facts.tsv',...await compositionFiles(repo),'DECISIONS.md']) {
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

// The top map: the entry points as components, the links between the flows they begin as wires,
// and every way in from outside the map as a port. Module-level code belongs to no declaration:
// what it calls is reached through the `module` port, and its own findings are this page's.
// `platform` is a call site with no target in any scanned root — a library, runtime or DOM
// operation. `outside` is a call site whose target is scanned source the map does not cover.
function moduleDiagnostics(m) {
  const sites=m.files.flatMap(file=>(m.moduleCallSites?.get(file)??[]).map(({state,...site})=>({...site,file,module:true,state})));
  return {unresolved:sites.filter(s=>s.state==='unresolved').map(({state,...s})=>s),
    platform:sites.filter(s=>s.state==='external').length,
    outside:m.outsideCalls.filter(c=>!c.from).length,
    moduleCallSites:sites};
}
function topPage(m,index,packets) {
  const components=m.entries.map(n=>declarationBox(n,index,packets));
  // Every link contracts onto the entry point whose flow holds it, so a declaration that is no
  // entry point is drawn on that flow instead of a second time here. A nested declaration goes
  // with the top-level declaration that holds it.
  const box=n=>index.get(m.ownerRoot.get(n.path)??outermost(n).path);
  const {add,port,portOut,drawn}=links();
  for(const n of m.nodes)for(const {mechanism,label} of m.reached.get(n.path)??[])port(mechanism,box(n),mechanism,label);
  for(const c of m.outsideCalls)if(c.from)portOut(c.root,box(c.from),'call',null);
  for(const c of m.calls) {
    if(!c.from||!m.mapped.has(c.from.file)||!m.mapped.has(c.to.file))continue;
    add(box(c.from),box(c.to),c.relation.kind,c.label||null);
  }
  for(const c of m.couplings) {
    if(!c.from||!c.to||!m.mapped.has(c.fromFile)||!m.mapped.has(c.toFile))continue;
    add(box(c.from),box(c.to),c.kind,c.label||null);
  }
  return {flow:true,generated:true,index:'0',path:'0',kind:'root',nodes:m.nodes.length,entries:m.entries.length,
    ...drawn(),...moduleDiagnostics(m),components,
    ...(m.stranded.length?{stranded:m.stranded.map(n=>n.path)}:{}),
    children:components.map(c=>({index:c.index,path:c.path,label:c.label,file:c.file,lines:c.lines}))};
}
const outermost=n=>{let node=n;while(node.parent)node=node.parent;return node;};
const declarationBox=(n,index,packets)=>({index:index.get(n.path),path:n.path,label:n.path.slice(n.file.length+2),
  file:n.file,line:n.line,endLine:n.endLine,lines:n.endLine-n.line+1,
  ...(packets.has(n.path)&&destinationFor(packets.get(n.path))==='graph'?{}:{leaf:true})});

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
  if(at===undefined)throw Error(`No node ${key}. Read 0 for the entry points.`);
  const page=at==='0'?held.root:held.groupPages?.[at]??await nodePage(dir,held,at);
  if(!page)throw Error(`No node ${at}. Read 0 for the entry points.`);
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
    throw Error(`Page ${page.index} is the top map; --code takes a cluster or node. Read 0 without --code for its entry points.`);
  if(page.kind==='group') {
    const spans=[];
    for(const path of page.codeTargets??[]) {
      const target=await nodePage(dir,held,held.byPath[path]);
      if(!target)throw Error(`Group ${page.index} refers to missing code ${path}; regenerate 0.`);
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
  const totals={entries:held.root.entries,files:Object.keys(held.files).length,pages:nodes.length,
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
  // A declaration no entry point reaches: it keeps a box on the top map, and `check` names it so
  // the cycle behind it can be looked at.
  const stranded=held.root.stranded??[];
  return {dir,missing:false,generated:held.generated,
    stale,
    totals,stranded,
    // A page no map shows, which for an authored group means grouping that nothing reads.
    unplaced:held.unplaced??[],
    facts,orphanFacts:held.orphanFacts??[]};
}
