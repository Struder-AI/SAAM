// Couplings carried by a literal both ends spell: worker message types, HTTP routes, file names, registry entries.
// Nothing is linked unless each end resolves to the same literal through immutable bindings, imports,
// parameters (every resolved call site), defaults, literal-array iteration and function returns.
const fsModules=new Set(['node:fs','node:fs/promises','fs','fs/promises']);
const fsCalls={readFile:[[0,'read']],readFileSync:[[0,'read']],createReadStream:[[0,'read']],stat:[[0,'read']],access:[[0,'read']],
  writeFile:[[0,'write']],writeFileSync:[[0,'write']],appendFile:[[0,'write']],createWriteStream:[[0,'write']],unlink:[[0,'write']],rm:[[0,'write']],
  copyFile:[[0,'read'],[1,'write']],rename:[[1,'write']]};
const iterators=new Set(['map','forEach','flatMap','filter','some','every','find']);
const equality=new Set(['===','==','!==','!=']);

export function couplings({modules,calls,assignments,lookup,nodeScope,nodeOwner,parents,value,choices,location,edge,property,children,functions,importPath}) {
  const unlinked=[],linked={};
  const owner=(node,module)=>nodeOwner.get(node)?.id??`${module.file}:<module>`;
  const site=(node,module)=>location(module,node);
  const miss=(kind,reason,node,module,label)=>unlinked.push({kind,reason,...(label?{label}:{}),file:module.file,line:node.loc.start.line,column:node.loc.start.column+1,text:module.text.slice(node.start,Math.min(node.end,node.start+90))});
  const key=p=>p.type==='Property'&&!p.computed?String(p.key.name??p.key.value):null;
  const unbound=(node,name)=>node?.type==='Identifier'&&node.name===name&&!lookup(nodeScope.get(node),name);
  const imported=(node,sources,name)=>{if(node?.type!=='Identifier')return false;const b=lookup(nodeScope.get(node),node.name);return !!b?.imported&&sources.has(b.source)&&(name===undefined||b.imported===name);};

  const paramOf=new Map(),paramsOf=new Map(),argsOf=new Map();
  for(const m of modules.values())for(const fn of m.functions)fn.params.forEach((param,index)=>{
    const note=(p,name,fallback)=>{
      if(p.type==='AssignmentPattern')return note(p.left,name,p.right);
      if(p.type==='Identifier') {const b=nodeScope.get(fn).bindings.get(p.name);if(!b)return;const info={b,fn,index,key:name,fallback,module:m};paramOf.set(b,info);paramsOf.set(fn,[...paramsOf.get(fn)??[],info]);}
      else if(p.type==='ObjectPattern'&&name===undefined)for(const q of p.properties)if(key(q))note(q.value,key(q));
    };
    note(param);
  });
  function returns(fn) {
    if(fn.body.type!=='BlockStatement')return [fn.body];
    const out=[];(function walk(n){if(n!==fn&&functions.has(n.type))return;if(n.type==='ReturnStatement'){if(n.argument)out.push(n.argument);return;}for(const c of children(n))walk(c);})(fn);return out;
  }
  const direct=new Map(calls.map(c=>[c.node,c]));
  const fnOf=t=>t.fn??t.classNode?.body.body.find(p=>p.kind==='constructor')?.value;
  function targetFns(call,module,seen=new Set()) {
    const found=(direct.get(call)?.targets??[]).map(t=>({fn:fnOf(t),module:t.module})).filter(t=>t.fn);
    if(found.length||call.callee.type!=='Identifier'||!paramOf.has(lookup(nodeScope.get(call.callee),call.callee.name)))return found;
    return origins(call.callee,module,seen).flatMap(o=>functions.has(o.node.type)?[{fn:o.node,module:o.module}]
      :choices(value(o.node,nodeScope.get(o.node),o.module)).filter(v=>v.fn).map(v=>({fn:v.fn,module:v.module})));
  }
  function elements(o,seen) {
    return o.node.type!=='ArrayExpression'?[]:o.node.elements.flatMap(e=>!e?[]:e.type==='SpreadElement'?origins(e.argument,o.module,seen).flatMap(x=>elements(x,seen)):[{node:e,module:o.module}]);
  }
  function exportedBinding(m,name,depth=0) {
    const e=m?.exports.get(name);if(!e||depth>8)return null;
    return e.source?exportedBinding(modules.get(importPath(m,e.source)),e.name,depth+1):e.binding;
  }
  // at: the argument (or iterated element) where the value last entered a function; that declaration is the one naming it.
  function origins(node,module,seen=new Set(),at) {
    if(!node||seen.has(node))return [];seen.add(node);
    const again=(n,m=module,from=at)=>origins(n,m,seen,from);
    if(node.type==='AwaitExpression'||node.type==='ChainExpression')return again(node.argument??node.expression);
    if(node.type==='ConditionalExpression')return [...again(node.consequent),...again(node.alternate)];
    if(node.type==='LogicalExpression')return [...again(node.left),...again(node.right)];
    if(node.type==='Identifier') {
      let b=lookup(nodeScope.get(node),node.name);
      if(b?.imported&&b.imported!=='*')b=exportedBinding(modules.get(importPath(b.module,b.source)),b.imported);
      if(b&&!b.written) {
        const p=paramOf.get(b),holder=b.node&&parents.get(parents.get(b.node));
        if(p) {
          const call=parents.get(p.fn),list=[...argsOf.get(b)??[],...(p.fallback?[{node:p.fallback,module:p.module}]:[])];
          if(p.index===0&&p.key===undefined&&call?.type==='CallExpression'&&call.arguments[0]===p.fn&&call.callee.type==='MemberExpression'&&iterators.has(property(call.callee)))
            return origins(call.callee.object,p.module,seen).flatMap(o=>elements(o,seen)).flatMap(e=>again(e.node,e.module,e));
          if(list.length)return list.flatMap(a=>again(a.node,a.module,a.node===p.fallback?at:a));
        } else if(holder?.type==='ForOfStatement'&&holder.left===parents.get(b.node))return origins(holder.right,b.module,seen).flatMap(o=>elements(o,seen)).flatMap(e=>again(e.node,e.module,e));
        else if(b.constant&&b.init)return again(b.init,b.module);
        else if(b.fn)return [{node:b.fn,module:b.module}];
      }
    }
    if(node.type==='MemberExpression'&&node.object.type==='ThisExpression'&&property(node)) {
      const stores=fields.get(classOf(node))?.get(fieldKey(node));
      if(stores)return stores.flatMap(a=>again(a.node,a.module));
    }
    if(node.type==='CallExpression') {const out=targetFns(node,module,seen).flatMap(t=>returns(t.fn).flatMap(r=>again(r,t.module)));if(out.length)return out;}
    return [{node,module,at}];
  }
  const fieldKey=n=>(n.property.type==='PrivateIdentifier'?'#':'')+property(n);
  const classOf=n=>{let s=nodeScope.get(n);while(s&&!s.classNode)s=s.parent;return s?.classNode;};
  const fields=new Map();
  for(const a of assignments) {
    const left=a.node.left;if(left?.type!=='MemberExpression'||left.object.type!=='ThisExpression'||!property(left)||a.node.operator!=='=')continue;
    const cls=classOf(left);if(!cls)continue;
    if(!fields.has(cls))fields.set(cls,new Map());
    const map=fields.get(cls);map.set(fieldKey(left),[...map.get(fieldKey(left))??[],{node:a.node.right,module:a.module}]);
  }
  function feed(c,fn) {
    let grew=false;
    for(const p of paramsOf.get(fn)??[]) {
      const args=c.node.arguments;if(!args[p.index]||args.slice(0,p.index+1).some(a=>a.type==='SpreadElement'))continue;
      const given=p.key===undefined?[{node:args[p.index],module:c.module}]:origins(args[p.index],c.module).flatMap(o=>{
        if(o.node.type!=='ObjectExpression')return [];
        const props=o.node.properties,at=props.findLastIndex(q=>key(q)===p.key);
        return at<0||props.slice(at+1).some(q=>q.type==='SpreadElement')?[]:[{node:props[at].value,module:o.module}];
      });
      const list=argsOf.get(p.b)??[];argsOf.set(p.b,list);
      for(const g of given)if(!list.some(k=>k.node===g.node)){list.push(g);grew=true;}
    }
    return grew;
  }
  for(let grew=true,round=0;grew&&round<8;round++) {grew=false;for(const c of calls)for(const t of targetFns(c.node,c.module))if(feed(c,t.fn))grew=true;}

  // Text of an expression: complete when every part is a literal; otherwise the literal prefix.
  function strings(node,module,tail=false,depth=0,at) {
    if(node.type==='Literal'&&typeof node.value==='string')return [{text:node.value,complete:true,node:at?.node??node,module:at?.module??module}];
    const join=(left,right)=>left.flatMap(a=>!a.complete?[a]:right.map(b=>({text:a.text+b.text,complete:b.complete,node:b.node??a.node,module:b.node?b.module:a.module})));
    if(node.type==='TemplateLiteral')return node.quasis.reduce((out,q,i)=>join(join(out,[{text:q.value.cooked,complete:true,...(q.value.cooked?{node:at?.node??node,module:at?.module??module}:{})}]),
      node.expressions[i]?strings(node.expressions[i],module,tail,depth,at):[{text:'',complete:true}]),[{text:'',complete:true}]);
    if(node.type==='BinaryExpression'&&node.operator==='+')return join(strings(node.left,module,tail,depth,at),strings(node.right,module,tail,depth,at));
    if(tail&&node.type==='CallExpression'&&node.arguments.length&&['resolve','join'].includes(node.callee.name??property(node.callee))
      &&imported(node.callee.type==='MemberExpression'?node.callee.object:node.callee,new Set(['node:path','path'])))return strings(node.arguments.at(-1),module,tail,depth,at);
    if(node.type==='NewExpression'&&unbound(node.callee,'URL')&&node.arguments[0])return strings(node.arguments[0],module,tail,depth,at);
    const found=depth>12?[]:origins(node,module).filter(o=>o.node!==node);
    return found.length?found.flatMap(o=>strings(o.node,o.module,tail,depth+1,o.at??at??{node,module})):[{text:'',complete:false}];
  }
  function link(kind,from,to,evidence,label,extra={}) {
    linked[kind]=(linked[kind]??0)+1;
    return edge(kind,from,to,evidence,{label,...extra});
  }

  // 1. Worker messages.
  function workerFile(o) {
    const n=o.node;if(n.type!=='NewExpression'||n.callee.type!=='Identifier'||n.callee.name!=='Worker')return null;
    if(!unbound(n.callee,'Worker')&&!imported(n.callee,new Set(['node:worker_threads']),'Worker'))return null;
    const a=n.arguments[0],meta=a?.type==='NewExpression'&&unbound(a.callee,'URL')&&a.arguments[0]?.type==='Literal'&&a.arguments[1]?.type==='MemberExpression'&&a.arguments[1].object.type==='MetaProperty';
    const file=a?.type==='Literal'&&typeof a.value==='string'&&a.value.startsWith('/')?a.value.slice(1):meta?importPath(o.module,String(a.arguments[0].value)):null;
    if(!modules.has(file)){miss('worker-message','worker-url-not-a-scanned-literal',n,o.module);return null;}
    return file;
  }
  const peerCache=new Map();
  function peer(node,module) {
    if(peerCache.has(node))return peerCache.get(node);
    const self=unbound(node,'self')||imported(node,new Set(['node:worker_threads']),'parentPort');
    const result=self?{self:module.file}:{workers:origins(node,module).map(o=>({file:workerFile(o),created:site(o.node,o.module)})).filter(w=>w.file)};
    peerCache.set(node,result);return result;
  }
  const sends=[],listens=[];
  for(const c of calls) {
    const callee=c.node.callee,name=callee.type==='MemberExpression'?property(callee):null,args=c.node.arguments;
    if(name==='postMessage'&&args[0])sends.push({node:c.node,module:c.module,message:args[0],peer:peer(callee.object,c.module)});
    if(['on','once','addEventListener'].includes(name)&&args[0]?.type==='Literal'&&args[0].value==='message'&&args[1])
      listens.push({node:c.node,module:c.module,handler:args[1],event:name==='addEventListener',peer:peer(callee.object,c.module)});
  }
  for(const a of assignments)if(a.node.left?.type==='MemberExpression'&&property(a.node.left)==='onmessage')
    listens.push({node:a.node,module:a.module,handler:a.node.right,event:true,peer:peer(a.node.left.object,a.module)});
  // Which literals a handler compares the message type with, and where it reads the message id.
  function dispatch(fn,module,index,event,out={types:[],ids:[]},seen=new Set()) {
    if(!fn.params[index]||seen.has(fn))return out;seen.add(fn);
    const messages=new Set(),events=new Set(),types=new Set(),ids=new Set();
    const bound=n=>n?.type==='Identifier'?lookup(nodeScope.get(n),n.name):null;
    const isMessage=n=>n&&(messages.has(bound(n))||n.type==='MemberExpression'&&property(n)==='data'&&events.has(bound(n.object)));
    function take(p,s,asEvent) {
      if(p.type==='AssignmentPattern')p=p.left;
      if(p.type==='Identifier') {const b=lookup(s,p.name);if(b)(asEvent?events:messages).add(b);}
      else if(p.type==='ObjectPattern')for(const q of p.properties) {
        const k=key(q),v=q.value?.type==='AssignmentPattern'?q.value.left:q.value;if(!k)continue;
        if(asEvent) {if(k==='data')take(v,s,false);}
        else if(v.type==='Identifier'&&(k==='type'||k==='id')) {const b=lookup(s,v.name);if(b)(k==='type'?types:ids).add(b);}
      }
    }
    take(fn.params[index],nodeScope.get(fn),event);
    const walk=(n,visit)=>{visit(n);for(const c of children(n))walk(c,visit);};
    for(let pass=0;pass<2;pass++)walk(fn.body,n=>{if(n.type==='VariableDeclaration')for(const v of n.declarations)if(v.init&&(isMessage(v.init)||events.has(bound(v.init))))take(v.id,nodeScope.get(n),!isMessage(v.init));});
    const isType=n=>n.type==='MemberExpression'&&property(n)==='type'&&isMessage(n.object)||n.type==='Identifier'&&types.has(bound(n))&&parents.get(n)?.type!=='Property';
    const literal=(n,at)=>{const s=strings(n,module);if(s.length===1&&s[0].complete)out.types.push({text:s[0].text,node:at,module});else miss('worker-message','dispatch-operand-not-literal',at,module);};
    walk(fn.body,n=>{
      if(n.type==='BinaryExpression'&&equality.has(n.operator)) {if(isType(n.left))literal(n.right,n);else if(isType(n.right))literal(n.left,n);}
      else if(n.type==='SwitchStatement'&&isType(n.discriminant)) {for(const c of n.cases)if(c.test)literal(c.test,c);}
      else if(n.type==='MemberExpression'&&property(n)==='id'&&isMessage(n.object)||n.type==='Identifier'&&ids.has(bound(n))&&parents.get(n)?.type!=='Property')out.ids.push({node:n,module});
      else if(n.type==='CallExpression')n.arguments.forEach((a,i)=>{if(isMessage(a)||events.has(bound(a)))for(const t of targetFns(n,module))dispatch(t.fn,t.module,i,!isMessage(a),out,seen);});
    });
    return out;
  }
  const handlerFns=l=>origins(l.handler,l.module).flatMap(o=>functions.has(o.node.type)?[{fn:o.node,module:o.module}]
    :choices(value(o.node,nodeScope.get(o.node),o.module)).filter(v=>v.fn).map(v=>({fn:v.fn,module:v.module})));
  for(const l of listens) {
    const fns=handlerFns(l);if(!fns.length)miss('worker-message','handler-not-resolved',l.node,l.module);
    l.found=fns.map(h=>({...h,...dispatch(h.fn,h.module,0,l.event)}));
  }
  const typeFree=(node,module)=>origins(node,module).every(o=>o.node.type==='ObjectExpression'&&o.node.properties.every(q=>q.type==='SpreadElement'?typeFree(q.argument,o.module):key(q)&&key(q)!=='type'));
  function message(send) {
    const objects=origins(send.message,send.module).filter(o=>o.node.type==='ObjectExpression');
    if(!objects.length)return {reason:'message-not-an-object-literal'};
    const out={types:[],id:false};
    for(const o of objects) {
      const props=o.node.properties,at=props.findLastIndex(q=>key(q)==='type');
      if(at<0) {if(props.some(q=>key(q)==='id'))out.id=true;else return {reason:'message-has-no-literal-type'};continue;}
      if(!props.slice(at+1).every(q=>q.type!=='SpreadElement'||typeFree(q.argument,o.module)))return {reason:'later-spread-may-replace-type'};
      const found=strings(props[at].value,o.module);if(found.some(s=>!s.complete))out.partial=true;
      out.types.push(...found.filter(s=>s.complete));
    }
    return out;
  }
  for(const s of sends)if(!s.peer.self&&!s.peer.workers.length)miss('worker-message','sender-worker-instance-unresolved',s.node,s.module);
  for(const l of listens)if(!l.peer.self&&!l.peer.workers.length)miss('worker-message','listener-worker-instance-unresolved',l.node,l.module);
  const workerFiles=new Set([...sends,...listens].flatMap(x=>(x.peer.workers??[]).map(w=>w.file)));
  const matchedTests=new Set(),seenTests=new Set();
  for(const file of workerFiles)for(const toWorker of [true,false]) {
    const near=x=>toWorker?x.peer.workers?.some(w=>w.file===file):x.peer.self===file,far=x=>toWorker?x.peer.self===file:x.peer.workers?.some(w=>w.file===file);
    const created=[...sends,...listens].flatMap(x=>(x.peer.workers??[]).filter(w=>w.file===file).map(w=>w.created)).filter((c,i,all)=>all.findIndex(d=>d.file===c.file&&d.start===c.start)===i);
    const handlers=listens.filter(far).flatMap(l=>l.found);
    for(const h of handlers)for(const t of h.types)seenTests.add(t);
    for(const s of sends.filter(near)) {
      const m=message(s);if(m.reason){miss('worker-message',m.reason,s.node,s.module);continue;}
      if(m.partial)miss('worker-message','type-not-literal',s.node,s.module);
      for(const t of m.types) {
        const tests=handlers.flatMap(h=>h.types).filter(x=>x.text===t.text);
        if(!tests.length)miss('worker-message','no-dispatch-on-this-type',s.node,s.module,t.text);
        for(const x of tests) {matchedTests.add(x);link('worker-message',owner(t.node,t.module),owner(x.node,x.module),[...created,site(t.node,t.module),site(s.node,s.module),site(x.node,x.module)],t.text,{by:'type',worker:file});}
      }
      if(m.id) {
        const readers=handlers.filter(h=>!h.types.length&&h.ids.length);
        if(!readers.length)miss('worker-message','untyped-message-without-id-reader',s.node,s.module);
        for(const h of readers)link('worker-message',owner(s.node,s.module),owner(h.ids[0].node,h.module),[...created,site(s.node,s.module),site(h.ids[0].node,h.module)],'id',{by:'id',worker:file});
      }
    }
  }
  for(const t of seenTests)if(!matchedTests.has(t))miss('worker-message','no-sender-of-this-type',t.node,t.module,t.text);

  // 2. HTTP routes.
  const methodTest=(n,ops)=>n.type==='BinaryExpression'&&ops.includes(n.operator)&&n.left.type==='MemberExpression'&&property(n.left)==='method'&&n.right.type==='Literal'?String(n.right.value):null;
  const split=(n,op)=>n.type==='LogicalExpression'&&n.operator===op?[...split(n.left,op),...split(n.right,op)]:[n];
  const stops=n=>n.type==='ReturnStatement'||n.type==='ThrowStatement'||n.type==='BlockStatement'&&n.body.some(stops);
  function methodAt(node) {
    for(let n=node,p=parents.get(n);p;n=p,p=parents.get(p)) {
      if(p.type==='LogicalExpression'&&p.operator==='&&')for(const part of split(p,'&&')){const m=methodTest(part,['===','==']);if(m)return m;}
      if(p.type==='IfStatement'&&p.consequent===n)for(const part of split(p.test,'&&')){const m=methodTest(part,['===','==']);if(m)return m;}
      if(p.type==='BlockStatement'||p.type==='Program')for(const before of p.body.slice(0,p.body.indexOf(n)))if(before.type==='IfStatement'&&stops(before.consequent))
        for(const part of split(before.test,'||')){const m=methodTest(part,['!==','!=']);if(m)return m;}
      if(p.type==='FunctionDeclaration')return null;
    }
    return null;
  }
  const routes=[],requests=[];
  const isPath=n=>n?.type==='MemberExpression'&&property(n)==='pathname';
  const route=(n,at,module,prefix=false)=>{for(const s of strings(n,module))if(s.complete&&s.text.startsWith('/'))routes.push({path:s.text,prefix,method:methodAt(at),node:at,module});};
  for(const m of modules.values())(function walk(n) {
    if(n.type==='BinaryExpression'&&['===','=='].includes(n.operator)) {if(isPath(n.left))route(n.right,n,m);else if(isPath(n.right))route(n.left,n,m);}
    for(const c of children(n))walk(c);
  })(m.ast);
  for(const c of calls) {
    const callee=c.node.callee,name=callee.type==='MemberExpression'?property(callee):null,args=c.node.arguments;
    if(name==='includes'&&isPath(args[0]))for(const e of origins(callee.object,c.module).flatMap(o=>elements(o)))route(e.node,c.node,e.module);
    if(name==='startsWith'&&isPath(callee.object)&&args[0]&&parents.get(c.node)?.type!=='UnaryExpression')route(args[0],c.node,c.module,true);
    const fetches=unbound(callee,'fetch')||callee.type==='Identifier'&&unbound(paramOf.get(lookup(nodeScope.get(callee),callee.name))?.fallback,'fetch');
    if(!args[0]||!fetches&&!(c.node.type==='NewExpression'&&unbound(callee,'EventSource')))continue;
    let method='GET';
    if(fetches&&args[1]) {
      const found=origins(args[1],c.module).map(o=>{
        if(o.node.type!=='ObjectExpression'||o.node.properties.some(q=>q.type==='SpreadElement'))return null;
        const p=o.node.properties.find(q=>key(q)==='method');if(!p)return 'GET';
        const s=strings(p.value,o.module);return s.length===1&&s[0].complete?s[0].text.toUpperCase():null;
      });
      method=found.length&&found.every(f=>f&&f===found[0])?found[0]:null;
    }
    if(!method){miss('http-route','request-method-not-literal',c.node,c.module);continue;}
    for(const s of strings(args[0],c.module)) {
      if(/^[a-z]+:/i.test(s.text))continue;
      if(!s.text.startsWith('/')||!s.complete&&!s.text.includes('?'))miss('http-route','request-path-not-literal',c.node,c.module);
      else requests.push({path:s.text.split('?')[0],method,literal:s,node:c.node,module:c.module});
    }
  }
  const served=new Set();
  for(const r of requests) {
    const same=routes.filter(x=>x.prefix?r.path.startsWith(x.path):x.path===r.path),exact=same.filter(x=>x.method===r.method),open=same.filter(x=>!x.method);
    const chosen=exact.length?exact:open.length===1?open:[];
    if(!chosen.length)miss('http-route',open.length>1?'route-method-ambiguous':'no-literal-route-for-request',r.node,r.module,`${r.method} ${r.path}`);
    for(const x of chosen) {served.add(x);link('http-route',owner(r.literal.node,r.literal.module),owner(x.node,x.module),[site(r.literal.node,r.literal.module),site(r.node,r.module),site(x.node,x.module)],`${r.method} ${x.path}${x.prefix?'*':''}`);}
  }
  for(const x of routes)if(!served.has(x))miss('http-route','no-literal-request-for-route',x.node,x.module,`${x.method??'?'} ${x.path}${x.prefix?'*':''}`);

  // 3. Files on disk.
  const accesses=new Map();
  for(const c of calls) {
    const callee=c.node.callee,name=callee.type==='Identifier'?lookup(c.scope,callee.name)?.imported:callee.type==='MemberExpression'?property(callee):null;
    if(!Object.hasOwn(fsCalls,name??'')||!imported(callee.type==='Identifier'?callee:callee.object,fsModules))continue;
    for(const [index,mode] of fsCalls[name]) {
      const arg=c.node.arguments[index];if(!arg||arg.type==='SpreadElement')continue;
      const found=strings(arg,c.module,true),names=found.filter(s=>s.complete&&s.node&&/[^/\\]\.[A-Za-z0-9]+$/.test(s.text));
      if(!names.length||found.some(s=>!s.complete))miss('file',`${mode}-path-not-literal`,c.node,c.module);
      for(const s of names) {
        const label=s.text.replace(/^\.\//,''),entry=accesses.get(label)??{read:[],write:[]};accesses.set(label,entry);
        if(!entry[mode].some(a=>a.literal.node===s.node&&a.node===c.node))entry[mode].push({literal:s,node:c.node,module:c.module});
      }
    }
  }
  for(const [label,{read,write}] of accesses) {
    if(!read.length||!write.length){const a=(read[0]??write[0]);miss('file',read.length?'read-without-literal-writer':'write-without-literal-reader',a.literal.node,a.literal.module,label);continue;}
    const done=new Set();
    for(const w of write)for(const r of read) {
      const from=owner(w.literal.node,w.literal.module),to=owner(r.literal.node,r.literal.module),pair=`${from}\n${to}`;
      if(from===to||done.has(pair))continue;done.add(pair);
      link('file',from,to,[site(w.literal.node,w.literal.module),site(w.node,w.module),site(r.literal.node,r.literal.module),site(r.node,r.module)],label);
    }
  }

  // 4. Registry entries: callables held side by side under one literal key, in an object whose entries repeat those roles.
  for(const m of modules.values())(function walk(n) {
    if(n.type==='ObjectExpression') {
      const entries=n.properties.filter(p=>key(p)&&p.value.type==='ObjectExpression'),roles=new Map();
      for(const e of entries)for(const q of e.value.properties)if(key(q))roles.set(key(q),(roles.get(key(q))??0)+1);
      for(const e of entries) {
        const held=e.value.properties.flatMap(q=>{if(!(roles.get(key(q))>1))return [];const v=choices(value(q.value,nodeScope.get(q.value),m)).filter(v=>v.decl&&v.fn);return v.length===1?[{q,decl:v[0].decl}]:[];});
        for(let i=0;i<held.length;i++)for(let j=i+1;j<held.length;j++)if(held[i].decl.id!==held[j].decl.id)
          link('registry-entry',held[i].decl.id,held[j].decl.id,[site(held[i].q,m),site(held[j].q,m)],`${key(e)}: ${key(held[i].q)}, ${key(held[j].q)}`);
      }
    }
    for(const c of children(n))walk(c);
  })(m.ast);
  return {linked,unlinked};
}
