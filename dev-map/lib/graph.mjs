import {readFile} from 'node:fs/promises';
import {posix, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {isMapped} from './scope.mjs';

const functions = new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
// The child nodes of an AST node. Every walk in this file asks the same node the same question,
// so the answer is held per node rather than rebuilt from `Object.entries` each time.
const childCache = new WeakMap();
const children = node => {
  const found = childCache.get(node);
  if (found) return found;
  const out = [];
  for (const key of Object.keys(node)) {
    if (key==='loc'||key==='start'||key==='end') continue;
    const value = node[key];
    if (Array.isArray(value)) {for(const v of value)if(v?.type)out.push(v);}
    else if (value?.type) out.push(value);
  }
  childCache.set(node,out);
  return out;
};
const property = node => !node.computed ? node.property?.name : node.property?.type==='Literal' ? String(node.property.value) : null;
// The thing a handler is stored on, as the source names it: an id selector by its id, a binding
// by its name, a static member path by that path. A receiver no static reading names gives null,
// and the handler keeps the property alone, as before.
const handlerReceiver = node => {
  if(node.type==='Identifier')return node.name;
  if(node.type==='ThisExpression')return 'this';
  if(node.type==='MemberExpression'&&property(node)) {
    const outer=handlerReceiver(node.object);return outer?`${outer}.${property(node)}`:null;
  }
  if(node.type==='CallExpression'&&node.arguments.length===1&&node.arguments[0].type==='Literal'
    &&typeof node.arguments[0].value==='string')return node.arguments[0].value.replace(/^#/,'')||null;
  return null;
};
// A callable stored on a platform event property is reached by whatever fires it, never by a name
// this code calls, so nothing but the site can name it. Inside a holder the holder does. At module
// level there is no holder, and the property alone repeats for every element of the same page, so
// the receiver and the event name it: an identity unique in the file that survives line edits,
// where a source position does not.
const handlerPath = (receiver,event) => receiver?`@handler/${encodeURIComponent(receiver)}.${event}`:event;
// Static and instance methods occupy different receiver namespaces in JavaScript. Keep the
// ordinary source spelling for instance methods and reserve a generated segment for every static
// method, so adding or removing a same-named counterpart never retargets either declaration.
const methodPath = node => {
  const name=String(node.key.name??node.key.value);
  if(node.static)return `@static/${encodeURIComponent(name)}`;
  return name.startsWith('@')?`@name/${encodeURIComponent(name)}`:name;
};
const passed = n => n.type==='Identifier'?n.name:n.type==='AssignmentPattern'?passed(n.left):n.type==='RestElement'&&n.argument.type==='Identifier'?`...${n.argument.name}`:
  n.type==='ObjectPattern'&&n.properties.every(p=>p.type==='Property'&&!p.computed)?`{${n.properties.map(p=>p.key.name??p.key.value).join(',')}}`:null;

// The projection's mapped set; uniqueness of a method name is asked of that code only.
const mappedCode=isMapped;

export async function extractGraph({repo,files,importAliases={},readSource=file=>readFile(resolve(repo,file),'utf8')}) {
  const modules=new Map(), declarations=[], calls=[], assignments=[], relations=[], unresolved=[], declFn=new Map(),declarationPaths=new Map();
  const nodeScope=new WeakMap(), nodeOwner=new WeakMap(), nodeDecl=new WeakMap(), parents=new WeakMap(),declScope=new Map();
  const parameterDefaultNames=new WeakMap(),listenerNames=new WeakMap();
  const scopes=[], bindings=[];
  const scope=(parent,kind,origin=null)=>{
    const role=origin?.type??kind,ordinal=(parent?.scopeCounts.get(role)??0)+1;
    parent?.scopeCounts.set(role,ordinal);
    const s={parent,kind,role,ordinal,scopeCounts:new Map(),bindings:new Map()};scopes.push(s);return s;
  };
  const lookup=(s,name)=>s?.bindings.get(name)??(s?.parent?lookup(s.parent,name):null);
  function bind(s,name,info={}) {
    if(s.bindings.has(name)) {const b=s.bindings.get(name);b.written=true;return b;}
    const b={name,scope:s,...info};s.bindings.set(name,b);bindings.push(b);return b;
  }
  // `from` records the initializer and exact static path selected by a binding.
  function pattern(node,s,info={},from=null) {
    if(!node)return;
    if(node.type==='Identifier')bind(s,node.name,from?{...info,destructured:from}:info);
    else if(node.type==='RestElement')pattern(node.argument,s,info,from);
    else if(node.type==='AssignmentPattern')pattern(node.left,s,info,from?{...from,defaulted:true}:null);
    else if(node.type==='ObjectPattern')for(const p of node.properties)pattern(p.value??p.argument,s,info,
      from&&p.type==='Property'&&!p.computed?{...from,keys:[...from.keys,String(p.key.name??p.key.value)]}:null);
    else if(node.type==='ArrayPattern')for(const p of node.elements)pattern(p,s,info,from);
  }
  function location(m,n) {return {file:m.file,start:n.start,end:n.end,line:n.loc.start.line,column:n.loc.start.column+1,endLine:n.loc.end.line,text:m.text.slice(n.start,n.end)};}
  const declNode=new Map();
  function declaration(m,n,path,kind,owner,anchor=true,lexicalScope=null) {
    const d={id:`${m.file}:${n.start}:${kind}`,anchor:anchor?`${m.file}::${path.join('::')}`:null,name:path.at(-1),kind,parent:owner?.id??null,...location(m,n)};
    declarations.push(d);declarationPaths.set(d.id,path);nodeDecl.set(n,d);declNode.set(d.id,n);
    if(lexicalScope)declScope.set(d.id,lexicalScope);
    return d;
  }
  const patternNames=n=>n.type==='Identifier'?[n.name]:n.type==='ObjectPattern'?n.properties.flatMap(p=>patternNames(p.value??p.argument))
    :n.type==='ArrayPattern'?n.elements.filter(Boolean).flatMap(patternNames):n.type==='RestElement'?patternNames(n.argument)
    :n.type==='AssignmentPattern'?patternNames(n.left):[];
  function markParameterDefaults(node) {
    if(!node)return;
    if(node.type==='AssignmentPattern') {
      if(node.left.type==='Identifier'&&functions.has(node.right.type))parameterDefaultNames.set(node.right,node.left.name);
      markParameterDefaults(node.left);return;
    }
    if(node.type==='ObjectPattern')for(const p of node.properties)markParameterDefaults(p.value??p.argument);
    else if(node.type==='ArrayPattern')for(const p of node.elements)markParameterDefaults(p);
    else if(node.type==='RestElement')markParameterDefaults(node.argument);
  }
  function returnedCallable(node,parent) {
    let child=node;
    for(let outer=parent;outer;child=outer,outer=parents.get(outer)) {
      if(outer.type==='ReturnStatement')return outer.argument===child;
      if(functions.has(outer.type))return outer.body===child&&outer.body.type!=='BlockStatement';
      if(outer.type==='SequenceExpression'&&outer.expressions.at(-1)!==child)return false;
      if(!['ConditionalExpression','LogicalExpression','SequenceExpression','AwaitExpression','ChainExpression'].includes(outer.type))return false;
    }
    return false;
  }
  function visit(m,n,s,path=[],owner=null,parent=null) {
    if(!n)return;
    if(parent)parents.set(n,parent);
    nodeScope.set(n,s);nodeOwner.set(n,owner);
    if(n.type==='VariableDeclaration') {
      let target=s;if(n.kind==='var')while(target.parent&&target.kind!=='function')target=target.parent;
      for(const v of n.declarations) {
        if(v.id.type==='Identifier') {
          const next=[...path,v.id.name],d=declaration(m,v,next,'variable',owner,true,target);
          const b=bind(target,v.id.name,{node:v,init:v.init,decl:d,module:m,constant:n.kind==='const'});
          nodeScope.set(v,s);nodeOwner.set(v,owner);parents.set(v,n);
          if(v.init) {if(functions.has(v.init.type))b.fn=v.init;visit(m,v.init,s,next,owner,v);}
        } else {
          pattern(v.id,target,{},v.init?{init:v.init,module:m,keys:[],stable:n.kind==='const'}:null);
          // A pattern is code too: defaults and computed keys hold calls and callable values
          // that run when the declarator does. Function parameters are walked the same way.
          visit(m,v.id,s,path,owner,v);
          if(v.init)visit(m,v.init,s,path,owner,v);
        }
      }
      return;
    }
    if(functions.has(n.type)) {
      const named=n.type==='FunctionDeclaration'&&!!n.id;
      const defaultName=parameterDefaultNames.get(n),listenerName=listenerNames.get(n);
      const inherited=!!parent&&nodeDecl.has(parent)&&(
        parent.type==='VariableDeclarator'&&parent.init===n||
        ['Property','MethodDefinition'].includes(parent.type)&&parent.value===n||
        parent.type==='AssignmentExpression'&&parent.right===n);
      const next=named?[...path,n.id.name]:inherited?path:listenerName?[...path,listenerName]
        :defaultName?[...path,`@default/${encodeURIComponent(defaultName)}`]:[...path,`<callback@${n.loc.start.line}:${n.loc.start.column+1}>`];
      const d=inherited?nodeDecl.get(parent):declaration(m,n,next,listenerName?'handler':'function',owner,named||!!defaultName||!!listenerName,s);
      if(!named&&!inherited&&returnedCallable(n,parent))d.generatedRole='returned-callable';
      if(defaultName)d.generatedRole='parameter-default';
      d.callable=true;nodeDecl.set(n,d);nodeOwner.set(n,d);declFn.set(d.id,n);m.functions.push(n);
      if(named)bind(s,n.id.name,{fn:n,decl:d,module:m});
      const inner=scope(s,'parameters');nodeScope.set(n,inner);
      if(n.type!=='ArrowFunctionExpression') {
        inner.thisBoundary=true;
        if(parent?.type==='MethodDefinition') {let outer=s;while(outer&&!outer.classNode)outer=outer.parent;inner.thisClass=outer?.classNode;inner.thisStatic=!!parent.static;}
      }
      if(n.id&&!named)bind(inner,n.id.name,{fn:n,decl:d,module:m});
      for(const p of n.params) {pattern(p,inner,{parameter:true});markParameterDefaults(p);}
      for(const p of n.params)visit(m,p,inner,next,d,n);
      visit(m,n.body,scope(inner,'function'),next,d,n);return;
    }
    if(n.type==='ClassDeclaration'||n.type==='ClassExpression') {
      const next=n.id?[...path,n.id.name]:path;
      const d=declaration(m,n,next,'class',owner,!!n.id,s);
      if(n.id)bind(s,n.id.name,{decl:d,module:m,classNode:n});
      const inner=scope(s,'class');inner.classNode=n;
      for(const child of children(n))if(child!==n.id)visit(m,child,inner,next,d,n);return;
    }
    if((n.type==='Property'||n.type==='MethodDefinition')&&!n.computed&&functions.has(n.value?.type)) {
      // A static nested record names its complete member path. Dropping its
      // holders makes distinct entries such as text.validate and mesh.validate
      // collide. Computed/spread holders still retain the conservative name.
      const names=[String(n.key.name??n.key.value)];
      let complete=true;
      if(n.type==='Property')for(let object=parent;object?.type==='ObjectExpression';){
        if(object.properties.some(p=>p.type==='SpreadElement'||p.computed)){complete=false;break;}
        const holder=parents.get(object);
        if(holder?.type!=='Property'||holder.value!==object)break;
        if(holder.computed){complete=false;break;}
        names.unshift(String(holder.key.name??holder.key.value));object=parents.get(holder);
      }
      const next=[...path,n.type==='MethodDefinition'?methodPath(n):complete?names.join('.'):String(n.key.name??n.key.value)];
      declaration(m,n,next,'method',owner,true,s);visit(m,n.value,s,next,owner,n);return;
    }
    if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&property(n.left)&&functions.has(n.right.type)) {
      // The handler's body is written inside the handler, so what that body declares is homed by
      // the handler, not by the module or the function the assignment happens to sit in.
      path=[...path,owner?property(n.left):handlerPath(handlerReceiver(n.left.object),property(n.left))];
      declaration(m,n,path,'handler',owner,true,s);
    }
    // `addEventListener('x', …)` stores a callable the same way, and at module level it is named
    // the same way, so the listener is a handler declaration rather than a source position.
    if(n.type==='CallExpression'&&!owner&&n.callee.type==='MemberExpression'&&property(n.callee)==='addEventListener') {
      const [event,handler]=n.arguments,receiver=handlerReceiver(n.callee.object);
      if(receiver&&event?.type==='Literal'&&typeof event.value==='string'&&functions.has(handler?.type))
        listenerNames.set(handler,handlerPath(receiver,event.value));
    }
    if((n.type==='BlockStatement'&&!functions.has(parent?.type))||n.type==='CatchClause'||['ForStatement','ForOfStatement','ForInStatement','SwitchStatement'].includes(n.type)) {
      s=scope(s,'block',n);nodeScope.set(n,s);if(n.type==='CatchClause')pattern(n.param,s);
    }
    if(n.type==='ImportDeclaration')for(const spec of n.specifiers)bind(s,spec.local.name,{imported:spec.type==='ImportNamespaceSpecifier'?'*':spec.imported?.name??spec.imported?.value??'default',source:n.source.value,module:m,node:spec});
    if(n.type==='CallExpression'||n.type==='NewExpression')calls.push({node:n,module:m,owner,scope:s});
    if(n.type==='AssignmentExpression'||n.type==='UpdateExpression')assignments.push({node:n,module:m,scope:s,owner});
    for(const child of children(n))visit(m,child,s,path,owner,n);
  }
  for(const file of files) {
    const text=await readSource(file);
    const ast=parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});
    const m={file,text,ast,scope:scope(null,'module'),functions:[],exports:new Map(),hash:createHash('sha256').update(text).digest('hex')};
    modules.set(file,m);visit(m,ast,m.scope);
  }
  function importPath(m,source) {
    if(importAliases[`${m.file}:${source}`])return importAliases[`${m.file}:${source}`];
    return source.startsWith('.')?posix.normalize(posix.join(posix.dirname(m.file),source)):null;
  }
  for(const m of modules.values())for(const n of m.ast.body) {
    if(n.type==='ExportNamedDeclaration') {
      if(n.declaration?.id)m.exports.set(n.declaration.id.name,{binding:lookup(m.scope,n.declaration.id.name)});
      for(const v of n.declaration?.declarations??[])for(const name of patternNames(v.id))m.exports.set(name,{binding:lookup(m.scope,name)});
      for(const p of n.specifiers)m.exports.set(p.exported.name??p.exported.value,n.source?{source:n.source.value,name:p.local.name}: {binding:lookup(m.scope,p.local.name)});
    }
    if(n.type==='ExportDefaultDeclaration')m.exports.set('default',n.declaration.id&&['FunctionDeclaration','ClassDeclaration'].includes(n.declaration.type)
      ?{binding:lookup(m.scope,n.declaration.id.name)}:{expression:n.declaration});
    if(n.type==='ExportAllDeclaration') {
      if(n.exported)m.exports.set(n.exported.name??n.exported.value,{namespaceSource:n.source.value});
      else (m.starExports??=[]).push(n.source.value);
    }
  }
  for(const a of assignments) {
    const lhs=a.node.left??a.node.argument;
    function recordWrite(n,value=null) {
      if(n.type==='Identifier') {const b=lookup(a.scope,n.name);if(b)(b.writeValues??=[]).push(value);}
      else if(n.type==='ObjectPattern')for(const p of n.properties)recordWrite(p.value??p.argument);
      else if(n.type==='ArrayPattern')for(const p of n.elements)if(p)recordWrite(p);
      else if(n.type==='RestElement'||n.type==='AssignmentPattern')recordWrite(n.argument??n.left);
    }
    function mark(n) {
      if(n.type==='Identifier') {const b=lookup(a.scope,n.name);if(b)b.written=true;}
      else if(n.type==='ObjectPattern')for(const p of n.properties)mark(p.value??p.argument);
      else if(n.type==='ArrayPattern')for(const p of n.elements)if(p)mark(p);
      else if(n.type==='RestElement'||n.type==='AssignmentPattern')mark(n.argument??n.left);
    }
    recordWrite(lhs,a.node.type==='AssignmentExpression'&&a.node.operator==='='&&lhs.type==='Identifier'?a.node.right:null);
    mark(lhs);
    if(lhs.type==='MemberExpression') {
      let base=lhs.object;while(base.type==='MemberExpression')base=base.object;
      if(base.type==='Identifier') {
        function markObject(b,seen=new Set()) {
          if(!b||seen.has(b))return;seen.add(b);b.objectWritten=true;
          (b.memberWrites??=new Set()).add(lhs.object===base?property(lhs):'*nested*');
          if(b.init?.type==='Identifier')markObject(lookup(nodeScope.get(b.init),b.init.name),seen);
        }
        markObject(lookup(a.scope,base.name));
      }
    }
  }
  // A call may mutate an array passed by reference. Receiver classification below uses this only
  // as a conservative escape marker; it does not infer whether the callee actually mutates it.
  for(const c of calls)for(const arg of c.node.arguments) {
    const value=arg.type==='SpreadElement'?arg.argument:arg;
    if(value.type==='Identifier') {const b=lookup(c.scope,value.name);if(b)b.callEscaped=true;}
  }
  function exportTarget(m,name,seen) {
    // An unscanned star source may also provide this name. It cannot silently
    // lose a conflict with a scanned source, even when that source has a target.
    if(!m)return {unknown:true};
    const key=`${m.file}::${name}`;if(seen.has(key))return null;seen=new Set(seen).add(key);
    const e=m.exports.get(name);
    if(e) {
      if(e.source)return exportTarget(modules.get(importPath(m,e.source)),e.name,seen);
      if(e.namespaceSource) {
        const namespace=modules.get(importPath(m,e.namespaceSource));
        return namespace?{namespace}:{unknown:true};
      }
      if(e.binding?.imported) {
        const imported=modules.get(importPath(e.binding.module,e.binding.source));
        return e.binding.imported==='*'?(imported?{namespace:imported}:{unknown:true}):exportTarget(imported,e.binding.imported,seen);
      }
      return e.binding||e.expression?{module:m,...e}:{unknown:true};
    }
    if(name==='default')return null;
    let found=null;
    for(const source of m.starExports??[]) {
      const target=exportTarget(modules.get(importPath(m,source)),name,seen);
      if(!target)continue;
      if(target.unknown)return target;
      // ESM star ambiguity concerns the originating binding, not equality of
      // function values. Two diamond paths to the same binding are unambiguous.
      if(found&&!(found.binding&&found.binding===target.binding
        ||found.expression&&found.expression===target.expression
        ||found.namespace&&found.namespace===target.namespace))return {unknown:true};
      found=target;
    }
    return found;
  }
  function exported(m,name,seen) {
    const target=exportTarget(m,name,seen);
    if(!target||target.unknown)return null;
    if(target.namespace)return {namespace:target.namespace};
    seen=new Set(seen).add(`${m.file}::${name}`);
    return target.binding?bindingValue(target.binding,seen):value(target.expression,target.module.scope,target.module,seen);
  }
  function bindingValue(b,seen=new Set()) {
    if(!b||b.written||seen.has(b))return null;seen=new Set(seen).add(b);
    if(b.imported) {
      const m=modules.get(importPath(b.module,b.source));
      const v=b.imported==='*'?{namespace:m}:exported(m,b.imported,seen);
      return union(choices(v).map(v=>({...v,resolution:[location(b.module,parents.get(b.node)??b.node),...v.resolution??[]]})));
    }
    if(b.fn)return {fn:b.fn,decl:nodeDecl.get(b.fn),module:b.module,resolution:[]};
    if(b.classNode)return {classNode:b.classNode,decl:b.decl,module:b.module,static:true,memberWrites:b.memberWrites};
    if(b.destructured?.stable&&!b.destructured.defaulted&&b.destructured.keys.length)return destructuredValue(b.destructured,seen);
    if(b.constant&&b.init) {
      const v=value(b.init,nodeScope.get(b.init),b.module,seen);
      return union(choices(v).filter(v=>!b.objectWritten||v.classNode).map(v=>({...v,memberWrites:b.memberWrites,resolution:[location(b.module,b.node),...v.resolution??[]]})));
    }
    return null;
  }
  function destructuredValue(from,seen) {
    const initial=choices(value(from.init,nodeScope.get(from.init),from.module,seen));
    if(initial.length===1&&(initial[0].namespace||initial[0].externalNamespace)) {
      if(from.keys.length!==1)return null;
      return union(namespaceMember(initial[0],from.keys[0],seen).map(v=>({...v,
        resolution:[...v.resolution??[],{...location(from.module,from.init),exportName:from.keys[0]}]})));
    }
    // Direct returned records are fresh at selection. Following arbitrary holder
    // aliases here would also need escape/lifetime proof, which this rule does not have.
    let init=from.init;
    if(init.type==='AwaitExpression')init=init.argument;
    if(init.type==='CallExpression') {
      const factories=choices(value(init.callee,nodeScope.get(init.callee),from.module,seen));
      if(factories.length!==1||!factories[0].fn||factories[0].fn.generator)return null;
      const fn=factories[0].fn,returned=returnedBy(fn);
      if(returned.length!==1||returned[0].type!=='ObjectExpression')return null;
      if(fn.body.type==='BlockStatement'&&fn.body.body.at(-1)?.argument!==returned[0])return null;
    } else if(init.type!=='ObjectExpression')return null;
    let held=initial;
    for(const key of from.keys) {
      if(held.length!==1||!held[0].object)return null;
      const holder=held[0],properties=holder.object.properties;
      if(properties.some(p=>p.type!=='Property'||p.computed||p.kind!=='init'||String(p.key.name??p.key.value)==='__proto__'))return null;
      const selected=properties.filter(p=>String(p.key.name??p.key.value)===key);
      if(selected.length!==1)return null;
      const p=selected[0];
      if(!stableRecordField(p.value))return null;
      const values=choices(value(p.value,nodeScope.get(p.value),holder.module,seen));
      if(values.length!==1||values[0].unknown)return null;
      held=values.map(v=>({...v,resolution:[...holder.resolution??[],location(holder.module,p),...v.resolution??[]]}));
    }
    return held.length===1?held[0]:null;
  }
  function stableRecordField(n,seen=new Set()) {
    if(functions.has(n.type)||n.type==='ObjectExpression')return true;
    if(n.type!=='Identifier')return false;
    const b=lookup(nodeScope.get(n),n.name);
    if(!b||b.written||seen.has(b))return false;seen=new Set(seen).add(b);
    if(b.imported)return true;
    if(b.fn)return b.node?.type!=='VariableDeclarator'||b.constant;
    if(b.destructured?.stable&&!b.destructured.defaulted)return true;
    return !!(b.constant&&b.init&&b.init.type!=='ObjectExpression'&&stableRecordField(b.init,seen));
  }
  // The expressions a function returns. A function's own body does not change while the graph is
  // built, so the walk that finds them runs once per function instead of once per call site.
  const returnCache=new WeakMap();
  function returnedBy(fn) {
    const found=returnCache.get(fn);if(found)return found;
    const returned=[];
    if(fn.body.type==='BlockStatement')(function returns(node) {
      if(node!==fn&&functions.has(node.type))return;
      if(node.type==='ReturnStatement') {if(node.argument)returned.push(node.argument);return;}
      for(const child of children(node))returns(child);
    })(fn);else returned.push(fn.body);
    returnCache.set(fn,returned);return returned;
  }
  // A resolution that starts with nothing visited is a pure function of the node, the scope it is
  // read in and the module it belongs to, so it is held: several passes ask for the same callee.
  const valueCache=new WeakMap();
  function value(n,s,m,seen=new Set()) {
    if(!n)return null;
    if(seen.size===0&&s&&m) {
      let byScope=valueCache.get(n);if(!byScope)valueCache.set(n,byScope=new WeakMap());
      let byModule=byScope.get(s);if(!byModule)byScope.set(s,byModule=new WeakMap());
      const held=byModule.get(m);if(held!==undefined)return held.v;
      const computed=resolveValue(n,s,m,seen);byModule.set(m,{v:computed});return computed;
    }
    return resolveValue(n,s,m,seen);
  }
  function resolveValue(n,s,m,seen) {
    if(seen.has(n))return null;seen=new Set(seen).add(n);
    if(n.type==='ChainExpression')return value(n.expression,s,m,seen);
    if(n.type==='AwaitExpression')return union(choices(value(n.argument,s,m,seen)).flatMap(awaitedValues));
    if(n.type==='ImportExpression') {
      if(n.source.type!=='Literal'||typeof n.source.value!=='string')return null;
      const path=importPath(m,n.source.value),namespace=modules.get(path),resolution=[location(m,n)];
      // Dynamic import resolves a Promise. A then export can participate in
      // Promise assimilation; this scanner does not execute that protocol.
      const payload=namespace?(exportTarget(namespace,'then',new Set())?{unknown:true}:{namespace,resolution})
        :path&&mappedCode(path)?{unknown:true}:{externalNamespace:path??n.source.value,resolution};
      return {promise:payload};
    }
    if(functions.has(n.type))return {fn:n,decl:nodeDecl.get(n),module:m};
    if(n.type==='Identifier')return bindingValue(lookup(s,n.name),seen);
    if(n.type==='ThisExpression') {let outer=s;while(outer&&!outer.thisBoundary)outer=outer.parent;return outer?.thisClass?{classNode:outer.thisClass,module:m,static:outer.thisStatic}:null;}
    // `super` is the class the enclosing method's class extends: `super(...)` calls its
    // constructor and `super.name()` its method. Arrow functions inherit the binding; an
    // ordinary function body starts a new one, so the search stops at the first `this` boundary.
    if(n.type==='Super') {
      let outer=s;while(outer&&!outer.thisBoundary)outer=outer.parent;
      const extended=outer?.thisClass?.superClass;
      if(!extended)return null;
      return union(choices(value(extended,nodeScope.get(extended)??s,m,seen)).filter(v=>v.classNode)
        .map(v=>({...v,static:!!outer.thisStatic,resolution:[...v.resolution??[],location(m,n)]})));
    }
    if(n.type==='NewExpression')return union(choices(value(n.callee,s,m,seen)).filter(v=>v.classNode).map(v=>({...v,static:false,resolution:[location(m,n)]})));
    if(n.type==='ObjectExpression')return {object:n,scope:s,module:m};
    if(n.type==='ConditionalExpression'||n.type==='LogicalExpression')return union([value(n.consequent??n.left,s,m,seen),value(n.alternate??n.right,s,m,seen)]);
    if(n.type==='CallExpression') {
      const values=[];
      for(const target of choices(value(n.callee,s,m,seen))) {
        if(!target.fn||target.fn.generator) {values.push({unknown:true});continue;}
        const returned=returnedBy(target.fn);
        const results=[];
        for(const ret of returned)for(const v of choices(value(ret,nodeScope.get(ret),target.module,seen)??{unknown:true}))results.push({...v,selections:Object.fromEntries(Object.entries(v.selections??{}).map(([k,v])=>[`${m.file}:${n.start}/${k}`,v])),resolution:[...target.resolution??[],location(m,n),location(target.module,ret),...v.resolution??[]]});
        // An async call returns a Promise, never the returned holder itself.
        // Only explicit await may expose a proved, non-thenable payload.
        if(target.fn.async)values.push({promise:union(results)??{unknown:true}});
        else values.push(...results);
      }
      return union(values);
    }
    if(n.type==='MemberExpression') {
      const key=property(n),values=[];
      for(const object of choices(value(n.object,s,m,seen))) {
        if(object.unknown)values.push(object.externalMember?{unknown:true}:object);
        if(object.promise)values.push({unknown:true});
        if(object.classNode&&key&&!object.memberWrites?.has(key)&&!object.memberWrites?.has(null)) {
          const method=object.classNode.body.body.find(p=>p.type==='MethodDefinition'&&!p.computed&&String(p.key.name??p.key.value)===key&&!!p.static===!!object.static&&p.kind==='method');
          if(method)values.push({fn:method.value,decl:nodeDecl.get(method.value),module:object.module,resolution:[...object.resolution??[],location(object.module,method)]});
        }
        if((object.namespace||object.externalNamespace)&&key)values.push(...namespaceMember(object,key,seen));
        if(object.object&&!object.object.properties.some(p=>p.type==='SpreadElement'||p.computed)) {
          for(const p of object.object.properties)if(key===null||String(p.key.name??p.key.value)===key) {
            if(p.kind==='get'||p.kind==='set')continue;
            for(const v of choices(value(p.value,nodeScope.get(p.value),object.module,seen)??{unknown:true}))values.push({...v,resolution:[...object.resolution??[],location(m,n),location(object.module,p),...v.resolution??[]],possible:object.possible||key===null||v.possible,
              selections:{...object.selections,...v.selections,...(key===null?{[`${m.file}:${n.start}`]:String(p.key.name??p.key.value)}:{})}});
          }
        }
      }
      return union(values);
    }
    return null;
  }
  function namespaceMember(holder,key,seen) {
    if(holder.externalNamespace)return [{unknown:true,externalMember:{module:holder.externalNamespace,name:key},resolution:holder.resolution}];
    return choices(exported(holder.namespace,key,seen)).map(v=>({...v,resolution:[...holder.resolution??[],...v.resolution??[]]}));
  }
  function awaitedValues(v) {
    if(v.promise)return choices(v.promise).flatMap(awaitedValues);
    if(v.object&&v.object.properties.some(p=>p.type==='SpreadElement'||p.computed||String(p.key?.name??p.key?.value)==='then'))return [{unknown:true}];
    if(v.classNode&&(v.classNode.superClass||v.classNode.body.body.some(p=>String(p.key?.name??p.key?.value)==='then')))return [{unknown:true}];
    return [v];
  }
  function choices(v) {return v?.choices??(v?[v]:[]);}
  function union(values) {const list=values.flatMap(v=>choices(v??{unknown:true}));return list.length===1?list[0]:list.length?{choices:list}:null;}
  let next=0;
  function edge(kind,from,to,evidence,extra={}) {
    const e={id:`e${++next}`,kind,from,to,evidence,...extra};relations.push(e);return e;
  }
  const callEdges=new WeakMap();
  function unresolvedReason(n,s) {
    if(n.type==='MemberExpression')return 'dynamic-member';
    if(n.type!=='Identifier')return 'unsupported-callee-expression';
    const b=lookup(s,n.name);
    return !b?'external-or-unbound':b.written?'mutated-binding':b.parameter?'parameter-target':b.imported?'unresolved-import':'unresolved-local-value';
  }
  for(const c of calls) {
    const v=value(c.node.callee,c.scope,c.module),site=location(c.module,c.node);
    // `super(...)` runs the extended class's constructor, so it is a construction like `new`.
    const kind=c.node.type==='NewExpression'||c.node.callee.type==='Super'?'construct':'call';
    const targets=choices(v).filter(v=>v.decl),resolved=[];c.targets=targets;
    for(const target of targets)if(!resolved.some(e=>e.to===target.decl.id&&JSON.stringify(e.selections)===JSON.stringify(target.selections)))resolved.push(edge(kind,c.owner?.id??`${c.module.file}:<module>`,target.decl.id,[site],{resolution:target.resolution??[],selections:target.selections,possible:!!target.possible||targets.length>1||choices(v).some(v=>v.unknown),
      args:c.node.arguments.map(passed),params:(target.fn??target.classNode?.body.body.find(p=>p.kind==='constructor')?.value)?.params.map(passed)??[]}));
    if(resolved.length)callEdges.set(c.node,resolved);
    else unresolved.push({kind,from:c.owner?.id??`${c.module.file}:<module>`,site,reason:unresolvedReason(c.node.callee,c.scope)});
    if(resolved.length&&choices(v).some(v=>v.unknown))unresolved.push({kind:'call',from:c.owner?.id??`${c.module.file}:<module>`,site,reason:'partially-resolved-target',knownTargets:resolved.map(e=>e.to)});
  }
  function producer(n,seen=new Set()) {
    if(!n||seen.has(n))return null;seen=new Set(seen).add(n);
    if(n.type==='AwaitExpression'||n.type==='ChainExpression')return producer(n.argument??n.expression,seen);
    if(n.type==='CallExpression')return callEdges.get(n);
    if(n.type==='Identifier') {
      const b=lookup(nodeScope.get(n),n.name);
      if(b?.constant&&!b.written)return producer(b.init,seen);
    }
    return null;
  }
  for(const c of calls) {
    const consumers=callEdges.get(c.node);if(!consumers)continue;
    for(const consumer of consumers) {
    for(let i=0;i<c.node.arguments.length;i++) {
      const p=producer(c.node.arguments[i]);
      for(const source of p??[])if(Object.entries(source.selections??{}).every(([key,v])=>!(key in (consumer.selections??{}))||consumer.selections[key]===v))edge('value-flow',source.to,consumer.to,[...source.evidence,...consumer.evidence],{via:c.owner?.id,argument:i,path:[source.id,consumer.id],meaning:'Returned value supplied as argument; payload semantics not inferred.'});
    }
    let parent=parents.get(c.node);
    if(parent?.type==='AwaitExpression')parent=parents.get(parent);
    if(parent?.type==='VariableDeclarator'||parent?.type==='ReturnStatement')edge('return-value',consumer.to,consumer.from,consumer.evidence,{path:[consumer.id],...(parent.id?.type==='Identifier'?{result:parent.id.name}:{}),meaning:'Call result assigned or returned in caller; not a claim about payload contents.'});
    }
  }
  // Keep storage explicit: a lexical dependency is not an execution-order claim.
  for(const a of assignments)if(a.node.type==='AssignmentExpression'&&a.node.left.type==='Identifier') {
    const b=lookup(a.scope,a.node.left.name);if(!b?.decl)continue;
    const produced=producer(a.node.right);
    const writer=a.owner?.id??`${a.module.file}:<module>`;
    // The caller assigns the returned value. The provider does not thereby
    // access caller storage; captured bindings still have a separate write edge.
    for(const p of produced??[])edge('return-value',p.to,writer,[...p.evidence,location(a.module,a.node)],{path:[p.id],result:b.name,meaning:'Call result assigned by caller; no payload, alias, lifetime or purity proof.'});
    edge('state-write',writer,b.decl.id,[location(a.module,a.node)],{meaning:'Lexical assignment owner writes this binding; no lifetime or dominance proof.'});
  }
  for(const m of modules.values()) {
    function reads(n) {
      if(n.type==='Identifier') {
        const b=lookup(nodeScope.get(n),n.name),p=parents.get(n),owner=nodeOwner.get(n);
        const nameOnly=(p?.type==='MemberExpression'&&p.property===n&&!p.computed)||(p?.type==='Property'&&p.key===n&&!p.computed)||(p?.type==='VariableDeclarator'&&p.id===n)||(p?.type==='AssignmentExpression'&&p.left===n);
        if(b?.written&&b.decl&&owner&&!nameOnly&&b.decl.parent!==owner.id)edge('state-read',b.decl.id,owner.id,[location(m,n)],{meaning:'Lexical state dependency; no value, timing or request-correlation proof.'});
      }
      for(const child of children(n))reads(child);
    }
    reads(m.ast);
  }
  const receiverBinding=n=>n?.type==='Identifier'?lookup(nodeScope.get(n),n.name):null;
  const handlers=assignments.filter(a=>a.node.type==='AssignmentExpression'&&a.node.left.type==='MemberExpression'&&property(a.node.left)==='onmessage'&&functions.has(a.node.right.type));
  const messages=calls.filter(c=>c.node.callee.type==='MemberExpression'&&property(c.node.callee)==='postMessage');
  const workerLinks=[];
  for(const c of calls) {
    const target=value(c.node.callee,c.scope,c.module);if(!target?.fn)continue;
    for(let i=0;i<c.node.arguments.length;i++) {
      const arg=c.node.arguments[i],param=target.fn.params[i];
      if(arg.type!=='NewExpression'||arg.callee.type!=='Identifier'||arg.callee.name!=='Worker'||lookup(nodeScope.get(arg), 'Worker')||arg.arguments[0]?.type!=='Literal'||param?.type!=='Identifier')continue;
      const url=arg.arguments[0].value;if(typeof url!=='string'||!url.startsWith('/studio/'))continue;
      const worker=modules.get(url.slice(1));if(!worker)continue;
      const b=lookup(nodeScope.get(target.fn),param.name);if(!b||b.written)continue;
      const receivers=handlers.filter(h=>receiverBinding(h.node.left.object)===b);
      const workerHandlers=handlers.filter(h=>h.module===worker&&h.node.left.object.type==='Identifier'&&h.node.left.object.name==='self'&&!receiverBinding(h.node.left.object));
      const senders=messages.filter(msg=>receiverBinding(msg.node.callee.object)===b);
      const replies=messages.filter(msg=>msg.module===worker&&msg.node.callee.object.name==='self'&&!receiverBinding(msg.node.callee.object));
      const link={creation:location(c.module,arg),binding:location(c.module,c.node),worker:worker.file};workerLinks.push(link);
      for(const [from,to] of [[senders,workerHandlers],[replies,receivers]])for(const msg of from)for(const h of to) {
        edge('worker-handoff',msg.owner?.id??`${msg.module.file}:<module>`,nodeDecl.get(h.node.right).id,[link.creation,link.binding,location(msg.module,msg.node),location(h.module,h.node)],{meaning:'Possible message delivery on this Worker instance; no dispatch, success, request-ID correlation or ordering proof.'});
      }
    }
  }
  // A record is a holder, not a page, wherever it is written. `const viewer={…}` names a value no
  // reader can open, so `::` before one of its function members promises a page that does not
  // exist; the member joins its holder with `.` for record membership, and what is written inside
  // that member keeps `::` after it. The same holds for a record declared inside a function
  // (`createStudio::lifetime.onViewers`): the holder is still a value, not a page. A holder that
  // is callable — a nested function, a method, a class — is a page, and keeps `::`. A name-keyed
  // dispatch table at module level is the exception the registry rule already made: a
  // `registry-entry` coupling reaches each entry of a module-level table by its key, so that key
  // stays a segment of its own and the entry keeps the identity it had. A table written inside a
  // function is a local value like any other record, and its entries read `table.key`, which is
  // how the registry coupling already labels them.
  {
    const keyed=new Set();
    for(const r of relations)if(r.kind==='registry-entry'){keyed.add(r.from);keyed.add(r.to);}
    const records=new Set();
    for(const d of declarations)
      if(d.kind==='variable'&&!d.callable&&d.anchor)records.add(`${d.file}::${declarationPaths.get(d.id).join('::')}`);
    for(const d of declarations) {
      const segments=declarationPaths.get(d.id);
      if(!d.anchor||segments.length<2)continue;
      const named=[segments[0]];
      for(let i=1;i<segments.length;i++)
        if(records.has(`${d.file}::${segments.slice(0,i).join('::')}`)&&!(i===1&&keyed.has(d.id)))
          named[named.length-1]+=`.${segments[i]}`;
        else named.push(segments[i]);
      d.anchor=`${d.file}::${named.join('::')}`;
    }
  }
  // The same registration written as a property. `canvas.onpointerdown=beginCanvasDrag` hands the
  // platform a callable exactly as `addEventListener('pointerdown',…)` does, so the function doing
  // the assigning reaches the declaration it names and draws a wire to it. The platform's own
  // property naming decides the shape: `on` and a lower-case event, never a record field, which is
  // capitalised (`onProgress`). A function written at the site is already a handler declaration the
  // site homes, and needs no edge to say where it lives.
  for(const a of assignments) {
    const n=a.node;
    if(n.type!=='AssignmentExpression'||n.operator!=='='||n.left.type!=='MemberExpression')continue;
    const event=property(n.left);
    if(!event||!/^on[a-z]/.test(event)||!mappedCode(a.module.file))continue;
    // `a.onx=b.ony=handler` registers the same callable twice; each property is its own site.
    let held=n.right;while(held.type==='AssignmentExpression'&&held.operator==='=')held=held.right;
    if(functions.has(held.type))continue;
    for(const fn of new Set(choices(value(held,a.scope,a.module)).filter(v=>v.fn).map(v=>v.fn))) {
      const d=nodeDecl.get(fn);
      // A positional anchor is an anonymous callable; it has no declaration a reader can open.
      if(!d||!mappedCode(d.file)||!d.anchor||/<callback@\d+:\d+>/.test(d.anchor))continue;
      edge('event-listener',a.owner?.id??`${a.module.file}:<module>`,d.id,[location(a.module,n)],
        {label:event.slice(2),receiver:handlerReceiver(n.left.object)??event,rule:'handler-property'});
    }
  }
  // A resolved invocation of an anonymous function must retain that function's
  // identity, never its enclosing factory's implementation. Source positions
  // name anonymous returned functions even before any caller reaches them.
  const invoked=new Set(relations.filter(r=>r.kind==='call'||r.kind==='construct').map(r=>r.to));
  const declarationsById=new Map(declarations.map(d=>[d.id,d])),reanchored=new Set();
  for(const d of declarations) {
    const enclosing=declarationsById.get(d.parent);
    if(d.anchor&&reanchored.has(d.parent)){
      const suffix=declarationPaths.get(d.id).slice(declarationPaths.get(d.parent).length);
      d.anchor=`${enclosing.anchor}::${suffix.join('::')}`;reanchored.add(d.id);
    }
    if(!d.callable||d.anchor&&!/<callback@\d+:\d+>/.test(d.anchor)||!(d.generatedRole==='returned-callable'||invoked.has(d.id)))continue;
    let parent=declarationsById.get(d.parent);
    while(parent&&(!parent.anchor||/<callback@\d+:\d+>/.test(parent.anchor)))parent=declarationsById.get(parent.parent);
    const role=d.generatedRole==='returned-callable'?'return':'callable';
    d.name=`<${role}@${d.line}:${d.column}>`;
    d.anchor=`${parent?.anchor??d.file}::${d.name}`;
    d.generatedRole??='invoked-callable';
    reanchored.add(d.id);
  }
  // Repeated inline object callbacks can have the same lexical property path while still being
  // distinct callable values (for example two `{filter: c=>...}` arguments in one function).
  // If their shared path were left ambiguous, projection would represent calls to either callback
  // as calls to the enclosing function. Keep the source property name and add source position only
  // for that collision; ordinary duplicate declarations remain ambiguous.
  const propertyAnchorCounts=new Map();
  for(const d of declarations)if(d.anchor&&d.callable&&d.kind==='method'&&parents.get(declFn.get(d.id))?.type==='Property')
    propertyAnchorCounts.set(d.anchor,(propertyAnchorCounts.get(d.anchor)??0)+1);
  for(const d of declarations)if(propertyAnchorCounts.get(d.anchor)>1)d.anchor+=`@${d.line}:${d.column}`;
  // A path names a lexical binding, not just the spelling of its identifier.
  // Qualify only genuine shadow collisions; unrelated edits must not turn an
  // identity into a source-line address. A duplicate in the same scope remains
  // ambiguous because these declarations do not prove separate bindings.
  const collisions=new Map();
  const originalAnchors=new Map(declarations.map(d=>[d.id,d.anchor]));
  for(const d of declarations)if(d.anchor&&['variable','function','class'].includes(d.kind))
    (collisions.get(d.anchor)??collisions.set(d.anchor,[]).get(d.anchor)).push(d);
  const ancestor=(outer,inner)=>{for(let at=inner;at;at=at.parent)if(at===outer)return true;return false;};
  const chain=s=>{const out=[];for(let at=s;at;at=at.parent)out.push(at);return out;};
  for(const [anchor,group] of collisions)if(group.length>1){
    const scoped=group.map(d=>({d,scope:declScope.get(d.id)}));
    if(scoped.some(row=>!row.scope)||new Set(scoped.map(row=>row.scope)).size!==scoped.length)continue;
    const outer=scoped.filter(row=>scoped.every(other=>ancestor(row.scope,other.scope)));
    const canonical=outer.length===1?outer[0]:null;
    const common=chain(scoped[0].scope).find(scope=>scoped.every(row=>ancestor(scope,row.scope)));
    if(!common)continue;
    const prefix=anchor.slice(0,anchor.lastIndexOf('::')),name=anchor.slice(anchor.lastIndexOf('::')+2);
    for(const row of scoped){
      if(row===canonical)continue;
      const stop=canonical?.scope??common,route=[];
      for(let at=row.scope;at&&at!==stop;at=at.parent)if(at.kind==='block')
        route.unshift(`${at.role.replace(/Statement$/,'').toLowerCase()}-${at.ordinal}`);
      if(!route.length)continue;
      row.d.anchor=`${prefix}::@scope/${route.join('/')}::${name}`;
      row.d.identity={kind:'lexical-scope',scope:route,base:anchor};
    }
  }
  // A nested declaration belongs to the newly identified parent binding.
  // Carry that structural prefix into its address without changing its site.
  const byDeclarationId=new Map(declarations.map(d=>[d.id,d]));
  const depth=d=>{let n=0;for(let at=d.parent;at;at=byDeclarationId.get(at)?.parent)n++;return n;};
  for(const d of [...declarations].sort((a,b)=>depth(a)-depth(b))){
    const parent=byDeclarationId.get(d.parent),before=originalAnchors.get(d.parent);
    if(parent?.anchor&&before&&parent.anchor!==before&&d.anchor?.startsWith(`${before}::`))
      d.anchor=`${parent.anchor}${d.anchor.slice(before.length)}`;
  }
  const anchorCounts=new Map();for(const d of declarations)if(d.anchor)anchorCounts.set(d.anchor,(anchorCounts.get(d.anchor)??0)+1);
  for(const d of declarations)if(anchorCounts.get(d.anchor)>1)d.ambiguousAnchor=true;
  // Module-level code that runs at load: every top-level statement but an import, an export list
  // and a declaration, and every initializer that does more than state constant data. No
  // declaration holds it, so no leaf draws it. A callable written inside a top-level statement is
  // listed too: the model says whether a leaf draws it (leaves.mjs).
  const inert=new Set(['Literal','TemplateLiteral','TemplateElement','Identifier','ArrayExpression','ObjectExpression',
    'Property','SpreadElement','UnaryExpression','BinaryExpression','LogicalExpression','MemberExpression',
    'ConditionalExpression','ChainExpression','MetaProperty','PrivateIdentifier']);
  const opaque=n=>functions.has(n.type)||n.type==='ClassExpression'||n.type==='ClassDeclaration';
  const runs=n=>!!n&&!opaque(n)&&(!inert.has(n.type)||children(n).some(runs));
  const callablesIn=(n,out=[])=>{if(!n)return out;if(opaque(n)){const d=nodeDecl.get(n);if(d)out.push(d.id);return out;}
    for(const c of children(n))callablesIn(c,out);return out;};
  const moduleCode=[];
  for(const m of modules.values())if(mappedCode(m.file))for(const top of m.ast.body) {
    const s=top.type==='ExportNamedDeclaration'||top.type==='ExportDefaultDeclaration'?top.declaration:top;
    if(!s||['ImportDeclaration','ExportAllDeclaration','FunctionDeclaration','ClassDeclaration'].includes(s.type))continue;
    const parts=s.type==='VariableDeclaration'?s.declarations.map(d=>({node:d,value:d.init,runs:runs(d.init)})):[{node:s,value:s,runs:!opaque(s)}];
    for(const part of parts) {
      const callables=callablesIn(part.value);
      if(!part.runs&&!callables.length)continue;
      const {node}=part;
      moduleCode.push({file:m.file,line:node.loc.start.line,column:node.loc.start.column+1,start:node.start,end:node.end,
        expression:m.text.slice(node.start,Math.min(node.end,node.start+80)).replace(/\s+/g,' '),runs:part.runs,callables});
    }
  }
  return {schema:1,importAliases,files:[...modules.values()].map(m=>({file:m.file,sha256:m.hash,lines:m.ast.loc.end.line})),declarations,relations,unresolved,workerLinks,moduleCode,
    limits:['Static possible relationships, not execution traces or proofs of reachability.',
      'Calls resolve lexical bindings, const aliases, imports, named re-exports, literal object members, finite function-return choices, local class methods and the extended class a `super` reference names. A receiver or callable is followed through parameters, destructured bindings and this-fields, then through at most one further static member selection per hop. Computed registry selection gives possible targets, not a selected dialect or proof of branch feasibility. Escaped object mutation, arbitrary callback protocols, inherited members reached other than through `super`, export-star and dynamic imports are not modeled.',
      'Value flow handles direct call results and immutable aliases. Lexical state dependencies do not prove reaching definitions. Control sequence is not inferred from call order.',
      'Worker links require a literal /studio/ URL passed directly to a resolved function parameter; messages are not correlated by ID or branch. Other worker construction remains unresolved.',
      'Import aliases are explicit deployment facts, not guessed module paths.',
      'Projection chooses the nearest containing authored component and collapses at most six call/handoff steps. Enclosed code is not individually explained. Repeated occurrences receive the same possible component relationships, not an inferred execution order between occurrences.',
      'Declaration inventory includes variables/classes/functions/methods and handlers plus anonymous callbacks; parameters and destructured bindings are scope-only. Native, generated and non-mjs source is outside extraction.']};
}
