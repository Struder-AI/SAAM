// Scope identity for scanner analyses. A binding is identified by the lexical
// scope that declares it, not by its spelling or source line.
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const kids=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
const patternIds=(n,out=[])=>{
  if(!n)return out;
  if(n.type==='Identifier')out.push(n);
  else if(n.type==='AssignmentPattern')patternIds(n.left,out);
  else if(n.type==='RestElement')patternIds(n.argument,out);
  else if(n.type==='ObjectPattern')for(const p of n.properties)patternIds(p.value??p.argument,out);
  else if(n.type==='ArrayPattern')for(const e of n.elements)patternIds(e,out);
  return out;
};
const patternNames=n=>patternIds(n).map(id=>id.name);

export function scopeTree(fn){
  const scopeOf=new WeakMap(),blocks=new Set(['BlockStatement','ForStatement','ForOfStatement','ForInStatement','SwitchStatement','CatchClause','StaticBlock','ClassBody']);
  let seq=0;
  const make=(parent,kind)=>({parent,kind,names:new Map()});
  const fnScope=s=>{while(s.kind!=='function')s=s.parent;return s;};
  const declare=(s,name)=>{if(!s.names.has(name))s.names.set(name,{id:`b${++seq}`,name});return s.names.get(name);};
  const hoistVars=(n,s)=>{
    if(functions.has(n.type))return;
    if(n.type==='VariableDeclaration'&&n.kind==='var')for(const d of n.declarations)for(const v of patternNames(d.id))declare(fnScope(s),v);
    for(const c of kids(n))hoistVars(c,s);
  };
  function declarations(n,s){
    if(n.type==='ExportNamedDeclaration'||n.type==='ExportDefaultDeclaration')return n.declaration&&declarations(n.declaration,s);
    if(n.type==='ImportDeclaration')for(const spec of n.specifiers)declare(s,spec.local.name);
    if(n.type==='FunctionDeclaration'&&n.id)declare(s,n.id.name);
    if(n.type==='VariableDeclaration'&&n.kind!=='var')for(const d of n.declarations)for(const v of patternNames(d.id))declare(s,v);
    if(n.type==='ClassDeclaration'&&n.id)declare(s,n.id.name);
  }
  function walk(n,s){
    if(functions.has(n.type)){
      const inner=make(s,'function');
      for(const p of n.params)for(const v of patternNames(p))declare(inner,v);
      if(n.id&&n.type!=='FunctionDeclaration')declare(inner,n.id.name);
      scopeOf.set(n,inner);
      for(const c of kids(n))hoistVars(c,inner);
      for(const c of kids(n))walk(c,inner);
      return;
    }
    let inner=s;
    if(blocks.has(n.type)){
      inner=make(s,'block');
      if(n.type==='CatchClause')for(const v of patternNames(n.param))declare(inner,v);
      for(const c of kids(n))declarations(c,inner);
      for(const c of [n.body?.body,n.consequent].find(Array.isArray)??[])declarations(c,inner);
    }
    scopeOf.set(n,inner);
    for(const c of kids(n))walk(c,inner);
  }
  const root=make(null,'function');
  for(const p of fn.params??[])for(const v of patternNames(p))declare(root,v);
  if(fn.type==='Program')for(const c of fn.body)declarations(c,root);
  scopeOf.set(fn,root);
  for(const c of kids(fn))hoistVars(c,root);
  for(const c of kids(fn))walk(c,root);
  const find=(s,name)=>!s?null:s.names.get(name)??find(s.parent,name);
  return {binding:node=>node?.type==='Identifier'?find(scopeOf.get(node)??root,node.name):null,parameter:name=>root.names.get(name)??null};
}
