// A private callable used only by one stage belongs to that stage even when it
// is written beside it. This is ownership, not a claim of purity. References
// that escape (exports, callbacks, aliases, records) conservatively keep a leaf.
import {scopeTree} from './lexical-bindings.mjs';
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const kids=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);

// Reference evidence uses lexical binding identity, including nested callables.
// Only direct invocation is nonescaping; a callback in a record remains blocked.
export function privateCallableReferences({graph,asts,topLevel=false}) {
  const result=new Map(),declarations=new Map(graph.declarations.filter(d=>d.anchor&&!d.ambiguousAnchor).map(d=>[`${d.file}:${d.start}`,d]));
  for(const [file,ast] of asts) {
    const {binding}=scopeTree(ast),bindings=new Map();
    function collect(node,parent,depth=0,exported=false) {
      const id=node.type==='FunctionDeclaration'?node.id:node.type==='VariableDeclarator'&&functions.has(node.init?.type)?node.id:null;
      const declaration=declarations.get(`${file}:${node.start}`)??declarations.get(`${file}:${node.init?.start}`);
      if(id?.type==='Identifier'&&binding(id)&&declaration&&(!topLevel||(node.type==='FunctionDeclaration'?parent?.type==='Program':depth===2&&parent?.kind==='const'))) {
        bindings.set(binding(id),{path:declaration.anchor,id,exported,references:[],escapes:[]});
      }
      for(const child of kids(node))collect(child,node,depth+1,node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'||exported&&node.type==='VariableDeclaration');
    }
    collect(ast,null);
    (function walk(node,parent){
      const candidate=node.type==='Identifier'?bindings.get(binding(node)):null;
      if(candidate&&node!==candidate.id) {
        const key=parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed
          ||parent?.type==='Property'&&parent.key===node&&!parent.computed&&!parent.shorthand;
        if(!key) {
          const site={file,line:node.loc.start.line,start:node.start,end:node.end};
          candidate.references.push(site);
          if(!(parent?.type==='CallExpression'&&parent.callee===node))candidate.escapes.push({...site,kind:parent?.type});
        }
      }
      kids(node).forEach(child=>walk(child,node));
    })(ast,null);
    for(const {id,...candidate} of bindings.values()) {
      for(const field of ['references','escapes'])candidate[field]=[...new Map(candidate[field].map(r=>[r.start,r])).values()];
      result.set(candidate.path,candidate);
    }
  }
  return result;
}

export function foldOwnedHelpers({graph,projection,asts,leafOf}) {
  const candidates=new Set([...privateCallableReferences({graph,asts,topLevel:true})].filter(([path,c])=>!c.exported&&!c.escapes.length&&leafOf.has(path)).map(([path])=>path));
  const node=id=>projection.owner.get(id)?.path;
  const root=path=>leafOf.get(path);
  const arrivals=new Map();
  for(const relation of graph.relations) {
    const leaf=root(node(relation.to));if(!leaf)continue;
    (arrivals.get(leaf)??arrivals.set(leaf,[]).get(leaf)).push(relation);
  }
  let changed=true;
  while(changed) {
    changed=false;
    for(const path of candidates) {
      if(root(path)!==path)continue;
      const incoming=new Set();let boundary=false;
      for(const r of arrivals.get(path)??[]) {
        const from=node(r.from),caller=root(from);
        if(caller===path)continue;
        if(!['call','construct'].includes(r.kind)||!caller){boundary=true;break;}
        incoming.add(caller);
      }
      if(boundary||incoming.size!==1)continue;
      const owner=[...incoming][0];
      for(const [declaration,leaf] of leafOf)if(leaf===path)leafOf.set(declaration,owner);
      (arrivals.get(owner)??arrivals.set(owner,[]).get(owner)).push(...arrivals.get(path)??[]);
      arrivals.delete(path);
      changed=true;
    }
  }
  return leafOf;
}
