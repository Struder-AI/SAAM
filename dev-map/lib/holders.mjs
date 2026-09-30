// Where a value can arrive. A member call `x.k(…)` whose receiver the value tracer could not name
// reaches mapped code only through a holder carrying a mapped `k` (an object written with
// callable members, or an instance of a class with methods), and a call of a parameter or other
// binding reaches whatever function value arrives there. So this follows each holder, and each
// function, forward from where it is made: through bindings, imports, parameters, returns,
// property keys and collection elements, flow-insensitively. A value that leaves what the scan
// follows (a call with no known target that is not the platform's, a `yield`, a default export
// expression) has `escaped`, and may arrive anywhere.
//
// Collections: a local binding made as a fresh collection (`[]`, `new Set()`, `new Map()`) and
// only ever used through its own members, indexing, iteration or a spread copy keeps its own
// elements; every other collection shares one pool of elements.
//
// The platform is read by what it does with a value handed to it: a wrapper hands it back
// (`new Proxy(h,…)`, `Object.freeze(h)`, `Promise.resolve(h)`), a container keeps it as an
// element (`list.push(h)`, `map.set(k,h)`), and anything else neither keeps nor returns the value
// itself (it logs, clones, serialises, iterates or reads it). A callback handed to the platform
// returns into the call's result or the shared elements.
const wrappers=new Set(['Proxy','freeze','seal','preventExtensions','resolve','assign']);
const storing=new Set(['push','unshift','add','set','splice','fill']);
const containerCalls=new Set(['Map','Set','WeakMap','WeakSet','Array','of','all','allSettled','race','any','concat']);
const fresh=new Set(['Map','Set','WeakMap','WeakSet','Array']);
// Member calls that hand back an element of their receiver, and those that hand each element to
// a callback (at the parameter position given).
const taking=new Set(['get','at','pop','shift','find','findLast']);
const iterating=new Map([['forEach',[0]],['map',[0]],['flatMap',[0]],['filter',[0]],['some',[0]],['every',[0]],['find',[0]],
  ['findIndex',[0]],['findLast',[0]],['findLastIndex',[0]],['reduce',[1]],['reduceRight',[1]],['sort',[0,1]],['toSorted',[0,1]]]);
// Member calls whose result holds the same elements as their receiver.
const copying=new Set(['slice','filter','concat','values','entries','keys','toSorted','toReversed','flat']);
const SHARED='shared';
//
// `ctx` is the graph's own reading of the source: parents, scopes and binding lookup, the call
// targets proved so far, and whether a call is the platform's.
export function holderReach(ctx) {
  const {modules,parents,nodeScope,lookup,property,functions,children,targetsOf,platformCall,exportedBindings,importsOf}=ctx;
  const pure=new Set(['ParenthesizedExpression','ChainExpression','AwaitExpression','TSAsExpression']);
  const patterns=new Set(['ObjectPattern','ArrayPattern','RestElement','AssignmentPattern']);
  const unwrap=n=>{while(n&&pure.has(n.type))n=n.expression??n.argument;return n;};

  // A simple declarator's name is not walked by the graph, so it is scoped by its declarator.
  const declScope=new WeakMap(),scopeOf=n=>nodeScope.get(n)??declScope.get(n);
  const refs=new Map(),keyReads=new Map(),keyPatterns=new Map(),thisNodes=[],moduleOf=new WeakMap(),extended=new Set();
  // Element reads before their collection is known: the receiver read, and what receives the
  // element (`node` takes it as a value, `target` is a pattern or parameter it is assigned to).
  const reads=[];
  const push=(map,key,value)=>(map.get(key)??map.set(key,[]).get(key)).push(value);
  const enclosingFunction=n=>{let p=parents.get(n);while(p&&!functions.has(p.type))p=parents.get(p);return p??null;};
  const inPattern=n=>{const p=parents.get(n);if(!p)return false;
    if(p.type==='Property'&&patterns.has(parents.get(p)?.type)&&(p.value===n||p.key===n))return true;
    if(['ObjectPattern','ArrayPattern','RestElement'].includes(p.type))return true;
    if(p.type==='AssignmentPattern')return p.left===n;
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
  const calleeName=call=>call.callee.type==='Identifier'?call.callee.name:call.callee.type==='MemberExpression'?property(call.callee):null;
  for(const m of modules.values())(function walk(n){
    if(n.type==='Identifier'&&isReference(n)){const b=lookup(nodeScope.get(n),n.name);if(b)push(refs,b,n);}
    if(n.type==='MemberExpression'&&!isWritten(n)){const k=property(n);
      if(k!==null&&k!==undefined)push(keyReads,k,n);else reads.push({receiver:n.object,node:n});}
    if(n.type==='ObjectPattern')for(const p of n.properties)if(p.type==='Property'&&!p.computed)push(keyPatterns,String(p.key.name??p.key.value),p.value);
    if(n.type==='ThisExpression')thisNodes.push(n);
    if(n.type==='VariableDeclarator') {
      declScope.set(n.id,nodeScope.get(n));
      if(n.id.type==='ArrayPattern')for(const e of n.id.elements)if(e)reads.push({receiver:n.init,target:e});
    }
    if(n.type==='CallExpression'||n.type==='NewExpression')moduleOf.set(n,m);
    if(n.superClass?.type==='Identifier')extended.add(n.superClass.name);
    if(n.type==='ForOfStatement')reads.push({receiver:n.right,target:n.left.type==='VariableDeclaration'?n.left.declarations[0].id:n.left});
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression') {
      const name=property(n.callee);
      if(taking.has(name))reads.push({receiver:n.callee.object,node:n});
      for(const i of iterating.get(name)??[]) {
        const callback=n.arguments[0];
        if(functions.has(callback?.type)&&callback.params[i])reads.push({receiver:n.callee.object,target:callback.params[i]});
      }
    }
    for(const c of children(n))walk(c);
  })(m.ast);

  // A private collection: made fresh, never rebound, never exported, and used only through its
  // own members, indexing, iteration or a spread copy.
  const privacy=new Map();
  function isPrivate(b) {
    if(!b)return false;
    if(privacy.has(b))return privacy.get(b);
    const init=unwrap(b.node?.type==='VariableDeclarator'?b.node.init:null);
    const made=init?.type==='ArrayExpression'||init?.type==='NewExpression'&&init.callee.type==='Identifier'&&fresh.has(init.callee.name)&&!lookup(nodeScope.get(init.callee),init.callee.name);
    const own=r=>{const p=parents.get(r);return p?.type==='MemberExpression'&&p.object===r||p?.type==='ForOfStatement'&&p.right===r
      ||p?.type==='SpreadElement'&&parents.get(p)?.type==='ArrayExpression';};
    const found=!!made&&!b.written&&!exportedBindings.has(b)&&(refs.get(b)??[]).every(own);
    privacy.set(b,found);return found;
  }
  // The element pools an expression's elements come from: a private collection's own, the pools
  // a literal spreads or a copying call reads, and otherwise the shared pool.
  function pools(n) {
    n=unwrap(n);
    if(n?.type==='Identifier'){const b=lookup(nodeScope.get(n),n.name);return isPrivate(b)?[b]:[SHARED];}
    if(n?.type==='ArrayExpression')return n.elements.filter(e=>e?.type==='SpreadElement').flatMap(e=>pools(e.argument));
    if(n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&copying.has(property(n.callee)))return pools(n.callee.object);
    if(n?.type==='CallExpression'&&n.callee.type==='MemberExpression'&&property(n.callee)==='from'&&n.callee.object.name==='Array')return pools(n.arguments[0]);
    return [SHARED];
  }
  const readsOf=new Map();
  for(const r of reads)for(const pool of pools(r.receiver))push(readsOf,pool,r);
  const valueReads=[];
  for(const m of modules.values())(function walk(n){
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.name==='Object'
      &&['values','entries'].includes(property(n.callee)))valueReads.push(n);
    for(const c of children(n))walk(c);
  })(m.ast);
  // A literal's own elements go where the literal does: into a for-of's binding, into the private
  // collection it makes, and otherwise into the shared pool.
  function literalPool(a) {
    let at=a,p=parents.get(a);
    if(p?.type==='NewExpression'&&p.arguments[0]===a&&p.callee.type==='Identifier'&&fresh.has(p.callee.name)){at=p;p=parents.get(p);}
    if(p?.type==='VariableDeclarator'&&p.init===at&&p.id.type==='Identifier'){const b=lookup(scopeOf(p.id),p.id.name);if(isPrivate(b))return b;}
    return SHARED;
  }

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
    const held=new Set(),bindings=new Set(),keys=new Set(),done=new Set(),calls=new Set(),handed=new Set(),pooled=new Set();let escaped=false,why=null;
    // Where the value left what the scan follows, said the way a finding row says a site.
    const escape=(n,reason)=>{escaped=true;why??={reason,line:n?.loc?.start.line,file:moduleOf.get(n)?.file??null,
      call:n&&(n.type==='CallExpression'||n.type==='NewExpression')?calleeName(n):null};};
    const work=[...starts];
    // An exported binding is read by name wherever it is imported, and as a member of any
    // namespace it is imported through.
    const bind=b=>{if(!b||bindings.has(b))return;bindings.add(b);work.push(...refs.get(b)??[]);
      for(const name of exportedBindings.get(b)??[]){key(name);for(const other of importsOf(b))bind(other);}};
    // A value stored under a key also comes out of reading an object's values whole
    // (`Object.values(o)`, `Object.entries(o)`), as an element of the shared pool.
    const key=k=>{if(k===null||k===undefined){toPool(SHARED);return;}if(keys.has(k))return;keys.add(k);
      work.push(...keyReads.get(k)??[]);for(const target of keyPatterns.get(k)??[])assign(target);
      if(valueReads.length)toPool(SHARED);};
    function toPool(pool) {
      if(pooled.has(pool))return;pooled.add(pool);
      for(const r of readsOf.get(pool)??[])r.target?assign(r.target):work.push(r.node);
    }
    // What a function returns reaches every call of it (`callers`). The platform, handed a
    // callback, returns what it makes of it: the call's result or a shared element.
    const returned=fn=>{if(!fn||done.has(fn))return;done.add(fn);
      const found=callers(fn);
      if(found.escaped){escaped=true;why??=found.why;return;}
      work.push(...found.calls);
      if(found.handed.length){work.push(...found.handed);toPool(SHARED);}};
    // A value arriving at a pattern or a binding target.
    function assign(target) {
      if(!target)return;
      if(target.type==='Identifier'){bind(lookup(scopeOf(target),target.name));return;}
      if(target.type==='AssignmentPattern'){assign(target.left);return;}
      if(target.type==='RestElement'){toPool(SHARED);return;}
      if(target.type==='MemberExpression'){
        const k=property(target);
        if(k===null||k===undefined)for(const pool of pools(target.object))toPool(pool);else key(k);
        return;
      }
      // Destructuring a value takes its members apart, which are not the value.
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
      else if(p.type==='ArrayExpression') {
        const loop=parents.get(p);
        if(loop?.type==='ForOfStatement'&&loop.right===p)assign(loop.left.type==='VariableDeclaration'?loop.left.declarations[0].id:loop.left);
        else toPool(literalPool(p));
      }
      else if(p.type==='SpreadElement'&&parents.get(p)?.type==='ObjectExpression')work.push(parents.get(p));
      else if(p.type==='ReturnStatement')returned(enclosingFunction(p));
      else if(functions.has(p.type)&&p.body===n)returned(p);
      // A generator hands what it yields to whatever iterates it: a shared element.
      else if(p.type==='YieldExpression')toPool(SHARED);
      else if(p.type==='ExportDefaultDeclaration')escape(p,'default-export');
      else if((p.type==='CallExpression'||p.type==='NewExpression')&&p.arguments.includes(n)) {
        const m=moduleOf.get(p),targets=targetsOf(p,m);
        for(const fn of targets) {
          const params=fn.params??fn.body?.body?.find(x=>x.kind==='constructor')?.value.params??[];
          const i=p.arguments.indexOf(n),param=params[i];
          if(param)assign(param);else if(params.at(-1)?.type==='RestElement')toPool(SHARED);
        }
        if(platformCall(p,m)) {
          handed.add(p);
          const name=calleeName(p);
          if(wrappers.has(name)&&p.arguments[0]===n)work.push(p);
          if(storing.has(name)&&p.callee.type==='MemberExpression')for(const pool of pools(p.callee.object))toPool(pool);
          else if(containerCalls.has(name)||storing.has(name))toPool(SHARED);
        }
        else if(!targets.length)escape(p,'passed-to-unknown-callee');
      }
      // A promise's `then` hands what it settles to to its callback.
      else if(p.type==='MemberExpression'&&p.object===n&&property(p)==='then') {
        const call=parents.get(p),callback=call?.type==='CallExpression'?call.arguments[0]:null;
        if(functions.has(callback?.type)&&callback.params[0])assign(callback.params[0]);
      }
    }
    return {held,escaped,why,calls:[...calls],handed:[...handed]};
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
    const flow=follow(starts),found={calls:[...new Set([...proved,...flow.calls])],handed:flow.handed,escaped:flow.escaped,why:flow.why};
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
    const found=holder.type!=='ObjectExpression'&&extended.has(holder.id?.name)?{held:new Set(),escaped:true,why:{reason:'extended-class',line:holder.loc.start.line}}:follow(starts);
    cache.set(holder,found);return found;
  }
  // The functions that can arrive at each call as its callee: every function written in scanned
  // code that is not an object or class member (a member is called by name), followed as a value.
  // `escaped` lists those whose value leaves what the scan follows, so may arrive anywhere.
  let arrivals=null;
  function arriving() {
    if(arrivals)return arrivals;
    const at=new Map(),escaped=[];
    for(const m of modules.values())(function walk(n){
      if(functions.has(n.type)&&!['Property','MethodDefinition'].includes(parents.get(n)?.type)) {
        const found=callers(n);
        if(found.escaped)escaped.push({fn:n,why:found.why});
        for(const call of found.calls)(at.get(call)??at.set(call,new Set()).get(call)).add(n);
      }
      for(const c of children(n))walk(c);
    })(m.ast);
    return arrivals={at,escaped};
  }
  return Object.assign(reach,{arriving});
}
