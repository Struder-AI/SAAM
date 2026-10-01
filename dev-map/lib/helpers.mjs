// A private callable used only by one stage belongs to that stage even when it
// is written beside it. This is ownership, not a claim of purity. References
// that escape (exports, callbacks, aliases, records) conservatively keep a leaf.
import {scopeTree} from './lexical-bindings.mjs';
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const kids=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);

export function foldOwnedHelpers({graph,projection,asts,leafOf}) {
  const candidates=new Set();
  for(const [file,ast] of asts) {
    const {binding}=scopeTree(ast),privateBindings=new Map(),blocked=new Set();
    for(const statement of ast.body) {
      if(statement.type==='FunctionDeclaration'&&binding(statement.id))privateBindings.set(binding(statement.id),{name:statement.id.name,id:statement.id});
      if(statement.type==='VariableDeclaration'&&statement.kind==='const')for(const d of statement.declarations)
        if(d.id.type==='Identifier'&&functions.has(d.init?.type)&&binding(d.id))privateBindings.set(binding(d.id),{name:d.id.name,id:d.id});
    }
    (function walk(node,parent){
      const candidate=node.type==='Identifier'?privateBindings.get(binding(node)):null;
      if(candidate&&node!==candidate.id) {
        // A noncomputed member/property key is not a reference to this binding.
        const key=parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed
          ||parent?.type==='Property'&&parent.key===node&&!parent.computed&&!parent.shorthand;
        if(!key&&!(parent?.type==='CallExpression'&&parent.callee===node))blocked.add(candidate.name);
      }
      kids(node).forEach(child=>walk(child,node));
    })(ast,null);
    for(const {name} of privateBindings.values())if(!blocked.has(name)&&leafOf.has(`${file}::${name}`))candidates.add(`${file}::${name}`);
  }
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
