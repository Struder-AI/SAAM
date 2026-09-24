// The mapped code as one call graph. Nothing about the map comes from where code is written: no
// directory or file is a place, a box or a boundary. A declaration's durable name still says
// which file holds it, and scope (scope.mjs) says which code is mapped at all.
import {isMapped,outsideRootOf} from './scope.mjs';
const order=(a,b)=>a<b?-1:a>b?1:0;
const COUPLINGS=new Set(['file','http-route','worker-message','registry-entry','event-listener']);
const outermost=n=>{let node=n;while(node.parent)node=node.parent;return node;};
// A declaration written as `x.onthing = function` is reached by the host that fires it. At module
// level the element and the event name it, so the event is the last segment of that name.
const domHandler=d=>d.kind==='handler'&&/(?:^|\.)on[a-z]/.test(d.name);
// A call made on a parameter is an invocation of whatever a caller passed. The callable is the
// caller's code, so it is no step inside the callee's flow: it does not put the target under the
// callee, and a declaration reached only this way is an entry point.
const callback=c=>!!c.relation?.viaParameter;

// Every call, coupling and handoff reduced to node endpoints, with the mechanism that carries it.
export function model(graph,projection) {
  const files=graph.files.map(f=>f.file).filter(isMapped).sort(order),mapped=new Set(files);
  const byId=new Map(graph.declarations.map(d=>[d.id,d]));
  const moduleFile=id=>id.endsWith(':<module>')?id.slice(0,id.length-':<module>'.length):null;
  const owner=id=>projection.owner.get(id)??null;
  const node=id=>{const n=owner(id);return n&&n.kind!=='module'?n:null;};
  // Module top level, and code enclosed in a declaration that is no node of its own, are both
  // reached when the module is evaluated; neither is a caller inside the map.
  const atModule=id=>!!moduleFile(id)||owner(id)?.kind==='module';
  const fileOf=id=>node(id)?.file??byId.get(id)?.file??moduleFile(id);
  const domNodes=new Set(graph.declarations.filter(domHandler).map(d=>d.anchor).filter(Boolean));

  const calls=[],couplings=[],outsideCalls=[];
  for(const r of graph.relations) {
    const at=r.evidence?.[0]??null;
    if(['call','construct'].includes(r.kind)) {
      const to=node(r.to);
      if(!to) {
        // A call that leaves the mapped roots for scanned source. It has no map address, but the
        // declaration it reaches is named, so every level can draw where its code goes outside.
        const target=byId.get(r.to),fromFile=fileOf(r.from);
        if(target&&target.anchor&&!isMapped(target.file)&&fromFile&&isMapped(fromFile))
          outsideCalls.push({from:node(r.from),fromFile,atModule:atModule(r.from),root:outsideRootOf(target.file),
            to:{path:target.anchor,file:target.file,label:target.name},start:at?.start??0,line:at?.line??null});
        continue;
      }
      calls.push({from:node(r.from),fromFile:fileOf(r.from),fromPath:byId.get(r.from)?.anchor??null,
        atModule:atModule(r.from),to,start:at?.start??0,
        line:at?.line??null,label:names(r,byId).join(', '),relation:r});
    } else if(COUPLINGS.has(r.kind)||r.kind==='worker-handoff') {
      const kind=r.kind==='worker-handoff'?'worker-message':r.kind;
      couplings.push({kind,label:r.label??null,...(r.table?{table:true}:{}),from:node(r.from),to:node(r.to),
        fromFile:fileOf(r.from),toFile:fileOf(r.to),line:at?.line??null});
    }
  }
  // How a node is reached from outside the map, by mechanism.
  const reached=new Map(),note=(n,mechanism,from,label=null)=>{
    const key=n.path,list=reached.get(key)??reached.set(key,[]).get(key);
    if(!list.some(e=>e.mechanism===mechanism&&e.from===from&&e.label===label))list.push({mechanism,from,label});
  };
  for(const c of calls) {
    if(c.atModule)note(c.to,'module',c.fromFile);
    else if(!c.from)note(c.to,c.fromFile?outsideRootOf(c.fromFile):'unmapped-caller',c.fromFile);
    else if(!mapped.has(c.from.file))note(c.to,outsideRootOf(c.fromFile),c.fromFile);
  }
  for(const c of couplings)if(c.to)note(c.to,c.kind,c.from?.path??c.fromFile,c.label);
  for(const path of domNodes)if(projection.nodes.has(path))note(projection.nodes.get(path),'dom-event',null);

  const nodes=[...projection.nodes.values()].filter(n=>n.kind!=='module'&&mapped.has(n.file));
  const inMap=c=>c.from&&mapped.has(c.from.file)&&mapped.has(c.to.file);
  // Callees, in first-appearance order within the caller's own body.
  const callees=new Map();
  for(const c of calls) {
    if(callback(c))continue;
    if(!inMap(c)||c.from===c.to)continue;
    const list=callees.get(c.from.path)??callees.set(c.from.path,[]).get(c.from.path);
    const found=list.find(x=>x.to===c.to);
    if(found)found.start=Math.min(found.start,c.start);else list.push({to:c.to,start:c.start});
  }
  for(const list of callees.values())list.sort((a,b)=>a.start-b.start);
  // Where the flows begin. An entry point is a top-level declaration that no mapped declaration
  // calls. A coupling is not a call here — a registry entry, route, worker message or file
  // handoff names a declaration without putting it inside another declaration's flow — and
  // neither is a call made while a module is evaluated, which belongs to no declaration at all.
  // A declaration reached only that way, only from outside the map, or by nothing, is an entry
  // point. Recursion, direct or through a helper the declaration holds, does not place a
  // declaration under itself.
  const called=new Set(),edges=new Map();
  for(const c of calls) {
    if(callback(c)||!inMap(c))continue;
    const from=outermost(c.from),to=outermost(c.to);
    if(from===to)continue;
    (edges.get(from.path)??edges.set(from.path,new Set()).get(from.path)).add(to.path);
    if(!c.to.parent)called.add(c.to.path);
  }
  const tops=nodes.filter(n=>!n.parent);
  const reach=path=>{
    const seen=new Set([path]),stack=[path];
    while(stack.length)for(const to of edges.get(stack.pop())??[])if(!seen.has(to)){seen.add(to);stack.push(to);}
    return seen.size;
  };
  // Entry points in the order of how much each reaches, most first, then by name: the flow that
  // reaches a shared declaration first homes it, so the largest flows claim what they share.
  const byReach=list=>list.map(n=>[n,reach(n.path)]).sort((a,b)=>b[1]-a[1]||order(a[0].path,b[0].path)).map(([n])=>n);
  const roots=byReach(tops.filter(n=>!called.has(n.path)));
  // Which entry box owns a declaration: the first entry point, in that order, whose calls reach
  // it, walking each entry's calls depth first. That is the entry the walk homes it under, and
  // the top map contracts its links onto that entry. A declaration in a call cycle no entry point
  // enters is stranded: it keeps a box of its own rather than being dropped.
  const ownerRoot=new Map();
  const claim=box=>{
    const stack=[box.path];
    while(stack.length) {
      const at=stack.pop();
      if(ownerRoot.has(at))continue;
      ownerRoot.set(at,box.path);
      for(const to of edges.get(at)??[])stack.push(to);
    }
  };
  for(const root of roots)claim(root);
  const stranded=byReach(tops.filter(n=>!ownerRoot.has(n.path)));
  for(const orphan of stranded)claim(orphan);
  const entries=[...roots,...stranded];
  // A nested declaration is drawn and homed with the top-level declaration that holds it.
  for(const n of nodes)if(n.parent)ownerRoot.set(n.path,ownerRoot.get(outermost(n).path));
  const moduleCallSites=new Map();
  for(const [state,sites] of [['external',graph.callSites?.externalSites??[]],['unresolved',graph.callSites?.unresolved??[]]])for(const record of sites){
    if(!record.from?.endsWith(':<module>'))continue;
    const {site}=record,file=site.file;
    const rows=moduleCallSites.get(file)??moduleCallSites.set(file,[]).get(file);
    rows.push({state,call:site.text,line:site.line,column:site.column,start:site.start,end:site.end,rule:record.rule??record.reason});
  }
  return {files,mapped,nodes,calls,outsideCalls,couplings,reached,callees,moduleCallSites,
    roots,stranded,entries,ownerRoot,
    fileLines:new Map(graph.files.map(f=>[f.file,f.lines]))};
}

// The names a relation carries, so a wire is labelled in the code's own words.
function names(r,byId) {
  if(r.kind==='call'||r.kind==='construct')return [...new Set((r.args??[]).map((a,i)=>r.params?.[i]??a).filter(Boolean))];
  return r.label?[r.label]:[];
}

// Internal addresses, one number per declaration: the entry points first, in their order, then
// every other declaration by name. They are identities only; published indexes are the map
// tree's (tree.mjs).
export function numberNodes(m) {
  const first=new Set(m.entries.map(n=>n.path));
  const rest=m.nodes.filter(n=>!first.has(n.path)).sort((a,b)=>order(a.path,b.path));
  return new Map([...m.entries,...rest].map((n,i)=>[n.path,String(i+1)]));
}
