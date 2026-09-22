// Shapes read off the AST, not off names. An ASSERTION is a function whose whole body is a
// guarded throw built from its parameters; a call to one is a requirement on the calling page,
// not a component. A FORMULA is a function whose whole body is one returned expression that
// assigns to nothing, and whose linked calls are all formulas. This is component metadata;
// formula classification never removes a called function or substitutes a passthrough wire.
// A SCALAR REDUCTION is a small local counted accumulation, presented directly as source.
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

// One returned expression that only computes. It assigns and deletes nothing, suspends nothing
// (no async, generator, await or yield), constructs nothing, encloses no block-bodied function,
// and every call it makes reaches code classified below. External is a location/accounting
// category, never a purity guarantee: e.g. a one-expression fs.writeFile wrapper has effects.
// `unsafeAt(start)` answers for a call site in this function's own file.
export function formulaShape(fn,unsafeAt=()=>true) {
  if(!fn||fn.async||fn.generator)return false;
  let body=null;
  if(fn.body.type!=='BlockStatement')body=fn.body;
  else {
    const [only,...rest]=fn.body.body;
    if(rest.length||only?.type!=='ReturnStatement'||!only.argument)return false;
    body=only.argument;
  }
  let clean=true;
  (function walk(n){
    if(!clean)return;
    if(writes.has(n.type)||n.type==='UnaryExpression'&&n.operator==='delete')return void(clean=false);
    if(['AwaitExpression','YieldExpression','NewExpression'].includes(n.type))return void(clean=false);
    if(functions.has(n.type)&&n.body.type==='BlockStatement')return void(clean=false);
    if(n.type==='CallExpression'&&unsafeAt(n.start))return void(clean=false);
    for(const c of kids(n))walk(c);
  })(body);
  return clean;
}

// A deliberately narrow presentation shape: one numeric accumulator, one counted loop,
// one arithmetic accumulation and one scalar return. This is not a runtime type or purity
// guarantee (JavaScript indexed reads/coercion can have effects). Calls, searches, branches,
// nested loops and writes outside those local loop/accumulator bindings never qualify.
export function scalarReductionShape(fn) {
  if(!fn||fn.async||fn.generator||fn.params.some(p=>p.type!=='Identifier')||fn.body.type!=='BlockStatement')return false;
  const [seed,loop,result,...rest]=fn.body.body;
  if(rest.length||seed?.type!=='VariableDeclaration'||seed.kind==='var'||seed.declarations.length!==1||loop?.type!=='ForStatement'||result?.type!=='ReturnStatement')return false;
  const accumulator=seed.declarations[0];
  if(accumulator.id.type!=='Identifier'||accumulator.init?.type!=='Literal'||typeof accumulator.init.value!=='number')return false;
  const params=new Set(fn.params.map(p=>p.name)),sum=accumulator.id.name;
  if(params.has(sum)||loop.init?.type!=='VariableDeclaration'||loop.init.kind!=='let'||![1,2].includes(loop.init.declarations.length))return false;
  const declarations=loop.init.declarations;
  if(declarations.some(d=>d.id.type!=='Identifier'))return false;
  const counters=declarations.map(d=>d.id.name),[counter,previous]=counters;
  if(new Set([...params,sum,...counters]).size!==params.size+1+counters.length)return false;
  const arithmetic=new Set(['+','-','*','/','%','**']);
  const expression=(n,names)=>{
    if(!n)return false;
    if(n.type==='Literal')return typeof n.value==='number';
    if(n.type==='Identifier')return names.has(n.name);
    if(n.type==='UnaryExpression')return ['+','-'].includes(n.operator)&&expression(n.argument,names);
    if(n.type==='BinaryExpression')return arithmetic.has(n.operator)&&expression(n.left,names)&&expression(n.right,names);
    if(n.type==='MemberExpression'&&!n.optional) {
      let root=n.object;while(root.type==='MemberExpression')root=root.object;
      return root.type==='Identifier'&&params.has(root.name)&&expression(n.object,names)&&
        (n.computed?expression(n.property,names):n.property.type==='Identifier'&&n.property.name==='length');
    }
    return false;
  };
  if(declarations.some(d=>!expression(d.init,params)))return false;
  const test=loop.test;
  if(test?.type!=='BinaryExpression'||!['<','<=','>','>='].includes(test.operator)||test.left.type!=='Identifier'||test.left.name!==counter||!expression(test.right,params))return false;
  const update=previous?loop.update?.type==='AssignmentExpression'&&loop.update.operator==='='&&loop.update.left.type==='Identifier'&&loop.update.left.name===previous?loop.update.right:null:loop.update;
  if(update?.type!=='UpdateExpression'||update.argument.type!=='Identifier'||update.argument.name!==counter||!['++','--'].includes(update.operator)||previous&&update.prefix)return false;
  if((update.operator==='++')!==['<','<='].includes(test.operator))return false;
  const body=loop.body.type==='BlockStatement'?loop.body.body: [loop.body];
  const addition=body.length===1&&body[0].type==='ExpressionStatement'?body[0].expression:null;
  if(addition?.type!=='AssignmentExpression'||!['+=','-='].includes(addition.operator)||addition.left.type!=='Identifier'||addition.left.name!==sum)return false;
  return expression(addition.right,new Set([...params,...counters]))&&reads(result.argument).has(sum)&&expression(result.argument,new Set([...params,sum]));
}

// A source presentation boundary for a single numerical expression, including elementary
// vector maps. This classifies syntax, not runtime purity or Array/Math receiver identity.
// The scanner's unresolved calls and callback limits remain available in the code read.
export function numericalExpressionShape(fn) {
  if(!fn||fn.async||fn.generator)return false;
  const names=new Set();
  for(const p of fn.params) {
    if(p.type==='Identifier')names.add(p.name);
    else if(p.type==='AssignmentPattern'&&p.left.type==='Identifier'&&p.right.type==='Literal'&&typeof p.right.value==='number')names.add(p.left.name);
    else return false;
  }
  const body=fn.body.type==='BlockStatement'?
    fn.body.body.length===1&&fn.body.body[0].type==='ReturnStatement'?fn.body.body[0].argument:null:fn.body;
  const arithmetic=new Set(['+','-','*','/','%','**']);
  const math=new Set(['abs','acos','acosh','asin','asinh','atan','atan2','atanh','cbrt','ceil','cos','cosh','exp','expm1','floor','hypot','log','log10','log1p','log2','max','min','pow','round','sign','sin','sinh','sqrt','tan','tanh','trunc']);
  let operation=false;
  const expression=(n,scope)=>{
    if(!n)return false;
    if(n.type==='Literal')return typeof n.value==='number';
    if(n.type==='Identifier')return scope.has(n.name);
    if(n.type==='UnaryExpression'&&['+','-'].includes(n.operator)){operation=true;return expression(n.argument,scope);}
    if(n.type==='BinaryExpression'&&arithmetic.has(n.operator)){operation=true;return expression(n.left,scope)&&expression(n.right,scope);}
    if(n.type==='ArrayExpression')return n.elements.every(e=>expression(e,scope));
    if(n.type==='MemberExpression'&&!n.optional)return expression(n.object,scope)&&(n.computed?expression(n.property,scope):n.property.type==='Identifier');
    if(n.type!=='CallExpression'||n.optional||n.callee.type!=='MemberExpression'||n.callee.computed||n.callee.optional)return false;
    const {object,property}=n.callee;
    if(object.type==='Identifier'&&object.name==='Math'&&!scope.has('Math')&&math.has(property.name)) {
      operation=true;
      return n.arguments.length>0&&n.arguments.every(a=>expression(a.type==='SpreadElement'?a.argument:a,scope));
    }
    if(property.name!=='map'||n.arguments.length!==1||!expression(object,scope))return false;
    const callback=n.arguments[0];
    if(callback.type!=='ArrowFunctionExpression'||callback.async||callback.body.type==='BlockStatement'||callback.params.length<1||callback.params.length>2||callback.params.some(p=>p.type!=='Identifier'))return false;
    return expression(callback.body,new Set([...scope,...callback.params.map(p=>p.name)]));
  };
  return expression(body,names)&&operation;
}

// Shapes for every mapped node at once. A formula stays a formula only while every linked call it
// makes reaches another formula, so the set is narrowed to its own fixed point.
export function classify({graph,projection,asts}) {
  const assertions=new Map(),formula=new Set(),scalarReductions=new Set(),numericalExpressions=new Set(),fns=new Map();
  const spanOf=new Map();
  for(const d of graph.declarations)if(d.anchor&&!d.ambiguousAnchor&&!spanOf.has(d.anchor))spanOf.set(d.anchor,d);
  const accounted=new Set();
  for(const r of graph.relations)if(r.kind==='call'&&projection.owner.get(r.to)?.kind!=='module'&&projection.owner.has(r.to))
    for(const e of r.evidence??[])accounted.add(`${e.file}:${e.start}`);
  const unsafeIn=file=>start=>!accounted.has(`${file}:${start}`);
  for(const n of projection.nodes.values()) {
    if(n.kind==='module')continue;
    const ast=asts.get(n.file),d=spanOf.get(n.path);if(!ast||!d)continue;
    const fn=functionAt(ast,d.start,d.end);if(!fn)continue;
    fns.set(n.path,fn);
    if(scalarReductionShape(fn))scalarReductions.add(n.path);
    if(numericalExpressionShape(fn))numericalExpressions.add(n.path);
    const assertion=assertionOf(fn);
    if(assertion)assertions.set(n.path,assertion);
    else if(formulaShape(fn,unsafeIn(n.file)))formula.add(n.path);
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
  return {assertions,formulas:formula,scalarReductions,numericalExpressions,fns};
}
