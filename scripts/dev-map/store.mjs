// The stored map. Scanning is a choice: `generate` is the only thing that reads source and
// resolves links; every read afterwards comes out of this store. The store holds one record per
// source file, keyed by that file's content hash, so a read can tell without scanning whether
// what it returns still matches the code.
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFlow,flowPacket} from './flow.mjs';
import {model,numberRegion} from './regions.mjs';

export const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
export const storeDir=repo=>resolve(repo,'dev-map/generated');
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
  const context=await clock('load',()=>loadFlow({repo,...(readSource?{readSource}:{}),...(files?{files}:{})}));
  Object.assign(timings,context.timings);
  const {graph,projection}=context,lines=new Map(graph.files.map(f=>[f.file,f.lines]));
  const dir=storeDir(repo),held=await readIndex(dir);
  const m=model(graph,projection);
  if(region&&!m.regions.some(r=>r.index===region))throw Error(`Unknown region ${region}; regions are ${m.regions.map(r=>r.index).join(', ')}.`);
  const scoped=region?m.regions.filter(r=>r.index===region):m.regions;

  // Numbering. A scoped run keeps every index the store already holds outside the region.
  const index=new Map();
  if(region&&held)for(const [path,at] of Object.entries(held.byPath))if(at.split('.')[0]!==region)index.set(path,at);
  const trees=new Map(),entries=new Map();
  for(const r of scoped) {
    const numbered=numberRegion(m,r);
    for(const [path,at] of numbered.index)index.set(path,at);
    trees.set(r.index,numbered);entries.set(r.index,numbered.entries);
  }
  for(const n of projection.nodes.values())if(index.has(n.path))n.handle=index.get(n.path);

  // Packets. A scoped run reuses the stored packet of every node outside the region.
  const packets=new Map();
  const mine=new Set(scoped.flatMap(r=>r.files));
  await clock('pages',async()=>{for(const n of m.nodes)if(mine.has(n.file))packets.set(n.path,flowPacket(context,n.path));});
  if(region&&held)for(const record of await Promise.all(Object.values(held.records).map(f=>json(resolve(dir,'files',f)))))
    for(const packet of Object.values(record.pages))if(!mine.has(packet.file))packets.set(packet.path,packet);

  // A stored component names its node by file and label; its index is read back from the map so
  // a renumbered region is followed everywhere it is referenced.
  for(const packet of packets.values()) {
    packet.index=index.get(packet.path)??packet.index;
    for(const c of packet.components)c.index=index.get(`${c.file}::${c.label}`)??c.index;
    for(const f of packet.formulas)f.index=index.get(`${f.file}::${f.label}`)??f.index;
    for(const r of packet.requires)r.index=index.get(r.by)??r.index;
  }
  // Consequences: `calledFrom` is the exact inverse of the components, couplings carry the other
  // end's index, and the leaf mark says a component's own page holds no further step.
  const from=new Map();
  for(const packet of packets.values())for(const c of packet.components) {
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
  const leafOf=path=>packets.get(path)?.components.length===0;
  for(const packet of packets.values()) {
    packet.calledFrom=(from.get(packet.path)??[]).sort((a,b)=>byIndex(a.index,b.index));
    packet.couplings=coupled.get(packet.path)??[];
    for(const c of packet.components){if(leafOf(`${c.file}::${c.label}`))c.leaf=true;else delete c.leaf;}
  }

  // Root, region and file pages, and the file records the node pages are stored in.
  const regionPages=new Map(held?Object.entries(held.regionPages??{}):[]);
  const filePages=new Map(held?Object.entries(held.filePages??{}):[]);
  if(region)for(const [at,page] of [...filePages])if(at.split('.')[0]===region)filePages.delete(at);
  for(const r of scoped) {
    const numbered=trees.get(r.index);
    regionPages.set(r.index,regionPage(m,r,numbered,index,packets,lines));
    for(const f of numbered.files)filePages.set(f.index,filePage(m,r,f,numbered,index,packets,lines));
  }
  const root=rootPage(m,lines);
  const records=new Map();
  for(const f of graph.files) {
    const file=f.file;if(!m.regionOf.has(file))continue;
    const pages=Object.fromEntries([...packets.values()].filter(p=>p.file===file).map(p=>[p.index,p]));
    records.set(file,{file,sha256:f.sha256,lines:f.lines,region:m.regionOf.get(file).index,pages});
  }
  const stored={schema:2,generated:new Date().toISOString().slice(0,10),
    regions:m.regions.map(r=>({index:r.index,path:r.path,files:r.files})),
    files:Object.fromEntries([...records.values()].map(r=>[r.file,{sha256:r.sha256,lines:r.lines,region:r.region}])),
    records:Object.fromEntries([...records.keys()].map(f=>[f,`${slug(f)}.json`])),
    nodes:Object.fromEntries([...packets.values()].map(p=>[p.index,{path:p.path,file:p.file}]).sort((a,b)=>byIndex(a[0],b[0]))),
    byPath:Object.fromEntries([...[...packets.values()].map(p=>[p.path,p.index]),
      ...[...filePages.values()].map(p=>[p.file,p.index])].sort((a,b)=>order(a[0],b[0]))),
    root,regionPages:Object.fromEntries([...regionPages].sort((a,b)=>byIndex(a[0],b[0]))),
    filePages:Object.fromEntries([...filePages].sort((a,b)=>byIndex(a[0],b[0])))};
  await clock('write',async()=>{
    if(!region)await rm(resolve(dir,'files'),{recursive:true,force:true});
    await mkdir(resolve(dir,'files'),{recursive:true});
    for(const record of records.values())await write(resolve(dir,'files',`${slug(record.file)}.json`),record);
    await write(resolve(dir,'index.json'),stored);
  });
  return {timings,regions:m.regions.length,pages:packets.size,files:records.size,scope:region??'0'};
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
    ...drawn(),components,
    children:components.map(c=>({index:c.index,file:c.file,lines:c.lines,nodes:c.nodes}))};
}

// A file page: the entry points declared in it as components, the derived `unreached` box for
// whatever the walk from those entries never reaches, and everything that reaches them — other
// files of the region, other regions, outside callers — as ports.
function filePage(m,r,f,numbered,index,packets,lines) {
  const at=new Map(numbered.files.map(x=>[x.file,x.index]));
  const box=n=>({index:index.get(n.path),label:n.path.slice(n.file.length+2),file:n.file,line:n.line,
    endLine:n.endLine,lines:n.endLine-n.line+1,...(packets.get(n.path)?.components.length?{}:{leaf:true})});
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
    ...drawn(),components,
    ...(f.unreached?{unreached:{index:f.unreached.index,nodes:unreached}}:{unreached:{nodes:[]}}),
    children:[...components,...unreached].map(c=>({index:c.index,label:c.label,file:c.file,lines:c.lines}))};
}

// ---- reading ----------------------------------------------------------------------------
export async function readIndex(dir) {
  try {return await json(resolve(dir,'index.json'));} catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// Every read hashes the source behind what it returns and says so in data when they differ.
export async function readGenerated(target,{repo=repoRoot,code=false,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const dir=storeDir(repo),held=await readIndex(dir);
  if(!held)return {generated:true,stale:{regenerate:'0'}};
  const key=String(target).replaceAll('\\','/').replace(/\/$/,'');
  const at=/^\d+(\.\d+)*$/.test(key)?key:held.byPath[key];
  if(at===undefined)throw Error(`No generated page for ${key}. Read 0 for the regions.`);
  const page=at==='0'?held.root:held.regionPages[at]??held.filePages?.[at]??await nodePage(dir,held,at);
  if(!page)throw Error(`No generated page ${at}. Read 0 for the regions.`);
  const behind=at==='0'?Object.keys(held.files)
    :page.kind==='region'?page.files
    :page.kind==='file'?[page.file]
    :[...new Set([page.file,...page.components.map(c=>c.file)])];
  const stale=await staleness(held,behind,readSource);
  if(code)return {...codeFor(page,held),...(stale?{stale}:{})};
  return {...page,...(stale?{stale}:{})};
}

async function nodePage(dir,held,at) {
  const node=held.nodes[at];if(!node)return null;
  const record=await json(resolve(dir,'files',held.records[node.file]));
  return record.pages[at]??null;
}

async function staleness(held,behind,readSource) {
  const changed=[];
  for(const file of behind) {
    const stored=held.files[file];
    if(!stored){changed.push(file);continue;}
    const text=await Promise.resolve(readSource(file)).catch(()=>null);
    if(text===null||sha(text)!==stored.sha256)changed.push(file);
  }
  if(!changed.length)return null;
  const regions=[...new Set(changed.map(f=>held.files[f]?.region).filter(Boolean))];
  return {regenerate:regions.length===1?regions[0]:'0',files:changed.sort(order)};
}

// `--code` answers a function page or a leaf with its own span, and a file page with the whole
// file: a file is a bounded unit of code whose size the page already states. A root or region page
// spans no code of its own, so it answers with its children and how many lines each one is.
function codeFor(page,held) {
  if(page.kind==='root'||page.kind==='region')
    return {generated:true,index:page.index,kind:page.kind,code:false,children:page.children};
  if(page.kind==='file')
    return {generated:true,index:page.index,kind:page.kind,file:page.file,line:1,endLine:page.lines,lines:page.lines,code:true};
  return {generated:true,index:page.index,path:page.path,file:page.file,line:page.line,endLine:page.endLine,lines:page.lines,code:true};
}

export async function readCode(target,{repo=repoRoot,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const head=await readGenerated(target,{repo,code:true,readSource});
  if(!head.code)return head;
  const text=await readSource(head.file);
  const lines=text.split('\n').slice(head.line-1,head.endLine).map((line,i)=>`${head.line+i}\t${line}`);
  return {...head,source:lines.join('\n')};
}
