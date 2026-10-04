// Per-file compilation for the compositional analysis (plans/dev-maps.md#analysis). Walks one
// parsed module, exactly as constraints.mjs does, but records each callable's constraints as a
// summary over its own local nodes instead of adding them to a whole-program graph:
//
// - Nodes and allocation slots belong to the callable whose code creates them. A reference to an
//   enclosing callable's variable is an environment local, resolved when the summary is used.
// - A node is *open* when its value depends on the call: parameters, `this`, the callable's own
//   function object, variables nested callables write, and everything computed from them; a fresh
//   object that is returned (or, for a constructor, the instance's own fields) is open too, so
//   every call site gets its own. Everything else is *closed*: the same for every call.
// - Closed operations run once per callable; open operations are its summary, instantiated per
//   call site by compose.mjs. Direct calls name their target symbolically (file and export), so a
//   file compiles without reading any other file, and an edit recompiles only that file.
//
// The output depends only on the file's text and the import resolver.

const ELEMENT='[]';
const UNMODELLED_GLOBALS=new Set(['eval','Function','Proxy','Reflect']);
const UNMODELLED_MEMBERS=new Set(['defineProperty','defineProperties','setPrototypeOf','__defineGetter__','__defineSetter__']);

// Operand fields per operation: nodes read, the node written, and allocation slots used.
const IN={E:['a'],LOAD:['b'],STORE:['b','v'],CALL:['c','th'],NEW:['c'],SCALL:['fb'],COPYF:['src'],FE:['v'],FSTAR:['v'],ENS:['v'],LOADNS:['b'],REEXP:['b']};
const OUT={E:'b',LOAD:'t',CALL:'r',NEW:'r',SCALL:'r',ALLOC:'n',SELF:'n',PLAT:'n',NS:'n'};
const SLOTS={ALLOC:['s'],FE:['s'],FSTAR:['s'],FSLOT:['s','s2'],FPLAT:['s'],COPYF:['s']};
const HAS_ARGS=new Set(['CALL','NEW','SCALL']);
export const OPS={IN,OUT,SLOTS,HAS_ARGS};

export function compileModule(mod,{resolveImport}) {
  const file=mod.file;
  const nodeOwner=[];const slotOwner=[],slotSpec=[];
  const fns=[];const notes=[];const noted=new Set();
  const node=fn=>{nodeOwner.push(fn.idx);return nodeOwner.length-1;};
  const slot=(fn,spec)=>{slotOwner.push(fn.idx);slotSpec.push(spec);return slotOwner.length-1;};
  const emit=(fn,op)=>{fn.ops.push(op);};
  function note(kind,fn,n){const k=`${kind}|${file}|${n?.start??fn?.key}`;if(noted.has(k))return;noted.add(k);notes.push({kind,fnKey:fn?.key,file,line:n?.loc?.start.line});}

  function newCallable(n,owner,name,{arrow=false,kind='function',thisNode}={}) {
    const f={idx:fns.length,key:file+':'+n.start,name,kind,file,line:n.loc?.start.line,end:n.loc?.end.line,
      owner:owner?owner.idx:-1,arrow,module:kind==='module',params:[],rest:-1,restSlot:-1,ops:[],selfNodes:[]};
    fns.push(f);
    f.ret=node(f);f.thisH=thisNode??node(f);
    return f;
  }
  const site=(fn,n,text)=>({id:`${file}:${n.start}`,line:n.loc?.start.line,text,resultUsed:true});
  const source=n=>mod.text.slice(n.start,Math.min(n.end,n.start+80));

  // --- scopes ---------------------------------------------------------------------------------
  class Scope {
    constructor(parent,fn){this.parent=parent;this.fn=fn;this.names=new Map();}
    declare(name){let n=this.names.get(name);if(n===undefined){n=node(this.fn);this.names.set(name,n);}return n;}
    lookup(name){for(let s=this;s;s=s.parent){const n=s.names.get(name);if(n!==undefined)return n;}return undefined;}
  }
  function patternNames(p,out=[]) {
    if(!p)return out;
    switch(p.type){
      case 'Identifier':out.push(p.name);break;
      case 'ObjectPattern':for(const q of p.properties)patternNames(q.type==='RestElement'?q.argument:q.value,out);break;
      case 'ArrayPattern':for(const q of p.elements)patternNames(q,out);break;
      case 'RestElement':patternNames(p.argument,out);break;
      case 'AssignmentPattern':patternNames(p.left,out);break;
    }
    return out;
  }
  function hoistVars(body,scope) {
    const visit=n=>{
      if(!n||typeof n.type!=='string')return;
      if(n.type==='VariableDeclaration'&&n.kind==='var')for(const d of n.declarations)for(const x of patternNames(d.id))scope.declare(x);
      if(/Function|Class/.test(n.type)&&n.type!=='ClassBody')return;
      for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v.type==='string')visit(v);}
    };
    body.forEach(visit);
  }
  function declareBlock(statements,scope) {
    for(const s0 of statements) {
      const s=s0.type==='ExportNamedDeclaration'||s0.type==='ExportDefaultDeclaration'?s0.declaration:s0;
      if(!s)continue;
      if(s.type==='VariableDeclaration'&&s.kind!=='var')for(const d of s.declarations)for(const x of patternNames(d.id))scope.declare(x);
      if((s.type==='FunctionDeclaration'||s.type==='ClassDeclaration')&&s.id)scope.declare(s.id.name);
    }
  }

  // --- module preparation: local functions, exports, imports --------------------------------
  const moduleFn=newCallable(mod.ast,null,'(module load)',{kind:'module'});
  const mscope=new Scope(null,moduleFn);
  hoistVars(mod.ast.body,mscope);declareBlock(mod.ast.body,mscope);
  const mctx={fn:moduleFn,scope:mscope,thisNode:undefined,classInfo:null};
  const local=new Map(),exports=new Map(),imports=new Map(),reexports=[],reassigned=new Set();
  for(const s0 of mod.ast.body) {
    const s=(s0.type==='ExportNamedDeclaration'||s0.type==='ExportDefaultDeclaration')?(s0.declaration??s0):s0;
    if(s.type==='FunctionDeclaration'&&s.id&&!s.generator)local.set(s.id.name,s);
    if(s.type==='VariableDeclaration'&&s.kind==='const')for(const d of s.declarations)
      if(d.id.type==='Identifier'&&d.init&&(d.init.type==='ArrowFunctionExpression'||d.init.type==='FunctionExpression')&&!d.init.generator)local.set(d.id.name,d.init);
    if(s0.type==='ExportNamedDeclaration') {
      if(s0.declaration){const d=s0.declaration;for(const n of d.type==='VariableDeclaration'?d.declarations.flatMap(x=>patternNames(x.id)):[d.id.name])exports.set(n,{local:n});}
      for(const sp of s0.specifiers??[]) {
        const ex=sp.exported.name??sp.exported.value,lo=sp.local.name??sp.local.value;
        exports.set(ex,s0.source?{from:resolveImport(file,s0.source.value),name:lo}:{local:lo});
      }
    }
    if(s0.type==='ExportDefaultDeclaration'&&s0.declaration.id)exports.set('default',{local:s0.declaration.id.name});
    if(s0.type==='ExportAllDeclaration'&&!s0.exported)reexports.push(resolveImport(file,s0.source.value));
    if(s0.type==='ImportDeclaration')for(const sp of s0.specifiers)if(sp.type==='ImportSpecifier')
      imports.set(sp.local.name,{from:resolveImport(file,s0.source.value),name:sp.imported.name??sp.imported.value});
  }
  const visitAssigned=n=>{if(!n||typeof n.type!=='string')return;
    if(n.type==='AssignmentExpression'&&n.left.type==='Identifier')reassigned.add(n.left.name);
    if(n.type==='UpdateExpression'&&n.argument.type==='Identifier')reassigned.add(n.argument.name);
    for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v))v.forEach(visitAssigned);else if(v&&typeof v.type==='string')visitAssigned(v);}};
  visitAssigned(mod.ast);
  for(const r of reassigned)local.delete(r);
  const localKeys=new Map([...local].map(([name,ast])=>[name,file+':'+ast.start]));

  function moduleNamespace(spec,fn,n) {
    const t=node(fn);
    emit(fn,{k:'NS',n:t,file:resolveImport(file,spec),spec,line:n.loc?.start.line});
    return t;
  }
  for(const s of mod.ast.body)if(s.type==='ImportDeclaration') {
    const target=moduleNamespace(s.source.value,moduleFn,s);
    for(const sp of s.specifiers) {
      const b=mscope.declare(sp.local.name);
      if(sp.type==='ImportNamespaceSpecifier')emit(moduleFn,{k:'E',a:target,b});
      else load(target,sp.type==='ImportDefaultSpecifier'?'default':(sp.imported.name??sp.imported.value),b,moduleFn);
    }
  }

  // --- constraint helpers ---------------------------------------------------------------------
  function load(b,name,t,fn){emit(fn,{k:'LOAD',b,name,t});}
  function store(b,name,v,fn,st){emit(fn,{k:'STORE',b,name,v:v??-1,site:st});}
  function spreadNodes(args,fn) {
    const spread=args.findIndex(a=>typeof a==='object'&&a.spread);
    const nodes=args.map(a=>typeof a==='object'?a.node:a);
    let spreadAt=-1;
    if(spread>=0){const el=node(fn);load(nodes[spread],ELEMENT,el,fn);nodes[spread]=el;spreadAt=spread;}
    return {nodes,spreadAt};
  }
  function call(st,fn,c,th,args,r,method) {
    const {nodes,spreadAt}=spreadNodes(args,fn);
    emit(fn,{k:'CALL',site:st,c,th:th??-1,args:nodes,spreadAt,r,method});
  }
  function staticTarget(name,ctx) {
    const binding=ctx.scope.lookup(name);
    if(binding===undefined||mscope.names.get(name)!==binding)return undefined;
    const key=localKeys.get(name);
    if(key)return {key};
    const imp=imports.get(name);
    return imp?.from?{file:imp.from,name:imp.name}:undefined;
  }
  function global(name,ctx) {
    if(UNMODELLED_GLOBALS.has(name))note('global:'+name,ctx.fn);
    if(name==='undefined'||name==='NaN'||name==='Infinity')return undefined;
    const n=node(ctx.fn);emit(ctx.fn,{k:'PLAT',n,how:'root',name});return n;
  }
  function identifier(name,ctx) {
    if(name==='arguments'&&!ctx.fn.module)note('arguments',ctx.fn);
    return ctx.scope.lookup(name)??global(name,ctx);
  }

  // --- statements -----------------------------------------------------------------------------
  function statements(list,ctx){for(const s of list)statement(s,ctx);}
  function block(list,ctx){const scope=new Scope(ctx.scope,ctx.fn);declareBlock(list,scope);statements(list,{...ctx,scope});}
  function statement(s,ctx) {
    if(!s)return;
    switch(s.type) {
      case 'ImportDeclaration':return;
      case 'ExportNamedDeclaration':if(s.declaration)statement(s.declaration,ctx);return;
      case 'ExportDefaultDeclaration':
        if((s.declaration.type==='FunctionDeclaration'||s.declaration.type==='ClassDeclaration')&&s.declaration.id)statement(s.declaration,ctx);
        return;
      case 'ExportAllDeclaration':return;
      case 'VariableDeclaration':for(const d of s.declarations){if(d.init)bindPattern(d.id,expression(d.init,ctx),ctx);}return;
      case 'FunctionDeclaration':{const v=functionValue(s,ctx);emit(ctx.fn,{k:'E',a:v,b:ctx.scope.lookup(s.id.name)});return;}
      case 'ClassDeclaration':{const v=classValue(s,ctx);emit(ctx.fn,{k:'E',a:v,b:ctx.scope.lookup(s.id.name)});return;}
      case 'ExpressionStatement':expression(s.expression,ctx,{unused:true});return;
      case 'ReturnStatement':
        if(s.argument){const v=expression(s.argument,ctx);if(v!==undefined)emit(ctx.fn,{k:'E',a:v,b:ctx.fn.ret});}
        return;
      case 'IfStatement':expression(s.test,ctx);statement(s.consequent,ctx);statement(s.alternate,ctx);return;
      case 'BlockStatement':block(s.body,ctx);return;
      case 'ForStatement':{const scope=new Scope(ctx.scope,ctx.fn);const c={...ctx,scope};
        if(s.init){if(s.init.type==='VariableDeclaration'){declareBlock([s.init],scope);statement(s.init,c);}else expression(s.init,c);}
        if(s.test)expression(s.test,c);if(s.update)expression(s.update,c);statement(s.body,c);return;}
      case 'ForOfStatement':case 'ForInStatement':{const scope=new Scope(ctx.scope,ctx.fn);const c={...ctx,scope};
        const src=expression(s.right,c);let el;
        if(s.type==='ForOfStatement'&&src!==undefined){el=node(ctx.fn);load(src,ELEMENT,el,ctx.fn);}
        if(s.left.type==='VariableDeclaration'){declareBlock([s.left],scope);if(el!==undefined)bindPattern(s.left.declarations[0].id,el,c);}
        else if(el!==undefined)assign(s.left,el,c);
        statement(s.body,c);return;}
      case 'WhileStatement':case 'DoWhileStatement':expression(s.test,ctx);statement(s.body,ctx);return;
      case 'TryStatement':
        statement(s.block,ctx);
        if(s.handler){const scope=new Scope(ctx.scope,ctx.fn);
          for(const x of patternNames(s.handler.param))emit(ctx.fn,{k:'PLAT',n:scope.declare(x),how:'unknown'});
          statement(s.handler.body,{...ctx,scope});}
        statement(s.finalizer,ctx);return;
      case 'ThrowStatement':expression(s.argument,ctx);return;
      case 'SwitchStatement':{expression(s.discriminant,ctx);const all=s.cases.flatMap(c=>c.consequent);
        const scope=new Scope(ctx.scope,ctx.fn);declareBlock(all,scope);const c={...ctx,scope};
        for(const k of s.cases){if(k.test)expression(k.test,c);statements(k.consequent,c);}return;}
      case 'LabeledStatement':statement(s.body,ctx);return;
      case 'WithStatement':note('with',ctx.fn,s);return;
      case 'EmptyStatement':case 'BreakStatement':case 'ContinueStatement':case 'DebuggerStatement':return;
      default:note('statement:'+s.type,ctx.fn,s);
    }
  }
  function bindPattern(p,value,ctx) {
    switch(p.type) {
      case 'Identifier':if(value!==undefined)emit(ctx.fn,{k:'E',a:value,b:ctx.scope.lookup(p.name)??ctx.scope.declare(p.name)});return;
      case 'ObjectPattern':
        for(const q of p.properties) {
          if(q.type==='RestElement'){bindPattern(q.argument,value,ctx);continue;}
          const key=propertyKey(q,ctx);
          const t=node(ctx.fn);if(value!==undefined)load(value,key,t,ctx.fn);
          bindPattern(q.value,t,ctx);
        }
        return;
      case 'ArrayPattern':{const t=node(ctx.fn);if(value!==undefined)load(value,ELEMENT,t,ctx.fn);
        for(const q of p.elements)if(q)bindPattern(q.type==='RestElement'?q.argument:q,q.type==='RestElement'?value:t,ctx);return;}
      case 'RestElement':bindPattern(p.argument,value,ctx);return;
      case 'AssignmentPattern':{const d=expression(p.right,ctx);const t=node(ctx.fn);
        if(value!==undefined)emit(ctx.fn,{k:'E',a:value,b:t});if(d!==undefined)emit(ctx.fn,{k:'E',a:d,b:t});bindPattern(p.left,t,ctx);return;}
      case 'MemberExpression':assign(p,value,ctx);return;
    }
  }
  function assign(target,value,ctx) {
    if(target.type==='Identifier'){if(value!==undefined)emit(ctx.fn,{k:'E',a:value,b:identifier(target.name,ctx)});return;}
    if(target.type==='MemberExpression') {
      const base=expression(target.object,ctx);const key=memberKey(target,ctx);
      if(base!==undefined)store(base,key,value,ctx.fn,site(ctx.fn,target));
      return;
    }
    bindPattern(target,value,ctx);
  }
  function write(target,ctx) {
    if(target.type!=='MemberExpression')return;
    const base=expression(target.object,ctx);
    if(base!==undefined)store(base,memberKey(target,ctx),undefined,ctx.fn,site(ctx.fn,target));
  }
  function laterKeys(properties,spread) {
    const keys=[];
    for(const q of properties.slice(properties.indexOf(spread)+1))if(q.type==='Property'&&!q.computed)keys.push(q.key.type==='Identifier'?q.key.name:String(q.key.value));
    return keys;
  }
  function propertyKey(p,ctx) {
    if(!p.computed)return p.key.type==='Identifier'?p.key.name:p.key.type==='PrivateIdentifier'?'#'+p.key.name:String(p.key.value);
    if(p.key.type==='Literal')return typeof p.key.value==='number'?ELEMENT:String(p.key.value);
    expression(p.key,ctx);return null;
  }
  function memberKey(m,ctx) {
    if(!m.computed)return m.property.type==='PrivateIdentifier'?'#'+m.property.name:m.property.name;
    const k=m.property;
    if(k.type==='Literal')return typeof k.value==='number'?ELEMENT:String(k.value);
    expression(k,ctx);
    return null;
  }

  // --- expressions: return the node holding the value, or undefined for primitives ------------
  function allocate(shape,ctx,e,proto) {
    const s=slot(ctx.fn,{shape,line:e.loc?.start.line,proto});
    const v=node(ctx.fn);emit(ctx.fn,{k:'ALLOC',n:v,s});return {s,v};
  }
  function expression(e,ctx,{unused=false}={}) {
    if(!e)return undefined;
    switch(e.type) {
      case 'Identifier':return identifier(e.name,ctx);
      case 'Literal':case 'TemplateLiteral':
        if(e.type==='TemplateLiteral')for(const x of e.expressions)expression(x,ctx);
        if(e.regex)return allocate('regexp',ctx,e).v;
        return undefined;
      case 'ThisExpression':return ctx.thisNode;
      case 'Super':return ctx.classInfo?.superNode;
      case 'ArrayExpression':{const {s,v}=allocate('array',ctx,e,'Array.prototype');
        for(const x of e.elements){if(!x)continue;
          if(x.type==='SpreadElement'){const src=expression(x.argument,ctx);if(src!==undefined){const t=node(ctx.fn);load(src,ELEMENT,t,ctx.fn);emit(ctx.fn,{k:'FE',v:t,s,name:ELEMENT});}}
          else{const src=expression(x,ctx);if(src!==undefined)emit(ctx.fn,{k:'FE',v:src,s,name:ELEMENT});}}
        return v;}
      case 'ObjectExpression':{const {s,v}=allocate('object',ctx,e,'Object.prototype');
        for(const p of e.properties) {
          if(p.type==='SpreadElement'){const src=expression(p.argument,ctx);if(src!==undefined)emit(ctx.fn,{k:'COPYF',src,s,over:laterKeys(e.properties,p)});continue;}
          const key=propertyKey(p,ctx);
          if(p.kind==='get'||p.kind==='set')note('accessor',ctx.fn,p);
          const val=p.value.type==='FunctionExpression'||p.value.type==='ArrowFunctionExpression'?functionValue(p.value,ctx,key,{thisNode:undefined}):expression(p.value,ctx);
          if(val===undefined)continue;
          if(key===null)emit(ctx.fn,{k:'FSTAR',v:val,s});
          else emit(ctx.fn,{k:'FE',v:val,s,name:key});
        }
        return v;}
      case 'FunctionExpression':case 'ArrowFunctionExpression':case 'FunctionDeclaration':return functionValue(e,ctx);
      case 'ClassExpression':case 'ClassDeclaration':return classValue(e,ctx);
      case 'MemberExpression':{
        const base=expression(e.object,ctx);const key=memberKey(e,ctx);
        if(!e.computed&&UNMODELLED_MEMBERS.has(key))note('member:'+key,ctx.fn,e);
        if(base===undefined)return undefined;
        const t=node(ctx.fn);load(base,key,t,ctx.fn);return t;}
      case 'ChainExpression':return expression(e.expression,ctx,{unused});
      case 'CallExpression':return callExpression(e,ctx,unused);
      case 'NewExpression':{const callee=expression(e.callee,ctx);const args=argumentNodes(e.arguments,ctx);const r=node(ctx.fn);
        if(callee!==undefined){const {nodes,spreadAt}=spreadNodes(args,ctx.fn);
          emit(ctx.fn,{k:'NEW',site:{...site(ctx.fn,e,source(e.callee)),resultUsed:!unused},c:callee,args:nodes,spreadAt,r});}
        return r;}
      case 'AssignmentExpression':{
        const v=expression(e.right,ctx);
        if(e.operator==='='||e.operator==='??='||e.operator==='||='||e.operator==='&&=')assign(e.left,v,ctx);
        else{expression(e.left,ctx);write(e.left,ctx);}
        return v;}
      case 'SequenceExpression':{let v;for(const x of e.expressions)v=expression(x,ctx);return v;}
      case 'ConditionalExpression':{expression(e.test,ctx);return union([expression(e.consequent,ctx),expression(e.alternate,ctx)],ctx);}
      case 'LogicalExpression':return union([expression(e.left,ctx),expression(e.right,ctx)],ctx);
      case 'BinaryExpression':expression(e.left,ctx);expression(e.right,ctx);return undefined;
      case 'UnaryExpression':expression(e.argument,ctx);if(e.operator==='delete')write(e.argument,ctx);return undefined;
      case 'UpdateExpression':expression(e.argument,ctx);write(e.argument,ctx);return undefined;
      case 'AwaitExpression':{const v=expression(e.argument,ctx);if(v===undefined)return undefined;const t=node(ctx.fn);
        emit(ctx.fn,{k:'E',a:v,b:t});load(v,ELEMENT,t,ctx.fn);return t;}
      case 'YieldExpression':note('yield',ctx.fn,e);expression(e.argument,ctx);return undefined;
      case 'SpreadElement':return expression(e.argument,ctx);
      case 'TaggedTemplateExpression':{for(const x of e.quasi.expressions)expression(x,ctx);
        const callee=expression(e.tag,ctx);const r=node(ctx.fn);if(callee!==undefined)call(site(ctx.fn,e,source(e.tag)),ctx.fn,callee,undefined,[],r);return r;}
      case 'ImportExpression':{
        if(e.source.type==='Literal'){const {s,v}=allocate('promise',ctx,e);
          emit(ctx.fn,{k:'FE',v:moduleNamespace(e.source.value,ctx.fn,e),s,name:ELEMENT});return v;}
        note('dynamic-import',ctx.fn,e);expression(e.source,ctx);return undefined;}
      case 'MetaProperty':return undefined;
      case 'ParenthesizedExpression':return expression(e.expression,ctx,{unused});
      default:note('expression:'+e.type,ctx.fn,e);return undefined;
    }
  }
  function union(nodes,ctx) {
    const present=nodes.filter(n=>n!==undefined);
    if(present.length<2)return present[0];
    const t=node(ctx.fn);for(const n of present)emit(ctx.fn,{k:'E',a:n,b:t});return t;
  }
  function argumentNodes(list,ctx) {
    return list.map(a=>{
      if(a.type==='SpreadElement'){const n=expression(a.argument,ctx);return {spread:true,node:n??node(ctx.fn)};}
      return expression(a,ctx)??node(ctx.fn);
    });
  }
  function callExpression(e,ctx,unused) {
    const c=e.callee;
    if(c.type==='Super') {
      const args=argumentNodes(e.arguments,ctx);const r=node(ctx.fn);
      const sup=ctx.classInfo?.superNode;
      if(sup!==undefined)call({...site(ctx.fn,e,'super(...)'),resultUsed:false},ctx.fn,sup,ctx.thisNode,args,r,undefined);
      return r;
    }
    let callee,thisNode,method;
    if(c.type==='MemberExpression'||c.type==='ChainExpression'&&c.expression.type==='MemberExpression') {
      const m=c.type==='ChainExpression'?c.expression:c;
      thisNode=m.object.type==='Super'?ctx.thisNode:expression(m.object,ctx);
      const base=m.object.type==='Super'?ctx.classInfo?.superProtoNode:thisNode;
      method=memberKey(m,ctx);
      if(!m.computed&&UNMODELLED_MEMBERS.has(method))note('member:'+method,ctx.fn,m);
      if(m.computed&&m.property.type!=='Literal')note('computed-callee',ctx.fn,m);
      callee=node(ctx.fn);if(base!==undefined)load(base,method,callee,ctx.fn);
    } else {
      const target=c.type==='Identifier'?staticTarget(c.name,ctx):undefined;
      if(target) {
        // A direct call: the target is named here and resolved when composing, so this file
        // compiles alone. The binding is kept for a target that turns out not to be a function.
        const fb=identifier(c.name,ctx);
        const args=argumentNodes(e.arguments,ctx);const r=node(ctx.fn);
        const {nodes,spreadAt}=spreadNodes(args,ctx.fn);
        emit(ctx.fn,{k:'SCALL',site:{...site(ctx.fn,e,source(c)),resultUsed:!unused},target,fb,args:nodes,spreadAt,r});
        return r;
      }
      callee=expression(c,ctx);
      if(c.type!=='Identifier'&&!/Function/.test(c.type))note('callee-expression:'+c.type,ctx.fn,c);
    }
    const args=argumentNodes(e.arguments,ctx);
    const r=node(ctx.fn);
    if(callee!==undefined)call({...site(ctx.fn,e,source(c)),resultUsed:!unused},ctx.fn,callee,thisNode,args,r,method);
    return r;
  }

  function functionValue(n,ctx,name,{thisNode}={}) {
    const arrow=n.type==='ArrowFunctionExpression';
    const f=newCallable(n,ctx.fn,name??n.id?.name,{arrow,thisNode:arrow?ctx.thisNode:thisNode});
    const s=slot(ctx.fn,{fn:f.idx});
    const v=node(ctx.fn);emit(ctx.fn,{k:'ALLOC',n:v,s});
    const scope=new Scope(ctx.scope,f);
    if(n.type==='FunctionExpression'&&n.id)emit(f,{k:'SELF',n:scope.declare(n.id.name)});
    const fctx={fn:f,scope,thisNode:f.thisH,classInfo:ctx.classInfo};
    for(const p of n.params) {
      const pn=node(f);
      if(p.type==='RestElement'){f.rest=pn;f.restSlot=slot(f,{shape:'array',rest:true});emit(f,{k:'ALLOC',n:pn,s:f.restSlot});
        for(const x of patternNames(p.argument))scope.declare(x);bindPattern(p.argument,pn,fctx);continue;}
      f.params.push(pn);
      for(const x of patternNames(p))scope.declare(x);
      bindPattern(p,pn,fctx);
    }
    if(n.body.type==='BlockStatement') {
      hoistVars(n.body.body,scope);declareBlock(n.body.body,scope);
      statements(n.body.body,fctx);
    } else {
      const v2=expression(n.body,fctx);
      if(v2!==undefined)emit(f,{k:'E',a:v2,b:f.ret});
    }
    if(n.generator)note('generator',f,n);
    return v;
  }
  function classValue(n,ctx) {
    const name=n.id?.name??'(class)';
    const ctorNode=n.body.body.find(m=>m.kind==='constructor');
    const owner=ctx.fn;
    const superNode=n.superClass?expression(n.superClass,ctx):undefined;
    const ctor=newCallable(ctorNode?.value??n,owner,name,{kind:'class'});
    const cs=slot(owner,{fn:ctor.idx});
    const v=node(owner);emit(owner,{k:'ALLOC',n:v,s:cs});
    const ps=slot(owner,{shape:'prototype',name:name+'.prototype',line:n.loc?.start.line});
    emit(owner,{k:'FSLOT',s:cs,name:'prototype',s2:ps});
    let superProtoNode;
    if(superNode!==undefined) {
      superProtoNode=node(owner);load(superNode,'prototype',superProtoNode,owner);
      emit(owner,{k:'FE',v:superProtoNode,s:ps,name:'__proto__'});
      emit(owner,{k:'FE',v:superNode,s:cs,name:'__proto__'});
    } else emit(owner,{k:'FPLAT',s:ps,name:'__proto__',path:'Object.prototype'});
    const classInfo={superNode,superProtoNode};
    const scope=new Scope(ctx.scope,ctor);
    if(n.id)emit(ctor,{k:'SELF',n:scope.declare(n.id.name)});
    const cctx={fn:ctor,scope,thisNode:ctor.thisH,classInfo};
    if(ctorNode) {
      const fnode=ctorNode.value;
      for(const p of fnode.params){const pn=node(ctor);ctor.params.push(pn);for(const x of patternNames(p))scope.declare(x);bindPattern(p,pn,cctx);}
      hoistVars(fnode.body.body,scope);declareBlock(fnode.body.body,scope);
      statements(fnode.body.body,cctx);
    } else if(superNode!==undefined) {
      // An implicit constructor forwards its arguments to the parent.
      const rest=node(ctor);ctor.rest=rest;ctor.restSlot=slot(ctor,{shape:'array',rest:true});emit(ctor,{k:'ALLOC',n:rest,s:ctor.restSlot});
      call({...site(ctor,n,'super(...)'),resultUsed:false},ctor,superNode,ctor.thisH,[{spread:true,node:rest}],node(ctor),undefined);
    }
    for(const m of n.body.body) {
      if(m.kind==='constructor')continue;
      if(m.type==='StaticBlock'){statements(m.body,{...cctx,thisNode:v});continue;}
      const key=propertyKey(m,cctx);
      if(m.type==='MethodDefinition') {
        if(m.kind==='get'||m.kind==='set')note('accessor',ctor,m);
        const mv=functionValue(m.value,{...ctx,classInfo},`${name}.${key}`,{thisNode:undefined});
        if(key!==null)emit(owner,{k:'FE',v:mv,s:m.static?cs:ps,name:key});
      } else if(m.type==='PropertyDefinition') {
        if(!m.value)continue;
        const target=m.static?v:ctor.thisH;
        const fctx=m.static?{...cctx,thisNode:v}:cctx;
        const val=m.value.type==='ArrowFunctionExpression'||m.value.type==='FunctionExpression'?functionValue(m.value,fctx,`${name}.${key}`):expression(m.value,fctx);
        if(val!==undefined&&key!==null)store(target,key,val,ctor,site(ctor,m));
      }
    }
    return v;
  }

  // --- the module body and its exports ---------------------------------------------------------
  statements(mod.ast.body,mctx);
  for(const s of mod.ast.body) {
    if(s.type==='ExportNamedDeclaration') {
      if(s.declaration) {
        const d=s.declaration;
        const names=d.type==='VariableDeclaration'?d.declarations.flatMap(x=>patternNames(x.id)):[d.id.name];
        for(const n of names)emit(moduleFn,{k:'ENS',v:mscope.lookup(n),name:n});
      }
      if(s.source) {
        const target=moduleNamespace(s.source.value,moduleFn,s);
        for(const sp of s.specifiers)emit(moduleFn,{k:'LOADNS',b:target,name:sp.local.name??sp.local.value,ename:sp.exported.name??sp.exported.value});
      } else for(const sp of s.specifiers)emit(moduleFn,{k:'ENS',v:mscope.lookup(sp.local.name)??global(sp.local.name,mctx),name:sp.exported.name??sp.exported.value});
    } else if(s.type==='ExportDefaultDeclaration') {
      const d=s.declaration;
      const v=(d.type==='FunctionDeclaration'||d.type==='ClassDeclaration')&&d.id?mscope.lookup(d.id.name):expression(d,mctx);
      if(v!==undefined)emit(moduleFn,{k:'ENS',v,name:'default'});
    } else if(s.type==='ExportAllDeclaration') {
      const target=moduleNamespace(s.source.value,moduleFn,s);
      if(s.exported)emit(moduleFn,{k:'ENS',v:target,name:s.exported.name});
      else emit(moduleFn,{k:'REEXP',b:target});
    }
  }

  const functions=classify({fns,nodeOwner,slotOwner,slotSpec});
  // Module-level function objects, by callable key, for direct calls.
  const fnSlot={};
  const mf=functions[0];
  mf.slots.forEach((sp,i)=>{if(sp.fn!==undefined)fnSlot[functions[sp.fn].key]=i;});
  return {file,functions,notes,
    iface:{exports:Object.fromEntries(exports),local:Object.fromEntries(localKeys),reexports,fnSlot}};
}

// Open/closed classification, then each callable's operations renumbered over its own locals.
function classify({fns,nodeOwner,slotOwner,slotSpec}) {
  const N=nodeOwner.length,S=slotOwner.length;
  const openN=new Uint8Array(N),openS=new Uint8Array(S);
  const isModule=i=>fns[i].module;
  const markN=h=>{if(h===undefined||h<0||openN[h]||isModule(nodeOwner[h]))return false;openN[h]=1;return true;};
  const ins=op=>{const out=[];for(const k of IN[op.k]??[]){const h=op[k];if(h!==undefined&&h>=0)out.push(h);}if(HAS_ARGS.has(op.k))out.push(...op.args);return out;};
  const slotsOf=op=>(SLOTS[op.k]??[]).map(k=>op[k]);

  // Seeds: what varies per call.
  for(const f of fns) {
    if(f.module)continue;
    for(const p of f.params)markN(p);
    if(f.rest>=0){markN(f.rest);openS[f.restSlot]=1;}
    if(nodeOwner[f.thisH]===f.idx)markN(f.thisH);
    for(const op of f.ops) {
      if(op.k==='SELF')markN(op.n);
      // A variable a nested callable writes holds per-call state of its owner.
      const o=OUT[op.k];if(o&&op[o]!==undefined&&nodeOwner[op[o]]!==f.idx)markN(op[o]);
    }
  }
  // Fresh objects that are returned (or are a constructed instance's fields) get one per call.
  for(const f of fns) {
    if(f.module)continue;
    const rr=new Set([f.ret]);if(f.kind==='class')rr.add(f.thisH);
    for(let changed=true;changed;) {
      changed=false;
      for(const op of f.ops) {
        let add=[];
        if(op.k==='E'&&rr.has(op.b))add=[op.a];
        else if(op.k==='STORE'&&rr.has(op.b)&&op.v>=0)add=[op.v];
        else if(op.k==='FE'&&rr.has('s'+op.s))add=[op.v];
        else if(op.k==='FSLOT'&&rr.has('s'+op.s))add=['s'+op.s2];
        else if(op.k==='ALLOC'&&rr.has(op.n))add=['s'+op.s];
        for(const x of add)if(!rr.has(x)){rr.add(x);changed=true;}
      }
    }
    for(const x of rr)if(typeof x==='string'){const s=+x.slice(1);if(slotSpec[s].fn===undefined&&slotOwner[s]===f.idx)openS[s]=1;}
  }
  // Free variables of each callable and its nested callables.
  const free=fns.map(()=>new Set());
  for(const f of fns)for(const op of f.ops){
    const o=OUT[op.k];const hs=ins(op);if(o&&op[o]!==undefined)hs.push(op[o]);
    for(const h of hs)if(nodeOwner[h]!==f.idx)free[f.idx].add(h);
  }
  for(let i=fns.length-1;i>0;i--){const p=fns[i].owner;if(p<0)continue;for(const h of free[i])if(nodeOwner[h]!==p)free[p].add(h);}
  // Forward propagation to a fixed point.
  for(let changed=true;changed;) {
    changed=false;
    for(const f of fns) {
      if(f.module)continue;
      for(const op of f.ops) {
        let open=ins(op).some(h=>openN[h])||slotsOf(op).some(s=>openS[s]);
        const o=OUT[op.k];
        if(op.k==='PLAT'||op.k==='NS'||op.k==='SELF')continue;
        if(open&&o&&markN(op[o]))changed=true;
      }
    }
    for(let s=0;s<S;s++)if(!openS[s]&&slotSpec[s].fn!==undefined&&!isModule(slotOwner[s])) {
      for(const h of free[slotSpec[s].fn])if(openN[h]){openS[s]=1;changed=true;break;}
    }
  }

  // Renumber per callable: own nodes first, then environment locals.
  const own=new Int32Array(N),ownSlot=new Int32Array(S);
  const counts=fns.map(()=>0),slotCounts=fns.map(()=>0);
  for(let h=0;h<N;h++)own[h]=counts[nodeOwner[h]]++;
  for(let s=0;s<S;s++)ownSlot[s]=slotCounts[slotOwner[s]]++;
  const depth=fns.map(()=>0);for(const f of fns)depth[f.idx]=f.owner<0?0:depth[f.owner]+1;
  return fns.map(f=>{
    const envIdx=new Map();const env=[];
    const L=h=>{
      if(h===undefined||h<0)return -1;
      if(nodeOwner[h]===f.idx)return own[h];
      let e=envIdx.get(h);
      if(e===undefined){e=counts[f.idx]+env.length;envIdx.set(h,e);const o=nodeOwner[h];
        env.push({key:fns[o].key,up:depth[f.idx]-depth[o],local:own[h],module:fns[o].module});}
      return e;
    };
    const x0=h=>L(h);
    const Ls=s=>{if(slotOwner[s]!==f.idx)throw Error(`slot used outside its callable in ${f.key}`);return ownSlot[s];};
    const closedOps=[],openOps=[];
    for(const op of f.ops) {
      let open=!f.module&&(ins(op).some(h=>openN[h])||slotsOf(op).some(s=>openS[s])||(OUT[op.k]&&op[OUT[op.k]]!==undefined&&openN[op[OUT[op.k]]]));
      const x={...op};
      for(const k of IN[op.k]??[])if(op[k]!==undefined)x[k]=L(op[k]);
      if(OUT[op.k])x[OUT[op.k]]=L(op[OUT[op.k]]);
      if(HAS_ARGS.has(op.k))x.args=op.args.map(L);
      for(const k of SLOTS[op.k]??[])x[k]=Ls(op[k]);
      (open?openOps:closedOps).push(x);
    }
    // The return slice: open operations a call's result depends on, writes into objects it
    // returns, and calls handed those objects. A call site runs only this per context.
    const need=new Set([x0(f.ret)]);if(f.kind==='class')need.add(x0(f.thisH));
    const needSlot=new Set();
    const sliceOf=new Set();
    for(let changed=true;changed;) {
      changed=false;
      for(const x of openOps) {
        if(sliceOf.has(x))continue;
        const out=OUT[x.k]?x[OUT[x.k]]:undefined;
        const ins_=[...(IN[x.k]??[]).map(k=>x[k]).filter(h=>h!==undefined&&h>=0),...(HAS_ARGS.has(x.k)?x.args:[])];
        const sl=(SLOTS[x.k]??[]).map(k=>x[k]);
        let take=out!==undefined&&out>=0&&need.has(out)&&x.k!=='STORE';
        if(x.k==='STORE'&&need.has(x.b))take=true;
        if((x.k==='FE'||x.k==='FSTAR'||x.k==='COPYF'||x.k==='FSLOT'||x.k==='FPLAT')&&needSlot.has(x.s))take=true;
        if((x.k==='CALL'||x.k==='NEW'||x.k==='SCALL')&&ins_.some(h=>need.has(h)))take=true;
        if(x.k==='E'&&need.has(x.a))take=true;
        if(!take)continue;
        sliceOf.add(x);changed=true;
        for(const h of ins_)need.add(h);
        if(out!==undefined&&out>=0)need.add(out);
        for(const q of sl)needSlot.add(q);
      }
    }
    const sliceOps=openOps.filter(x=>sliceOf.has(x));
    const nOwn=counts[f.idx],n=nOwn+env.length;
    const open=new Uint8Array(n);
    for(let h=0;h<N;h++)if(nodeOwner[h]===f.idx&&openN[h])open[own[h]]=1;
    for(const [h,e] of envIdx)if(openN[h])open[e]=1;
    const slots=[];for(let s=0;s<S;s++)if(slotOwner[s]===f.idx)slots[ownSlot[s]]={...slotSpec[s],open:!!openS[s]};
    return {key:f.key,name:f.name,kind:f.kind,file:f.file,line:f.line,end:f.end,owner:f.owner,arrow:f.arrow,module:f.module,
      n,nOwn,env,open,params:f.params.map(L),rest:L(f.rest),restSlot:f.restSlot>=0?Ls(f.restSlot):-1,
      thisL:L(f.thisH),ret:L(f.ret),slots,closedOps,openOps,sliceOps};
  });
}
