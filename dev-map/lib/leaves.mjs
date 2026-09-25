// The mapped code as one call graph. Nothing about the map comes from where code is written: no
// directory or file is a place, a box or a boundary. A declaration's durable name still says
// which file holds it, and scope (scope.mjs) says which code is mapped at all.
import {isMapped,outsideRootOf,activeCallers} from './scope.mjs';
const order=(a,b)=>a<b?-1:a>b?1:0;
const COUPLINGS=new Set(['file','http-route','worker-message','registry-entry','event-listener']);
// A declaration written as `x.onthing = function` is reached by the host that fires it. At module
// level the element and the event name it, so the event is the last segment of that name.
const domHandler=d=>d.kind==='handler'&&/(?:^|\.)on[a-z]/.test(d.name);
// A call made on a parameter is an invocation of whatever a caller passed: the callable is the
// caller's code.
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
  const moduleCallSites=new Map();
  for(const [state,sites] of [['external',graph.callSites?.externalSites??[]],['unresolved',graph.callSites?.unresolved??[]]])for(const record of sites){
    if(!record.from?.endsWith(':<module>'))continue;
    const {site}=record,file=site.file;
    const rows=moduleCallSites.get(file)??moduleCallSites.set(file,[]).get(file);
    rows.push({state,call:site.text,line:site.line,column:site.column,start:site.start,end:site.end,rule:record.rule??record.reason});
  }
  const leafOf=leaves(nodes,calls,couplings,mapped);
  return {files,mapped,nodes,calls,outsideCalls,couplings,reached,moduleCallSites,leafOf,
    ...externals({calls,outsideCalls,couplings,reached,leafOf}),
    fileLines:new Map(graph.files.map(f=>[f.file,f.lines]))};
}

// Externals: what outside the maps links to a leaf. Each outside declaration that calls in, is
// called, or couples in is one external; so are the browser, firing DOM events, and module load,
// running module-level code. Inactive outside code (tests, demos, benchmarks) is counted on the
// leaf and never drawn, and a platform call reaches no scanned code. `externalLinks` are
// {external, leaf, out}, `out` when the leaf reaches the external.
function externals({calls,outsideCalls,couplings,reached,leafOf}) {
  const known=new Map(),seen=new Set(),externalLinks=[];
  const add=(external,label,root,path,out)=>{
    const leaf=leafOf.get(path);if(!leaf)return;
    if(!known.has(external))known.set(external,{id:external,label,root});
    const key=`${external}\n${leaf}\n${out}`;
    if(!seen.has(key)){seen.add(key);externalLinks.push({external,leaf,out});}
  };
  const declaration=(path,file)=>[path,path.includes('::')?path.slice(path.indexOf('::')+2):path.slice(path.lastIndexOf('/')+1),outsideRootOf(file)];
  for(const c of calls) {
    if(c.from&&isMapped(c.from.file))continue;
    if(c.fromFile&&isMapped(c.fromFile)){if(c.atModule)add('module load','module load','module load',c.to.path,false);continue;}
    if(!c.fromFile||!activeCallers(c.fromFile))continue;
    const [id,label,root]=declaration(c.fromPath??c.fromFile,c.fromFile);
    add(id,label,root,c.to.path,false);
  }
  for(const c of outsideCalls)if(c.from){const [id,label,root]=declaration(c.to.path,c.to.file);add(id,label,root,c.from.path,true);}
  for(const c of couplings) {
    if(c.to&&!c.from&&c.fromFile&&!isMapped(c.fromFile)){const [id,label,root]=declaration(c.fromFile,c.fromFile);add(id,label,root,c.to.path,false);}
    if(c.from&&!c.to&&c.toFile&&!isMapped(c.toFile)){const [id,label,root]=declaration(c.toFile,c.toFile);add(id,label,root,c.from.path,true);}
  }
  for(const [path,list] of reached)if(list.some(r=>r.mechanism==='dom-event'))add('browser','browser','browser',path,false);
  const order=(a,b)=>a<b?-1:a>b?1:0;
  return {externals:[...known.values()].sort((a,b)=>order(a.id,b.id)),
    externalLinks:externalLinks.sort((a,b)=>order(a.external,b.external)||order(a.leaf,b.leaf)||Number(a.out)-Number(b.out))};
}

// Every scoped declaration is drawn by exactly one leaf. A declaration written inside another is
// part of the enclosing declaration's leaf when it only serves that declaration: nothing outside
// the enclosing declaration's own code reaches it. One that other code calls or links to directly,
// or that code outside the maps calls, interacts with the rest differently and is a leaf of its
// own. A callable passed into a parameter stays the passing code's, and module evaluation belongs
// to no declaration, so neither makes a leaf. Returns declaration path → leaf path.
function leaves(nodes,calls,couplings,mapped) {
  const within=(n,holder)=>{for(let at=n;at;at=at.parent)if(at===holder)return true;return false;};
  const own=new Set(nodes.filter(n=>!n.parent).map(n=>n.path));
  for(const c of calls) {
    if(!c.to.parent||c.atModule||callback(c))continue;
    if(!c.from||!mapped.has(c.from.file)||!within(c.from,c.to.parent))own.add(c.to.path);
  }
  for(const c of couplings)if(c.to?.parent&&c.from&&!within(c.from,c.to.parent))own.add(c.to.path);
  const leafOf=new Map(),find=n=>own.has(n.path)?n.path:leafOf.get(n.parent.path)??find(n.parent);
  for(const n of nodes)leafOf.set(n.path,find(n));
  return leafOf;
}

// The names a relation carries, so a wire is labelled in the code's own words.
function names(r,byId) {
  if(r.kind==='call'||r.kind==='construct')return [...new Set((r.args??[]).map((a,i)=>r.params?.[i]??a).filter(Boolean))];
  return r.label?[r.label]:[];
}

// Internal addresses, one number per declaration, by name. They are identities only; published
// indexes are the map tree's (tree.mjs).
export function numberNodes(m) {
  return new Map([...m.nodes].sort((a,b)=>order(a.path,b.path)).map((n,i)=>[n.path,String(i+1)]));
}
