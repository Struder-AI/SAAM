// Where a mapped holder can be held. A holder is an object written with callable members, or an
// instance of a class with methods. A member call `x.k(…)` whose receiver the value tracer could
// not name reaches mapped code only through a holder carrying a mapped `k`, so this follows each
// such holder forward from where it is made: through bindings, imports, parameters, returns,
// property keys and collection elements, flow-insensitively. A receiver no holder of `k` reaches
// cannot reach mapped code; one a holder reaches is a possible call of that holder's member. A
// holder that leaves what the scan follows (a call with no known target that is not the
// platform's, a `yield`, a default export expression) has `escaped`, and every receiver stays
// possible for it.
//
// The platform is read by what it does with a value handed to it: a wrapper hands it back
// (`new Proxy(h,…)`, `Object.freeze(h)`, `Promise.resolve(h)`), a container keeps it as an
// element (`list.push(h)`, `map.set(k,h)`, `new Set([h])`), and anything else neither keeps nor
// returns the holder itself (it logs, clones, serialises, iterates or reads it).
const wrappers=new Set(['Proxy','freeze','seal','preventExtensions','resolve','assign']);
const containers=new Set(['push','unshift','set','add','splice','fill','concat','Map','Set','WeakMap','WeakSet','Array','of','all','allSettled','race','any']);
//
// `ctx` is the graph's own reading of the source: parents, scopes and binding lookup, the call
// targets proved so far, and whether a call is the platform's.
export function holderReach(ctx) {
  const {modules,parents,nodeScope,lookup,property,functions,children,targetsOf,platformCall,exportedBindings,importsOf}=ctx;
  const pure=new Set(['ParenthesizedExpression','ChainExpression','AwaitExpression','TSAsExpression']);
  const patterns=new Set(['ObjectPattern','ArrayPattern','RestElement','AssignmentPattern']);

  // One walk over every scanned module indexes where values are read.
  // A simple declarator's name is not walked by the graph, so it is scoped by its declarator.
  const declScope=new WeakMap(),scopeOf=n=>nodeScope.get(n)??declScope.get(n);
  const refs=new Map(),keyReads=new Map(),keyPatterns=new Map(),elementReads=[],thisNodes=[],moduleOf=new WeakMap(),extended=new Set();
  const push=(map,key,value)=>(map.get(key)??map.set(key,[]).get(key)).push(value);
  const enclosingFunction=n=>{let p=parents.get(n);while(p&&!functions.has(p.type))p=parents.get(p);return p??null;};
  const inPattern=n=>{let child=n,p=parents.get(n);
    while(p){
      if(p.type==='Property'&&patterns.has(parents.get(p)?.type)&&(p.value===child||p.key===child))return true;
      if(['ObjectPattern','ArrayPattern','RestElement'].includes(p.type))return true;
      if(p.type==='AssignmentPattern')return p.left===child;
      if(p.type==='Property'&&p.key===child&&!p.computed&&p.value!==child)return true;
      return false;
    }
    return false;};
  const isReference=n=>{
    const p=parents.get(n);if(!p)return false;
    if(p.type==='MemberExpression'&&p.property===n&&!p.computed)return false;
    if(['MethodDefinition','PropertyDefinition'].includes(p.type)&&p.key===n&&!p.computed)return false;
    if(p.type==='Property'&&p.key===n&&!p.computed&&p.value!==n&&!p.shorthand)return false;
    if(p.type==='VariableDeclarator'&&p.id===n)return false;
    if((functions.has(p.type)||p.type.startsWith('Class'))&&p.id===n)return false;
    if(functions.has(p.type)&&p.params.includes(n))return false;
    if(['ImportSpecifier','ImportDefaultSpecifier','ImportNamespaceSpecifier','ExportSpecifier','LabeledStatement',
      'BreakStatement','ContinueStatement','MetaProperty','CatchClause'].includes(p.type))return false;
    if(p.type==='AssignmentExpression'&&p.left===n)return false;
    return !inPattern(n);
  };
  const isWritten=n=>{const p=parents.get(n);return p?.type==='AssignmentExpression'&&p.left===n||p?.type==='UpdateExpression'
    ||p?.type==='UnaryExpression'&&p.operator==='delete';};
  for(const m of modules.values())(function walk(n){
    if(n.type==='Identifier'&&isReference(n)){const b=lookup(nodeScope.get(n),n.name);if(b)push(refs,b,n);}
    if(n.type==='MemberExpression'&&!isWritten(n)){const k=property(n);
      if(k!==null&&k!==undefined)push(keyReads,k,n);else elementReads.push(n);}
    if(n.type==='ObjectPattern')for(const p of n.properties)if(p.type==='Property'&&!p.computed)push(keyPatterns,String(p.key.name??p.key.value),p.value);
    if(n.type==='ThisExpression')thisNodes.push(n);
    if(n.type==='VariableDeclarator')declScope.set(n.id,nodeScope.get(n));
    if(n.type==='CallExpression'||n.type==='NewExpression')moduleOf.set(n,m);
    if(n.superClass?.type==='Identifier')extended.add(n.superClass.name);
    if(n.type==='ForOfStatement')elementReads.push(n.left.type==='VariableDeclaration'?n.left.declarations[0].id:n.left);
    if(n.type==='ArrayPattern')for(const e of n.elements)if(e)elementReads.push(e);
    for(const c of children(n))walk(c);
  })(m.ast);
  // The calls each function is the proved target of, read once from the edges.
  const callsOf=new Map();
  for(const m of modules.values())(function walk(n){
    if(n.type==='CallExpression'||n.type==='NewExpression')for(const fn of targetsOf(n,m))push(callsOf,fn,n);
    for(const c of children(n))walk(c);
  })(m.ast);
  // `this` in a class's own methods, including the arrow functions inside them, is its instance.
  const thisClass=n=>{let s=nodeScope.get(n);while(s&&!s.thisBoundary)s=s.parent;return s&&!s.thisStatic?s.thisClass:null;};
  // `this` in a method written in an object literal is that object.
  const thisObject=n=>{let fn=enclosingFunction(n);while(fn?.type==='ArrowFunctionExpression')fn=enclosingFunction(fn);
    const p=fn&&parents.get(fn);return p?.type==='Property'&&parents.get(p)?.type==='ObjectExpression'&&p.value===fn?parents.get(p):null;};

  // Follows one value from the expressions that make it: a holder, or a function, whose calls
  // are wherever it arrives as a callee. Returns the expressions that may hold it, the calls it
  // arrives at as the callee, the platform calls it is handed to, and whether it escaped.
  function follow(starts) {
    const held=new Set(),bindings=new Set(),keys=new Set(),done=new Set(),calls=new Set(),handed=new Set();let element=false,escaped=false;
    const work=[...starts];
    // An exported binding is read by name wherever it is imported, and as a member of any
    // namespace it is imported through.
    const bind=b=>{if(!b||bindings.has(b))return;bindings.add(b);work.push(...refs.get(b)??[]);
      for(const name of exportedBindings.get(b)??[]){key(name);for(const other of importsOf(b))bind(other);}};
    const key=k=>{if(k===null||k===undefined){toElement();return;}if(keys.has(k))return;keys.add(k);
      work.push(...keyReads.get(k)??[]);for(const target of keyPatterns.get(k)??[])assign(target);};
    const toElement=()=>{if(element)return;element=true;for(const n of elementReads)patterns.has(n.type)||n.type==='Identifier'&&!isReference(n)?assign(n):work.push(n);
      // Whatever a platform call hands back may be an element of a collection that holds it,
      // and so may what an inline callback a platform call runs is handed.
      for(const m of modules.values())(function walk(n){
        if(n.type==='CallExpression'&&platformCall(n,m)) {
          work.push(n);
          for(const a of n.arguments)if(functions.has(a.type))for(const param of a.params)assign(param);
        }
        for(const c of children(n))walk(c);})(m.ast);};
    // What a function returns reaches every call of it (`callers`). The platform, handed a
    // callback, returns what it makes of it: the call's result or an element.
    const returned=fn=>{if(!fn||done.has(fn))return;done.add(fn);
      const found=callers(fn);
      if(found.escaped){escaped=true;return;}
      work.push(...found.calls);
      if(found.handed.length){work.push(...found.handed);toElement();}};
    // A value arriving at a pattern or a binding target.
    function assign(target) {
      if(!target)return;
      if(target.type==='Identifier'){bind(lookup(scopeOf(target),target.name));return;}
      if(target.type==='AssignmentPattern'){assign(target.left);return;}
      if(target.type==='RestElement'){toElement();return;}
      if(target.type==='MemberExpression'){key(property(target));return;}
      // Destructuring a holder takes its members apart, which are not the holder.
    }
    while(work.length&&!escaped) {
      const n=work.pop();
      if(held.has(n))continue;held.add(n);
      const p=parents.get(n);if(!p)continue;
      if(pure.has(p.type)||p.type==='ConditionalExpression'&&p.test!==n||p.type==='LogicalExpression'
        ||p.type==='SequenceExpression'&&p.expressions.at(-1)===n||p.type==='AssignmentExpression'&&p.right===n)work.push(p);
      if((p.type==='CallExpression'||p.type==='NewExpression')&&p.callee===n)calls.add(p);
      else if(p.type==='VariableDeclarator'&&p.init===n)assign(p.id);
      else if(p.type==='AssignmentExpression'&&p.right===n)assign(p.left);
      else if(p.type==='AssignmentPattern'&&p.right===n)assign(p.left);
      else if(p.type==='Property'&&p.value===n&&parents.get(p)?.type==='ObjectExpression')key(p.computed?(p.key.type==='Literal'?String(p.key.value):null):String(p.key.name??p.key.value));
      else if(p.type==='PropertyDefinition'&&p.value===n)key(p.computed?null:String(p.key.name??p.key.value));
      else if(p.type==='ArrayExpression')toElement();
      else if(p.type==='SpreadElement'&&parents.get(p)?.type==='ObjectExpression')work.push(parents.get(p));
      else if(p.type==='ReturnStatement')returned(enclosingFunction(p));
      else if(functions.has(p.type)&&p.body===n)returned(p);
      else if(['YieldExpression','ExportDefaultDeclaration'].includes(p.type))escaped=true;
      else if((p.type==='CallExpression'||p.type==='NewExpression')&&p.arguments.includes(n)) {
        const m=moduleOf.get(p),targets=targetsOf(p,m);
        for(const fn of targets) {
          const params=fn.params??fn.body?.body?.find(x=>x.kind==='constructor')?.value.params??[];
          const i=p.arguments.indexOf(n),param=params[i];
          if(param)assign(param);else if(params.at(-1)?.type==='RestElement')toElement();
        }
        if(platformCall(p,m)) {
          handed.add(p);
          const name=p.callee.type==='Identifier'?p.callee.name:property(p.callee);
          if(wrappers.has(name)&&p.arguments[0]===n)work.push(p);
          if(containers.has(name))toElement();
        }
        else if(!targets.length)escaped=true;
      }
      // A promise's `then` hands what it settles to to its callback.
      else if(p.type==='MemberExpression'&&p.object===n&&property(p)==='then') {
        const call=parents.get(p),callback=call?.type==='CallExpression'?call.arguments[0]:null;
        if(functions.has(callback?.type)&&callback.params[0])assign(callback.params[0]);
      }
    }
    return {held,escaped,calls:[...calls],handed:[...handed]};
  }
  // Every call of a function. A member of an object or class is called by name, so its calls are
  // the proved ones and every unproved call of that member name. Any other function is followed
  // as a value from its declaration's name, or from where it is written, to the calls it arrives
  // at; a recursive request while one is being followed adds nothing.
  const callerCache=new Map();
  function callers(fn) {
    if(callerCache.has(fn))return callerCache.get(fn);
    const p=parents.get(fn),proved=callsOf.get(fn)??[];
    if(['Property','MethodDefinition'].includes(p?.type)){const found={calls:proved,handed:[],escaped:false};callerCache.set(fn,found);return found;}
    callerCache.set(fn,{calls:proved,handed:[],escaped:false});
    let starts=[fn];
    if(fn.type==='FunctionDeclaration') {
      const b=lookup(nodeScope.get(fn),fn.id.name);
      starts=[b,...(exportedBindings.has(b)?importsOf(b):[])].flatMap(x=>refs.get(x)??[]);
      for(const name of exportedBindings.get(b)??[])starts.push(...keyReads.get(name)??[]);
    }
    const flow=follow(starts),found={calls:[...new Set([...proved,...flow.calls])],handed:flow.handed,escaped:flow.escaped};
    callerCache.set(fn,found);return found;
  }
  const cache=new Map();
  // An object literal holder is itself and `this` in its methods; a class holder is every proved
  // construction of it and `this` in its methods.
  function reach(holder) {
    if(cache.has(holder))return cache.get(holder);
    const starts=holder.type==='ObjectExpression'?[holder,...thisNodes.filter(t=>thisObject(t)===holder)]
      :[...(callsOf.get(holder)??[]),...thisNodes.filter(t=>thisClass(t)===holder)];
    // A class another class extends makes instances the scan does not name as its own.
    const found=holder.type!=='ObjectExpression'&&extended.has(holder.id?.name)?{held:new Set(),escaped:true}:follow(starts);
    cache.set(holder,found);return found;
  }
  return reach;
}
