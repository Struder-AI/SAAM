// Derive declaration containment without turning an authored preview or an
// observed dependency into permission. Raw source/effect rows are never rewritten.
import {privateCallableReferences} from './helpers.mjs';

export function semanticContainment({graph,projection,asts,spec,ownership,bindings,pipelineProofs=[]}) {
  const nodes=new Map(spec.nodes.map(n=>[n.id,n])),indexes=new Map(spec.nodes.map(n=>[n.index,n.id]));
  const declarations=new Map(graph.declarations.map(d=>[d.id,d]));
  const top=id=>nodes.has(id)?indexes.get(nodes.get(id).index.split('.')[0]):id;
  const authored=ownership.leaves??{},homes={},owners={},provenance={},folds=[],blocked=[],provisional=[];
  const protectedPaths=new Set((bindings.bindings??bindings??[]).map(b=>b.target));
  const protectedNodes=new Set(spec.contracts.flatMap(c=>[c.from,c.to,...(c.access??[]).flatMap(a=>[a.from,a.to])]));
  const pathOf=n=>n.kind==='module'?`${n.file}::@module`:n.path;
  const sourceNodes=new Map();
  for(const n of nodes.values())if(n.source?.declaration) {
    const path=`${n.source.file}::${n.source.declaration}`;
    (sourceNodes.get(path)??sourceNodes.set(path,[]).get(path)).push(n.id);
    if(protectedNodes.has(n.id))protectedPaths.add(path);
  }
  const references=privateCallableReferences({graph,asts});
  for(const [path,r] of references)if(r.exported||r.escapes.some(s=>['ExportSpecifier','ExportDefaultDeclaration'].includes(s.kind)))protectedPaths.add(path);
  const units=new Map([...projection.nodes.values()].map(n=>[pathOf(n),n]));
  for(const [file] of asts)if(!units.has(`${file}::@module`))units.set(`${file}::@module`,{kind:'module',file});
  for(const n of units.values()) {
    const path=pathOf(n);if(/@\d+:\d+/.test(path))continue;
    homes[path]=path;
    const declared=authored[path]?.owner??null,root=top(declared),hints=sourceNodes.get(path)??[];
    const exact=hints.filter(id=>top(id)===root),conflicts=hints.filter(id=>top(id)!==root);
    owners[path]=exact.length===1?exact[0]:declared;
    provenance[path]={home:'declaration',nesting:'provisional',owner:exact.length===1?'exact-source-reference':'provisional-authored-assignment',rootOwner:root,
      ...(hints.length?{sourceNodes:hints}:{}),...(protectedPaths.has(path)?{publicEntry:true}:{})};
    if(conflicts.length||exact.length!==1)provisional.push({declaration:path,owner:owners[path],reason:conflicts.length?'Source preview conflicts with actual root responsibility.':exact.length>1?'Multiple exact source previews; no unique operation home.':'No unique exact declaration preview; authored nesting is unproved.',evidence:{authored:declared,sourceNodes:hints}});
  }
  // An escaping/anonymous callable is not its factory. Without its own proved
  // semantic home it blocks a fold; keep that incoming identity in the evidence.
  const endpoint=id=>{const d=declarations.get(id),n=projection.owner.get(id);return d?.callable?d.anchor??d.id:n?pathOf(n):null;};
  const arrivals=new Map();
  for(const r of graph.relations) {
    const to=endpoint(r.to);if(!to)continue;
    (arrivals.get(to)??arrivals.set(to,[]).get(to)).push(r);
  }
  for(const [path,ref] of references) {
    if(!(path in homes)||ref.exported)continue;
    const incoming=(arrivals.get(path)??[]).filter(r=>endpoint(r.from)!==path);
    const callers=[...new Set(incoming.map(r=>endpoint(r.from)))];
    const into=callers[0],rootOwner=provenance[path]?.rootOwner;
    const proofs=pipelineProofs.filter(p=>`${p.call.file}::${p.callee}`===path&&`${p.call.file}::${p.caller}`===into);
    let enclosing=into;while(homes[enclosing]&&homes[enclosing]!==enclosing&&enclosing!==path)enclosing=homes[enclosing];
    let reason=protectedPaths.has(path)?'Referenced public entry must remain addressable.':ref.escapes.length?'Callable escapes direct invocation; callback/alias consumption is unproved.':
      incoming.some(r=>!['call','construct'].includes(r.kind)||r.possible)||callers.length!==1||!into?'No single resolved invocation owner.':
      ref.references.some(site=>!incoming.some(r=>(r.evidence??[]).some(e=>e.file===site.file&&e.start<=site.start&&e.end>=site.end)))?'An invocation has no resolved incoming source evidence.':
      !rootOwner||rootOwner!==provenance[into]?.rootOwner?'Caller and helper do not share a known root responsibility.':
      enclosing===path?'Mutual invocation does not prove a containing owner.':null;
    const evidence={references:ref.references,incoming:incoming.map(r=>({from:endpoint(r.from),source:r.from,target:r.to,kind:r.kind,sites:r.evidence??[]})),...(ref.escapes.length?{escapes:ref.escapes}:{})};
    if(reason){blocked.push({declaration:path,reason,evidence});continue;}
    homes[path]=into;owners[path]=owners[into];
    provenance[path]={...provenance[path],home:'private-direct-call',nesting:'private-containment-proved',owner:'enclosing-declaration',into};
    folds.push({declaration:path,into,owner:owners[into],rootOwner,evidence:{...evidence,...(proofs.length?{pipeline:proofs}:{})},
      limits:['Only the listed fresh-value handoffs are proved; other effects and unknowns remain on their original source rows.','Containment changes the displayed home, not runtime behavior or contract permission.']});
  }
  for(const path of Object.keys(homes)) {
    while(homes[path]!==homes[homes[path]])homes[path]=homes[homes[path]];
    if(homes[path]!==path)owners[path]=owners[homes[path]];
  }
  for(const fold of folds){fold.into=homes[fold.declaration];fold.owner=owners[fold.declaration];}
  // Existing shared display boxes are not evidence that their declarations enclose.
  const grouped=new Map();
  for(const [path,owner] of Object.entries(owners))if(owner)(grouped.get(owner)??grouped.set(owner,[]).get(owner)).push(path);
  for(const [owner,paths] of grouped)if(new Set(paths.map(p=>homes[p])).size>1)
    provisional.push({owner,declarations:paths,reason:'Authored box groups distinct semantic declarations; containment remains unproved.'});
  return {schema:1,homes,owners,provenance,folds,blocked,provisional,protected:[...protectedPaths].sort()};
}
