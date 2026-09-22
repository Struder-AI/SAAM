// Regions are the mapped directories under core/ and studio/ that directly hold source files,
// numbered in sorted path order; a directory the scope excludes is scanned but is no region.
// Declarations have canonical addresses under their own source file.
// Composition can place contextual appearances elsewhere without changing this source identity.
import {isMapped,outsideRootOf} from './scope.mjs';
const dirname=f=>f.slice(0,f.lastIndexOf('/'));
const order=(a,b)=>a<b?-1:a>b?1:0;
const COUPLINGS=new Set(['file','http-route','worker-message','registry-entry','event-listener']);
// A declaration written as `x.onthing = function` is reached by the host that fires it.
const domHandler=d=>d.kind==='handler'&&/^on[a-z]/.test(d.name);

export function regionsOf(graph) {
  const files=graph.files.map(f=>f.file).filter(isMapped).sort(order);
  return [...new Set(files.map(dirname))].sort(order).map((path,i)=>
    ({index:String(i+1),path,files:files.filter(f=>dirname(f)===path)}));
}

// Every call, coupling and handoff reduced to node endpoints, with the mechanism that carries it.
export function model(graph,projection) {
  const regions=regionsOf(graph),regionOf=new Map();
  for(const r of regions)for(const f of r.files)regionOf.set(f,r);
  const byId=new Map(graph.declarations.map(d=>[d.id,d]));
  const moduleFile=id=>id.endsWith(':<module>')?id.slice(0,id.length-':<module>'.length):null;
  const owner=id=>projection.owner.get(id)??null;
  const node=id=>{const n=owner(id);return n&&n.kind!=='module'?n:null;};
  // Module top level, and code enclosed in a declaration that is no node of its own, are both
  // reached when the module is evaluated; neither is a caller inside any region.
  const atModule=id=>!!moduleFile(id)||owner(id)?.kind==='module';
  const fileOf=id=>node(id)?.file??byId.get(id)?.file??moduleFile(id);
  const domNodes=new Set(graph.declarations.filter(domHandler).map(d=>d.anchor).filter(Boolean));

  const calls=[],couplings=[];
  for(const r of graph.relations) {
    const at=r.evidence?.[0]??null;
    if(['call','construct'].includes(r.kind)) {
      const to=node(r.to);if(!to)continue;
      calls.push({from:node(r.from),fromFile:fileOf(r.from),atModule:atModule(r.from),to,start:at?.start??0,
        line:at?.line??null,label:names(r,byId).join(', '),relation:r});
    } else if(COUPLINGS.has(r.kind)||r.kind==='worker-handoff') {
      const kind=r.kind==='worker-handoff'?'worker-message':r.kind;
      couplings.push({kind,label:r.label??null,from:node(r.from),to:node(r.to),
        fromFile:fileOf(r.from),toFile:fileOf(r.to),line:at?.line??null});
    }
  }
  // How a node is reached from outside its own region, by mechanism.
  const reached=new Map(),note=(n,mechanism,from,label=null)=>{
    const key=n.path,list=reached.get(key)??reached.set(key,[]).get(key);
    if(!list.some(e=>e.mechanism===mechanism&&e.from===from&&e.label===label))list.push({mechanism,from,label});
  };
  const hasCaller=new Set();
  for(const c of calls) {
    hasCaller.add(c.to.path);
    const home=regionOf.get(c.to.file);
    if(c.atModule)note(c.to,'module',c.fromFile);
    else if(!c.from)note(c.to,c.fromFile?outsideRootOf(c.fromFile):'unmapped-caller',c.fromFile);
    else {
      const from=regionOf.get(c.from.file);
      if(!from)note(c.to,outsideRootOf(c.fromFile),c.fromFile);
      else if(from!==home)note(c.to,`region:${from.index}`,c.from.path);
    }
  }
  for(const c of couplings) {
    if(c.to){hasCaller.add(c.to.path);note(c.to,c.kind,c.from?.path??c.fromFile,c.label);}
    if(c.from&&c.kind==='registry-entry')hasCaller.add(c.from.path);
  }
  for(const path of domNodes)if(projection.nodes.has(path))note(projection.nodes.get(path),'dom-event',null);

  const nodes=[...projection.nodes.values()].filter(n=>n.kind!=='module'&&regionOf.has(n.file));
  const inRegion=new Map(regions.map(r=>[r.index,[]]));
  for(const n of nodes)inRegion.get(regionOf.get(n.file).index).push(n);
  for(const list of inRegion.values())list.sort((a,b)=>order(a.file,b.file)||a.start-b.start);
  // Callees inside the same region, in first-appearance order within the caller's own body.
  const callees=new Map();
  for(const c of calls) {
    if(!c.from||regionOf.get(c.from.file)!==regionOf.get(c.to.file)||c.from===c.to)continue;
    const list=callees.get(c.from.path)??callees.set(c.from.path,[]).get(c.from.path);
    const found=list.find(x=>x.to===c.to);
    if(found)found.start=Math.min(found.start,c.start);else list.push({to:c.to,start:c.start});
  }
  for(const list of callees.values())list.sort((a,b)=>a.start-b.start);
  const moduleCallSites=new Map();
  for(const [state,sites] of [['external',graph.callSites?.externalSites??[]],['unresolved',graph.callSites?.unresolved??[]]])for(const record of sites){
    if(!record.from?.endsWith(':<module>'))continue;
    const {site}=record,file=site.file;
    const rows=moduleCallSites.get(file)??moduleCallSites.set(file,[]).get(file);
    rows.push({state,call:site.text,line:site.line,column:site.column,start:site.start,end:site.end,rule:record.rule??record.reason});
  }
  return {regions,regionOf,nodes,inRegion,calls,couplings,reached,hasCaller,callees,moduleCallSites,
    fileLines:new Map(graph.files.map(f=>[f.file,f.lines])),
    entries:index=>inRegion.get(index).filter(n=>reached.has(n.path)||!hasCaller.has(n.path))};
}

// The names a relation carries, so a wire is labelled in the code's own words.
function names(r,byId) {
  if(r.kind==='call'||r.kind==='construct')return [...new Set((r.args??[]).map((a,i)=>r.params?.[i]??a).filter(Boolean))];
  return r.label?[r.label]:[];
}

// Canonical identity follows source containment, never whichever caller reaches a node first.
// These region.file.declaration addresses are internal: published indexes are the map tree's
// (tree.mjs), and these serve scoped reuse only.
// A nested declaration is placed by the declaration that holds it, never beside it, so only
// top-level declarations are a file's entries. Every declaration still gets a source address.
export function numberRegion(m,region) {
  const index=new Map();
  const files=region.files.map((file,i)=>({file,index:`${region.index}.${i+1}`,entries:[],unreached:null}));
  for(const f of files) {
    let at=0;
    for(const n of m.inRegion.get(region.index).filter(n=>n.file===f.file)) {
      const handle=`${f.index}.${++at}`;
      index.set(n.path,handle);
      if(!n.parent)f.entries.push({index:handle,node:n,children:[]});
    }
  }
  return {entries:m.entries(region.index),index,files};
}
