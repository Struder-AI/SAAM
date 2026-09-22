// The stored map. AST scanning and link resolution happen only during explicit generation.
// Reads use stored relationships, enumerate/hash inputs for freshness, and return source at code
// destinations. Each retained file record keeps the hash of the source that produced its pages.
import {readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFlow,flowPacket} from './flow.mjs';
import {model,numberRegion} from './regions.mjs';
import {readFacts,bindFacts} from './facts.mjs';
import {sourceFiles} from './graph.mjs';
import {scanRoots} from './scope.mjs';
import {readCompositions,compositionFiles,composePages} from './composition.mjs';
import {attachPortReferences} from './port-references.mjs';
import {attachOverviewAnchors} from './overview.mjs';
import {treeNumbering,renumber,markRepeats} from './tree.mjs';

export const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
export const storeDir=repo=>resolve(repo,'dev-map/store');
export const destinationFor=page=>['root','region','group'].includes(page.kind)?'graph'
  :page.kind==='file'?(page.nodes===0?'code':'graph')
  :page.shape==='scalar-reduction'?'code'
  :page.shape==='numerical-expression'&&!(page.components?.length)?'code'
  :(page.operators?.length??0)>0||((page.components??[]).reduce((n,c)=>n+Math.max(1,c.calls??1),0)>1&&(page.wires?.length??0)>0)?'graph':'code';
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
export async function generate({repo=repoRoot,region=null,readSource,files}={}) {
  const timings={},clock=async(key,run)=>{const t=Date.now();const out=await run();timings[key]=Date.now()-t;return out;};
  const generationInputs=await inputHashes(repo);
  const config=await readCompositions({repo});
  const context=await clock('load',()=>loadFlow({repo,...(readSource?{readSource}:{}),...(files?{files}:{})}));
  Object.assign(timings,context.timings);
  const {graph,projection}=context,lines=new Map(graph.files.map(f=>[f.file,f.lines]));
  const dir=storeDir(repo),held=await readIndex(dir);
  const m=model(graph,projection);
  // Region numbers belong to the current directory inventory. A partial write cannot safely
  // reuse old addresses when that inventory changes, or when its provenance predates this schema.
  const requestedRegion=region;
  let widened=null;
  if(region&&(!held||held.schema<4||JSON.stringify(held.regions.map(r=>r.path))!==JSON.stringify(m.regions.map(r=>r.path)))) {
    widened='region-inventory-or-store-schema';region=null;
  }
  if(region&&!m.regions.some(r=>r.index===region))throw Error(`Unknown region ${region}; regions are ${m.regions.map(r=>r.index).join(', ')}.`);
  // Removing a declaration can invalidate an arbitrary incoming reference. Rebuild the complete
  // already-scanned graph rather than publish an address that now names a different declaration.
  if(region&&Object.entries(held.nodes).some(([at,node])=>at.split('.')[0]===region&&!projection.nodes.has(node.path))) {
    widened='removed-declaration';region=null;
  }
  if(region) {
    const scanned=new Map(graph.files.map(f=>[f.file,f.sha256]));
    const structuralChanged=(config.flows??[]).some(spec=>{
      const at=held.sourceByPath[spec.path],page=held.sourceRegionPages?.[at]??held.regionPages[at]??held.sourceFilePages?.[at]??held.filePages[at];
      if(!page)return false;
      const contained=page.kind==='region'?[...page.files,...(m.regions.find(r=>r.path===spec.path)?.files??[])]:[page.file];
      return contained.some(file=>held.files[file]?.region!==region&&m.regionOf.get(file)?.index!==region&&held.fingerprint.sources[file]!==scanned.get(file));
    });
    if(structuralChanged){widened='composition-source-dependencies';region=null;}
  }
  const scoped=region?m.regions.filter(r=>r.index===region):m.regions;

  // Numbering. A scoped run keeps every index the store already holds outside the region.
  const index=new Map();
  if(region&&held)for(const [path,at] of Object.entries(held.sourceByPath))if(at.split('.')[0]!==region)index.set(path,at);
  const trees=new Map(),entries=new Map();
  for(const r of scoped) {
    const numbered=numberRegion(m,r);
    index.set(r.path,r.index);
    for(const f of numbered.files)index.set(f.file,f.index);
    for(const [path,at] of numbered.index)index.set(path,at);
    trees.set(r.index,numbered);entries.set(r.index,numbered.entries);
  }
  for(const n of projection.nodes.values())if(index.has(n.path))n.handle=index.get(n.path);

  // Packets. A scoped run reuses the stored packet of every node outside the region.
  const packets=new Map();
  const mine=new Set(scoped.flatMap(r=>r.files));
  const oldRecords=region&&held?new Map((await Promise.all(Object.values(held.records).map(f=>json(resolve(dir,'files',f))))).map(r=>[r.file,r])):new Map();
  await clock('pages',async()=>{for(const n of m.nodes)if(mine.has(n.file))packets.set(n.path,flowPacket(context,n.path));});
  if(region&&held)for(const record of oldRecords.values())
    for(const packet of Object.values(record.sourcePages??record.pages))if(!mine.has(packet.file)) {
      remapReferences(packet,held,index,projection,mine);
      packets.set(packet.path,packet);
    }

  // A stored component names its node by file and label; its index is read back from the map so
  // a renumbered region is followed everywhere it is referenced.
  for(const packet of packets.values()) {
    packet.index=index.get(packet.path)??packet.index;
    for(const c of packet.components)c.index=index.get(`${c.file}::${c.label}`)??c.index;
    for(const f of packet.formulas)f.index=index.get(`${f.file}::${f.label}`)??f.index;
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
  for(const packet of packets.values()) {
    packet.calledFrom=(from.get(packet.path)??[]).sort((a,b)=>byIndex(a.index,b.index));
    packet.couplings=coupled.get(packet.path)??[];
    for(const c of packet.components){if(leafOf(`${c.file}::${c.label}`))c.leaf=true;else delete c.leaf;}
  }

  attachPortReferences(packets,index);

  // Root, region and file pages, and the file records the node pages are stored in.
  const regionPages=new Map(region&&held?Object.entries(held.sourceRegionPages??held.regionPages??{}):[]);
  const filePages=new Map(region&&held?Object.entries(held.sourceFilePages??held.filePages??{}):[]);
  if(region)for(const page of [...regionPages.values(),...filePages.values()])remapReferences(page,held,index,projection,mine);
  if(region)for(const [at,page] of [...filePages])if(at.split('.')[0]===region)filePages.delete(at);
  for(const r of scoped) {
    const numbered=trees.get(r.index);
    regionPages.set(r.index,regionPage(m,r,numbered,index,packets,lines));
    for(const f of numbered.files)filePages.set(f.index,filePage(m,r,f,numbered,index,packets,lines));
  }
  const root=rootPage(m,lines);

  // External facts. A row names a declaration this scan holds or a file of the map; anything else
  // is an orphan, carried in the store so a read and `check` both report it.
  const facts=await readFacts({repo});
  const known=new Set([...packets.keys(),...[...filePages.values()].map(p=>p.file)]);
  const {byTarget,orphans}=bindFacts(facts.rows,known);
  for(const packet of packets.values()) {
    const held=byTarget.get(packet.path);
    if(held)packet.facts=held;else delete packet.facts;
  }
  for(const page of filePages.values()) {
    const held=byTarget.get(page.file);
    if(held)page.facts=held;else delete page.facts;
  }

  // Keep canonical packets beside their presentation. Scoped generation must recompose from
  // those packets, not from an already collapsed drawing that has lost its internal wires.
  const sourcePackets=new Map([...packets].map(([path,page])=>[path,structuredClone(page)]));
  const sourceRegionPages=structuredClone(Object.fromEntries([...regionPages].sort(([a],[b])=>byIndex(a,b))));
  const sourceFilePages=structuredClone(Object.fromEntries([...filePages].sort(([a],[b])=>byIndex(a,b))));
  const allPages=new Map([...packets,...[...regionPages.values()].map(p=>[p.path,p]),...[...filePages.values()].map(p=>[p.file,p])]);
  const composed=composePages(allPages,config,{model:m,index,packets});
  for(const [path,page] of composed.pages) {
    if(packets.has(path))packets.set(path,page);
    else if(page.kind==='region')regionPages.set(page.index,page);
    else if(page.kind==='file')filePages.set(page.index,page);
  }
  const groupPages=Object.fromEntries(composed.groupPages);
  const destinations=new Map([root,...regionPages.values(),...filePages.values(),...packets.values(),...Object.values(groupPages)].map(page=>[page.index,page]));
  for(const page of destinations.values()) {
    page.destination=destinationFor(page);
    if(!['root','region','file','group'].includes(page.kind)) {
      if(page.destination==='code')page.leaf=true;else delete page.leaf;
    }
    if(page.destination==='code')page.sourceSpan={file:page.file,line:page.kind==='file'?1:page.line,
      endLine:page.kind==='file'?page.lines:page.endLine};
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
    page.callerReferences=(page.calledFrom??[]).filter(ref=>!shown.has(ref.index)).map(describe);
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

  attachOverviewAnchors(destinations,index);

  // Publish tree indexes. Source addresses stay behind only for scoped reuse; a page that no
  // map shows is not published.
  const sourceByPath=Object.fromEntries([...index,...Object.values(groupPages).map(p=>[p.path,p.index])]
    .sort((a,b)=>order(a[0],b[0])));
  const tree=treeNumbering(destinations);
  const placed=new Set([...destinations].filter(([at])=>tree.has(at)).map(([,page])=>page));
  const unplaced=[...destinations.values()].filter(page=>!placed.has(page)).map(page=>page.path??page.file).sort(order);
  renumber([...placed],tree);
  for(const [path,page] of packets)if(!placed.has(page))packets.delete(path);
  const publish=pages=>Object.fromEntries([...pages].filter(page=>placed.has(page))
    .map(page=>[page.index,page]).sort((a,b)=>byIndex(a[0],b[0])));
  const publishedRegions=publish(regionPages.values()),publishedFiles=publish(filePages.values()),
    publishedGroups=publish(Object.values(groupPages));
  markRepeats(new Map([...placed].map(page=>[page.index,page])));
  const records=new Map();
  const recordFiles=new Map(graph.files.filter(f=>mine.has(f.file)).map(f=>[f.file,f]));
  for(const record of oldRecords.values())if(!mine.has(record.file))recordFiles.set(record.file,record);
  for(const [,f] of [...recordFiles].sort(([a],[b])=>order(a,b))) {
    const file=f.file;
    const pages=Object.fromEntries([...packets.values()].filter(p=>p.file===file).map(p=>[p.index,p]));
    const sourcePages=Object.fromEntries([...sourcePackets.values()].filter(p=>p.file===file).map(p=>[p.index,p]));
    // Retained declaration spans must keep the source bytes that produced them.
    const source=mine.has(file)?context.sources.get(file):f.source;
    records.set(file,{file,sha256:f.sha256,lines:f.lines,region:m.regionOf.get(file)?.index??f.region,
      ...(typeof source==='string'?{source}:{}),pages,sourcePages});
  }
  const currentSources=Object.fromEntries(graph.files.map(f=>[f.file,f.sha256]));
  const sourceHashes=region?{...held.fingerprint.sources}:currentSources;
  if(region) {
    for(const file of Object.keys(sourceHashes))if(held.files[file]?.region===region)delete sourceHashes[file];
    for(const file of mine)sourceHashes[file]=currentSources[file];
  }
  const fingerprint={sources:Object.fromEntries(Object.entries(sourceHashes).sort(([a],[b])=>order(a,b))),inventory:files?'explicit':'disk',
    inputs:region?held.fingerprint.inputs:generationInputs};
  const stored={schema:4,generated:new Date().toISOString().slice(0,10),fingerprint,
    regions:m.regions.map(r=>({index:r.index,path:r.path,files:r.files})),
    files:Object.fromEntries([...records.values()].map(r=>[r.file,{sha256:r.sha256,lines:r.lines,region:r.region}])),
    records:Object.fromEntries([...records.keys()].map(f=>[f,`${slug(f)}.json`])),
    nodes:Object.fromEntries([...packets.values()].map(p=>[p.index,{path:p.path,file:p.file}]).sort((a,b)=>byIndex(a[0],b[0]))),
    // A page is reachable by the durable name of what it is about: a declaration path, a file
    // path, or — for a region — the directory the region is.
    byPath:Object.fromEntries([...[...packets.values()].map(p=>[p.path,p.index]),
      ...Object.values(publishedFiles).map(p=>[p.file,p.index]),
      ...Object.values(publishedGroups).map(p=>[p.path,p.index]),
      ...m.regions.map(r=>[r.path,r.index])].sort((a,b)=>order(a[0],b[0]))),
    sourceByPath,
    root,regionPages:publishedRegions,filePages:publishedFiles,
    sourceRegionPages,sourceFilePages,groupPages:publishedGroups,
    orphanFacts:orphans,factErrors:facts.errors};
  await clock('write',async()=>{
    if(!region)await rm(resolve(dir,'files'),{recursive:true,force:true});
    await mkdir(resolve(dir,'files'),{recursive:true});
    for(const record of records.values())await write(resolve(dir,'files',`${slug(record.file)}.json`),record);
    await write(resolve(dir,'index.json'),stored);
  });
  return {timings,regions:m.regions.length,pages:packets.size,files:records.size,scope:region??'0',
    ...(unplaced.length?{unplaced}:{}),
    ...(widened?{requestedScope:requestedRegion,widened}:{}),
    facts:facts.rows.length-orphans.length,orphanFacts:orphans,factErrors:facts.errors};
}

// Only address-bearing fields are rewritten: a numeric data label is not a map address. Keep
// a durable declaration identity while changing every endpoint that refers to its old address.
function remapReferences(page,held,index,projection,refreshedFiles) {
  const paths=new Map(Object.entries(held.sourceByPath).map(([path,at])=>[at,path]));
  const address=value=>{
    if(typeof value!=='string')return value;
    const prefix=/^(file:|region:)/.exec(value)?.[0]??'';
    const at=value.slice(prefix.length),path=paths.get(at);
    return path&&index.has(path)?prefix+index.get(path):value;
  };
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    for(const [key,item] of Object.entries(value)) {
      if(['index','handle','from','to','region','parent','port','mechanism'].includes(key))value[key]=address(item);
      else visit(item);
    }
    const path=value.path??(value.file&&value.label?`${value.file}::${value.label}`:null);
    const node=path&&projection.nodes.get(path);
    if(node&&refreshedFiles.has(node.file)) {
      if('index' in value)value.index=index.get(path)??value.index;
      for(const key of ['line','endLine'])if(key in value)value[key]=node[key];
      if('lines' in value)value.lines=node.endLine-node.line+1;
    }
  };
  visit(page);
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

// Page 0: the regions as components, the cross-region links as wires, and every way in from
// outside the regions as a port.
function rootPage(m,lines) {
  const components=m.regions.map(r=>({index:r.index,path:r.path,files:r.files.length,
    lines:r.files.reduce((sum,f)=>sum+(lines.get(f)??0),0),nodes:m.inRegion.get(r.index).length,
    entries:m.entries(r.index).length}));
  const wires=new Map(),ports=new Map();
  const add=(from,to,kind,label)=>{
    const key=`${from}\n${to}`,w=wires.get(key)??wires.set(key,{from,to,kinds:{},count:0,labels:new Set()}).get(key);
    w.kinds[kind]=(w.kinds[kind]??0)+1;w.count++;if(label)w.labels.add(label);
  };
  for(const c of m.calls) {
    const to=m.regionOf.get(c.to.file);if(!to)continue;
    if(c.atModule||!c.from) {
      const port=c.atModule?'module':(c.fromFile?.split('/')[0]??'unmapped');
      ports.set(port,port);add(port,to.index,c.atModule?'module':'call',null);
    } else {
      const fromRegion=m.regionOf.get(c.from.file);
      if(!fromRegion){ports.set(c.fromFile.split('/')[0],c.fromFile.split('/')[0]);add(c.fromFile.split('/')[0],to.index,'call',null);}
      else if(fromRegion!==to)add(fromRegion.index,to.index,c.relation.kind,c.label||null);
    }
  }
  for(const c of m.couplings) {
    const from=c.fromFile&&m.regionOf.get(c.fromFile),to=c.toFile&&m.regionOf.get(c.toFile);
    if(!to)continue;
    if(!from){ports.set(c.kind,c.kind);add(c.kind,to.index,c.kind,c.label);}
    else if(from!==to)add(from.index,to.index,c.kind,c.label);
  }
  return {flow:true,generated:true,index:'0',kind:'root',
    regions:components,
    ports:[...ports.keys()].sort(order).map(port=>({port,mechanism:port})),
    wires:[...wires.values()].sort((a,b)=>order(a.from,b.from)||order(a.to,b.to))
      .map(w=>({from:w.from,to:w.to,kinds:w.kinds,count:w.count,...(w.count===1&&w.labels.size===1?{label:[...w.labels][0]}:{})})),
    children:components.map(c=>({index:c.index,path:c.path,files:c.files,lines:c.lines,nodes:c.nodes}))};
}

const links=()=>{
  const wires=new Map(),ports=new Map();
  const add=(from,to,kind,label)=>{
    if(from===undefined||to===undefined||from===to)return;
    const key=`${from}\n${to}`,w=wires.get(key)??wires.set(key,{from,to,kinds:{},count:0,labels:new Set()}).get(key);
    w.kinds[kind]=(w.kinds[kind]??0)+1;w.count++;if(label)w.labels.add(label);
  };
  const port=(name,to,kind,label)=>{ports.set(name,name);add(name,to,kind,label);};
  const drawn=()=>({ports:[...ports.keys()].sort(order).map(p=>({port:p,mechanism:p})),
    wires:[...wires.values()].sort((a,b)=>order(a.from,b.from)||order(a.to,b.to))
      .map(w=>({from:w.from,to:w.to,kinds:w.kinds,count:w.count,...(w.count===1&&w.labels.size===1?{label:[...w.labels][0]}:{})}))});
  return {add,port,drawn};
};

// A region page: the files it holds as components, the links between those files as wires, and
// every way into the region from outside it as a port. A file is a bounded unit of code, so the
// summary a region owes is which of its files reach which.
function moduleDiagnostics(m,files) {
  const sites=files.flatMap(file=>(m.moduleCallSites?.get(file)??[]).map(({state,...site})=>({...site,file,module:true,state})));
  return {unresolved:sites.filter(s=>s.state==='unresolved').map(({state,...s})=>s),
    external:sites.filter(s=>s.state==='external').length,
    moduleCallSites:sites};
}
function regionPage(m,r,numbered,index,packets,lines) {
  const at=new Map(numbered.files.map(f=>[f.file,f.index]));
  const count=new Map(r.files.map(f=>[f,0]));
  for(const n of m.inRegion.get(r.index))count.set(n.file,count.get(n.file)+1);
  const components=numbered.files.map(f=>({index:f.index,file:f.file,lines:lines.get(f.file)??0,
    nodes:count.get(f.file),entries:f.entries.length,...(f.unreached?{unreached:f.unreached.children.length}:{})}));
  const {add,port,drawn}=links();
  for(const n of m.inRegion.get(r.index))for(const {mechanism,label} of m.reached.get(n.path)??[])port(mechanism,at.get(n.file),mechanism,label);
  for(const c of m.calls) {
    if(!c.from||m.regionOf.get(c.from.file)!==r||m.regionOf.get(c.to.file)!==r)continue;
    add(at.get(c.from.file),at.get(c.to.file),c.relation.kind,c.label||null);
  }
  for(const c of m.couplings) {
    if(!c.fromFile||!c.toFile||m.regionOf.get(c.fromFile)!==r||m.regionOf.get(c.toFile)!==r)continue;
    add(at.get(c.fromFile),at.get(c.toFile),c.kind,c.label||null);
  }
  return {flow:true,generated:true,index:r.index,kind:'region',path:r.path,
    files:r.files,lines:r.files.reduce((sum,f)=>sum+(lines.get(f)??0),0),nodes:m.inRegion.get(r.index).length,
    ...drawn(),...moduleDiagnostics(m,r.files),components,
    children:components.map(c=>({index:c.index,file:c.file,lines:c.lines,nodes:c.nodes}))};
}

// A file page: the entry points declared in it as components, the derived `unreached` box for
// whatever the walk from those entries never reaches, and everything that reaches them — other
// files of the region, other regions, outside callers — as ports.
function filePage(m,r,f,numbered,index,packets,lines) {
  const at=new Map(numbered.files.map(x=>[x.file,x.index]));
  const box=n=>({index:index.get(n.path),label:n.path.slice(n.file.length+2),file:n.file,line:n.line,
    endLine:n.endLine,lines:n.endLine-n.line+1,...(packets.has(n.path)&&destinationFor(packets.get(n.path))==='graph'?{}:{leaf:true})});
  const components=f.entries.map(b=>box(b.node));
  const unreached=f.unreached?f.unreached.children.map(b=>box(b.node)):[];
  const shown=new Set(components.map(c=>c.index));
  const {add,port,drawn}=links();
  for(const b of f.entries)for(const {mechanism,label} of m.reached.get(b.node.path)??[])port(mechanism,b.index,mechanism,label);
  for(const c of m.calls) {
    if(!c.from)continue;
    const to=index.get(c.to.path);if(!shown.has(to))continue;
    const from=index.get(c.from.path);
    if(shown.has(from))add(from,to,c.relation.kind,c.label||null);
    else if(m.regionOf.get(c.from.file)===r&&c.from.file!==f.file)port(`file:${at.get(c.from.file)}`,to,c.relation.kind,c.label||null);
  }
  return {flow:true,generated:true,index:f.index,kind:'file',file:f.file,region:r.index,
    lines:lines.get(f.file)??0,nodes:m.inRegion.get(r.index).filter(n=>n.file===f.file).length,
    ...drawn(),...moduleDiagnostics(m,[f.file]),components,
    ...(f.unreached?{unreached:{index:f.unreached.index,nodes:unreached}}:{unreached:{nodes:[]}}),
    children:[...components,...unreached].map(c=>({index:c.index,label:c.label,file:c.file,lines:c.lines}))};
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
  if(at===undefined)throw Error(`No generated page for ${key}. Read 0 for the regions.`);
  const page=at==='0'?held.root:held.groupPages?.[at]??held.regionPages[at]??held.filePages?.[at]??await nodePage(dir,held,at);
  if(!page)throw Error(`No generated page ${at}. Read 0 for the regions.`);
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
// code: complete files for a region, source spans for a contextual group, or its own declaration.
async function codeFor(page,held,dir) {
  if(page.kind==='root')
    throw Error(`Page ${page.index} is a root page; --code takes a region, file, group or node. Read 0 without --code for its regions.`);
  if(page.kind==='region'||page.kind==='group') {
    const spans=[];
    if(page.kind==='region')for(const file of page.files)spans.push({file,line:1,endLine:held.files[file].lines});
    else for(const path of page.codeTargets??[]) {
      const at=held.byPath[path],target=held.filePages[at]??await nodePage(dir,held,at);
      if(!target)throw Error(`Group ${page.index} refers to missing code ${path}; regenerate 0.`);
      spans.push({file:target.file,line:target.kind==='file'?1:target.line,endLine:target.kind==='file'?target.lines:target.endLine});
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
  if(page.kind==='file')
    return {generated:true,index:page.index,kind:page.kind,file:page.file,line:1,endLine:page.lines,lines:page.lines,code:true};
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
  const totals={regions:held.regions.length,files:Object.keys(held.files).length,pages:nodes.length,
    linked:nodes.reduce((n,p)=>n+p.components.length,0),
    unresolved:nodes.reduce((n,p)=>n+p.unresolved.length,0),
    external:nodes.reduce((n,p)=>n+(p.external??0),0)};
  const unreached=Object.values(held.filePages??{}).flatMap(p=>(p.unreached?.nodes??[])
    .map(n=>({index:n.index,path:`${n.file}::${n.label}`,lines:n.lines})));
  return {dir,missing:false,generated:held.generated,
    stale,
    totals,unreached:unreached.sort((a,b)=>byIndex(a.index,b.index)),
    facts,orphanFacts:held.orphanFacts??[]};
}
