import {readFile, readdir} from 'node:fs/promises';
import {posix, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {couplings} from './couplings.mjs';
import {iterationMethods} from './shapes.mjs';
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

export async function sourceFiles(repo, roots=['core','studio','skills','adapters']) {
  const files=[];
  async function walk(dir) {
    for(const entry of await readdir(resolve(repo,dir),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
      const path=`${dir}/${entry.name}`;
      if(entry.isDirectory()&&!['tests','node_modules','.local'].includes(entry.name)) await walk(path);
      else if(entry.isFile()&&entry.name.endsWith('.mjs')&&!entry.name.endsWith('.test.mjs')) files.push(path);
    }
  }
  for(const dir of roots) await walk(dir);
  return files.sort();
}

// The projection's mapped set; uniqueness of a method name is asked of that code only.
const mappedCode=isMapped;

export async function extractGraph({repo,files,importAliases={},literalCouplings=false,receiverCalls=false,readSource=file=>readFile(resolve(repo,file),'utf8')}) {
  const modules=new Map(), declarations=[], calls=[], assignments=[], relations=[], unresolved=[], declFn=new Map(),declarationPaths=new Map();
  const nodeScope=new WeakMap(), nodeOwner=new WeakMap(), nodeDecl=new WeakMap(), parents=new WeakMap();
  const parameterDefaultNames=new WeakMap();
  const scopes=[], bindings=[];
  const scope=(parent,kind)=>{const s={parent,kind,bindings:new Map()};scopes.push(s);return s;};
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
  function declaration(m,n,path,kind,owner,anchor=true) {
    const d={id:`${m.file}:${n.start}:${kind}`,anchor:anchor?`${m.file}::${path.join('::')}`:null,name:path.at(-1),kind,parent:owner?.id??null,...location(m,n)};
    declarations.push(d);declarationPaths.set(d.id,path);nodeDecl.set(n,d);return d;
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
          const next=[...path,v.id.name],d=declaration(m,v,next,'variable',owner);
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
      const defaultName=parameterDefaultNames.get(n);
      const inherited=!!parent&&nodeDecl.has(parent)&&(
        parent.type==='VariableDeclarator'&&parent.init===n||
        ['Property','MethodDefinition'].includes(parent.type)&&parent.value===n||
        parent.type==='AssignmentExpression'&&parent.right===n);
      const next=named?[...path,n.id.name]:inherited?path:defaultName?[...path,`@default/${encodeURIComponent(defaultName)}`]:[...path,`<callback@${n.loc.start.line}:${n.loc.start.column+1}>`];
      const d=inherited?nodeDecl.get(parent):declaration(m,n,next,'function',owner,named||!!defaultName);
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
      const d=declaration(m,n,next,'class',owner,!!n.id);
      if(n.id)bind(s,n.id.name,{decl:d,module:m,classNode:n});
      const inner=scope(s,'class');inner.classNode=n;
      for(const child of children(n))if(child!==n.id)visit(m,child,inner,next,d,n);return;
    }
    if((n.type==='Property'||n.type==='MethodDefinition')&&!n.computed&&functions.has(n.value?.type)) {
      const next=[...path,n.type==='MethodDefinition'?methodPath(n):String(n.key.name??n.key.value)];
      declaration(m,n,next,'method',owner);visit(m,n.value,s,next,owner,n);return;
    }
    if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&property(n.left)&&functions.has(n.right.type)) {
      declaration(m,n,[...path,property(n.left)],'handler',owner);
    }
    if((n.type==='BlockStatement'&&!functions.has(parent?.type))||n.type==='CatchClause'||['ForStatement','ForOfStatement','ForInStatement','SwitchStatement'].includes(n.type)) {
      s=scope(s,'block');nodeScope.set(n,s);if(n.type==='CatchClause')pattern(n.param,s);
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
    for(const p of produced??[])edge('state-write',p.to,b.decl.id,[...p.evidence,location(a.module,a.node)],{path:[p.id],meaning:'Call result written to binding; no lifetime or dominance proof.'});
    if(!produced&&a.owner)edge('state-write',a.owner.id,b.decl.id,[location(a.module,a.node)]);
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
  // Opt-in, after every other relation, so relation ids and the authored projection are unchanged without it.
  const coupled=literalCouplings?couplings({modules,calls,assignments,lookup,nodeScope,nodeOwner,parents,value,choices,location,edge,property,children,functions,importPath}):null;
  if(receiverCalls&&!coupled)throw Error('receiverCalls needs literalCouplings: it reuses that value resolver.');
  const accounting=receiverCalls?accountCalls(coupled.origins):null;
  // Every call site in mapped code ends LINKED, EXTERNAL or UNRESOLVED, each with the rule
  // that decided it. Linking follows the receiver's or callee's value through the coupling
  // resolver, extended with destructured bindings and factory-returned object members.
  function accountCalls(origins) {
    // Names mapped code can carry on an object. Lexical declarations do not make their
    // spelling a member name: `const slice=...` must not make an unrelated `value.slice()`
    // internal. Keep explicit methods and properties whose values may be callable, including
    // shorthand properties and callable member assignments. Unknown values stay conservative.
    const carried=new Set(),plain=new Set(['Literal','TemplateLiteral','ArrayExpression','ObjectExpression']);
    for(const d of declarations)if(mappedCode(d.file)&&d.callable)carried.add(d.name);
    for(const m of modules.values())if(mappedCode(m.file))(function walk(n) {
      const key=!n.computed?n.key?.name??n.key?.value:n.key?.type==='Literal'?n.key.value:null;
      if(['Property','PropertyDefinition','MethodDefinition'].includes(n.type)&&key!==null&&key!==undefined&&
        (n.type==='MethodDefinition'||!plain.has(n.value?.type??'Literal')))carried.add(String(key));
      if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&property(n.left)!==null&&
        !plain.has(n.right.type))carried.add(property(n.left));
      for(const c of children(n))walk(c);
    })(m.ast);
    const rootOf=n=>{let base=n;while(base&&['MemberExpression','ChainExpression','AwaitExpression','TSNonNullExpression'].includes(base.type))base=base.object??base.expression??base.argument;return base;};
    // The `extends` expression governing a `super` reference, found the way `value` finds it.
    const superClassAt=n=>{let s=nodeScope.get(n);while(s&&!s.thisBoundary)s=s.parent;return s?.thisClass?.superClass??null;};
    const packageImport=b=>!!b?.imported&&!importPath(b.module,b.source);
    const bindingOf=n=>n?.type==='Identifier'?lookup(nodeScope.get(n),n.name):null;
    // Reassignment alone does not erase a receiver's built-in type when every value written to
    // that binding is visibly an array. This is type evidence only: it does not select a mapped
    // implementation of the member or imply that any particular write reaches the call.
    const alwaysArray=(b,key)=>b?.init?.type==='ArrayExpression'&&b.writeValues?.length&&
      b.writeValues.every(n=>n?.type==='ArrayExpression')&&!b.callEscaped&&!b.objectWritten&&
      !b.memberWrites?.has(key)&&!b.memberWrites?.has(null);

    // A value that is provably not mapped code. `key` is the member the call needs.
    function externalValue(node,module,key,seen) {
      if(seen.has(node))return null;seen.add(node);
      if(['Literal','TemplateLiteral','ArrayExpression'].includes(node.type))return 'receiver-literal';
      if(node.type==='ObjectExpression')return node.properties.some(p=>p.type==='SpreadElement'||p.computed||String(p.key?.name??p.key?.value)===key)?null:'receiver-object-literal-lacks-member';
      if(node.type==='NewExpression')return node.callee.type==='Identifier'&&!bindingOf(node.callee)?'receiver-new-of-unbound-class'
        :packageImport(bindingOf(node.callee))?'receiver-new-of-package-class':null;
      if(node.type==='Identifier') {
        const b=bindingOf(node);
        if(!b)return 'receiver-unbound-identifier';
        if(packageImport(b))return 'receiver-package-import';
        if(alwaysArray(b,key))return 'receiver-array-valued-binding';
        return null;
      }
      if(node.type==='CallExpression'||node.type==='NewExpression')return externalCall(node,module,seen)?'receiver-external-call-result':null;
      return null;
    }
    // A call whose callee is provably not mapped code.
    function externalCall(node,module,seen) {
      const callee=node.callee,key=callee.type==='MemberExpression'?property(callee):null;
      // A `super` call reaches the extended class. When that class is not code this scan holds,
      // the call is outside the map for the same reason `new` of such a class is.
      if(callee.type==='Super'||callee.object?.type==='Super') {
        const extended=superClassAt(callee);
        if(!extended)return null;
        if(extended.type==='Identifier'&&!bindingOf(extended))return 'super-of-unbound-class';
        return packageImport(bindingOf(extended))?'super-of-package-import':null;
      }
      const imported=choices(value(callee,nodeScope.get(callee),module));
      if(imported.length&&imported.every(v=>v.externalMember))return 'literal-import-outside-scan';
      if(callee.type==='MemberExpression') {
        if(key!==null&&!carried.has(key))return 'member-name-not-in-mapped-code';
        const root=rootOf(callee.object);
        if(root?.type==='Identifier'&&!bindingOf(root))return 'unbound-receiver-root';
        const found=origins(callee.object,module);
        if(!found.length)return null;
        const rules=found.map(o=>externalValue(o.node,o.module,key,seen));
        return rules.every(Boolean)?rules[0]:null;
      }
      const b=bindingOf(callee);
      if(callee.type==='Identifier'&&!b)return 'unbound-callee';
      if(packageImport(b))return 'callee-package-import';
      return null;
    }

    // Members a resolved holder carries under `key`, following property values that are not
    // written as functions (a factory's `{load}` shorthand, an alias, a re-exported name).
    const holderFns=(v,key,module)=>{
      if(v.classNode)return [v.classNode.body.body.find(p=>p.type==='MethodDefinition'&&!p.computed&&String(p.key.name??p.key.value)===key&&!!p.static===!!v.static&&p.kind==='method')?.value].filter(Boolean);
      if(v.object)return v.object.properties.filter(p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&String(p.key.name??p.key.value)===key)
        .flatMap(p=>functions.has(p.value.type)?[p.value]:choices(value(p.value,nodeScope.get(p.value),v.module??module)).filter(x=>x.fn).map(x=>x.fn));
      return [];
    };
    // `origins` with destructured bindings followed back to the object they were taken from.
    function follow(node,module,seen=new Set(),depth=0) {
      const out=[];
      for(const o of origins(node,module)) {
        const b=depth<6?bindingOf(o.node):null;
        if(b?.destructured&&!b.written&&!seen.has(b)) {
          const next=new Set(seen).add(b);
          let held=follow(b.destructured.init,b.destructured.module,next,depth+1);
          for(const key of b.destructured.keys)
            held=held.flatMap(h=>choices(value(h.node,nodeScope.get(h.node),h.module))
              .flatMap(v=>v.object&&!v.object.properties.some(p=>p.type==='SpreadElement')
                ?v.object.properties.filter(p=>p.type==='Property'&&!p.computed&&String(p.key.name??p.key.value)===key)
                  .flatMap(p=>follow(p.value,v.module??h.module,next,depth+1)):[]));
          if(held.length) {out.push(...held);continue;}
        }
        out.push(o);
      }
      return out;
    }
    // A member a resolved holder carries under `key`, as values rather than functions, so a
    // further member of the selected value can be read in turn. Every selection is an exact,
    // non-computed key: a class body's own method, or a property of an object literal that no
    // spread can override.
    const memberValues=(v,key,module)=>{
      if(v.classNode) {
        const method=v.classNode.body.body.find(p=>p.type==='MethodDefinition'&&!p.computed&&String(p.key.name??p.key.value)===key&&!!p.static===!!v.static&&p.kind==='method');
        return method?[{fn:method.value,decl:nodeDecl.get(method.value),module:v.module??module}]:[];
      }
      if(v.object&&!v.object.properties.some(p=>p.type==='SpreadElement'||p.computed))
        return v.object.properties.filter(p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&String(p.key.name??p.key.value)===key)
          .flatMap(p=>choices(value(p.value,nodeScope.get(p.value),v.module??module)));
      return [];
    };
    // The values an expression can hold, each with `at`: the argument (or iterated element)
    // where that value entered, which is the caller site that supplies it. `follow` reads
    // locals, parameters, destructured bindings and this-fields; where `value` cannot read the
    // expression `follow` returned, and that expression selects a named member, the holder is
    // resolved the same way and the member selected on it. One hop per level, two at most.
    function valuesOf(node,module,depth=0) {
      const out=[];
      for(const o of follow(node,module)) {
        const held=choices(value(o.node,nodeScope.get(o.node),o.module)).flatMap(v=>o.awaited?awaitedValues(v):[v]);
        const member=o.node.type==='MemberExpression'?property(o.node):null;
        if(member===null||depth>=2||held.some(v=>!v.unknown)) {out.push(...held.map(v=>({v,at:o.at})));continue;}
        for(const held of valuesOf(o.node.object,o.module,depth+1))
          out.push(...memberValues(held.v,member,o.module).map(v=>({v,at:held.at??o.at})));
      }
      return out;
    }
    // Counts are call sites; `links` counts the relations those sites produced.
    const linked={'ast-call-site':0,'receiver-value':0,'value-follow':0},links={'receiver-value':0,'value-follow':0};
    // Full spans distinguish nested calls that share a starting expression.
    const external={},externalSites=[],unresolved=[],rules={},unlinked={},notes={};
    // Every call span that reached a target, in any scanned root. A later pass reads it to know
    // which member calls named no callee at all, which is what an iteration method looks like.
    const accounted=new Set();
    const count=(table,rule)=>{table[rule]=(table[rule]??0)+1;};
    for(const c of calls) {
      // Receiver and callable resolution runs for every scanned root, so an outside caller
      // reaches the same mapped declarations a mapped caller does and appears as a port.
      // The linked/external/unresolved account itself stays an account of mapped code.
      const inside=mappedCode(c.module.file);
      const callee=c.node.callee,key=callee.type==='MemberExpression'?property(callee):null;
      if(callEdges.has(c.node)) {accounted.add(`${c.module.file}:${c.node.start}:${c.node.end}`);if(inside) {linked['ast-call-site']++;count(rules,'ast-call-site');}continue;}
      const from=c.owner?.id??`${c.module.file}:<module>`,site=location(c.module,c.node);
      const found=new Map();
      // A default expression is one possible value of a parameter, not proof that it was selected
      // at this call. Concrete callback arguments traced from callers remain valid possible targets.
      const directParameter=callee.type==='Identifier'&&lookup(c.scope,callee.name)?.parameter;
      // Declarations reached that are scanned but not mapped: no map address, but still named,
      // so a finding row can say which callables this code supplies.
      const outside=new Set();
      const take=(fn,route,at,callable=false)=>{
        if(directParameter&&parameterDefaultNames.has(fn))return;
        const d=nodeDecl.get(fn);
        if(!d)return;
        if(mappedCode(d.file))found.set(d.id,{decl:d,fn,route,callable,at});
        else if(d.anchor)outside.add(d.anchor);
      };
      if(callee.type!=='MemberExpression'||key!==null) {
        const by=callee.type==='MemberExpression'?'receiver-value':'value-follow';
        for(const {v,at} of valuesOf(callee.type==='MemberExpression'?callee.object:callee,c.module))
          for(const fn of key===null?(v.fn?[v.fn]:[]):holderFns(v,key,c.module))take(fn,by,at);
        // A member that holds a callable rather than naming a method — a field assigned a
        // callback, a record member whose value is a function — is read as a value itself.
        if(!found.size&&key!==null)for(const {v,at} of valuesOf(callee,c.module))if(v.fn)take(v.fn,'value-follow',at,true);
      }
      if(found.size) {
        accounted.add(`${site.file}:${site.start}:${site.end}`);
        const route=[...found.values()][0].route;
        // A callable held in a member is whatever was stored there; the store is the evidence,
        // not a proof that this call reaches one particular stored function.
        const possible=found.size>1||[...found.values()].some(f=>f.callable);
        if(inside) {linked[route]++;links[route]+=found.size;count(rules,route);}
        // `evidence` stays the call site alone: other analyses read it as the set of accounted
        // call spans. The argument that supplied the value is provenance, so it goes to
        // `resolution`, where it names the caller this link was proved from.
        // A call on a parameter says so: the callable is the caller's, followed here through the
        // argument. The relationship is the same link; where it is drawn is not, so the map
        // keeps it out of the callee's own boxes and flow (dev-map/lib/flow.mjs, regions.mjs).
        for(const {decl,fn,at} of found.values())
          edge('call',from,decl.id,[site],{resolution:at?.node?[location(at.module,at.node)]:[],resolvedBy:route,...(key?{receiver:key}:{}),possible,
            ...(directParameter?{viaParameter:true}:{}),
            args:c.node.arguments.map(passed),params:(fn??declFn.get(decl.id))?.params.map(passed)??[]});
        continue;
      }
      if(!inside)continue;
      // No mapped target. Known callables this code can supply are still listed, so a finding
      // row says what the candidates are rather than only that the site is unresolved.
      const candidates=outside.size?[...outside].sort():null;
      const rule=externalCall(c.node,c.module,new Set());
      if(rule) {count(external,rule);count(rules,rule);unlinked[`${site.file}:${site.start}:${site.end}`]=rule;externalSites.push({from,site,rule});continue;}
      const subscribers=key!==null?null:registeredSubscriber(callee,c.scope);
      const reason=key!==null?'member-receiver-unresolved':callee.type==='MemberExpression'?'computed-member'
        :subscribers?'registered-subscriber':unresolvedReason(callee,c.scope);
      unresolved.push({from,site,name:key,reason,...(subscribers?{registration:subscribers}:{}),...(candidates?{candidates}:{})});
      count(rules,reason);unlinked[`${site.file}:${site.start}:${site.end}`]=reason;
      if(subscribers||candidates)notes[`${site.file}:${site.start}:${site.end}`]={...(subscribers?{registration:subscribers}:{}),...(candidates?{candidates}:{})};
    }
    return {states:{linked:Object.values(linked).reduce((a,b)=>a+b,0),external:Object.values(external).reduce((a,b)=>a+b,0),unresolved:unresolved.length},
      linked,links,external,externalSites,rules,unresolved,unlinked,notes,accounted};
  }
  // A local collection of callables, filled by a registration function in the same closure and
  // iterated at the call site: the value called is whatever was registered. No static target
  // exists, so the site names the registering declarations instead of inventing a callee.
  function registeredSubscriber(callee,s) {
    if(callee.type!=='Identifier')return null;
    const b=lookup(s,callee.name);
    if(!b?.node||b.written)return null;
    const holder=parents.get(parents.get(b.node));
    if(holder?.type!=='ForOfStatement'||holder.left!==parents.get(b.node))return null;
    let source=holder.right;
    // `for(const x of [...listeners])` iterates a copy of the same collection.
    if(source.type==='ArrayExpression'&&source.elements.length===1&&source.elements[0]?.type==='SpreadElement')source=source.elements[0].argument;
    if(source.type!=='Identifier')return null;
    const collection=lookup(nodeScope.get(source),source.name);
    if(!collection?.constant||!collection.init)return null;
    // A closure's own collection, not a module-level or imported one.
    let owner=collection.scope,closure=false;
    while(owner) {if(owner.kind==='function'||owner.kind==='parameters')closure=true;owner=owner.parent;}
    if(!closure)return null;
    const init=collection.init,builtin=n=>n.type==='Identifier'&&!lookup(nodeScope.get(n),n.name);
    if(!(init.type==='ArrayExpression'||init.type==='NewExpression'&&['Set','Map'].includes(init.callee.name)&&builtin(init.callee)))return null;
    const adds=new Set(['add','set','push','unshift']),registrations=new Set();
    for(const r of calls) {
      const target=r.node.callee;
      if(target.type!=='MemberExpression'||!adds.has(property(target))||target.object.type!=='Identifier')continue;
      if(lookup(nodeScope.get(target.object),target.object.name)!==collection)continue;
      const d=r.owner;
      if(d?.anchor&&!d.ambiguousAnchor)registrations.add(d.anchor);
    }
    return registrations.size?[...registrations].sort():null;
  }
  // Registrations. A call the accounting could not link, made on a receiver's method, handed a
  // string literal and a function, enters that function whenever the named event fires. The shape
  // decides it, not the method's spelling; the spelling is carried so the match can be read back.
  if(accounting)for(const c of calls) {
    if(c.node.type!=='CallExpression'||!mappedCode(c.module.file)||callEdges.has(c.node))continue;
    const callee=c.node.callee,key=callee.type==='MemberExpression'?property(callee):null;
    if(key===null||!Object.hasOwn(accounting.unlinked,`${c.module.file}:${c.node.start}:${c.node.end}`))continue;
    const [first,second]=c.node.arguments;
    if(first?.type!=='Literal'||typeof first.value!=='string'||!second)continue;
    const handlers=functions.has(second.type)?[second]:choices(value(second,c.scope,c.module)).filter(v=>v.fn).map(v=>v.fn);
    for(const fn of new Set(handlers)) {
      const d=nodeDecl.get(fn);if(!d||!mappedCode(d.file))continue;
      edge('event-listener',c.owner?.id??`${c.module.file}:<module>`,d.id,[location(c.module,c.node)],
        {label:first.value,receiver:key,rule:accounting.unlinked[`${c.module.file}:${c.node.start}:${c.node.end}`]});
    }
  }
  // An iteration method calls the function it is handed, once per element. When that function is
  // a declaration the call site names, the site is a call of it with the element as its argument,
  // so it is an ordinary call edge. An inline callback is not: it is the calling flow's own body,
  // traced there, and giving it an edge would make a box out of a stage.
  if(accounting)for(const c of calls) {
    if(c.node.type!=='CallExpression'||callEdges.has(c.node))continue;
    const callee=c.node.callee,key=callee.type==='MemberExpression'?property(callee):null;
    const spec=key===null?null:iterationMethods.get(key);
    if(!spec||accounting.accounted.has(`${c.module.file}:${c.node.start}:${c.node.end}`))continue;
    const args=c.node.arguments;
    if(args.length>spec.arity||args.some(a=>a.type==='SpreadElement'))continue;
    const handed=args[spec.callback];
    if(!handed||functions.has(handed.type))continue;
    const held=choices(value(handed,c.scope,c.module)).filter(v=>v.fn).map(v=>v.fn);
    for(const fn of new Set(held)) {
      const d=nodeDecl.get(fn);
      // A positional anchor is an anonymous callable; it has no declaration a reader can open.
      if(!d||!mappedCode(d.file)||!d.anchor||/<callback@\d+:\d+>/.test(d.anchor))continue;
      edge('call',c.owner?.id??`${c.module.file}:<module>`,d.id,[location(c.module,c.node)],
        {resolvedBy:'iteration-callback',iterationMethod:key,possible:held.length>1,
          args:fn.params.slice(0,spec.param.length).map(passed),params:fn.params.map(passed)});
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
  const anchorCounts=new Map();for(const d of declarations)if(d.anchor)anchorCounts.set(d.anchor,(anchorCounts.get(d.anchor)??0)+1);
  for(const d of declarations)if(anchorCounts.get(d.anchor)>1)d.ambiguousAnchor=true;
  return {schema:1,importAliases,files:[...modules.values()].map(m=>({file:m.file,sha256:m.hash,lines:m.ast.loc.end.line})),declarations,relations,unresolved,workerLinks,
    ...(coupled?{couplings:{linked:coupled.linked,unlinked:coupled.unlinked}}:{}),...(accounting?{callSites:accounting}:{}),
    limits:['Static possible relationships, not execution traces or proofs of reachability.',
      'Calls resolve lexical bindings, const aliases, imports, named re-exports, literal object members, finite function-return choices, local class methods and the extended class a `super` reference names. A receiver or callable is followed through parameters, destructured bindings and this-fields, then through at most one further static member selection per hop. Computed registry selection gives possible targets, not a selected dialect or proof of branch feasibility. Escaped object mutation, arbitrary callback protocols, inherited members reached other than through `super`, export-star and dynamic imports are not modeled.',
      'Value flow handles direct call results and immutable aliases. Lexical state dependencies do not prove reaching definitions. Control sequence is not inferred from call order.',
      'Worker links require a literal /studio/ URL passed directly to a resolved function parameter; messages are not correlated by ID or branch. Other worker construction remains unresolved.',
      'Import aliases are explicit deployment facts, not guessed module paths.',
      'Projection chooses the nearest containing authored component and collapses at most six call/handoff steps. Enclosed code is not individually explained. Repeated occurrences receive the same possible component relationships, not an inferred execution order between occurrences.',
      'Declaration inventory includes variables/classes/functions/methods and handlers plus anonymous callbacks; parameters and destructured bindings are scope-only. Native, generated and non-mjs source is outside extraction.']};
}
