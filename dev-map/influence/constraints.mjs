// Turns parsed modules into points-to constraints, and records for every callable what the
// derivation needs afterwards: its stores, loads, call sites and returns. Lexical scopes resolve
// each identifier to one binding node; unresolved identifiers are platform globals. Objects are
// allocation sites (literals, functions, classes, instances, module namespaces); platform values
// are opaque objects whose fields are further platform objects. Shapes the analysis does not
// model are recorded as `unmodelled`, never silently approximated away.
import {dirname,join,posix} from 'node:path';

const ELEMENT='[]';
const INSERT=new Set(['push','unshift','splice','set','add','fill']);
const UNMODELLED_GLOBALS=new Set(['eval','Function','Proxy','Reflect']);
const UNMODELLED_MEMBERS=new Set(['defineProperty','defineProperties','setPrototypeOf','__defineGetter__','__defineSetter__']);

// Platform calls that only ever return primitives: no object flows out of them.
const PRIMITIVE_ROOTS=new Set(['Math','Number','isNaN','isFinite','parseInt','parseFloat','String','Boolean','encodeURIComponent','decodeURIComponent']);
const PRIMITIVE_METHODS=new Set(['includes','indexOf','lastIndexOf','findIndex','findLastIndex','startsWith','endsWith','test','has','some','every','join','toString','toFixed','toPrecision','localeCompare','charCodeAt','codePointAt','charAt','isArray','hasOwn','hasOwnProperty','trim','trimStart','trimEnd','toLowerCase','toUpperCase','padStart','padEnd','repeat','replace','replaceAll','stringify','isInteger','isSafeInteger','isFinite','isNaN','now','getTime','valueOf','delete','size','byteLength','readUInt8','readUInt16LE','readUInt32LE','readInt32LE','readFloatLE','readDoubleLE','writeUInt8','writeUInt16LE','writeUInt32LE','writeInt32LE','writeFloatLE','writeDoubleLE','digest','randomUUID','toISOString','normalize','dirname','basename','extname','relative','isAbsolute','existsSync']);

export function buildConstraints(pt,modules,{resolveImport,platformModules=new Map(),cloning=true,depth=1}) {
  const functions=[],unmodelled=[],unresolvedImports=[];
  const platformObjects=new Map(),platformResults=new Map(),instances=new Map(),memo=new Set();
  const PLATFORM_PROTO=platform('platform.prototype',undefined,false);
  const once=key=>memo.has(key)?false:(memo.add(key),true);
  const nsOf=new Map();

  // A platform object carries the real runtime value when its path names one, so field reads
  // follow what actually exists; an unknown platform value has unknown members.
  function platform(path,value,known=value!==undefined) {
    let o=platformObjects.get(path);
    if(o===undefined){o=pt.object({kind:'platform',name:path,value,known});platformObjects.set(path,o);}
    return o;
  }
  function platformRoot(name) {
    if(platformModules.has(name))return platform(name,platformModules.get(name));
    if(name in globalThis)return platform(name,globalThis[name]);
    return platform(name);
  }
  const UNKNOWN=platform('platform.unknown');
  const ARRAY_PROTO=platform('Array.prototype',Array.prototype),OBJECT_PROTO=platform('Object.prototype',Object.prototype),FUNCTION_PROTO=platform('Function.prototype',Function.prototype);
  const isPlatform=o=>pt.objects[o].kind==='platform';
  const isCallable=o=>pt.objects[o].kind==='function';
  function platformChild(o,name) {
    const obj=pt.objects[o];
    if(!obj.known)return UNKNOWN;
    if(name===null||name===ELEMENT)return undefined;
    let v;try{if(obj.value==null||!(name in Object(obj.value)))return undefined;v=obj.value[name];}catch{return UNKNOWN;}
    return platform(obj.name+'.'+name,v,true);
  }
  // One record per source location, however many copies walk it.
  const noted=new Set();
  function note(kind,fn,node){const k=`${kind}|${fn?.file}|${node?.start??fn?.key}`;if(noted.has(k))return;noted.add(k);unmodelled.push({kind,fn:fn?.id,file:fn?.file,line:node?.loc?.start.line});}

  // --- loads, stores and calls as listeners ------------------------------------------------
  function loadFrom(o,name,target,reader) {
    if(!once(`l${o}|${name}|${target}`))return;
    if(isPlatform(o)){const c=platformChild(o,name);if(c!==undefined)pt.add(target,c);return;}
    if(name===null) {
      pt.onField(o,(f,fnode)=>{if(f==='__proto__')return;pt.edge(fnode,target);reader?.reads.add(fnode);});
    } else {
      const fnode=pt.field(o,name);pt.edge(fnode,target);reader?.reads.add(fnode);
      if(name!=='__proto__')pt.on(pt.field(o,'__proto__'),p=>loadFrom(p,name,target,reader));
    }
  }
  function load(base,name,target,reader){pt.on(base,o=>loadFrom(o,name,target,reader));}
  function store(base,name,value,writer,site) {
    writer?.stores.push({base,name,site});
    pt.on(base,o=>{
      if(!once(`s${o}|${name}|${value}`))return;
      if(isPlatform(o)){pt.on(value,v=>{if(isCallable(v))invokedByPlatform(v,writer,site);});return;}
      if(name===null) {
        pt.field(o,'*');
        pt.onField(o,(f,fnode)=>{if(f!=='__proto__')pt.edge(value,fnode);});
      } else pt.edge(value,pt.field(o,name));
    });
  }
  function copyFields(src,dst) {
    pt.on(src,o=>{if(isPlatform(o))return;pt.onField(o,(name,fnode)=>{if(name!=='__proto__')pt.edge(fnode,pt.field(dst,name));});});
  }

  // A platform function called with a SAAM callable invokes it: arguments come from the
  // receiver's elements, results return as elements of the call's result.
  function invokedByPlatform(fobj,caller,site,feed) {
    const f=pt.objects[fobj].fn;
    if(!once(`p${fobj}|${site.id}`))return;
    site.platformCallbacks.push(f.id);
    const event=UNKNOWN;
    for(const p of f.params){pt.add(p,event);if(feed!==undefined)pt.edge(feed,p);}
    if(f.rest!==undefined)pt.add(f.rest,event);
    if(!f.arrow)pt.add(f.thisNode,UNKNOWN);
    if(feed!==undefined)pt.edge(f.ret,feed);
  }
  // Elements of SAAM containers only; platform namespaces are not containers.
  function loadElements(n,target,caller){pt.on(n,o=>{if(!isPlatform(o))loadFrom(o,ELEMENT,target,caller);});}
  function platformCall(site,caller,thisNode,args,result,method,callee) {
    if(!once(`pc${site.id}`))return;
    site.platform=true;
    const root=callee===undefined?'':pt.objects[callee].name.split('.')[0];
    const primitive=PRIMITIVE_ROOTS.has(root)||PRIMITIVE_METHODS.has(method)||root==='JSON'&&method==='stringify';
    let elements;
    if(primitive)elements=pt.node();
    else {
      let pr=platformResults.get(site.id);
      if(pr===undefined){pr=pt.object({kind:'value',name:'platform result',owner:caller.id,site:site.id});platformResults.set(site.id,pr);}
      pt.add(result,pr);pt.add(pt.field(pr,'__proto__'),PLATFORM_PROTO);
      elements=pt.field(pr,ELEMENT);
      if(thisNode!==undefined){loadElements(thisNode,elements,caller);loadElements(thisNode,result,caller);}
    }
    for(const a of args) {
      if(!primitive)loadElements(a,elements,caller);
      pt.on(a,o=>{if(isCallable(o))invokedByPlatform(o,caller,site,elements);});
      if(thisNode!==undefined&&INSERT.has(method)){store(thisNode,ELEMENT,a,caller,site);site.inserts=true;}
    }
    if(method==='assign'&&args.length>1)for(const s of args.slice(1))pt.on(args[0],t=>{if(!isPlatform(t))copyFields(s,t);});
  }
  function dispatch(o,site,caller,thisNode,args,result,method) {
    const obj=pt.objects[o];
    if(obj.kind==='function') {
      const f=obj.fn;
      if(!once(`d${o}|${site.id}`))return;
      site.targets.push(f.id);
      bindArguments(f,args);
      pt.edge(f.ret,result);
      if(thisNode!==undefined&&!f.arrow)pt.edge(thisNode,f.thisNode);
    } else if(obj.kind==='resolver') {
      if(args[0]!==undefined)pt.edge(args[0],pt.field(obj.target,ELEMENT));
    } else if(obj.kind==='platform'||obj.kind==='value') {
      if(['call','apply'].includes(method)&&thisNode!==undefined) {
        pt.on(thisNode,fo=>{if(!isCallable(fo))return;const f=pt.objects[fo].fn;
          if(!once(`ca${fo}|${site.id}`))return;site.targets.push(f.id);
          if(!f.arrow&&args[0]!==undefined)pt.edge(args[0],f.thisNode);
          if(method==='call')bindArguments(f,args.slice(1));
          else if(args[1]!==undefined){const t=pt.node();load(args[1],ELEMENT,t,caller);for(const p of f.params)pt.edge(t,p);}
          pt.edge(f.ret,result);});
        return;
      }
      if(method==='bind'&&thisNode!==undefined){pt.edge(thisNode,result);return;}
      platformCall(site,caller,thisNode,args,result,method,o);
    }
  }
  // A spread argument (args.spreadAt) may supply every parameter from its position on.
  function bindArguments(f,args) {
    const at=args.spreadAt??-1;
    args.forEach((a,i)=>{
      if(at>=0&&i>=at){for(let j=i;j<f.params.length;j++)pt.edge(a,f.params[j]);}
      else if(i<f.params.length)pt.edge(a,f.params[i]);
      if(i>=f.params.length||at>=0&&i>=at)if(f.rest!==undefined)pt.edge(a,pt.field(f.restArray,ELEMENT));
    });
  }
  function call(site,caller,callee,thisNode,args,result,method) {
    caller.calls.push(site);
    const nodes=spreadNodes(args,caller);
    pt.on(callee,o=>dispatch(o,site,caller,thisNode,nodes,result,method));
  }
  function spreadNodes(args,caller) {
    const spread=args.findIndex(a=>typeof a==='object'&&a.spread);
    const nodes=args.map(a=>typeof a==='object'?a.node:a);
    if(spread>=0){const el=pt.node();load(nodes[spread],ELEMENT,el,caller);nodes[spread]=el;nodes.spreadAt=spread;}
    return nodes;
  }
  function construct(site,caller,callee,args,result) {
    caller.calls.push(site);site.construct=true;
    const nodes=spreadNodes(args,caller);
    pt.on(callee,o=>{
      const obj=pt.objects[o];
      const key=site.id+'|'+o;
      let inst=instances.get(key);
      if(inst===undefined){inst=pt.object({kind:isPlatform(o)?'value':'object',name:'new '+obj.name,owner:caller.id,site:site.id});instances.set(key,inst);}
      pt.add(result,inst);
      if(obj.kind==='function') {
        pt.edge(pt.field(o,'prototype'),pt.field(inst,'__proto__'));
        const ctor=obj.fn;
        if(once(`n${o}|${site.id}`)){site.targets.push(ctor.id);bindArguments(ctor,nodes);pt.add(ctor.thisNode,inst);pt.edge(ctor.ret,result);}
      } else if(isPlatform(o)) {
        const proto=obj.known&&obj.value?.prototype?platform(obj.name+'.prototype',obj.value.prototype):PLATFORM_PROTO;
        pt.add(pt.field(inst,'__proto__'),proto);
        if(obj.name==='Promise') {
          const resolver=pt.object({kind:'resolver',target:inst,name:'resolve'});
          for(const a of nodes)pt.on(a,fo=>{if(!isCallable(fo))return;const f=pt.objects[fo].fn;
            if(!once(`pr${fo}|${site.id}`))return;site.targets.push(f.id);for(const p of f.params)pt.add(p,resolver);});
        } else platformCall(site,caller,undefined,nodes,result,'new',o);
      }
    });
  }

  // --- scopes --------------------------------------------------------------------------
  class Scope {
    constructor(parent,fn){this.parent=parent;this.fn=fn;this.names=new Map();}
    declare(name){let n=this.names.get(name);if(n===undefined){n=pt.node();this.names.set(name,n);}return n;}
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

  // --- callables -------------------------------------------------------------------------
  function newCallable(node,mod,owner,name,{arrow=false,kind='function',thisNode}={}) {
    const f={id:functions.length,name,kind,file:mod.file,line:node.loc?.start.line,end:node.loc?.end.line,start:node.start,stop:node.end,owner:owner?.id,
      key:mod.file+':'+node.start,inClone:!!owner?.inClone,
      arrow,params:[],rest:undefined,restArray:undefined,ret:pt.node(),thisNode:thisNode??pt.node(),
      stores:[],reads:new Set(),calls:[],returnsValue:false,allocations:[],exported:false};
    functions.push(f);
    f.object=pt.object({kind:'function',fn:f,name:name??'(anonymous)',owner:owner?.id});
    return f;
  }
  function site(fn,node,text){return {id:`${fn.file}:${node.start}`,fn:fn.id,line:node.loc?.start.line,text,targets:[],platformCallbacks:[],platform:false,resultUsed:true};}

  // --- the walker ----------------------------------------------------------------------
  // Module-level functions by local name, the module's exports and its imports, so a direct
  // call can be resolved to its declaration before solving.
  const prepared=new Map();
  function prepareModule(mod) {
    const moduleFn=newCallable(mod.ast,mod,null,'(module load)',{kind:'module'});
    moduleFn.module=true;
    const scope=new Scope(null,moduleFn);
    hoistVars(mod.ast.body,scope);declareBlock(mod.ast.body,scope);
    const ctx={mod,fn:moduleFn,scope,thisNode:undefined,classInfo:null};
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
          exports.set(ex,s0.source?{from:resolveImport(mod.file,s0.source.value),name:lo}:{local:lo});
        }
      }
      if(s0.type==='ExportDefaultDeclaration'&&s0.declaration.id)exports.set('default',{local:s0.declaration.id.name});
      if(s0.type==='ExportAllDeclaration'&&!s0.exported)reexports.push(resolveImport(mod.file,s0.source.value));
      if(s0.type==='ImportDeclaration')for(const sp of s0.specifiers)if(sp.type==='ImportSpecifier')
        imports.set(sp.local.name,{from:resolveImport(mod.file,s0.source.value),name:sp.imported.name??sp.imported.value});
    }
    // A module binding that is ever reassigned is not a fixed target.
    const visit=n=>{if(!n||typeof n.type!=='string')return;
      if(n.type==='AssignmentExpression'&&n.left.type==='Identifier')reassigned.add(n.left.name);
      if(n.type==='UpdateExpression'&&n.argument.type==='Identifier')reassigned.add(n.argument.name);
      for(const k in n){if(k==='loc')continue;const v=n[k];if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v.type==='string')visit(v);}};
    visit(mod.ast);
    for(const r of reassigned)local.delete(r);
    prepared.set(mod.file,{mod,ctx,local,exports,imports,reexports});
    // Imports bind before the body runs.
    for(const s of mod.ast.body)if(s.type==='ImportDeclaration') {
      const target=moduleNamespace(mod,s.source.value,moduleFn,s);
      for(const sp of s.specifiers) {
        const b=scope.declare(sp.local.name);
        if(sp.type==='ImportNamespaceSpecifier')pt.edge(target,b);
        else load(target,sp.type==='ImportDefaultSpecifier'?'default':(sp.imported.name??sp.imported.value),b,moduleFn);
      }
    }
  }
  function exportedFunction(file,name,seen=new Set()) {
    const p=prepared.get(file);if(!p||seen.has(file+':'+name))return undefined;seen.add(file+':'+name);
    const e=p.exports.get(name);
    if(e?.local!==undefined){const ast=p.local.get(e.local);return ast&&{p,ast,name:e.local};}
    if(e?.from)return exportedFunction(e.from,e.name,seen);
    if(!e&&name!=='default')for(const r of p.reexports){const t=r&&exportedFunction(r,name,seen);if(t)return t;}
    return undefined;
  }
  function staticTarget(name,ctx) {
    const p=prepared.get(ctx.mod.file);if(!p)return undefined;
    const binding=ctx.scope.lookup(name);
    if(binding===undefined||p.ctx.scope.names.get(name)!==binding)return undefined;
    const ast=p.local.get(name);
    if(ast)return {p,ast,name};
    const imp=p.imports.get(name);
    return imp?.from?exportedFunction(imp.from,imp.name):undefined;
  }
  // Copies nest up to `depth` call sites deep; beyond that a site shares one copy.
  const clones=new Map();
  function cloneFor(siteId,target,caller) {
    const d=(caller.cloneDepth??0)+1;
    const key=d<=depth&&caller.cloneKey?caller.cloneKey+'>'+siteId:siteId;
    let f=clones.get(key);if(f)return f;
    functionValue(target.ast,target.p.ctx,target.name,{clone:c=>{f=c;c.cloneKey=key;c.cloneDepth=d<=depth?d:1;clones.set(key,c);}});
    return f;
  }
  function analyzeModule(mod) {
    const {ctx}=prepared.get(mod.file);
    const {scope,fn:moduleFn}=ctx;
    const ns=nsOf.get(mod.file);
    statements(mod.ast.body,ctx);
    // Exports.
    for(const s of mod.ast.body) {
      if(s.type==='ExportNamedDeclaration') {
        if(s.declaration) {
          const d=s.declaration;
          const names=d.type==='VariableDeclaration'?d.declarations.flatMap(x=>patternNames(x.id)):[d.id.name];
          for(const n of names)pt.edge(scope.lookup(n),pt.field(ns,n));
        }
        if(s.source) {
          const target=moduleNamespace(mod,s.source.value,moduleFn,s);
          for(const sp of s.specifiers)load(target,sp.local.name??sp.local.value,pt.field(ns,sp.exported.name??sp.exported.value),moduleFn);
        } else for(const sp of s.specifiers)pt.edge(scope.lookup(sp.local.name)??global(sp.local.name,ctx),pt.field(ns,sp.exported.name??sp.exported.value));
      } else if(s.type==='ExportDefaultDeclaration') {
        const d=s.declaration;
        const v=(d.type==='FunctionDeclaration'||d.type==='ClassDeclaration')&&d.id?scope.lookup(d.id.name):expression(d,ctx);
        if(v!==undefined)pt.edge(v,pt.field(ns,'default'));
      } else if(s.type==='ExportAllDeclaration') {
        const target=moduleNamespace(mod,s.source.value,moduleFn,s);
        if(s.exported)pt.edge(target,pt.field(ns,s.exported.name));
        else pt.on(target,o=>{if(isPlatform(o))return;pt.onField(o,(name,fnode)=>{if(name!=='default'&&name!=='__proto__')pt.edge(fnode,pt.field(ns,name));});});
      }
    }
  }
  function moduleNamespace(mod,spec,fn,node) {
    const n=pt.node();
    const file=resolveImport(mod.file,spec);
    if(file&&nsOf.has(file))pt.add(n,nsOf.get(file));
    else if(file===null){pt.add(n,platformModules.has(spec)?platform(spec,platformModules.get(spec)):platform(spec));}
    else {unresolvedImports.push({file:mod.file,spec,line:node.loc?.start.line});pt.add(n,platform('unresolved:'+spec));}
    return n;
  }
  function global(name,ctx) {
    if(UNMODELLED_GLOBALS.has(name))note('global:'+name,ctx.fn);
    if(name==='undefined'||name==='NaN'||name==='Infinity')return undefined;
    const n=pt.node();pt.add(n,platformRoot(name));return n;
  }
  function identifier(name,ctx) {
    if(name==='arguments'&&!ctx.fn.module){note('arguments',ctx.fn);}
    return ctx.scope.lookup(name)??global(name,ctx);
  }

  function statements(list,ctx){for(const s of list)statement(s,ctx);}
  function block(list,ctx) {
    const scope=new Scope(ctx.scope,ctx.fn);declareBlock(list,scope);
    statements(list,{...ctx,scope});
  }
  function statement(s,ctx) {
    if(!s)return;
    switch(s.type) {
      case 'ImportDeclaration':return;
      case 'ExportNamedDeclaration':if(s.declaration)statement(s.declaration,ctx);return;
      case 'ExportDefaultDeclaration':
        if((s.declaration.type==='FunctionDeclaration'||s.declaration.type==='ClassDeclaration')&&s.declaration.id)statement(s.declaration,ctx);
        return;
      case 'ExportAllDeclaration':return;
      case 'VariableDeclaration':for(const d of s.declarations){if(d.init)bindPattern(d.id,expression(d.init,ctx),ctx,d.init);}return;
      case 'FunctionDeclaration':{const v=functionValue(s,ctx);pt.edge(v,ctx.scope.lookup(s.id.name));return;}
      case 'ClassDeclaration':{const v=classValue(s,ctx);pt.edge(v,ctx.scope.lookup(s.id.name));return;}
      case 'ExpressionStatement':expression(s.expression,ctx,{unused:true});return;
      case 'ReturnStatement':
        if(s.argument){const v=expression(s.argument,ctx);ctx.fn.returnsValue=true;if(v!==undefined)pt.edge(v,ctx.fn.ret);}
        return;
      case 'IfStatement':expression(s.test,ctx);statement(s.consequent,ctx);statement(s.alternate,ctx);return;
      case 'BlockStatement':block(s.body,ctx);return;
      case 'ForStatement':{const scope=new Scope(ctx.scope,ctx.fn);const c={...ctx,scope};
        if(s.init){if(s.init.type==='VariableDeclaration'){declareBlock([s.init],scope);statement(s.init,c);}else expression(s.init,c);}
        if(s.test)expression(s.test,c);if(s.update)expression(s.update,c);statement(s.body,c);return;}
      case 'ForOfStatement':case 'ForInStatement':{const scope=new Scope(ctx.scope,ctx.fn);const c={...ctx,scope};
        const src=expression(s.right,c);let el;
        if(s.type==='ForOfStatement'&&src!==undefined){el=pt.node();load(src,ELEMENT,el,ctx.fn);}
        if(s.left.type==='VariableDeclaration'){declareBlock([s.left],scope);if(el!==undefined)bindPattern(s.left.declarations[0].id,el,c);}
        else if(el!==undefined)assign(s.left,el,c);
        statement(s.body,c);return;}
      case 'WhileStatement':case 'DoWhileStatement':expression(s.test,ctx);statement(s.body,ctx);return;
      case 'TryStatement':
        statement(s.block,ctx);
        if(s.handler){const scope=new Scope(ctx.scope,ctx.fn);
          for(const x of patternNames(s.handler.param))pt.add(scope.declare(x),UNKNOWN);
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

  // Binds a declared pattern to a value node.
  function bindPattern(p,value,ctx) {
    switch(p.type) {
      case 'Identifier':if(value!==undefined)pt.edge(value,ctx.scope.lookup(p.name)??ctx.scope.declare(p.name));return;
      case 'ObjectPattern':
        for(const q of p.properties) {
          if(q.type==='RestElement'){bindPattern(q.argument,value,ctx);continue;}
          const key=propertyKey(q,ctx);
          const t=pt.node();if(value!==undefined)load(value,key,t,ctx.fn);
          bindPattern(q.value,t,ctx);
        }
        return;
      case 'ArrayPattern':{const t=pt.node();if(value!==undefined)load(value,ELEMENT,t,ctx.fn);
        for(const q of p.elements)if(q)bindPattern(q.type==='RestElement'?q.argument:q,q.type==='RestElement'?value:t,ctx);return;}
      case 'RestElement':bindPattern(p.argument,value,ctx);return;
      case 'AssignmentPattern':{const d=expression(p.right,ctx);const t=pt.node();
        if(value!==undefined)pt.edge(value,t);if(d!==undefined)pt.edge(d,t);bindPattern(p.left,t,ctx);return;}
      case 'MemberExpression':assign(p,value,ctx);return;
    }
  }
  function assign(target,value,ctx) {
    if(target.type==='Identifier'){if(value!==undefined)pt.edge(value,identifier(target.name,ctx));return;}
    if(target.type==='MemberExpression') {
      const base=expression(target.object,ctx);const key=memberKey(target,ctx);
      if(base!==undefined&&value!==undefined)store(base,key,value,ctx.fn,site(ctx.fn,target));
      else if(base!==undefined)ctx.fn.stores.push({base,name:key,site:site(ctx.fn,target)});
      return;
    }
    bindPattern(target,value,ctx);
  }
  // A write of a primitive or a deletion: an effect on the object, with no value to propagate.
  function write(target,ctx) {
    if(target.type!=='MemberExpression')return;
    const base=expression(target.object,ctx);
    if(base!==undefined)ctx.fn.stores.push({base,name:memberKey(target,ctx),site:site(ctx.fn,target)});
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

  // --- expressions: return the node holding the value, or undefined for primitives --------
  function expression(e,ctx,{unused=false}={}) {
    if(!e)return undefined;
    switch(e.type) {
      case 'Identifier':return identifier(e.name,ctx);
      case 'Literal':case 'TemplateLiteral':
        if(e.type==='TemplateLiteral')for(const x of e.expressions)expression(x,ctx);
        if(e.regex)return allocate('regexp',ctx,e);
        return undefined;
      case 'ThisExpression':return ctx.thisNode;
      case 'Super':return ctx.classInfo?.superNode;
      case 'ArrayExpression':{const o=allocate('array',ctx,e);const v=pt.node();pt.add(v,o);const el=pt.field(o,ELEMENT);
        pt.add(pt.field(o,'__proto__'),ARRAY_PROTO);
        for(const x of e.elements){if(!x)continue;
          if(x.type==='SpreadElement'){const s=expression(x.argument,ctx);if(s!==undefined)load(s,ELEMENT,el,ctx.fn);}
          else{const s=expression(x,ctx);if(s!==undefined)pt.edge(s,el);}}
        return v;}
      case 'ObjectExpression':{const o=allocate('object',ctx,e);const v=pt.node();pt.add(v,o);
        pt.add(pt.field(o,'__proto__'),OBJECT_PROTO);
        for(const p of e.properties) {
          if(p.type==='SpreadElement'){const s=expression(p.argument,ctx);if(s!==undefined)copyFields(s,o);continue;}
          const key=propertyKey(p,ctx);
          if(p.kind==='get'||p.kind==='set')note('accessor',ctx.fn,p);
          const val=p.value.type==='FunctionExpression'||p.value.type==='ArrowFunctionExpression'?functionValue(p.value,ctx,key,{thisNode:undefined}):expression(p.value,ctx);
          if(val===undefined)continue;
          if(key===null){pt.edge(val,pt.field(o,'*'));pt.onField(o,(_,f)=>pt.edge(val,f));}
          else pt.edge(val,pt.field(o,key));
        }
        return v;}
      case 'FunctionExpression':case 'ArrowFunctionExpression':case 'FunctionDeclaration':return functionValue(e,ctx);
      case 'ClassExpression':case 'ClassDeclaration':return classValue(e,ctx);
      case 'MemberExpression':{
        const base=expression(e.object,ctx);const key=memberKey(e,ctx);
        if(!e.computed&&UNMODELLED_MEMBERS.has(key))note('member:'+key,ctx.fn,e);
        if(base===undefined)return undefined;
        const t=pt.node();load(base,key,t,ctx.fn);return t;}
      case 'ChainExpression':return expression(e.expression,ctx,{unused});
      case 'CallExpression':return callExpression(e,ctx,unused);
      case 'NewExpression':{const callee=expression(e.callee,ctx);const args=argumentNodes(e.arguments,ctx);const r=pt.node();
        if(callee!==undefined)construct({...site(ctx.fn,e,source(e.callee,ctx)),resultUsed:!unused},ctx.fn,callee,args,r);return r;}
      case 'AssignmentExpression':{
        const v=expression(e.right,ctx);
        if(e.operator==='='||e.operator==='??='||e.operator==='||='||e.operator==='&&=')assign(e.left,v,ctx);
        else{expression(e.left,ctx);write(e.left,ctx);}
        return v;}
      case 'SequenceExpression':{let v;for(const x of e.expressions)v=expression(x,ctx);return v;}
      case 'ConditionalExpression':{expression(e.test,ctx);return union([expression(e.consequent,ctx),expression(e.alternate,ctx)]);}
      case 'LogicalExpression':return union([expression(e.left,ctx),expression(e.right,ctx)]);
      case 'BinaryExpression':expression(e.left,ctx);expression(e.right,ctx);return undefined;
      case 'UnaryExpression':expression(e.argument,ctx);if(e.operator==='delete')write(e.argument,ctx);return undefined;
      case 'UpdateExpression':expression(e.argument,ctx);write(e.argument,ctx);return undefined;
      case 'AwaitExpression':{const v=expression(e.argument,ctx);if(v===undefined)return undefined;const t=pt.node();pt.edge(v,t);load(v,ELEMENT,t,ctx.fn);return t;}
      case 'YieldExpression':note('yield',ctx.fn,e);expression(e.argument,ctx);return undefined;
      case 'SpreadElement':return expression(e.argument,ctx);
      case 'TaggedTemplateExpression':{for(const x of e.quasi.expressions)expression(x,ctx);
        const callee=expression(e.tag,ctx);const r=pt.node();if(callee!==undefined)call(site(ctx.fn,e,source(e.tag,ctx)),ctx.fn,callee,undefined,[],r);return r;}
      case 'ImportExpression':{
        if(e.source.type==='Literal'){const r=pt.node();const p=allocate('promise',ctx,e);pt.add(r,p);
          pt.edge(moduleNamespace(ctx.mod,e.source.value,ctx.fn,e),pt.field(p,ELEMENT));return r;}
        note('dynamic-import',ctx.fn,e);expression(e.source,ctx);return undefined;}
      case 'MetaProperty':return undefined;
      case 'ParenthesizedExpression':return expression(e.expression,ctx,{unused});
      default:note('expression:'+e.type,ctx.fn,e);return undefined;
    }
  }
  function source(n,ctx){return ctx.mod.text.slice(n.start,Math.min(n.end,n.start+80));}
  function union(nodes) {
    const present=nodes.filter(n=>n!==undefined);
    if(present.length<2)return present[0];
    const t=pt.node();for(const n of present)pt.edge(n,t);return t;
  }
  function allocate(kind,ctx,e) {
    const o=pt.object({kind:'object',shape:kind,owner:ctx.fn.id,file:ctx.mod.file,line:e.loc?.start.line});ctx.fn.allocations.push(o);return o;
  }
  function argumentNodes(list,ctx) {
    return list.map(a=>{
      if(a.type==='SpreadElement'){const n=expression(a.argument,ctx);return {spread:true,node:n??pt.node()};}
      return expression(a,ctx)??pt.node();
    });
  }
  function callExpression(e,ctx,unused) {
    const c=e.callee;
    if(c.type==='Super') {
      const args=argumentNodes(e.arguments,ctx);const r=pt.node();
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
      callee=pt.node();if(base!==undefined)load(base,method,callee,ctx.fn);
    } else {
      const target=c.type==='Identifier'&&cloning?staticTarget(c.name,ctx):undefined;
      if(target) {
        // A direct call gets its own copy of the callee (one level of call-site context), so
        // values return only to the call that supplied them.
        const args=argumentNodes(e.arguments,ctx);const r=pt.node();
        const s={...site(ctx.fn,e,source(c,ctx)),resultUsed:!unused};
        ctx.fn.calls.push(s);
        const f=cloneFor(s.id,target,ctx.fn);
        s.targets.push(f.id);
        bindArguments(f,spreadNodes(args,ctx.fn));pt.edge(f.ret,r);
        return r;
      }
      callee=expression(c,ctx);
      if(c.type!=='Identifier'&&!/Function/.test(c.type))note('callee-expression:'+c.type,ctx.fn,c);
    }
    const args=argumentNodes(e.arguments,ctx);
    const r=pt.node();
    if(callee!==undefined)call({...site(ctx.fn,e,source(c,ctx)),resultUsed:!unused},ctx.fn,callee,thisNode,args,r,method);
    return r;
  }

  function functionValue(node,ctx,name,{thisNode,clone}={}) {
    const arrow=node.type==='ArrowFunctionExpression';
    const f=newCallable(node,ctx.mod,ctx.fn,name??node.id?.name,{arrow,thisNode:arrow?ctx.thisNode:thisNode});
    if(clone){f.inClone=true;clone(f);}
    if(arrow&&f.thisNode===undefined)f.thisNode=pt.node();
    const v=pt.node();pt.add(v,f.object);
    pt.add(pt.field(f.object,'__proto__'),FUNCTION_PROTO);
    const scope=new Scope(ctx.scope,f);
    if(node.type==='FunctionExpression'&&node.id)pt.add(scope.declare(node.id.name),f.object);
    const fctx={mod:ctx.mod,fn:f,scope,thisNode:f.thisNode,classInfo:arrow?ctx.classInfo:ctx.classInfo};
    for(const p of node.params) {
      const pn=pt.node();
      if(p.type==='RestElement'){f.rest=pn;f.restArray=pt.object({kind:'object',shape:'array',owner:f.id});pt.add(pn,f.restArray);
        for(const x of patternNames(p.argument))scope.declare(x);bindPattern(p.argument,pn,fctx);continue;}
      f.params.push(pn);
      for(const x of patternNames(p))scope.declare(x);
      bindPattern(p,pn,fctx);
    }
    if(node.body.type==='BlockStatement') {
      hoistVars(node.body.body,scope);declareBlock(node.body.body,scope);
      statements(node.body.body,fctx);
    } else {
      const v2=expression(node.body,fctx);f.returnsValue=true;f.expressionBody=true;
      if(v2!==undefined)pt.edge(v2,f.ret);
    }
    if(node.generator)note('generator',f,node);
    return v;
  }
  function classValue(node,ctx) {
    const name=node.id?.name??'(class)';
    const ctorNode=node.body.body.find(m=>m.kind==='constructor');
    const owner=ctx.fn;
    const superNode=node.superClass?expression(node.superClass,ctx):undefined;
    const ctor=newCallable(ctorNode?.value??node,ctx.mod,owner,name,{kind:'class'});
    const v=pt.node();pt.add(v,ctor.object);
    const proto=pt.object({kind:'object',shape:'prototype',owner:owner.id,name:name+'.prototype'});
    pt.add(pt.field(ctor.object,'prototype'),proto);
    let superProtoNode;
    if(superNode!==undefined) {
      superProtoNode=pt.node();load(superNode,'prototype',superProtoNode,owner);
      pt.edge(superProtoNode,pt.field(proto,'__proto__'));
      pt.edge(superNode,pt.field(ctor.object,'__proto__'));
    } else pt.add(pt.field(proto,'__proto__'),OBJECT_PROTO);
    const classInfo={superNode,superProtoNode};
    const scope=new Scope(ctx.scope,ctor);
    if(node.id)pt.add(scope.declare(node.id.name),ctor.object);
    const cctx={mod:ctx.mod,fn:ctor,scope,thisNode:ctor.thisNode,classInfo};
    if(ctorNode) {
      const fnode=ctorNode.value;
      for(const p of fnode.params){const pn=pt.node();ctor.params.push(pn);for(const x of patternNames(p))scope.declare(x);bindPattern(p,pn,cctx);}
      hoistVars(fnode.body.body,scope);declareBlock(fnode.body.body,scope);
      statements(fnode.body.body,cctx);
    } else if(superNode!==undefined) {
      // An implicit constructor forwards its arguments to the parent.
      const rest=pt.node();ctor.rest=rest;ctor.restArray=pt.object({kind:'object',shape:'array',owner:ctor.id});pt.add(rest,ctor.restArray);
      call({...site(ctor,node,'super(...)'),resultUsed:false},ctor,superNode,ctor.thisNode,[{spread:true,node:rest}],pt.node(),undefined);
    }
    for(const m of node.body.body) {
      if(m.kind==='constructor')continue;
      if(m.type==='StaticBlock'){statements(m.body,{...cctx,thisNode:v});continue;}
      const key=propertyKey(m,cctx);
      const holder=m.static?ctor.object:proto;
      if(m.type==='MethodDefinition') {
        if(m.kind==='get'||m.kind==='set')note('accessor',ctor,m);
        const mv=functionValue(m.value,{...ctx,classInfo},`${name}.${key}`,{thisNode:undefined});
        // Methods see the instance (or the class, if static) as this.
        if(key!==null)pt.edge(mv,pt.field(holder,key));
      } else if(m.type==='PropertyDefinition') {
        if(!m.value)continue;
        const target=m.static?v:ctor.thisNode;
        const fctx=m.static?{...cctx,thisNode:v}:cctx;
        const val=m.value.type==='ArrowFunctionExpression'||m.value.type==='FunctionExpression'?functionValue(m.value,fctx,`${name}.${key}`):expression(m.value,fctx);
        if(val!==undefined&&key!==null)store(target,key,val,ctor,site(ctor,m));
      }
    }
    return v;
  }

  // Namespaces first, so imports in any order resolve.
  for(const mod of modules){nsOf.set(mod.file,pt.object({kind:'object',shape:'module',name:mod.file,owner:null}));}
  for(const mod of modules)prepareModule(mod);
  for(const mod of modules)analyzeModule(mod);
  return {functions,unmodelled,unresolvedImports,namespaces:nsOf,platformObjects};
}

export function resolver(files,{aliases={}}={}) {
  const known=new Set(files);
  return (from,spec)=>{
    const alias=aliases[`${from}:${spec}`];if(alias)return alias;
    if(spec.startsWith('node:'))return null;
    if(!spec.startsWith('.')&&!spec.startsWith('/'))return null;
    const file=spec.startsWith('/')?spec.slice(1):posix.normalize(posix.join(posix.dirname(from),spec));
    return known.has(file)?file:undefined;
  };
}
