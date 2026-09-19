// Two shapes read off the AST, not off names. An ASSERTION is a function whose whole body is a
// guarded throw built from its parameters; a call to one is a requirement on the calling page,
// not a component. A FORMULA is a function whose whole body is one returned expression that
// assigns to nothing, and whose linked calls are all formulas; it is not a component either, and
// the data that passes through it keeps flowing.
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const kids=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
const writes=new Set(['AssignmentExpression','UpdateExpression']);
const paramNames=(p,out=[])=>{
  if(!p)return out;
  if(p.type==='Identifier')out.push(p.name);
  else if(p.type==='AssignmentPattern')paramNames(p.left,out);
  else if(p.type==='RestElement')paramNames(p.argument,out);
  else if(p.type==='ObjectPattern')for(const q of p.properties)paramNames(q.value??q.argument,out);
  else if(p.type==='ArrayPattern')for(const e of p.elements)paramNames(e,out);
  return out;
};
const reads=(n,out=new Set())=>{
  if(!n)return out;
  if(n.type==='Identifier')out.add(n.name);
  else if(n.type==='MemberExpression'){reads(n.object,out);if(n.computed)reads(n.property,out);}
  else for(const c of kids(n))reads(c,out);
  return out;
};
// The function a declaration holds: its own node, or the one it is written as. Indexed by span
// once per parsed file, because every page of that file asks the same question.
const spans=new WeakMap();
export function functionAt(ast,start,end) {
  let map=spans.get(ast);
  if(!map) {
    map=new Map();spans.set(ast,map);
    (function walk(n) {
      const fn=functions.has(n.type)?n:functions.has(n.value?.type)?n.value:functions.has(n.init?.type)?n.init:functions.has(n.right?.type)?n.right:null;
      const key=`${n.start}:${n.end}`;
      if(fn&&!map.has(key))map.set(key,fn);
      for(const c of kids(n))walk(c);
    })(ast);
  }
  return map.get(`${start}:${end}`)??null;
}

// `if (test) throw …` and nothing else, with the test and the thrown value built from parameters.
export function assertionOf(fn) {
  if(!fn||fn.body.type!=='BlockStatement'||fn.body.body.length!==1)return null;
  const s=fn.body.body[0];
  if(s.type!=='IfStatement'||s.alternate)return null;
  const inner=s.consequent.type==='BlockStatement'?(s.consequent.body.length===1?s.consequent.body[0]:null):s.consequent;
  if(inner?.type!=='ThrowStatement')return null;
  const params=fn.params.map(p=>paramNames(p)[0]??null);
  const named=new Set(params.filter(Boolean));
  const testNames=reads(s.test),thrownNames=reads(inner.argument);
  const condition=params.findIndex(p=>p&&testNames.has(p));
  if(condition<0)return null;
  // The thrown value may only be built from parameters, literals and constructors it names.
  const built=[...thrownNames].filter(n=>!named.has(n));
  if(inner.argument&&['NewExpression','CallExpression'].includes(inner.argument.type)) {
    if(inner.argument.callee.type!=='Identifier'||built.some(n=>n!==inner.argument.callee.name))return null;
  } else if(built.length)return null;
  const args=inner.argument?.arguments??[];
  const message=args.findIndex(a=>a.type==='Identifier'&&named.has(a.name));
  return {condition,message:message<0?-1:params.indexOf(args[message].name),
    line:fn.loc.start.line,params:params.length};
}

// One returned expression, no assignment or update anywhere in it.
export function formulaShape(fn) {
  if(!fn)return false;
  let body=null;
  if(fn.body.type!=='BlockStatement')body=fn.body;
  else {
    const [only,...rest]=fn.body.body;
    if(rest.length||only?.type!=='ReturnStatement'||!only.argument)return false;
    body=only.argument;
  }
  let clean=true;
  (function walk(n){if(!clean)return;if(writes.has(n.type)||n.type==='UnaryExpression'&&n.operator==='delete'){clean=false;return;}for(const c of kids(n))walk(c);})(body);
  return clean;
}

// Shapes for every mapped node at once. A formula stays a formula only while every linked call it
// makes reaches another formula, so the set is narrowed to its own fixed point.
export function classify({graph,projection,asts}) {
  const assertions=new Map(),formula=new Set(),fns=new Map();
  const spanOf=new Map();
  for(const d of graph.declarations)if(d.anchor&&!d.ambiguousAnchor&&!spanOf.has(d.anchor))spanOf.set(d.anchor,d);
  for(const n of projection.nodes.values()) {
    if(n.kind==='module')continue;
    const ast=asts.get(n.file),d=spanOf.get(n.path);if(!ast||!d)continue;
    const fn=functionAt(ast,d.start,d.end);if(!fn)continue;
    fns.set(n.path,fn);
    const assertion=assertionOf(fn);
    if(assertion)assertions.set(n.path,assertion);
    else if(formulaShape(fn))formula.add(n.path);
  }
  const out=new Map();
  for(const r of graph.relations)if(['call','construct'].includes(r.kind)) {
    const from=projection.owner.get(r.from),to=projection.owner.get(r.to);
    if(!from||!to||from===to||from.kind==='module'||to.kind==='module')continue;
    (out.get(from.path)??out.set(from.path,new Set()).get(from.path)).add(to.path);
  }
  for(let changed=true;changed;) {
    changed=false;
    for(const path of [...formula])
      if([...out.get(path)??[]].some(t=>!formula.has(t))){formula.delete(path);changed=true;}
  }
  return {assertions,formulas:formula,fns};
}
