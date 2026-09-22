// A function body is its own flow page: parameters in, the things it calls as components in
// call order, local def-use as wires, guards as gates, returns and throws out. Nothing here is
// authored; every element names the mechanism that produced it when that mechanism is not the
// plain AST. `flowPage` builds the full structure the renderer draws from; `flowPacket` is the
// lean agent read of the same page.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parse} from 'acorn';
import {extractGraph,sourceFiles} from './graph.mjs';
import {projectGraph,select} from './projection.mjs';
import {classify,functionAt,iterationMethods} from './shapes.mjs';
import {importAliases,scanRoots,isMapped} from './scope.mjs';

const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const kids=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
const clip=(s,n=72)=>s.length>n?s.slice(0,n-1)+'…':s;
const src=(text,n)=>clip(text.slice(n.start,n.end).replace(/\s+/g,' ').trim());
const name=p=>p.type==='Identifier'?p.name:p.type==='AssignmentPattern'?name(p.left):p.type==='RestElement'?`...${name(p.argument)}`
  :p.type==='ObjectPattern'?`{${p.properties.map(q=>q.type==='RestElement'?`...${name(q.argument)}`:q.key?.name??q.key?.value).join(',')}}`
  :p.type==='ArrayPattern'?`[${p.elements.map(e=>e?name(e):'').join(',')}]`:null;
const foot=n=>`${n.file.slice(n.file.lastIndexOf('/')+1)}:${n.line}-${n.endLine}`;
const linkOf=r=>r.resolvedBy??'ast-call-site';
// Call relations indexed by the site they were found at, built once per graph.
const targetIndex=new WeakMap();
function callTargets(graph) {
  const found=targetIndex.get(graph);if(found)return found;
  const map=new Map(),byId=new Set(graph.declarations.map(d=>d.id));
  for(const r of graph.relations)if(['call','construct'].includes(r.kind)&&byId.has(r.to)) {
    const at=`${r.evidence[0].file}:${r.evidence[0].start}:${r.evidence[0].end}`;
    (map.get(at)??map.set(at,[]).get(at)).push(r);
  }
  targetIndex.set(graph,map);return map;
}
const declarationIndex=new WeakMap();
function declarationsById(graph) {
  if(!declarationIndex.has(graph))declarationIndex.set(graph,new Map(graph.declarations.map(d=>[d.id,d])));
  return declarationIndex.get(graph);
}
const anchorIndex=new WeakMap();
function byAnchor(graph) {
  const found=anchorIndex.get(graph);if(found)return found;
  const map=new Map();
  for(const d of graph.declarations)if(d.anchor&&!d.ambiguousAnchor&&!map.has(d.anchor))map.set(d.anchor,d);
  anchorIndex.set(graph,map);return map;
}

// The identifiers a value could travel in: the argument itself, the base of a member chain,
// both branches of a choice, the members of a literal. Function arguments are not entered —
// their calls are their own sites. Identifier nodes, not names: a name is resolved in its scope.
function roots(n,out=[]) {
  if(!n)return out;
  if(n.type==='Identifier')out.push(n);
  else if(n.type==='MemberExpression')roots(n.object,out);
  else if(['AwaitExpression','ChainExpression','SpreadElement','UnaryExpression','YieldExpression','TSNonNullExpression'].includes(n.type))roots(n.argument??n.expression,out);
  else if(n.type==='ConditionalExpression'){roots(n.consequent,out);roots(n.alternate,out);}
  else if(n.type==='LogicalExpression'||n.type==='BinaryExpression'){roots(n.left,out);roots(n.right,out);}
  else if(n.type==='ObjectExpression')for(const p of n.properties)roots(p.value??p.argument,out);
  else if(n.type==='ArrayExpression')for(const e of n.elements)roots(e,out);
  else if(n.type==='TemplateLiteral')for(const e of n.expressions)roots(e,out);
  return out;
}
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

// Scopes inside the body being read, so def-use follows bindings rather than names: a name
// redeclared in a nested block or callback is a second binding and carries nothing from the first.
function scopeTree(fn) {
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
  function declarations(n,s) {
    if(n.type==='FunctionDeclaration'&&n.id)declare(s,n.id.name);
    if(n.type==='VariableDeclaration'&&n.kind!=='var')for(const d of n.declarations)for(const v of patternNames(d.id))declare(s,v);
    if(n.type==='ClassDeclaration'&&n.id)declare(s,n.id.name);
  }
  function walk(n,s) {
    if(functions.has(n.type)) {
      const inner=make(s,'function');
      for(const p of n.params)for(const v of patternNames(p))declare(inner,v);
      if(n.id&&n.type!=='FunctionDeclaration')declare(inner,n.id.name);
      scopeOf.set(n,inner);
      for(const c of kids(n))hoistVars(c,inner);
      for(const c of kids(n))walk(c,inner);
      return;
    }
    let inner=s;
    if(blocks.has(n.type)) {
      inner=make(s,'block');
      if(n.type==='CatchClause')for(const v of patternNames(n.param))declare(inner,v);
      for(const c of kids(n))declarations(c,inner);
      for(const c of [n.body?.body,n.consequent].find(Array.isArray)??[])declarations(c,inner);
    }
    scopeOf.set(n,inner);
    for(const c of kids(n))walk(c,inner);
  }
  const root=make(null,'function');
  for(const p of fn.params)for(const v of patternNames(p))declare(root,v);
  scopeOf.set(fn,root);
  for(const c of kids(fn))hoistVars(c,root);
  for(const c of kids(fn))walk(c,root);
  const find=(s,name)=>!s?null:s.names.get(name)??find(s.parent,name);
  return {binding:node=>node?.type==='Identifier'?find(scopeOf.get(node)??root,node.name):null,parameter:name=>root.names.get(name)??null};
}

// Which test stands between the enclosing code and this child, in the test's own words.
function optionalCallGate(n,text) {
  if(n.type!=='CallExpression')return null;
  const receiver=n.callee.type==='MemberExpression'&&n.callee.optional?n.callee.object:null;
  const conditions=[...(receiver?[receiver]:[]),...(n.optional?[n.callee]:[])];
  if(!conditions.length)return null;
  return {text:conditions.map(c=>`${src(text,c)} !== null && ${src(text,c)} !== undefined`).join(' && '),
    kind:n.optional?'optional-call':'optional-member'};
}
function gateFor(parent,child,text) {
  if(parent.type==='CallExpression'&&parent.arguments.includes(child)&&optionalCallGate(parent,text))
    return optionalCallGate(parent,text);
  if(parent.type==='IfStatement'&&parent.consequent===child)return {text:src(text,parent.test),kind:'if'};
  if(parent.type==='IfStatement'&&parent.alternate===child)return {text:`!(${src(text,parent.test)})`,kind:'else'};
  if(parent.type==='ConditionalExpression'&&parent.consequent===child)return {text:src(text,parent.test),kind:'ternary'};
  if(parent.type==='ConditionalExpression'&&parent.alternate===child)return {text:`!(${src(text,parent.test)})`,kind:'ternary'};
  if(parent.type==='LogicalExpression'&&parent.right===child)
    return {text:parent.operator==='||'?`!(${src(text,parent.left)})`:src(text,parent.left),kind:parent.operator};
  if(['ForStatement','WhileStatement'].includes(parent.type)&&parent.body===child&&parent.test)return {text:src(text,parent.test),kind:'loop'};
  if(['ForOfStatement','ForInStatement'].includes(parent.type)&&parent.body===child)
    return {text:`${parent.type==='ForOfStatement'?'of':'in'} ${src(text,parent.right)}`,kind:'loop'};
  // A case body can also run through fallthrough; its own case is not a proven guard.
  if(parent.type==='CatchClause'&&parent.body===child)return {text:'caught',kind:'catch'};
  return null;
}
// Keep every enclosing condition. `terms` preserves operator meaning (notably loop and
// nullish gates); the compound text is a compact display, not a rewritten JS predicate.
const shown=gates=>gates.length>1?{text:gates.map(g=>`(${g.text})`).join(' ∧ '),kind:'all',terms:gates.map(({text,kind,name,source})=>({text,kind,...(name?{name}:{}),...(source?{source}:{})}))}:gates[0]??null;
const guarded=g=>g?{...g,provenance:'ast-guard'}:null;
// A throw port is named by what the source throws: the constructor, with its first literal
// argument as written when it has one.
function thrown(n,text) {
  if(!n)return 'throw';
  if(['NewExpression','CallExpression'].includes(n.type)&&n.callee.type==='Identifier') {
    const first=n.arguments[0];
    return first&&['Literal','TemplateLiteral'].includes(first.type)?`${n.callee.name}(${src(text,first)})`:n.callee.name;
  }
  return src(text,n);
}
const directReturnCall=n=>{
  while(['AwaitExpression','ChainExpression'].includes(n?.type))n=n.argument??n.expression;
  if(n?.type!=='CallExpression')return null;
  const name=callee=>{if(callee.type==='Identifier')return callee.name;if(callee.type!=='MemberExpression'||callee.computed)return null;
    const owner=name(callee.object);return owner?`${owner}.${callee.property.name}`:null;};
  return name(n.callee);
};

// Closure-owned state. A factory's own `let`/`const` bindings are the state its members keep
// between calls, so they are nodes of the drawing wherever they are used: on the factory page
// once, wired to the members that share them, and on each member page with the reads and writes
// that member makes. A binding holding a callable is a declaration, not state, and a parameter
// is already a port.
const MUTATING_MEMBERS=new Set(['set','delete','clear','add','push','pop','shift','unshift','splice',
  'sort','reverse','fill','copyWithin','setDate','setTime']);
function ownedBindings(fnNode,keyOf) {
  const held=new Map();
  const site=n=>({line:n.loc.start.line,column:n.loc.start.column+1,endLine:n.loc.end.line,start:n.start,end:n.end});
  (function definitions(n,parent=null){
    if(n!==fnNode&&functions.has(n.type))return;
    if(n.type==='VariableDeclarator')for(const id of patternIds(n.id)) {
      const b=keyOf(id);if(!b||held.has(b))continue;
      held.set(b,{name:id.name,binding:parent?.kind??'let',source:site(id),
        callable:Boolean(n.init&&functions.has(n.init.type)),
        initial:!n.init?'undeclared-value':n.init.type==='NewExpression'?'constructed-value'
          :['Literal','ArrayExpression','ObjectExpression','TemplateLiteral'].includes(n.init.type)?'literal'
          :n.init.type==='CallExpression'?'nested-call':'computed-expression'});
    }
    for(const c of kids(n))definitions(c,n);
  })(fnNode);
  return held;
}
// How a body uses a binding it does not declare. Assigning the binding and mutating the object
// it holds are both writes of that state; everything else is a read. The walk stops where the
// map does: a declaration written inside this one has its own page and its own state wires.
function stateUses(body,keyOf,owned,stop) {
  const uses=new Map();
  const accessOf=(n,parents)=>{
    let top=n,above=parents.get(n);
    while(above?.type==='MemberExpression'&&above.object===top){top=above;above=parents.get(top);}
    if(above?.type==='AssignmentExpression'&&above.left===top)return top===n&&above.operator==='='?'write':'read-write';
    if(above?.type==='UpdateExpression'&&above.argument===top)return 'read-write';
    if(above?.type==='UnaryExpression'&&above.operator==='delete')return 'write';
    if(top!==n&&!top.computed&&above?.type==='CallExpression'&&above.callee===top
      &&MUTATING_MEMBERS.has(top.property?.name))return 'write';
    return 'read';
  };
  const parents=new Map();
  (function references(n,parent=null){
    if(n!==body&&stop.has(n.start))return;
    parents.set(n,parent);
    const propertyKey=parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed
      ||parent?.type==='Property'&&parent.key===n&&!parent.computed&&parent.value!==n;
    if(n.type==='Identifier'&&!propertyKey) {
      const b=keyOf(n),info=b&&owned.get(b);
      if(info&&!info.callable) {
        const access=accessOf(n,parents),row=uses.get(b)??uses.set(b,{...info,access:null,sites:[]}).get(b);
        row.access=row.access&&row.access!==access?'read-write':access;
        row.sites.push({node:n,access});
      }
    }
    for(const c of kids(n))references(c,n);
  })(body);
  return uses;
}
const childStops=node=>new Set(node.children.map(c=>c.start));

// The `this.` fields a span reads and writes, taken from the span's own AST.
function thisFields(ast,start,end) {
  const read=new Set(),written=new Set(),uncertainty=[],sites=[];
  const note=(field,access,n)=>sites.push({field,access,line:n.loc.start.line,endLine:n.loc.end.line,
    column:n.loc.start.column+1,endColumn:n.loc.end.column+1,start:n.start,end:n.end});
  let receiver='instance';
  const rootField=n=>{
    if(n?.type!=='MemberExpression')return null;
    while(n.object?.type==='MemberExpression')n=n.object;
    if(n.object?.type!=='ThisExpression')return null;
    if(n.property.type==='PrivateIdentifier')return `#${n.property.name}`;
    return n.computed?n.property.type==='Literal'?String(n.property.value):null:n.property.name;
  };
  (function walk(n,assigned,ownsThis=false) {
    if(n.end<start||n.start>end)return;
    if(n.start>=start&&n.end<=end) {
      if(n.type==='MethodDefinition'&&n.static)receiver='static';
      if(functions.has(n.type)) {
        if(ownsThis&&n.type!=='ArrowFunctionExpression')return;
        ownsThis=true;
      }
      if(ownsThis&&['ClassDeclaration','ClassExpression'].includes(n.type))return;
      const target=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'||n.type==='UnaryExpression'&&n.operator==='delete'?n.argument:null;
      const field=rootField(target);
      if(field){written.add(field);note(field,'write',n);}
      if(n.type==='CallExpression') {
        const receiverField=rootField(n.callee?.object);
        if(receiverField)uncertainty.push({kind:'nested-receiver-effect',line:n.loc.start.line,column:n.loc.start.column+1,field:receiverField});
      }
    }
    if(n.type==='MemberExpression'&&n.object.type==='ThisExpression') {
      const field=rootField(n);
      if(field){(assigned?written:read).add(field);note(field,assigned?'write':'read',n);}
      else uncertainty.push({kind:'computed-instance-field',line:n.loc.start.line,column:n.loc.start.column+1});
    }
    for(const c of kids(n))walk(c,c===n.left&&(n.type==='AssignmentExpression')||c===n.argument&&n.type==='UpdateExpression',ownsThis);
  })(ast,false);
  return {read,written,uncertainty,receiver,sites};
}

// A class page: its members as boxes, the calls and shared fields between them as wires, and
// every caller outside the class as a port.
function classPage(node,{graph,projection},ast,head,built=null) {
  const members=node.children;
  const inside=new Set();
  (function mark(n){inside.add(n.path);for(const c of n.children)mark(c);})(node);
  const spans=byAnchor(graph);
  const fields=new Map(members.map(m=>{const d=spans.get(m.path);return [m.path,d?thisFields(ast,d.start,d.end):{read:new Set(),written:new Set()}];}));
  // Writing a field while constructing is not state kept between calls; a member that writes
  // one after construction is. The construction's own field evidence still names those fields.
  const constructed=built?thisFields(ast,built.start,built.end):null;
  const stateful=members.some(m=>fields.get(m.path).written.size>0);
  const uncertainty=[...members.flatMap(m=>(fields.get(m.path).uncertainty??[]).map(u=>({...u,path:m.path}))),
    ...(constructed?.uncertainty??[]).map(u=>({...u,path:node.path}))];
  const candidates=new Map(),fieldId=(receiver,name)=>`field:${receiver}:${name}`;
  const source=n=>({file:node.file,line:n.loc.start.line,endLine:n.loc.end.line,column:n.loc.start.column+1,
    endColumn:n.loc.end.column+1,start:n.start,end:n.end});
  const candidate=(name,receiver,source,priority)=>{
    const id=fieldId(receiver,name),prior=candidates.get(id);
    if(!prior||priority<prior.priority||priority===prior.priority&&(source.start<prior.source.start||source.start===prior.source.start&&source.end>prior.source.end))
      candidates.set(id,{id,name,receiver,source,priority});
  };
  const declaration=spans.get(node.path);
  (function declarations(n){
    if(!declaration||n.end<declaration.start||n.start>declaration.end)return;
    if(['ClassDeclaration','ClassExpression'].includes(n.type)&&n.start>=declaration.start&&n.end<=declaration.end) {
      for(const field of n.body.body)if(field.type==='PropertyDefinition'&&(!field.computed||field.key.type==='Literal')) {
        const name=field.key.type==='PrivateIdentifier'?`#${field.key.name}`:String(field.key.name??field.key.value);
        candidate(name,field.static?'static':'instance',source(field),0);
      }
      return;
    }
    for(const child of kids(n))declarations(child);
  })(ast);
  for(const member of members)for(const {field,access,...site} of fields.get(member.path).sites??[])
    candidate(field,fields.get(member.path).receiver,{file:node.file,...site},access==='write'?2:3);
  // A field is usually named where construction sets it up, so that evidence is preferred.
  for(const {field,access,...site} of constructed?.sites??[])
    candidate(field,constructed.receiver,{file:node.file,...site},access==='write'?1:3);
  const wires=[],seen=new Set();
  const wire=w=>{const k=`${w.from}\n${w.to}\n${w.label}\n${w.kind}\n${w.source?.start??''}`;if(seen.has(k))return;seen.add(k);wires.push(w);};
  const mine=new Set(members.map(m=>m.path));
  const ports=new Map();
  for(const r of graph.relations) {
    if(!['call','construct'].includes(r.kind))continue;
    const to=projection.owner.get(r.to);if(!to||!inside.has(to.path))continue;
    const from=projection.owner.get(r.from);
    if(from&&inside.has(from.path)) {
      if(mine.has(from.path)&&mine.has(to.path)&&from!==to)wire({from:from.path,to:to.path,label:'',kind:'call',provenance:'ast-call-site'});
      continue;
    }
    if(!from||from.kind==='module')continue;
    // Constructing the class reaches the class itself; that caller is the page's own caller,
    // carried once as an incoming call rather than repeated as a wire to a member.
    let target=to===node?null:to;
    while(target&&!mine.has(target.path))target=target.parent;
    if(!target)continue;
    ports.set(from.path,{index:from.handle,path:from.path,label:from.path.slice(from.file.length+2),file:from.file});
    const at=r.evidence?.[0];
    wire({from:from.handle,to:target.path,label:r.kind==='construct'?'construct':'call',kind:'call',callKind:r.kind,...(r.possible?{possibleTarget:true}:{}),
      ...(at?{source:{file:at.file,line:at.line,endLine:at.endLine,column:at.column,start:at.start,end:at.end}}:{}),provenance:'ast-call-site'});
  }
  for(const a of members)for(const b of members) {
    if(a===b)continue;
    if(fields.get(a.path).receiver!==fields.get(b.path).receiver)continue;
    for(const field of fields.get(a.path).written)
      if(fields.get(b.path).read.has(field)||fields.get(b.path).written.has(field))
        wire({from:a.path,to:b.path,label:field,kind:'state',stateField:fieldId(fields.get(a.path).receiver,field),provenance:'ast-this-field'});
  }
  const usedFields=new Set(wires.map(w=>w.stateField).filter(Boolean));
  const stateFields=[...candidates.values()].filter(f=>usedFields.has(f.id)).map(({priority,...field})=>field);
  return {flow:true,generated:true,authored:[],node:head(node),inputs:[],outputs:[],requires:[],formulas:[],
    components:members.map((child,i)=>({...head(child),order:i+1,calls:0,links:['ast-member'],provenance:'ast-member',sites:[]})),
    ports:[...ports.values()].sort((a,b)=>a.index<b.index?-1:a.index>b.index?1:0),
    wires,external:[],unresolved:[],...(stateFields.length?{stateFields}:{}),...(stateful?{stateful:true}:{}),...(uncertainty.length?{uncertainty}:{} )};
}

export function flowPage({graph,projection,sources,asts,shapes},target) {
  const {node}=select(projection,target);
  if(!node||node.kind==='module')throw Error(`A flow page needs a function, method or class node; ${target} is not one.`);
  const declaration=byAnchor(graph).get(node.path)??(()=>{throw Error(`No declaration for ${node.path}.`);})();
  const text=sources.get(node.file)??(()=>{throw Error(`No source for ${node.file}.`);})();
  // A value the source has no expression for — the element an iteration method hands its
  // callback — is read as the element of the collection it comes from, not as that collection.
  const synthetic=new Map();
  const expression=n=>synthetic.get(n)??text.slice(n.start,n.end).trim();
  const display=n=>synthetic.get(n)??src(text,n);
  const sourceSite=n=>({file:node.file,line:n.loc.start.line,column:n.loc.start.column+1,start:n.start,end:n.end});
  const ast=asts?.get(node.file)??parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});
  const head=n=>({handle:n.handle,path:n.path,label:n.label,foot:foot(n),file:n.file,line:n.line,endLine:n.endLine,
    lines:n.endLine-n.line+1,kind:n.kind});

  // The function this node is: the declaration's own node, or the function it holds. A class has
  // no body of its own except its constructor, which is no node of its own: the class page is
  // that construction flow together with the members.
  const built=node.kind==='class'?byAnchor(graph).get(`${node.path}::constructor`)??null:null;
  const fn=functionAt(ast,declaration.start,declaration.end)
    ??(built?functionAt(ast,built.start,built.end):null);
  // What a class without a constructor is, is the members declared inside it, what they call in
  // each other, and the fields they share. A field one member writes and another reads is a
  // state wire between them, read off `this.` in each member's own span.
  if(!fn)return classPage(node,{graph,projection,asts},ast,head);
  const {binding,parameter}=scopeTree(fn);
  const key=n=>binding(n)?.id??null;

  // Call sites this node owns. A child node's body is its own page, so the walk stops there.
  const childFunctions=new Map(node.children.map(child=>{
    const d=byAnchor(graph).get(child.path);return [child.path,d?functionAt(ast,d.start,d.end):null];
  }));
  const stop=new Set(node.children.flatMap(c=>[c.start,...(childFunctions.get(c.path)?[childFunctions.get(c.path).start]:[])]));
  const sites=[],exits=[],uncertainty=[],uncertaintySeen=new Set(),parents=new WeakMap(),gatesAt=new WeakMap(),gateInputsAt=new WeakMap();
  const uncertain=(kind,n,details={})=>{
    const item={kind,line:n.loc.start.line,...details},key=JSON.stringify(item);
    if(!uncertaintySeen.has(key)){uncertaintySeen.add(key);uncertainty.push(item);}
  };
  const controls=new Set(['IfStatement','ConditionalExpression','LogicalExpression','ForStatement','ForOfStatement','ForInStatement',
    'WhileStatement','DoWhileStatement','SwitchStatement','TryStatement','CatchClause']);
  const targets=callTargets(graph),declarations=declarationsById(graph);

  // An iteration method runs the function it is handed once per element of its receiver, while
  // the call itself runs. So the callback is not a deferred body: it is a stage of this flow,
  // its parameter is the element, and the calls it makes are this function's calls. An inline
  // callback is entered here; a callback that names a declaration is a call of that declaration
  // with the element as its argument, and the edge for it was derived with the call sites.
  const iterationAt=new Map(),entered=new Set(),iterationGate=new Map();
  const iterationSpec=n=>{
    if(n.type!=='CallExpression'||n.callee.type!=='MemberExpression'||n.callee.computed||n.callee.property.type!=='Identifier')return null;
    const spec=iterationMethods.get(n.callee.property.name);
    if(!spec||n.arguments.length>spec.arity||n.arguments.some(a=>a.type==='SpreadElement'))return null;
    const handed=n.arguments[spec.callback];if(!handed)return null;
    const found=targets.get(`${node.file}:${n.start}:${n.end}`)??[];
    const callbacks=found.filter(r=>r.resolvedBy==='iteration-callback');
    // The method itself named mapped code, so this is that declaration's call, not an iteration.
    if(found.length!==callbacks.length)return null;
    const inline=functions.has(handed.type)&&!stop.has(handed.start)?handed:null;
    if(!inline&&!callbacks.length)return null;
    // What the callback calls each of its parameters, read off the callback itself.
    const named=spec.param.map((role,i)=>
      ((inline?inline.params[i]&&name(inline.params[i]):callbacks[0].params?.[i])??role).replace(/^\.\.\./,''));
    const receiver=n.callee.object,label=src(text,receiver),item=named[spec.param.indexOf('item')];
    // A callback that names a declaration is called with the values this stage holds, one
    // synthetic argument per parameter the method supplies: the element, and the accumulator.
    const slots=spec.param.map((role,i)=>({role,
      node:{type:'Identifier',name:named[i],start:receiver.start,end:receiver.end,loc:receiver.loc}}));
    for(const {role,node:slot} of slots)
      synthetic.set(slot,role==='item'?`${slot.name} of ${label}`:`${slot.name} so far`);
    const held={spec,handed,inline,receiver,label,callbacks,item,slots,
      accumulator:named[spec.param.indexOf('accumulator')],
      gate:{text:`of ${label}`,kind:'loop',name:label,source:{...sourceSite(receiver),endLine:receiver.loc.end.line}},
      element:slots[spec.param.indexOf('item')].node};
    return held;
  };
  (function iterations(n){
    if(n!==fn&&stop.has(n.start))return;
    const held=n.type==='CallExpression'?iterationSpec(n):null;
    if(held) {
      iterationAt.set(n,held);
      if(held.inline){entered.add(held.inline);iterationGate.set(held.inline,held.gate);}
    }
    for(const c of kids(n))iterations(c);
  })(fn);
  (function walk(n,gates,inner,controlled=false,gateInputs=[],nested=false){
    gatesAt.set(n,gates);
    gateInputsAt.set(n,gateInputs);
    if(n!==fn&&stop.has(n.start))return;
    if(n.type==='CallExpression'||n.type==='NewExpression') {
      const optionalGuard=optionalCallGate(n,text),optionalSubject=n.callee.type==='MemberExpression'&&n.callee.optional&&!n.optional?n.callee.object:n.callee;
      const optional=optionalGuard?{...optionalGuard,name:src(text,optionalSubject),source:{...sourceSite(optionalSubject),endLine:optionalSubject.loc.end.line}}:null;
      sites.push({node:n,gates:optional?[...gates,optional]:[...gates],inner,controlled:controlled||Boolean(optional)});
    }
    // A return or throw inside a nested callback leaves that callback, not this body.
    if(!nested&&n.type==='ReturnStatement')exits.push({kind:'return',node:n,value:n.argument,name:n.argument?src(text,n.argument):src(text,n),gate:shown(gates)});
    if(!nested&&n.type==='ThrowStatement')exits.push({kind:'throw',node:n,value:n.argument,name:thrown(n.argument,text),gate:shown(gates)});
    for(const c of kids(n)){
      parents.set(c,n);let g=gateFor(n,c,text);
      const condition=g?(n.test??(n.type==='LogicalExpression'?n.left:['ForOfStatement','ForInStatement'].includes(n.type)?n.right:n.type==='CallExpression'?n.callee:null)):null;
      if(g&&condition){
        const subject=['BinaryExpression','LogicalExpression'].includes(condition.type)?condition.left:condition;
        const named=['Identifier','MemberExpression'].includes(subject.type)?src(text,subject):subject.type==='CallExpression'?src(text,subject.callee):'condition';
        g={...g,name:named,source:{...sourceSite(condition),endLine:condition.loc.end.line}};
      }
      // An entered callback body runs once per element, like a loop body: its calls are this
      // function's calls, under the iteration's own gate.
      if(!g&&iterationGate.has(c))g=iterationGate.get(c);
      walk(c,g?[...gates,g]:gates,inner||(n!==fn&&functions.has(n.type)&&!entered.has(n)),
        controlled||controls.has(n.type)||entered.has(c),condition?[...gateInputs,condition]:gateInputs,
        nested||(n!==fn&&functions.has(n.type)));
    }
  })(fn,[],false);
  sites.sort((a,b)=>a.node.start-b.node.start);
  const siteAt=new Map(sites.map(site=>[`${site.node.start}:${site.node.end}`,site]));
  if(fn.body.type!=='BlockStatement')exits.push({kind:'return',node:fn.body,value:fn.body,name:src(text,fn.body),gate:null});

  // Components, in order of first appearance: a local closure where it is declared, any
  // other callee at its first call site. Assertions remain requirements. Computing a value
  // does not make a called function disappear: formula shape is metadata, not visibility.
  const components=new Map(),unlinked=[],requires=[],childAt=new Map(node.children.map(c=>[c.start,c]));
  for(const child of node.children)if(childFunctions.get(child.path))childAt.set(childFunctions.get(child.path).start,child);
  const rules=graph.callSites?.unlinked??{},externalRule=new Set(Object.keys(graph.callSites?.external??{}));
  // What a finding row can say beyond its rule: the registering declarations behind a
  // subscriber list, the known callables a still-unresolved site could reach.
  const siteNotes=graph.callSites?.notes??{};
  for(const child of node.children)components.set(child.path,{node:child,order:child.start,sites:[],links:new Set(['ast-closure'])});
  const assertionAt=(site,path)=>{
    const shape=shapes.assertions.get(path);if(!shape)return null;
    const condition=site.node.arguments[shape.condition],positionUnknown=site.node.arguments.slice(0,shape.condition+1).some(arg=>arg.type==='SpreadElement');
    let subject=condition;
    while(subject&&['BinaryExpression','LogicalExpression','UnaryExpression'].includes(subject.type))subject=subject.left??subject.argument;
    const name=subject&&['Identifier','MemberExpression'].includes(subject.type)?src(text,subject)
      :subject?.type==='CallExpression'?src(text,subject.callee):'condition';
    return {condition:{position:shape.condition+1,name:positionUnknown?'condition':name,
      ...(positionUnknown?{positionUnknown:true}:condition?{source:{...sourceSite(condition),endLine:condition.loc.end.line,endColumn:condition.loc.end.column+1}}:{omitted:true})},
      ...(shape.message>=0?{messagePosition:shape.message+1}:{})};
  };
  for(const site of sites) {
    const found=targets.get(`${node.file}:${site.node.start}:${site.node.end}`)??[];
    const receiver=site.node.callee.type==='MemberExpression'
      ?site.node.callee.object.type==='Identifier'?site.node.callee.object:site.node.callee.object.type==='ThisExpression'?site.node.callee.object:null:null;
    // Entering a callback does not identify the method that runs it: `xs.map` is still whatever
    // `xs` is, so the site keeps the row that says so, exactly as an inline callback's does.
    if(!found.some(r=>r.resolvedBy!=='iteration-callback')) {
      const at=`${node.file}:${site.node.start}:${site.node.end}`,rule=rules[at]??'unaccounted';
      unlinked.push({call:src(text,site.node.callee),line:site.node.loc.start.line,column:site.node.loc.start.column+1,
        state:externalRule.has(rule)?'external':'unresolved',rule,...(siteNotes[at]??{})});
      if(!found.length)continue;
    }
    for(const r of found) {
      const to=projection.owner.get(r.to);
      // A module node is the file, not a node of the map; a call into one names no step.
      if(!to||to===node||to.kind==='module')continue;
      const assertion=shapes.assertions.get(to.path);
      if(assertion) {
        const held=site.node.arguments[assertion.condition],said=site.node.arguments[assertion.message];
        const message=said?.type==='Literal'&&typeof said.value==='string'?said.value
          :said?.type==='TemplateLiteral'&&!said.expressions.length?said.quasis[0].value.cooked:null;
        requires.push({text:held?src(text,held):src(text,site.node),...(message?{message}:{}),
          line:site.node.loc.start.line,by:to.path,handle:to.handle,provenance:'ast-assertion'});
      }
      let c=components.get(to.path);
      if(!c)components.set(to.path,c={node:to,order:site.node.start,sites:[],links:new Set()});
      c.order=Math.min(c.order,site.node.start);
      // A callback an iteration method runs is handed the element, not the arguments written at
      // the call site, and the receiver of the method is nothing the callback is called on.
      const iteration=iterationAt.get(site.node);
      const handed=iteration?.callbacks.includes(r)?iteration:null;
      c.sites.push({...site,receiver:handed?null:receiver,relation:r,
        ...(handed?{iteration:handed,gates:[...site.gates,handed.gate]}:{}),
        args:handed?handed.slots.map(slot=>slot.node):site.node.arguments});
      c.links.add(linkOf(r));
    }
  }
  const order=[...components.values()].sort((a,b)=>a.order-b.order);
  order.forEach((c,i)=>{c.index=i+1;});

  // Wires. A parameter reaching a call is an input wire; a call result bound to a name and
  // later passed on is a data wire; a receiver called more than once is a state thread.
  const params=fn.params.map((p,i)=>({port:`in${i+1}`,name:name(p)??src(text,p),position:i+1,
    pattern:expression(p.type==='AssignmentPattern'?p.left:p),
    ...(p.type==='AssignmentPattern'?{default:expression(p.right)}:{}),...(p.type==='RestElement'?{rest:true}:{}),provenance:'ast-param'}));
  const ports=new Map();
  fn.params.forEach((p,i)=>{for(const v of patternNames(p)){const b=parameter(v);if(b)ports.set(b.id,{port:`in${i+1}`,label:v});}});
  // Interpret local binding definitions in evaluation order. Each expression keeps the
  // values reaching THAT use; a later assignment must never rewrite an earlier use.
  // Structured alternatives and iterations get explicit value-selection operators. The
  // graph never turns alternatives into execution order, and unsupported transfers stay unknown.
  const values=new WeakMap(),producers=n=>values.get(n)??[];
  const objectRecords=new Map();let nextObjectRecord=0;
  const invalidCollections=new Set();
  const collectionOf=list=>list?.length&&list.every(p=>p.collection&&!p.objectRecord&&!p.unknown
    &&p.collection.id===list[0].collection.id&&!invalidCollections.has(p.collection.id))?list[0].collection:null;
  const invalidateCollections=(list,env,n,kind)=>{
    for(const p of list)if(p.collection) {
      const id=p.collection.id;invalidCollections.add(id);
      for(const [b,value] of env)if(value.some(v=>v.collection?.id===id))env.set(b,[{unknown:src(text,n)}]);
      uncertain(kind,n,{binding:bindingName.get(p.collection.owner)??p.label??'',collection:p.collection.kind});
    }
  };
  const originGaps=(n,field='')=>{
    if(!n||functions.has(n.type))return [];
    if(n.type==='ObjectExpression')return n.properties.flatMap(p=>[
      ...(p.computed?originGaps(p.key,field?`${field}.[key]`:'[key]'):[]),
      ...originGaps(p.value??p.argument,[field,p.type==='SpreadElement'?'...':p.computed?`[${src(text,p.key)}]`:p.key.name??p.key.value].filter(x=>x!=='').join('.'))]);
    if(n.type==='ArrayExpression')return n.elements.flatMap((e,i)=>originGaps(e,`${field}[${i}]`));
    const value=producers(n);
    return [...(!value.length||value.some(p=>p.unknown)?[{node:n,field,expression:display(n)}]:[]),
      ...(n.type==='MemberExpression'&&n.computed?originGaps(n.property,field?`${field}.[key]`:'[key]'):[])];
  };
  const containsWrite=n=>['UpdateExpression','AssignmentExpression'].includes(n.type)||kids(n).some(containsWrite);
  const valueDescription=expression=>{
    const value=producers(expression),unknown=originGaps(expression).length>0;
    return {expression:display(expression),
      ...(!unknown&&!containsWrite(expression)&&value.length&&value.every(p=>p.constant!==undefined)?{constant:true}:{}),
      ...(unknown?{unknown:true}:{})};
  };
  const diagnoseOrigin=(kind,expression,details)=>{
    for(const gap of originGaps(expression))uncertain(kind,gap.node,{...details,...(gap.field?{field:gap.field}:{}),expression:gap.expression});
  };
  const operators=[],operatorWires=[];
  const operator=(kind,n,suffix,details)=>{
    const found=operators.find(o=>o.key===`${n.start}:${n.end}:${suffix}`);if(found)return found;
    const gate=['collection','update'].includes(kind)?guarded(shown(gatesAt.get(n)??[])):null;
    const op={id:`op${operators.length+1}`,key:`${n.start}:${n.end}:${suffix}`,kind,...sourceSite(n),
      endLine:n.loc.end.line,provenance:`ast-${kind}`,...(gate?{gate}:{}),...details};
    operators.push(op);return op;
  };
  const operatorInput=(op,port,list,extra={})=>{
    for(const p of list)if(p.end)operatorWires.push({from:p.end,to:op.id,label:p.label??'',kind:'data',
      ...(p.port?{fromPort:p.port}:{}),...(p.site?{sourceSite:p.site}:{}),toPort:port,provenance:`ast-${op.kind}`,...(op.gate?{gate:op.gate}:{}),...extra});
  };
  // Reading a repetition means guessing what it carries and reading its body; a guess that does
  // not hold has to be taken back, drawing and findings together, before the body is read again.
  const checkpoint=()=>({operators:operators.length,wires:operatorWires.length,captures:captureWires.length,
    findings:uncertainty.length,seen:[...uncertaintySeen],invalid:[...invalidCollections]});
  const restore=mark=>{
    operators.splice(mark.operators);operatorWires.splice(mark.wires);captureWires.splice(mark.captures);
    uncertainty.splice(mark.findings);uncertaintySeen.clear();for(const k of mark.seen)uncertaintySeen.add(k);
    invalidCollections.clear();for(const id of mark.invalid)invalidCollections.add(id);
  };
  const choice=(n,branches,details={})=>{
    if(branches.some(b=>!b.values.length||b.values.some(p=>p.unknown)))return null;
    const controlNode=n.test??n.left??(n.callee?.type==='MemberExpression'&&n.callee.optional&&!n.optional?n.callee.object:n.callee);
    const test=optionalCallGate(n,text)?.text??src(text,controlNode),op=operator('choice',n,details.binding??'result',{test,...details,
      alternatives:branches.map(b=>({port:b.port,expression:b.expression,
        ...(b.values.every(p=>p.constant!==undefined)?{constant:true}:{} )}))});
    const control=producers(controlNode);
    operatorInput(op,'control',control);
    if(!control.length||control.some(p=>p.unknown)) {
      op.controlUnknown=true;uncertain('choice-control',n,{operator:op.id,test});
    } else if(control.every(p=>p.constant!==undefined))op.controlConstant=src(text,controlNode);
    for(const b of branches)operatorInput(op,b.port,b.values,{expression:b.expression});
    return [{end:op.id,port:'selected',label:details.binding??src(text,n)}];
  };
  // Who supplied a callable: the innermost declaration holding the argument the value was
  // followed from. The argument may be the callable itself, so the holder above it is the
  // caller; a value passed at module level names its file instead.
  const declarationsInFile=new Map();
  const supplier=(at,target)=>{
    if(!at?.file)return null;
    if(!declarationsInFile.has(at.file))declarationsInFile.set(at.file,
      graph.declarations.filter(d=>d.file===at.file&&Number.isInteger(d.start)&&Number.isInteger(d.end)));
    let innermost=null;
    for(const d of declarationsInFile.get(at.file))
      if(d.start<=at.start&&at.end<=d.end&&(!innermost||d.start>=innermost.start&&d.end<=innermost.end))innermost=d;
    let found=innermost?projection.owner.get(innermost.id)??null:null;
    while(found&&found===target)found=found.parent??null;
    return found&&found.kind!=='module'?found:{file:at.file};
  };
  // Knowing that a parameter is invoked does not identify its concrete target.
  // Preserve that source-addressed call, its payload and optional control while
  // retaining the original parameter-target unresolved site. No alias inference.
  // Where callers could be followed to concrete callables, those callables are the callers'
  // own code, written and passed there: they are drawn on the caller's page and named here as
  // `parameterTargets` of this port. Either way the invocation itself is this one operator, so
  // the parameter's call, its arguments and its result keep their wires on this page.
  const parameterTargets=new Map(),parameterCallSites=new Set();
  const parameterInvocation=n=>{
    const site=siteAt.get(`${n.start}:${n.end}`),parameterPort=ports.get(key(n.callee));
    if(n.type!=='CallExpression'||n.callee.type!=='Identifier'||!parameterPort)return null;
    const at=`${node.file}:${n.start}:${n.end}`;
    const passed=(targets.get(at)??[]).filter(r=>r.viaParameter&&projection.owner.get(r.to)?.kind!=='module');
    if(rules[at]!=='parameter-target'&&!passed.length)return null;
    const callable=producers(n.callee);
    if(callable.length!==1||callable[0].end!==parameterPort.port)return null;
    const rows=parameterTargets.get(parameterPort.port)
      ??parameterTargets.set(parameterPort.port,[]).get(parameterPort.port);
    for(const r of passed) {
      const to=projection.owner.get(r.to);if(!to||to===node||rows.some(row=>row.path===to.path))continue;
      const from=supplier(r.resolution?.[0],to);
      rows.push({index:to.handle,path:to.path,file:to.file,line:to.line,endLine:to.endLine,
        ...(from?.handle?{from:from.handle,fromPath:from.path}:from?.file?{fromFile:from.file}:{}),
        ...(r.possible?{possible:true}:{})});
    }
    if(passed.length)parameterCallSites.add(`${n.start}:${n.end}`);
    const callee=src(text,n.callee),gates=[...(site?.gates??[])];
    const gate=guarded(shown(gates));
    const args=n.arguments.map((arg,i)=>({port:`arg${i+1}`,...valueDescription(arg),
      ...(arg.type==='ObjectExpression'?{fields:arg.properties.map(property=>({
        name:property.type==='SpreadElement'?'...':property.computed?src(text,property.key):String(property.key.name??property.key.value),
        ...valueDescription(property.value??property.argument)}))}:{})}));
    const op=operator('invocation',n,'parameter-call',{callee,optional:!!n.optional,
      ...(passed.length?{...(passed.length>1||passed.some(r=>r.possible)?{possibleTarget:true}:{})}:{targetUnknown:true}),
      ...(site?.inner?{executionUnknown:true}:{}),
      column:n.loc.start.column+1,start:n.start,end:n.end,arguments:args,
      ports:{inputs:['callable',...args.map(a=>a.port)],outputs:['result']},...(gate?{gate}:{})});
    operatorInput(op,'callable',callable,gate?{gate}:{});
    for(let i=0;i<n.arguments.length;i++) {
      operatorInput(op,`arg${i+1}`,producers(n.arguments[i]),{expression:args[i].expression,...(gate?{gate}:{})});
      diagnoseOrigin('argument-origin',n.arguments[i],{call:callee,argument:i+1});
    }
    return [{end:op.id,port:'result',label:src(text,n)}];
  };
  // A scanned declaration outside mapped roots is a known implementation, not
  // an unresolved callback. Keep its invocation local to this page; the target
  // has a source anchor but no invented canonical map address.
  const outsideInvocation=n=>{
    const relations=targets.get(`${node.file}:${n.start}:${n.end}`)??[];
    const outside=relations.map(relation=>({relation,declaration:declarations.get(relation.to)}))
      .filter(({declaration})=>declaration&&!isMapped(declaration.file));
    if(!outside.length)return null;
    const site=siteAt.get(`${n.start}:${n.end}`),callee=expression(n.callee),gate=guarded(shown(site?.gates??[]));
    const args=n.arguments.map((arg,i)=>({port:`arg${i+1}`,position:i+1,...valueDescription(arg),expression:expression(arg),
      ...(arg.type==='SpreadElement'?{spread:true}:{}),
      ...(n.arguments.slice(0,i+1).some(a=>a.type==='SpreadElement')?{positionUnknown:true}:{}),
      ...(arg.type==='ObjectExpression'?{fields:arg.properties.map(property=>({
        name:property.type==='SpreadElement'?'...':property.computed?expression(property.key):String(property.key.name??property.key.value),
        ...valueDescription(property.value??property.argument),expression:expression(property.value??property.argument)}))}:{})}));
    const possible=relations.length>1||outside.some(({relation})=>relation.possible);
    const op=operator('invocation',n,'outside-call',{callee,scope:'outside',callKind:n.type==='NewExpression'?'construct':'call',
      optional:!!n.optional,...(possible?{possibleTarget:true}:{}),...(site?.inner?{executionUnknown:true}:{}),
      targets:outside.map(({relation,declaration:d})=>({...(d.anchor&&!d.ambiguousAnchor?{path:d.anchor}:{}),label:d.name,
        file:d.file,line:d.line,endLine:d.endLine,...(relation.possible?{possible:true}:{})})),
      arguments:args,ports:{inputs:args.map(a=>a.port),outputs:['result']},...(gate?{gate}:{})});
    for(let i=0;i<n.arguments.length;i++) {
      operatorInput(op,`arg${i+1}`,producers(n.arguments[i]),{expression:args[i].expression,
        ...(args[i].spread?{spread:true}:{}),...(args[i].positionUnknown?{positionUnknown:true}:{}),...(gate?{gate}:{})});
      diagnoseOrigin('argument-origin',n.arguments[i],{call:callee,argument:i+1});
    }
    return [{end:op.id,port:'result',label:expression(n),site:sourceSite(n)}];
  };
  // Parameter identity can prove the receiver without proving its method target.
  // Only direct receivers and lexical const identifier aliases qualify.
  const parameterAliases=new Map();
  (function aliases(n){
    if(n!==fn&&(functions.has(n.type)||stop.has(n.start)))return;
    if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='Identifier'
      &&parents.get(n)?.kind==='const')parameterAliases.set(key(n.id),key(n.init));
    for(const c of kids(n))aliases(c);
  })(fn);
  const receiverParameter=b=>{
    const seen=new Set();
    while(b&&!seen.has(b)) {
      if(capturedBindings.has(b))return null;
      if(ports.has(b))return ports.get(b);
      seen.add(b);b=parameterAliases.get(b);
    }
    return null;
  };
  const parameterMemberInvocation=n=>{
    if(n.type!=='CallExpression'||n.callee.type!=='MemberExpression'||n.callee.object.type!=='Identifier')return null;
    const member=namedMember(n.callee),site=siteAt.get(`${n.start}:${n.end}`),receiver=n.callee.object;
    if(member===null||site?.inner||rules[`${node.file}:${n.start}:${n.end}`]!=='member-receiver-unresolved'
      ||targets.get(`${node.file}:${n.start}:${n.end}`)?.length)return null;
    const parameterPort=receiverParameter(key(receiver)),value=producers(receiver);
    if(!parameterPort||value.length!==1||value[0].end!==parameterPort.port||value[0].unknown||value[0].objectRecord||value[0].collection)return null;
    const callee=expression(n.callee),gate=guarded(shown(site?.gates??[]));
    const args=n.arguments.map((arg,i)=>({port:`arg${i+1}`,position:i+1,...valueDescription(arg),expression:expression(arg),
      ...(arg.type==='SpreadElement'?{spread:true}:{}),
      ...(n.arguments.slice(0,i+1).some(a=>a.type==='SpreadElement')?{positionUnknown:true}:{}),
      ...(arg.type==='ObjectExpression'?{fields:arg.properties.map(property=>({
        name:property.type==='SpreadElement'?'...':property.computed?expression(property.key):String(property.key.name??property.key.value),
        ...valueDescription(property.value??property.argument),expression:expression(property.value??property.argument)}))}:{})}));
    const op=operator('invocation',n,'parameter-member',{scope:'parameter-member',callee,receiver:receiver.name,member,targetUnknown:true,
      optional:!!optionalCallGate(n,text),...(n.callee.optional?{optionalReceiver:true}:{}),...(n.optional?{optionalCall:true}:{}),
      arguments:args,ports:{inputs:['receiver',...args.map(a=>a.port)],outputs:['result']},...(gate?{gate}:{})});
    operatorInput(op,'receiver',value);
    for(let i=0;i<n.arguments.length;i++) {
      operatorInput(op,`arg${i+1}`,producers(n.arguments[i]),{expression:args[i].expression,
        ...(args[i].spread?{spread:true}:{}),...(args[i].positionUnknown?{positionUnknown:true}:{})});
      diagnoseOrigin('argument-origin',n.arguments[i],{call:callee,argument:i+1});
    }
    return [{end:op.id,port:'result',label:expression(n),site:sourceSite(n)}];
  };
  const unique=list=>[...new Map(list.map(p=>[JSON.stringify(p),p])).values()];
  const initial=new Map([...ports].map(([b,p])=>[b,[{end:p.port,label:p.label}]]));
  const same=(a,b)=>JSON.stringify(a??[])===JSON.stringify(b??[]);
  const put=(pattern,value,env,preserveLabel=false)=>{
    if(['ObjectPattern','ArrayPattern'].includes(pattern?.type)&&value.some(p=>p.capturedReference)) {
      for(const part of pattern.type==='ObjectPattern'?pattern.properties:pattern.elements)if(part)
        put(part.type==='Property'?part.value:part,[{unknown:src(text,part)}],env,preserveLabel);
      return;
    }
    const records=new Set(value.map(p=>p.objectRecord).filter(Boolean));
    if(pattern?.type==='ObjectPattern'&&records.size) {
      const record=records.size===1&&value.every(p=>p.objectRecord)?objectRecords.get([...records][0]):null;
      if(record?.escaped)uncertain('record-escape',pattern,{expression:src(text,pattern),escapedAt:record.escaped.line});
      for(const property of pattern.properties) {
        const field=property.type==='Property'?(property.computed?property.key.type==='Literal'?String(property.key.value):null:String(property.key.name??property.key.value)):null;
        const selected=record&&!record.uncertain&&field!==null&&record.fields.has(field)?record.fields.get(field):[{unknown:src(text,property)}];
        put(property.value??property.argument,selected,env,preserveLabel);
      }
      return;
    }
    for(const id of patternIds(pattern))if(key(id)) {
      if(capturedBindings.has(key(id))&&value.some(p=>p.collection)) {
        invalidateCollections(value,env,id,'collection-capture');env.set(key(id),[{unknown:src(text,id)}]);continue;
      }
      const aliased=value.filter(p=>p.collection&&(p.objectRecord||p.collection.owner&&p.collection.owner!==key(id)));
      if(aliased.length){invalidateCollections(aliased,env,pattern,'collection-alias');env.set(key(id),[{unknown:src(text,pattern)}]);continue;}
      env.set(key(id),value.map(p=>({...p,label:preserveLabel?p.label??id.name:id.name,
        ...(p.collection?{collection:{...p.collection,owner:key(id)}}:{})})));
    }
  };
  const invalidateMember=(member,env,n)=>{
    const value=producers(member.object);
    invalidateCollections(value,env,n,'collection-member-write');
    for(const root of roots(member.object))if(key(root))env.set(key(root),[]);
    // Known aliases of the same object cannot keep claiming its pre-write value either.
    if(value.length)for(const [b,other] of env)if(other.some(p=>value.some(v=>v.end===p.end)))env.set(b,[]);
    uncertain('member-mutation',n,{binding:src(text,member)});
  };
  const merge=(env,branches,n,kind='branch-data-join',alternatives=null)=>{
    if(!branches.length)return;
    for(const b of new Set(branches.flatMap(e=>[...e.keys()]))) {
      const value=branches[0].get(b)??[];
      if(branches.every(e=>same(value,e.get(b))))env.set(b,value);
      else {
        const label=bindingName.get(b)??b;
        const joined=alternatives&&choice(n,branches.map((e,i)=>({port:alternatives[i],expression:label,values:e.get(b)??[]})),{binding:label});
        if(joined) {
          const collections=branches.map(e=>collectionOf(e.get(b))),collection=collections[0];
          env.set(b,collection&&collections.every(c=>c?.id===collection.id)?joined.map(p=>({...p,collection})):joined);
        } else {env.set(b,[]);uncertain(kind,n,{binding:label});}
      }
    }
  };
  const bindingName=new Map([...ports].map(([b,p])=>[b,p.label]));
  (function names(n){if(n.type==='Identifier'&&key(n))bindingName.set(key(n),n.name);for(const c of kids(n))names(c);})(fn);
  const outerBindings=new Set(),closureBindings=new Set();
  (function captures(n,inner=false){
    const nested=inner||n!==fn&&functions.has(n.type);
    if(n.type==='Identifier'&&key(n))(nested?closureBindings:outerBindings).add(key(n));
    for(const c of kids(n))captures(c,nested);
  })(fn);
  const capturedBindings=new Set([...closureBindings].filter(b=>outerBindings.has(b)));
  const captureBindings=new Map(),captureWrites=new Set(),captureMutations=new Set(),closureCaptures=new Map(),captureWires=[];
  const stateProducers=new Map();
  const bindingSource=n=>({...sourceSite(n),endLine:n.loc.end.line,endColumn:n.loc.end.column+1});
  for(const p of fn.params)for(const id of patternIds(p))captureBindings.set(key(id),{name:id.name,kind:'parameter',source:bindingSource(id)});
  (function definitions(n,parent=null){
    if(n!==fn&&functions.has(n.type)) {
      if(n.type==='FunctionDeclaration'&&n.id)captureBindings.set(key(n.id),{name:n.id.name,kind:'function',source:bindingSource(n.id)});
      return;
    }
    if(n.type==='VariableDeclarator')for(const id of patternIds(n.id))captureBindings.set(key(id),{name:id.name,kind:parent?.kind??'let',source:bindingSource(id)});
    for(const c of kids(n))definitions(c,n);
  })(fn);
  (function assignments(n){
    const assigned=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'?n.argument:null;
    for(const id of assigned?patternIds(assigned):[])if(key(id))captureWrites.add(key(id));
    if(assigned?.type==='MemberExpression')for(const id of roots(assigned.object))if(key(id))captureMutations.add(key(id));
    for(const c of kids(n))assignments(c);
  })(fn);
  const captureUses=new Map();
  for(const child of node.children) {
    const body=childFunctions.get(child.path),uses=new Map();if(!body)continue;
    (function references(n,parent=null){
      if(n!==body&&functions.has(n.type))return;
      const b=n.type==='Identifier'?key(n):null;
      const propertyKey=parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed
        ||parent?.type==='Property'&&parent.key===n&&!parent.computed&&parent.value!==n;
      if(b&&captureBindings.has(b)&&!propertyKey&&n!==body.id&&b!==key(body.id)) {
        const access=parent?.type==='AssignmentExpression'&&parent.left===n?(parent.operator==='='?'write':'read-write')
          :parent?.type==='UpdateExpression'&&parent.argument===n?'read-write':'read';
        const prior=uses.get(b);uses.set(b,prior&&prior!==access?'read-write':access);
      }
      for(const c of kids(n))references(c,n);
    })(body);
    captureUses.set(child.path,uses);
  }
  const captureClosure=(child,env)=>{
    const rows=closureCaptures.get(child.path)??new Map();closureCaptures.set(child.path,rows);
    for(const [b,access] of captureUses.get(child.path)??[]) {
      const info=captureBindings.get(b),value=env.get(b)??[],stable=['const','function','parameter'].includes(info.kind)&&!captureWrites.has(b);
      const known=stable&&value.length&&!value.some(p=>p.unknown);
      const previous=rows.get(b),row={name:info.name,access,source:info.source,reference:true,
        ...(!known?{valueUnknown:true}:{}),...(!stable?{lifetimeUnknown:true}:{}),...(captureMutations.has(b)?{mutationUnknown:true}:{})};
      rows.set(b,previous&&!previous.valueUnknown?previous:row);
      if(!known)continue;
      // What the factory's own initialisation put in the binding, kept so the state node can be
      // wired to it once instead of once per member.
      if(!stateProducers.has(b))stateProducers.set(b,value);
      for(const p of value)if(p.end)captureWires.push({binding:b,from:p.end,to:child.path,label:info.name,kind:'capture',toPort:`capture:${info.name}`,
        ...(p.port?{fromPort:p.port}:{}),...(p.site?{sourceSite:p.site}:{}),provenance:'ast-closure-capture'});
    }
  };
  const written=n=>{
    const found=new Set();
    (function walk(s){
      if(s!==n&&(functions.has(s.type)||stop.has(s.start)))return;
      const lhs=s.type==='AssignmentExpression'?s.left:s.type==='UpdateExpression'?s.argument:null;
      for(const id of lhs?patternIds(lhs):[])if(key(id))found.add(key(id));
      for(const c of kids(s))walk(c);
    })(n);
    return found;
  };
  const namedMember=n=>n?.type==='MemberExpression'?(n.computed?n.property.type==='Literal'?String(n.property.value):null:n.property.name):null;
  const addOperatorValue=(op,port,value,n)=>{
    operatorInput(op,port,value);
    (op.arguments??=[]).push({port,expression:expression(n)});
    const constants=value.filter(p=>p.constant!==undefined).map(p=>p.constant);
    if(constants.length===value.length&&constants.length)(op.constants??={})[port]=constants;
    if(!value.length||value.some(p=>p.unknown)) {
      (op.unknownInputs??=[]).push(port);uncertain(`${op.kind}-input`,n,{operator:op.id,input:port});
    }
  };
  const projectionCallback=n=>{
    if(n?.type!=='ArrowFunctionExpression'||n.async||n.params.length!==1||n.params[0].type!=='Identifier')return false;
    let selected=n.body;
    while(selected.type==='MemberExpression'&&!selected.optional&&(!selected.computed||selected.property.type==='Literal'))selected=selected.object;
    return selected.type==='Identifier'&&key(selected)===key(n.params[0]);
  };
  const collectionCallSpec=(n,env)=>{
    if(n.type!=='CallExpression'||n.callee.type!=='MemberExpression'||n.callee.object.type!=='Identifier')return null;
    const collection=collectionOf(env.get(key(n.callee.object))),operation=namedMember(n.callee);
    if(!collection||n.arguments.some(a=>a.type==='SpreadElement'))return null;
    if(collection.kind==='map'&&((operation==='get'&&n.arguments.length===1)||(operation==='set'&&n.arguments.length===2))
      ||collection.kind==='array'&&(operation==='push'||operation==='map'&&n.arguments.length===1&&projectionCallback(n.arguments[0])))
      return {collection,operation,receiver:n.callee.object};
    return null;
  };
  const createCollection=(n,kind,items=[])=>{
    const op=operator('collection',n,'create',{collection:kind,operation:'create',initial:expression(n),
      ports:{inputs:items.length?['items']:[],outputs:['state']}});
    if(items.length)addOperatorValue(op,'items',items,n);
    return [{end:op.id,port:'state',collection:{kind,id:`${node.file}:${n.start}`,owner:null}}];
  };
  const applyCollectionCall=(n,spec,env)=>{
    const {collection,operation,receiver}=spec,state=env.get(key(receiver))??[],args=n.arguments.map(producers);
    if(collectionOf(state)?.id!==collection.id) {
      uncertain('collection-receiver-update',n,{binding:receiver.name});return [{unknown:src(text,n)}];
    }
    const argPorts=operation==='get'?['key']:operation==='set'?['key','value']:operation==='push'?args.map((_,i)=>`item${i+1}`):[];
    const mutation=operation==='set'||operation==='push';
    const op=operator('collection',n,operation,{collection:collection.kind,operation,binding:receiver.name,
      ...(operation==='map'?{projection:expression(n.arguments[0])}:{}),
      ports:{inputs:['state',...argPorts],outputs:mutation?['state','result']:['result']}});
    addOperatorValue(op,'state',state,receiver);
    for(let i=0;i<argPorts.length;i++)addOperatorValue(op,argPorts[i],args[i],n.arguments[i]);
    if(mutation)env.set(key(receiver),[{end:op.id,port:'state',label:receiver.name,collection}]);
    for(let i=0;i<argPorts.length;i++)invalidateCollections(args[i],env,n,'collection-escape');
    return [{end:op.id,port:'result',...(operation==='set'?{collection}:operation==='map'?{collection:{kind:'array',id:`${node.file}:${n.start}`,owner:null}}:{})}];
  };
  // What a repeated body does to the bindings around it: the ones it writes, collection
  // mutations included, and the collections whose identity it does not keep — passed on, held
  // by a nested function, or reached by an operation this reader has no model for.
  const bodyEffects=(n,env)=>{
    const changed=written(n),unsafe=new Set();
    (function effects(s){
      if(s!==n&&stop.has(s.start))return;
      if(s.type==='CallExpression') {
        const receiver=s.callee.type==='MemberExpression'&&s.callee.object.type==='Identifier'?s.callee.object:null;
        const collection=receiver&&collectionOf(env.get(key(receiver))),operation=namedMember(s.callee);
        if(collection&&(collection.kind==='map'&&operation==='set'||collection.kind==='array'&&operation==='push'))changed.add(key(receiver));
        for(const arg of s.arguments)for(const root of roots(arg))if(collectionOf(env.get(key(root))))unsafe.add(key(root));
        if(collection&&!collectionCallSpec(s,env))unsafe.add(key(receiver));
      }
      if(s!==n&&functions.has(s.type)) {
        (function captures(t){if(t.type==='Identifier'&&collectionOf(env.get(key(t))))unsafe.add(key(t));for(const c of kids(t))captures(c);})(s);
        return;
      }
      for(const c of kids(s))effects(c);
    })(n);
    return {changed,unsafe};
  };
  // What a callback leaves: the expression an arrow is, or every return its own body makes.
  const callbackReturns=cb=>{
    if(cb.body.type!=='BlockStatement')return producers(cb.body);
    const out=[];
    (function returns(s){
      if(s!==cb&&functions.has(s.type))return;
      if(s.type==='ReturnStatement'){if(s.argument)out.push(...producers(s.argument));return;}
      for(const c of kids(s))returns(c);
    })(cb);
    return unique(out);
  };
  // One stage: the elements of the receiver in, the callback's work per element, the method's
  // own value out. An inline callback is traced here, with the element as its parameter; a
  // callback that names a declaration is drawn as a call of it and its result comes back from
  // that box. An accumulator is loop-carried, exactly as a loop's own accumulation is.
  const applyIterationCall=(n,held,env)=>{
    const {spec,inline,receiver,item,label,element,slots}=held;
    const iterable=evaluate(receiver,env);
    evaluate(n.callee,env);
    const initial=spec.initial!==undefined&&n.arguments[spec.initial]?evaluate(n.arguments[spec.initial],env):null;
    const carriedAt=spec.param.indexOf('accumulator');
    const binding=carriedAt<0?null:held.accumulator;
    const op=operator('iteration',n,`callback:${spec.method}`,{mode:'elements',method:spec.method,item,
      test:`of ${label}`,minIterations:0,callback:expression(held.handed),...(binding?{binding}:{}),
      ports:{inputs:['iterable',...(carriedAt<0?spec.feed?[spec.feed]:[]:['initial','next'])],
        outputs:['item',...(carriedAt<0?spec.produces?['result']:[]:['current','final'])]}});
    const known=iterable.length&&!iterable.some(p=>p.unknown);
    if(known)operatorInput(op,'iterable',iterable);
    else {
      // With no collection to read the element from, the element is the iteration's own variable
      // and nothing more: it is named as one, so the slots it feeds read as loop variables.
      op.iterationSourceUnknown=true;synthetic.set(element,item);
      uncertain('iteration-source',n,{iterable:label,binding:item});
    }
    const elements=known?[{end:op.id,port:'item',label:item}]:[{unknown:label,label:item}];
    const carried=carriedAt<0?null:[{end:op.id,port:'current',label:binding}];
    for(const slot of slots)values.set(slot.node,slot.role==='accumulator'?carried:elements);
    if(carriedAt>=0) {
      if(initial)operatorInput(op,'initial',initial);
      if(!initial||!initial.length||initial.some(p=>p.unknown)) {
        op.initialUnknown=true;uncertain('iteration-input',n,{operator:op.id,input:'initial'});
      }
    }
    invalidateCollections([...iterable,...(initial??[])],env,n,'collection-escape');
    let returned=[];
    if(inline) {
      // A binding the callback writes holds a different value on every element, which is what
      // an accumulator is: the same shape a loop body gets, on this operator's own call node.
      const {changed,unsafe}=bodyEffects(inline,env);
      const carriable=[...changed].filter(b=>env.has(b)),demoted=new Set();
      const mark=checkpoint();
      let accumulators=new Map(),inner=new Map(env);
      for(;;) {
        restore(mark);accumulators=new Map();inner=new Map(env);
        for(const b of carriable) {
          const incoming=env.get(b)??[],label=bindingName.get(b)??b;
          if(!demoted.has(b)&&!unsafe.has(b)) {
            const acc=operator('iteration',n,b,{binding:label,method:spec.method,test:`of ${held.label}`,minIterations:0,
              ports:{inputs:['initial','next'],outputs:['current','final']}});
            accumulators.set(b,acc);operatorInput(acc,'initial',incoming);
            if(!incoming.length||incoming.some(p=>p.unknown)) {
              acc.initialUnknown=true;uncertain('iteration-input',n,{operator:acc.id,input:'initial'});
            }
            const collection=collectionOf(incoming);
            inner.set(b,[{end:acc.id,port:'current',label,...(collection?{collection}:{})}]);
          } else {inner.set(b,[]);uncertain('loop-data-flow',n,{binding:label,
            reason:demoted.has(b)?'unknown-next':'unsafe-collection'});}
        }
        // A collection the callback reaches and this stage does not carry loses its identity
        // there: it is read or written once per element with nothing to say which.
        (function captures(s){
          if(s.type==='Identifier'&&!accumulators.has(key(s)))invalidateCollections(env.get(key(s))??[],env,n,'collection-capture');
          for(const c of kids(s))captures(c);})(inline.body);
        inline.params.forEach((p,i)=>put(p,spec.param[i]==='item'?elements:spec.param[i]==='accumulator'&&carried?carried:[{unknown:src(text,p)}],inner));
        statement(inline.body,inner);
        const failed=[...accumulators.keys()].filter(b=>!(inner.get(b)?.length)||inner.get(b).some(p=>p.unknown));
        if(!failed.length)break;
        for(const b of failed)demoted.add(b);
      }
      values.set(inline,[]);
      returned=callbackReturns(inline);
      for(const [b,acc] of accumulators) {
        operatorInput(acc,'next',inner.get(b));
        const collection=collectionOf(inner.get(b));
        env.set(b,[{end:acc.id,port:'final',label:acc.binding,...(collection?{collection}:{})}]);
      }
      for(const b of changed)if(env.has(b)&&!accumulators.has(b))env.set(b,[]);
    } else returned=held.callbacks.map(r=>projection.owner.get(r.to))
      .filter(t=>t&&t!==node&&t.kind!=='module').map(t=>({end:t.path,site:sourceSite(n)}));
    if(spec.feed) {
      operatorInput(op,spec.feed,returned);
      if((!returned.length||returned.some(p=>p.unknown))&&['value','next'].includes(spec.feed)) {
        (op.unknownInputs??=[]).push(spec.feed);uncertain('iteration-input',n,{operator:op.id,input:spec.feed});
      }
    }
    if(!spec.produces)return [{constant:'undefined'}];
    return [{end:op.id,port:carriedAt<0?'result':'final',label:src(text,n)}];
  };
  // An assignment that reads the binding it writes is an update of that binding, whatever
  // computes it: `max=Math.max(max,d)` has `max+=d`'s shape with another operation, so it is
  // drawn as one — `prior` what the binding held, `value` the other operands, the expression
  // as the operation. Only where the expression has no producer of its own, so a call the walk
  // resolved keeps its own wire into the binding instead of an operator in front of it.
  const updateOperands=n=>
    ['CallExpression','NewExpression'].includes(n.type)?{operation:`${expression(n.callee)}()`,operands:n.arguments}
    :n.type==='BinaryExpression'?{operation:n.operator,operands:[n.left,n.right]}
    :n.type==='ArrayExpression'?{operation:'[…]',operands:n.elements.filter(Boolean).map(e=>e.type==='SpreadElement'?e.argument:e)}
    :n.type==='ObjectExpression'?{operation:'{…}',operands:n.properties.map(p=>p.value??p.argument)}
    :n.type==='TemplateLiteral'?{operation:'`…`',operands:n.expressions}:null;
  const selfUpdate=n=>{
    const b=n.left.type==='Identifier'?key(n.left):null,shape=b&&updateOperands(n.right);
    if(!shape)return null;
    const reads=o=>roots(o).some(id=>key(id)===b);
    if(!shape.operands.some(o=>o&&reads(o)))return null;
    return {operation:shape.operation,expression:expression(n.right),
      value:unique(shape.operands.filter(o=>o&&!reads(o)).flatMap(producers))};
  };
  const updateValue=(n,prior,value,binding,prefix=true,shape=null)=>{
    const op=operator('update',n,'value',{operation:shape?.operation??n.operator,binding,prefix,
      ports:{inputs:['prior','value'],outputs:['next','result']}});
    addOperatorValue(op,'prior',prior,n);addOperatorValue(op,'value',value,n);
    op.arguments=[{port:'prior',expression:binding},
      {port:'value',expression:shape?.expression??(n.type==='UpdateExpression'?'1':expression(n.right))}];
    return {next:[{end:op.id,port:'next',label:binding}],result:[{end:op.id,port:'result',label:src(text,n)}]};
  };
  const evaluate=(n,env)=>{
    if(!n)return [];
    if(n!==fn&&stop.has(n.start)) {
      const child=childAt.get(n.start),at=n.type==='ExpressionStatement'?n.expression:n;
      const value=child?[{end:child.path,port:'callable'}]:[];
      const lhs=at.type==='VariableDeclarator'?at.id:at.type==='AssignmentExpression'?at.left:null;
      if(lhs)put(lhs,value,env);
      if(child)captureClosure(child,env);
      values.set(n,value);return value;
    }
    let result=[];
    if(functions.has(n.type)) {
      // A callback may run later or repeatedly. Captured mutable bindings have no known
      // reaching definition at its execution time; its own locals can still be followed.
      uncertain('callback-execution',n);
      (function captures(s){if(s.type==='Identifier')invalidateCollections(env.get(key(s))??[],env,n,'collection-capture');for(const c of kids(s))captures(c);})(n.body);
      const inner=new Map([...env.keys()].map(b=>{
        const info=captureBindings.get(b);
        if(!info||!['const','function','parameter'].includes(info.kind)||captureWrites.has(b))return [b,[]];
        // The lexical reference survives deferred execution; its object contents do
        // not. Literal-record/collection producers describe contents, not identity.
        const input=info.kind==='parameter'?ports.get(b):null;
        const value=input?[{end:input.port,label:input.label}]:env.get(b);
        return [b,(value??[]).map(p=>p.objectRecord||p.collection?{unknown:info.name}
          :p.end?{...p,capturedReference:true}:p)];
      }));
      statement(n.body,inner);values.set(n,[]);return [];
    }
    // Module target resolution is separate from a runtime namespace value. The
    // literal import specifier is never the value of the imported callable.
    if(n.type==='ImportExpression')result=[{unknown:src(text,n)}];
    else if(n.type==='Literal')result=[{constant:src(text,n)}];
    else if(n.type==='Identifier') {
      result=env.get(key(n))??(!key(n)&&['undefined','Infinity'].includes(n.name)?[{constant:n.name}]:[{unknown:src(text,n)}]);
      for(const p of result)if(p.port==='callable') {
        const child=node.children.find(c=>c.path===p.end);if(child)captureClosure(child,env);
      }
    }
    else if(n.type==='VariableDeclarator') {result=evaluate(n.init,env);put(n.id,result,env);}
    else if(n.type==='AssignmentExpression') {
      const before=evaluate(n.left,env),rhs=evaluate(n.right,env);
      const self=n.operator==='='&&(!rhs.length||rhs.some(p=>p.unknown))?selfUpdate(n):null;
      result=self?updateValue(n,before,self.value,n.left.name,true,self).next
        :n.operator==='='?rhs
        :n.left.type==='Identifier'&&!['&&=','||=','??='].includes(n.operator)?updateValue(n,before,rhs,n.left.name).next:[{unknown:src(text,n)}];
      if(n.left.type==='MemberExpression')invalidateMember(n.left,env,n);
      else put(n.left,result,env);
    } else if(n.type==='UpdateExpression') {
      const before=evaluate(n.argument,env);result=before;
      if(n.argument.type==='MemberExpression')invalidateMember(n.argument,env,n);
      else {const updated=updateValue(n,before,[{constant:'1'}],n.argument.name,n.prefix);put(n.argument,updated.next,env);result=updated.result;}
    } else if(n.type==='ConditionalExpression'||n.type==='LogicalExpression') {
      const test=n.test??n.left,left=n.consequent??n.right,right=n.alternate;
      const tested=evaluate(test,env),a=new Map(env),b=new Map(env);
      const av=evaluate(left,a),bv=right?evaluate(right,b):tested;
      const arms=n.type==='ConditionalExpression'?['true','false']:n.operator==='&&'?['truthy','falsy']
        :n.operator==='||'?['falsy','truthy']:['nullish','present'];
      merge(env,[a,b],n,'branch-data-join',arms);
      if(same(av,bv))result=av;
      else {
        const joined=choice(n,[{port:arms[0],expression:src(text,left),values:av},
          {port:arms[1],expression:src(text,right??test),values:bv}]);
        if(joined)result=joined;else uncertain('branch-result',n);
      }
    } else if(n.type==='CallExpression'||n.type==='NewExpression') {
      const spec=collectionCallSpec(n,env),local=parents.get(n);
      if(n.type==='NewExpression'&&n.callee.type==='Identifier'&&n.callee.name==='Map'&&!n.arguments.length
        &&rules[`${node.file}:${n.start}:${n.end}`]==='unbound-callee'&&local?.type==='VariableDeclarator'&&local.id.type==='Identifier') {
        result=createCollection(n,'map');values.set(n,result);return result;
      }
      const held=spec?null:iterationAt.get(n);
      if(held){result=applyIterationCall(n,held,env);values.set(n,result);return result;}
      evaluate(n.callee,env);
      const optional=!!optionalCallGate(n,text),argEnv=optional?new Map(env):env;
      const args=(n.arguments??[]).flatMap(a=>spec?.operation==='map'?[]:evaluate(a,argEnv));
      if(spec)result=applyCollectionCall(n,spec,argEnv);
      // An arbitrary call can retain or mutate an object passed to it, including
      // through its receiver. Earlier read snapshots remain valid; subsequent
      // field reads must no longer use the literal's original property values.
      const escaped=[...args,...(n.callee.type==='MemberExpression'?producers(n.callee.object):[])];
      for(const p of spec?[]:escaped)if(p.objectRecord) {
        const record=objectRecords.get(p.objectRecord);record.uncertain=true;record.escaped=sourceSite(n);
      }
      if(!spec)invalidateCollections(escaped,argEnv,n,'collection-escape');
      const to=(targets.get(`${node.file}:${n.start}:${n.end}`)??[]).map(r=>projection.owner.get(r.to)).filter(t=>t&&t!==node&&t.kind!=='module');
      const drawn=to;
      if(!spec){
        const outside=outsideInvocation(n);
        // A call on this function's own parameter is the parameter's invocation, whether or not
        // the callables callers pass could be followed: those are the caller's boxes, not this
        // page's, so the operator is the result here.
        const viaParameter=outside?null:parameterInvocation(n);
        result=viaParameter??(drawn.length?[...drawn.map(t=>({end:t.path,site:sourceSite(n)})),...(outside??[])]
          :outside??(to.length?args:parameterMemberInvocation(n)??[{unknown:src(text,n)}]));
      }
      if(optional)merge(env,[argEnv,new Map(env)],n,'optional-argument-state',['present','nullish']);
    } else if(n.type==='MemberExpression') {
      const object=evaluate(n.object,env),records=new Set(object.map(p=>p.objectRecord).filter(Boolean));
      const property=n.computed?n.property.type==='Literal'?String(n.property.value):null:n.property.name;
      const collection=collectionOf(object);
      if(object.some(p=>p.capturedReference)) {
        result=[{unknown:src(text,n)}];
      } else if(collection&&(collection.kind==='map'&&property==='size'||collection.kind==='array'&&property==='length')) {
        const op=operator('collection',n,property,{collection:collection.kind,operation:property,binding:src(text,n.object),
          ports:{inputs:['state'],outputs:['result']}});
        addOperatorValue(op,'state',object,n.object);result=[{end:op.id,port:'result'}];
      } else if(records.size) {
        const record=records.size===1&&object.every(p=>p.objectRecord)?objectRecords.get([...records][0]):null;
        if(record?.escaped)uncertain('record-escape',n,{expression:src(text,n),escapedAt:record.escaped.line});
        result=record&&!record.uncertain&&property!==null&&record.fields.has(property)?record.fields.get(property):[{unknown:src(text,n)}];
      } else result=object;
      result=result.map(p=>({...p,label:src(text,n)}));if(n.computed)result.push(...evaluate(n.property,env));
    } else if(n.type==='SequenceExpression')for(const e of n.expressions)result=evaluate(e,env);
    else if(n.type==='ArrayExpression') {
      const items=n.elements.flatMap(e=>evaluate(e,env)),local=parents.get(n);
      result=local?.type==='VariableDeclarator'&&local.id.type==='Identifier'?createCollection(n,'array',items):items;
    }
    else if(n.type==='ObjectExpression') {
      const record={fields:new Map(),uncertain:false};
      for(const p of n.properties) {
        if(p.computed)result.push(...evaluate(p.key,env));
        const value=evaluate(p.value??p.argument,env);result.push(...value);
        const field=p.type==='Property'?(p.computed?p.key.type==='Literal'?String(p.key.value):null:String(p.key.name??p.key.value)):null;
        if(field===null||field==='__proto__'||p.kind!=='init')record.uncertain=true;
        else record.fields.set(field,value);
      }
      const objectRecord=++nextObjectRecord;objectRecords.set(objectRecord,record);
      result=(result.length?result:[{constant:'{}'}]).map(p=>({...p,objectRecord}));
    }
    else for(const c of kids(n))result.push(...evaluate(c,env));
    result=unique(result);values.set(n,result);return result;
  };
  const statement=(n,env)=>{
    if(!n)return true;
    if(n!==fn&&stop.has(n.start)){evaluate(n,env);return true;}
    if(n.type==='BlockStatement') {
      for(const s of n.body)if(s.type==='FunctionDeclaration') {
        const child=childAt.get(s.start);if(child&&s.id)put(s.id,[{end:child.path,port:'callable'}],env);
      }
      for(const s of n.body)if(!statement(s,env))return false;
    } else if(n.type==='IfStatement') {
      evaluate(n.test,env);
      const a=new Map(env),b=new Map(env),aliveA=statement(n.consequent,a),aliveB=statement(n.alternate,b);
      merge(env,[...(aliveA?[a]:[]),...(aliveB?[b]:[])],n,'branch-data-join',aliveA&&aliveB?['true','false']:null);
      if(aliveA!==aliveB)uncertain('early-exit-control',n);
      return aliveA||aliveB;
    } else if(['ForStatement','ForOfStatement','ForInStatement','WhileStatement','DoWhileStatement'].includes(n.type)) {
      if(n.init)evaluate(n.init,env);
      const {changed,unsafe:unsafeCollections}=bodyEffects(n,env),loop=new Map(env);
      // Two kinds of shape. A BLOCKER means the value at the backedge is not this walk's to
      // know at all, so nothing is carried. A PARTIAL shape — a nested loop, break, continue,
      // throw, switch, try, a write through a member — leaves the normal-completion path
      // readable: those statements either end the path the walk is on (so the merge drops it)
      // or blank the bindings they touch, and a binding left without a value at the backedge
      // is discarded below. The accumulator says so with `backedge: normal-completion`.
      let hasReturn=false,hasBreak=false;
      const blockers=new Set(),partial=new Set(n.await?['await-iteration']:[]);
      const nestedLoops=[];
      (function inspect(s){
        if(s!==n&&(functions.has(s.type)||stop.has(s.start)))return;
        if(s!==n&&['ForStatement','ForOfStatement','ForInStatement','WhileStatement','DoWhileStatement'].includes(s.type)) {
          partial.add(s.await?'await-iteration':'nested-loop');
          nestedLoops.push(s);
        }
        if(s.type==='ReturnStatement'){
          hasReturn=true;
          if(n.type!=='ForStatement'||nestedLoops.some(loop=>s.start>=loop.start&&s.end<=loop.end))blockers.add('return-in-body');
        }
        if(['BreakStatement','ContinueStatement'].includes(s.type)) {
          partial.add('control-transfer');if(s.type==='BreakStatement')hasBreak=true;
        }
        if(['ThrowStatement','SwitchStatement','TryStatement'].includes(s.type))
          partial.add(s.type==='ThrowStatement'?'throw-in-body':s.type==='SwitchStatement'?'switch-in-body':'try-in-body');
        if(s.type==='AwaitExpression')partial.add('await-in-body');
        if(s.type==='YieldExpression')blockers.add('yield-in-body');
        if(s.type==='AssignmentExpression'&&s.left.type==='MemberExpression')partial.add('member-write');
        for(const child of kids(s))inspect(child);
      })(n);
      let structured=!blockers.size;
      // A method call on a receiver inside a nested loop runs once per inner element; the
      // effect it has on that receiver is the boundary, whether or not anything is carried.
      for(const nested of nestedLoops)(function footprint(s){
        if(s!==nested&&(functions.has(s.type)||stop.has(s.start)))return;
        if(s.type==='CallExpression') {
          const receiver=s.callee.type==='MemberExpression'&&s.callee.object.type==='Identifier'?s.callee.object:null;
          if(receiver) {
            const collection=collectionOf(env.get(key(receiver))),operation=namedMember(s.callee),spec=collectionCallSpec(s,env);
            uncertain(spec?'nested-collection-effect':'nested-receiver-effect',s,{receiver:receiver.name,operation,
              ownership:collection?'local':ports.has(key(receiver))?'parameter':'unknown',
              ...(collection?{collection:collection.kind}:{}),...(!spec?{effectUnknown:true}:{})});
          }
        }
        for(const child of kids(s))footprint(child);
      })(nested);
      // A return exits this function; only the surviving normal path reaches the
      // for-update and its backedge. No exception/termination proof is implied.
      const normalPaths=s=>{
        if(!s)return [[]];
        if(['ReturnStatement','ThrowStatement','BreakStatement'].includes(s.type))return [];
        if(s.type==='BlockStatement') {
          let paths=[[]];
          for(const child of s.body) {
            paths=paths.flatMap(path=>normalPaths(child).map(rest=>[...path,...rest]));
            if(paths.length>1)return paths.slice(0,2);
          }
          return paths;
        }
        if(s.type==='IfStatement')return [
          ...normalPaths(s.consequent).map(path=>[{node:s.test,inverse:false},...path]),
          ...normalPaths(s.alternate).map(path=>[{node:s.test,inverse:true},...path])];
        return [[]];
      };
      const paths=structured&&hasReturn?normalPaths(n.body):null;
      if(paths&&paths.length!==1){structured=false;blockers.add('branching-backedge');}
      const backedge=structured&&hasReturn?paths[0]:[],backedgeGates=backedge.map(({node:test,inverse})=>({
        text:inverse?`!(${src(text,test)})`:src(text,test),kind:inverse?'else':'if',name:src(text,test),
        source:{...sourceSite(test),endLine:test.loc.end.line}}));
      const nextGate=backedgeGates.length?guarded(shown([...(gatesAt.get(n)??[]),...backedgeGates])):null;
      if(structured&&(hasReturn||partial.size))uncertain('loop-exception-path',n,{backedge:'normal-completion',
        ...(partial.size?{shape:[...partial].sort().join('+')}:{})});
      if(nextGate&&n.update)(function guardUpdate(s){
        gatesAt.set(s,[...(gatesAt.get(s)??[]),...backedgeGates]);
        const site=siteAt.get(`${s.start}:${s.end}`);if(site)site.gates.push(...backedgeGates);
        for(const child of kids(s))guardUpdate(child);
      })(n.update);
      // What the loop carries: every binding the body writes that already holds a value is an
      // accumulator — `initial` from before the loop, `current` into the body, `next` from the
      // body's producer, `final` to whatever reads it after. A binding declared inside the body
      // is a fresh binding each iteration and carries nothing. A binding whose value at the
      // backedge the walk cannot name is demoted and the body read again without it, because a
      // carried `current` feeding it would be a claim the walk cannot make; one demotion can
      // cost another its `next`, so the reading repeats until nothing more falls.
      const carriable=[...changed].filter(b=>env.has(b)),demoted=new Set();
      const mark=checkpoint();
      let candidates=new Map();
      for(;;) {
        restore(mark);
        candidates=new Map();loop.clear();for(const [b,value] of env)loop.set(b,value);
        for(const b of carriable) {
          const incoming=env.get(b)??[],binding=bindingName.get(b)??b;
          if(!demoted.has(b)&&structured&&!unsafeCollections.has(b)) {
            const test=n.right?`${n.type==='ForInStatement'?'in':'of'} ${src(text,n.right)}`:n.test?src(text,n.test):'true';
            const noNormalExit=n.type==='ForStatement'&&!n.test&&!hasBreak;
            const op=operator('iteration',n,b,{binding,test,minIterations:n.type==='DoWhileStatement'||noNormalExit?1:0,
              ...(hasReturn||partial.size?{backedge:'normal-completion',exceptionalControlUnknown:true}:{}),
              ports:{inputs:['initial','next','control'],outputs:noNormalExit?['current']:['current','final']}});
            candidates.set(b,op);operatorInput(op,'initial',incoming);
            const constants=incoming.filter(p=>p.constant!==undefined).map(p=>p.constant);if(constants.length)op.initialConstants=constants;
            // Where the binding started is a gap of its own; what it carries is still carried.
            if(!incoming.length||incoming.some(p=>p.unknown)) {
              op.initialUnknown=true;uncertain('iteration-input',n,{operator:op.id,input:'initial'});
            }
            const collection=collectionOf(incoming);
            loop.set(b,[{end:op.id,port:'current',label:binding,...(collection?{collection}:{})}]);
          } else {loop.set(b,[]);uncertain('loop-data-flow',n,{binding,reason:demoted.has(b)?'unknown-next'
            :!structured?[...blockers].sort().join('+'):'unsafe-collection'});}
        }
        if(n.right){
          const value=evaluate(n.right,loop),pattern=n.left.declarations?.[0]?.id??n.left;
          if(n.type==='ForOfStatement'&&value.some(p=>p.end)&&!value.some(p=>p.unknown)) {
            const item=name(pattern)??src(text,pattern),op=candidates.values().next().value
              ??operator('iteration',n,'items',{mode:'elements',item,test:`of ${src(text,n.right)}`,minIterations:0,
                ports:{inputs:['iterable'],outputs:['item']}});
            op.item=item;
            if(!op.ports.outputs.includes('item'))op.ports.outputs.push('item');
            if(!op.ports.inputs.includes('iterable'))op.ports.inputs.push('iterable');
            operatorInput(op,'iterable',value);put(pattern,[{end:op.id,port:'item',label:item}],loop);
          } else {
            put(pattern,[{unknown:src(text,n.right),label:name(pattern)??src(text,pattern)}],loop);
            for(const op of candidates.values())op.iterationSourceUnknown=true;
            uncertain('iteration-source',n,{iterable:src(text,n.right)});
          }
        }
        if(n.test&&n.type!=='DoWhileStatement')evaluate(n.test,loop);
        const alive=statement(n.body,loop);if(alive&&n.update)evaluate(n.update,loop);
        if(n.type==='DoWhileStatement')evaluate(n.test,loop);
        const failed=[...candidates.keys()].filter(b=>!(loop.get(b)?.length)||loop.get(b).some(p=>p.unknown));
        if(!failed.length)break;
        for(const b of failed)demoted.add(b);
      }
      for(const b of changed) {
        const op=candidates.get(b);
        if(!op){env.set(b,[]);continue;}
        operatorInput(op,'next',loop.get(b),{...(nextGate?{gate:nextGate}:{}),...(hasReturn||partial.size?{provenance:'ast-normal-backedge'}:{})});
        for(const {node:test} of backedge) {
          const control=producers(test);operatorInput(op,'control',control,{...(nextGate?{gate:nextGate}:{})});
          if(!control.length||control.some(p=>p.unknown)) {
            op.backedgeControlUnknown=true;uncertain('iteration-backedge-control',test,{operator:op.id,test:src(text,test)});
          }
        }
        if(!n.right) {
          const control=n.test?producers(n.test):[{constant:'true'}];
          operatorInput(op,'control',control);
          if(!control.length||control.some(p=>p.unknown)){op.controlUnknown=true;uncertain('iteration-control',n,{operator:op.id});}
        }
        const constants=loop.get(b).filter(p=>!p.end).map(p=>p.constant);
        if(constants.length)op.nextConstants=constants;
        const collection=collectionOf(loop.get(b));
        env.set(b,op.ports.outputs.includes('final')?[{end:op.id,port:'final',label:op.binding,...(collection?{collection}:{})}]:[]);
      }
      if(structured&&n.type==='ForStatement'&&!n.test&&!hasBreak)return false;
    } else if(n.type==='BreakStatement'||n.type==='ContinueStatement') {
      uncertain('loop-control-transfer',n);return false;
    } else if(n.type==='ReturnStatement'||n.type==='ThrowStatement') {
      evaluate(n.argument,env);return false;
    } else if(n.type==='SwitchStatement'||n.type==='TryStatement') {
      uncertain(n.type==='SwitchStatement'?'switch-control-flow':'exceptional-control-flow',n);
      const changed=written(n),inner=new Map(env);
      for(const b of changed)inner.set(b,[]);
      if(n.type==='SwitchStatement') {
        evaluate(n.discriminant,env);
        for(const branch of n.cases)statement(branch,new Map(inner));
      } else {
        statement(n.block,new Map(inner));statement(n.handler,new Map(inner));statement(n.finalizer,new Map(inner));
      }
      for(const b of changed)env.set(b,[]);
    } else if(n.type==='SwitchCase') {
      evaluate(n.test,env);for(const s of n.consequent)if(!statement(s,env))break;
    } else if(n.type==='CatchClause')statement(n.body,env);
    else evaluate(n,env);
    return true;
  };
  statement(fn.body,initial);
  // A callback target is a reference, not a box. The call sites the parameter invocation above
  // stands for drop out of the drawing, and a component left with no site of its own goes with
  // them unless this function holds the declaration, which homes it here regardless.
  if(parameterCallSites.size) {
    // A call written in a parameter default is invoked by the same parameter, outside the body
    // the dataflow walks; a target already named as a reference is not also a box because of it.
    const referenced=new Set([...parameterTargets.values()].flat().map(row=>row.path));
    const onParameter=site=>site.node.callee.type==='Identifier'&&!!ports.get(key(site.node.callee));
    for(const c of order)c.sites=c.sites.filter(site=>!parameterCallSites.has(`${site.node.start}:${site.node.end}`));
    for(let i=order.length-1;i>=0;i--) {
      const c=order[i];if(c.links.has('ast-closure'))continue;
      if(c.sites.length&&!(referenced.has(c.node.path)&&c.sites.every(onParameter)))continue;
      // A finding follows its node, so the rows a dropped site would have raised are raised here
      // instead of with the box: what it invokes and where each argument came from.
      for(const site of c.sites) {
        diagnoseOrigin('callable-origin',site.node.callee,{call:src(text,site.node.callee)});
        site.args.forEach((arg,at)=>diagnoseOrigin('argument-origin',arg,{call:src(text,site.node.callee),argument:at+1}));
      }
      order.splice(i,1);
    }
    order.forEach((c,i)=>{c.index=i+1;});
  }
  for(const p of params)if(parameterTargets.get(p.port)?.length)p.parameterTargets=parameterTargets.get(p.port);
  for(const [path,rows] of closureCaptures)for(const row of rows.values())if(row.valueUnknown||row.mutationUnknown)
    uncertain('closure-capture',childFunctions.get(path),{closure:path,binding:row.name,access:row.access,
      ...(row.valueUnknown?{valueUnknown:true}:{}),...(row.lifetimeUnknown?{lifetimeUnknown:true}:{}),...(row.mutationUnknown?{mutationUnknown:true}:{})});
  const wires=[],seen=new Set();
  const wire=w=>{if(!w.from||!w.to)return;
    const k=`${w.from}\n${w.to}\n${w.label}\n${w.kind}\n${w.fromPort??''}\n${w.toPort??''}\n${JSON.stringify(w.gate??null)}\n${w.sourceSite?.start??''}:${w.sourceSite?.end??''}\n${w.targetSite?.start??''}:${w.targetSite?.end??''}`;if(seen.has(k))return;seen.add(k);
    wires.push({...w,...(w.provenance==='state-thread'?{order:'source'}:{})});};
  operatorWires.forEach(wire);captureWires.forEach(wire);
  const gateOf=site=>guarded(shown(site.gates));
  // A resolved implementation and the value used to invoke it are separate facts.
  // Only local identifier snapshots can establish this edge here: a member receiver
  // is not necessarily the callable, and captured values may have no reaching origin.
  const callableValues=site=>{
    const callee=site.node.callee;
    if(callee.type!=='Identifier'||!key(callee))return null;
    const value=producers(callee);
    if(value.length&&value.every(p=>p.port==='callable'&&!p.site))return null;
    return value;
  };
  for(const c of order) {
    const to=c.node.path;
    for(const site of c.sites) {
      const gate=gateOf(site),carried=new Set();
      const callable=callableValues(site);
      if(callable) {
        diagnoseOrigin('callable-origin',site.node.callee,{call:src(text,site.node.callee)});
        for(const p of callable)if(p.end) {
          carried.add(p.end);wire({from:p.end,to,label:expression(site.node.callee),kind:'data',toPort:'callable',
            ...(p.site?{sourceSite:p.site}:{}),targetSite:sourceSite(site.node),provenance:'ast-def-use',
            ...(p.port?{fromPort:p.port}:{}),...(gate?{gate}:{})});
        }
      }
      // Read the snapshots made while evaluating the arguments, never a final binding map.
      for(const [argumentIndex,arg] of site.args.entries()) {
        // argN is a source argument slot. A spread makes its expanded destination
        // and every later slot's callee parameter position unknown.
        const positionUnknown=site.args.slice(0,argumentIndex+1).some(a=>a.type==='SpreadElement');
        diagnoseOrigin('argument-origin',arg,{call:src(text,site.node.callee),argument:argumentIndex+1});
        const inner=['AwaitExpression','ChainExpression'].includes(arg.type)?arg.argument??arg.expression:arg;
        const nested=inner.type==='CallExpression'||inner.type==='NewExpression';
        for(const p of producers(arg))if(p.end&&(p.end!==to||p.site?.start!==site.node.start)) {
          carried.add(p.end);wire({from:p.end,to,label:p.label??'',kind:'data',toPort:`arg${argumentIndex+1}`,
            ...(positionUnknown?{positionUnknown:true}:{}),...(arg.type==='SpreadElement'?{spread:true}:{}),
            ...(p.site?{sourceSite:p.site}:{}),targetSite:sourceSite(site.node),
            provenance:p.port==='callable'?'ast-closure-value':p.end.startsWith('in')?'ast-param':nested?'ast-nested-call':'ast-def-use',
            ...(p.port?{fromPort:p.port}:{}),
            ...(inner.type==='BinaryExpression'||inner.type==='UnaryExpression'?{expression:src(text,inner)}:{}),...(gate?{gate}:{})});
        }
      }
      // A call reached only under a test, carrying no named argument, is a gate wire from
      // whatever the call is made on. With no source for it the gate stays on the component.
      const rb=site.receiver&&key(site.receiver);
      if(!carried.size&&gate&&rb&&ports.has(rb)&&producers(site.receiver).some(p=>p.end===ports.get(rb).port))
        wire({from:ports.get(rb).port,to,label:'',kind:'gate',provenance:'ast-guard',gate,targetSite:sourceSite(site.node)});
    }
  }
  // A receiver called more than once carries the object between those calls, in call order.
  const threads=new Map();
  for(const c of order)for(const site of c.sites)if(site.receiver) {
    const rk=site.receiver.type==='ThisExpression'?'this':key(site.receiver);
    if(!rk)continue;
    (threads.get(rk)??threads.set(rk,[]).get(rk)).push({start:site.node.start,to:c.node.path,site,rk,
      receiver:site.receiver.type==='ThisExpression'?'this':site.receiver.name});
  }
  const threaded=[];
  for(const [rk,list] of threads) {
    const steps=list.sort((a,b)=>a.start-b.start);
    if(steps.length<2)continue;
    // A lexical list is not an execution trace. Only the unguarded, non-callback
    // sequence can retain a state-thread, and even that is explicitly source order.
    if(list.some(s=>s.site.gates.length||s.site.inner||s.site.controlled)||written(fn.body).has(rk)) {
      uncertain('receiver-state-order',list[0].site.node,{receiver:steps[0].receiver});continue;
    }
    threaded.push(...steps);
    const label=steps[0].receiver;
    if(ports.has(rk))wire({from:ports.get(rk).port,to:steps[0].to,label,kind:'state',provenance:'state-thread',targetSite:sourceSite(steps[0].site.node)});
    for(let i=1;i<steps.length;i++)wire({from:steps[i-1].to,to:steps[i].to,label,kind:'state',provenance:'state-thread',
      sourceSite:sourceSite(steps[i-1].site.node),targetSite:sourceSite(steps[i].site.node)});
  }
  // What leaves the body: every return and every throw reachable in it, each with the test it
  // is written under. Exits that leave the same thing are one port.
  // Exits that leave the same thing under the same test are one port; a second test is a
  // second way out and keeps its own port, so no guard is dropped.
  const staticObjectKeys=value=>{
    if(value?.type==='ConditionalExpression'){
      const left=staticObjectKeys(value.consequent),right=staticObjectKeys(value.alternate);
      return left&&right?new Set([...left,...right]):null;
    }
    if(value?.type!=='ObjectExpression')return null;
    const keys=new Set();
    for(const property of value.properties){
      if(property.type==='SpreadElement'){
        const nested=staticObjectKeys(property.argument);if(!nested)return null;
        for(const key of nested)keys.add(key);
        continue;
      }
      const key=!property.computed?property.key.name??property.key.value:property.key.type==='Literal'?property.key.value:null;
      if(property.type!=='Property'||property.kind!=='init'||key===null||key===undefined)return null;
      keys.add(String(key));
    }
    return keys;
  };
  const returnValues=(value,prefix='')=>{
    if(value?.type!=='ObjectExpression')return producers(value).map(p=>({...p,...(prefix?{label:prefix,expression:expression(value)}:{})}));
    const fields=new Map(),unknown=[];
    for(const property of value.properties){
      const staticKey=property.type==='Property'&&!property.computed&&property.kind==='init';
      if(!staticKey){
        uncertain('return-field-origin',property,{expression:expression(property)});
        for(const [field,previous] of fields)uncertain('return-field-override',previous,{field,expression:expression(property)});
        fields.clear();
        unknown.push(...producers(property.value??property.argument).map(p=>({...p,label:prefix||'record',expression:expression(property)})));
        if(property.computed)unknown.push(...producers(property.key).map(p=>({...p,label:prefix||'key',expression:expression(property.key)})));
      } else fields.set(String(property.key.name??property.key.value),property.value);
    }
    return [...unknown,...[...fields].flatMap(([field,fieldValue])=>returnValues(fieldValue,prefix?`${prefix}.${field}`:field))];
  };
  const merged=new Map();
  for(const e of exits) {
    const k=`${e.kind}\n${e.name}\n${e.gate?.text??''}`;
    (merged.get(k)??merged.set(k,[]).get(k)).push(e);
  }
  const outputs=[...merged.values()].map((list,i)=>{
    const returnCalls=[...new Set(list.map(e=>directReturnCall(e.value)).filter(Boolean))];
    return ({port:`out${i+1}`,name:list[0].name,kind:list[0].kind,lines:list.map(e=>e.node.loc.start.line),
      ...(returnCalls.length===1&&list.every(e=>directReturnCall(e.value)===returnCalls[0])?{returnCall:returnCalls[0]}:{}),
      ...(list[0].value?.type==='ObjectExpression'?{
        fields:list[0].value.properties.filter(p=>p.type==='Property'&&!p.computed).map(p=>String(p.key.name??p.key.value)),
        ...(list[0].value.properties.some(p=>p.type==='SpreadElement')?{spread:true}:{}),
        ...(list[0].value.properties.some(p=>p.computed)?{computedKeys:true}:{}),
        source:{file:node.file,line:list[0].value.loc.start.line,endLine:list[0].value.loc.end.line}
      }:{}),
      ...(list[0].gate?{gate:guarded(list[0].gate)}:{}),
      provenance:list[0].kind==='throw'?'ast-throw':'ast-return'});
  });
  // Source-order state only reaches an exit that actually names that same receiver.
  threaded.sort((a,b)=>a.start-b.start);
  [...merged.values()].forEach((list,i)=>{for(const e of list) {
    diagnoseOrigin('return-origin',e.value,{port:`out${i+1}`});
    const provenance=e.kind==='throw'?'ast-throw':'ast-return';
    // An exit's control dependency is distinct from the value it returns/throws.
    // Even a constant or externally constructed error is selected by its guard.
    for(const condition of gateInputsAt.get(e.node)??[])for(const p of producers(condition))if(p.end)
      wire({from:p.end,to:`out${i+1}`,label:p.label??'',kind:'gate',toPort:'condition',
        ...(p.port?{fromPort:p.port}:{}),...(p.site?{sourceSite:p.site}:{}),
        ...(e.gate?{gate:guarded(e.gate)}:{}),provenance:'ast-guard'});
    for(const p of returnValues(e.value))wire({from:p.end,to:`out${i+1}`,label:p.label??'',kind:'return',provenance:p.port==='callable'?'ast-closure-value':provenance,...(p.expression?{expression:p.expression}:{}),
      ...(p.site?{sourceSite:p.site}:{}),
      ...(p.port?{fromPort:p.port}:{})});
    const returned=new Set(roots(e.value).map(root=>key(root)));
    for(const rk of returned) {
      const last=threaded.filter(s=>s.rk===rk&&s.start<e.node.start).at(-1);
      if(last)wire({from:last.to,to:`out${i+1}`,label:last.receiver,kind:'return',provenance:'state-thread',sourceSite:sourceSite(last.site.node)});
    }
  }});

  const present=c=>({handle:c.node.handle,path:c.node.path,label:c.node.label,foot:foot(c.node),
    file:c.node.file,line:c.node.line,endLine:c.node.endLine,lines:c.node.endLine-c.node.line+1,
    order:c.index,calls:c.sites.length,links:[...c.links].sort(),provenance:'ast-call-site',
    ...(childFunctions.get(c.node.path)?{closure:true,...(closureCaptures.has(c.node.path)?{captures:[...closureCaptures.get(c.node.path).values()]}:{})}:{}),
    ...(shapes.assertions.has(c.node.path)?{shape:'assertion',...(c.sites.length===1?{assertion:assertionAt(c.sites[0],c.node.path)}:{})}
      :shapes.scalarReductions?.has(c.node.path)?{shape:'scalar-reduction'}:shapes.formulas.has(c.node.path)?{shape:'formula'}:shapes.numericalExpressions?.has(c.node.path)?{shape:'numerical-expression'}:{}),
    sites:c.sites.map(s=>({line:s.node.loc.start.line,column:s.node.loc.start.column+1,
      ...(s.receiver?{receiver:s.receiver.type==='ThisExpression'?'this':s.receiver.name}:{}),link:linkOf(s.relation),provenance:'ast-call-site'})),
    ...(c.sites.every(s=>gateOf(s))&&new Set(c.sites.map(s=>gateOf(s).text)).size===1?{gate:{...gateOf(c.sites[0])}}:{})});

  const drawn=order.map(present);
  // Local bookkeeping that reaches no visible call or exit is not an explanatory stage.
  // Keep synthetic operators only along actual dependency paths to those graph boundaries.
  const operatorIds=new Set(operators.map(o=>o.id)),needed=new Set([...drawn.map(c=>c.path),...outputs.map(o=>o.port),
    ...operators.filter(o=>o.kind==='invocation').map(o=>o.id)]);
  for(let changed=true;changed;) {
    changed=false;
    for(const w of wires)if(needed.has(w.to)&&operatorIds.has(w.from)&&!needed.has(w.from)) {
      needed.add(w.from);changed=true;
    }
  }
  let liveOperators=operators.filter(o=>needed.has(o.id));
  let kept=new Set([...drawn.map(c=>c.path),...liveOperators.map(o=>o.id),...params.map(p=>p.port),...outputs.map(o=>o.port)]);
  const live=w=>kept.has(w.from)&&kept.has(w.to);
  // Closure-owned state. The bindings a factory declares and its members share are drawn as
  // their own nodes: once here with the initialisation that filled them and a wire per member
  // that reads or writes them, and again on each member's page against the calls and operators
  // that use them there. A state node is not a called declaration — it is no part of the
  // map-or-code rule — and it never floats: every one of them is placed by its own wires.
  const state=[],stateWires=[],stateBindings=new Set(),stateKey=new Map(),stateSeen=new Set();
  const stateNode=(holder,b,info,access)=>{
    const k=`${holder.path}\n${b}`,held=stateKey.get(k);
    if(held){if(held.access!==access)held.access='read-write';return held;}
    const made={id:`st${state.length+1}`,kind:'state',name:info.name,owner:holder.path,ownerIndex:holder.handle,
      binding:info.binding,access,file:holder.file,line:info.source.line,endLine:info.source.endLine,column:info.source.column};
    stateKey.set(k,made);state.push(made);return made;
  };
  const stateWire=w=>{
    const k=JSON.stringify([w.from,w.to,w.toPort??'',w.fromPort??'',w.access,w.stub??'',
      w.sourceSite?.start??'',w.targetSite?.start??'']);
    if(stateSeen.has(k))return;
    stateSeen.add(k);stateWires.push({kind:'state',provenance:'closure-state',...w});
  };
  const ownedHere=ownedBindings(fn,key);
  if(ownedHere.size&&node.children.length) {
    const shared=new Map();
    for(const child of node.children) {
      const body=childFunctions.get(child.path);if(!body)continue;
      for(const [b,row] of stateUses(body,key,ownedHere,childStops(child)))
        (shared.get(b)??shared.set(b,[]).get(b)).push({child,access:row.access});
    }
    for(const [b,members] of shared) {
      const info=ownedHere.get(b);
      const held=stateNode(node,b,info,members.map(m=>m.access).reduce((a,x)=>a&&a!==x?'read-write':x,null));
      stateBindings.add(b);
      const produced=(stateProducers.get(b)??[]).filter(p=>p.end);
      if(produced.length)for(const p of produced)stateWire({from:p.end,to:held.id,label:info.name,access:'write',
        ...(p.port?{fromPort:p.port}:{}),...(p.site?{sourceSite:p.site}:{})});
      else stateWire({from:'self',to:held.id,label:info.name,access:'write',stub:info.initial});
      for(const m of members) {
        if(m.access!=='write')stateWire({from:held.id,to:m.child.path,label:info.name,access:'read'});
        if(m.access!=='read')stateWire({from:m.child.path,to:held.id,label:info.name,access:'write'});
      }
    }
  }
  // This page's own view of the state it does not own: what the declaration holding it declared
  // and this body uses. The holder chain is walked outward, so the innermost declaration that
  // owns the binding is the one named.
  const holders=[];
  for(let a=node.parent;a&&['function','method','handler'].includes(a.kind);a=a.parent) {
    const d=byAnchor(graph).get(a.path);if(!d||d.file!==node.file)break;
    const outer=functionAt(ast,d.start,d.end);if(!outer)break;
    const scope=scopeTree(outer),keyOf=n=>scope.binding(n)?.id??null;
    holders.push({node:a,keyOf,owned:ownedBindings(outer,keyOf)});
  }
  if(holders.length) {
    const siteByNode=new Map();
    for(const c of order)for(const s of c.sites)if(!siteByNode.has(s.node))siteByNode.set(s.node,{path:c.node.path,site:s});
    const opByNode=new Map();
    for(const op of liveOperators)if(op.start!==undefined&&!opByNode.has(`${op.start}:${op.end}`))opByNode.set(`${op.start}:${op.end}`,op);
    const outPortOf=new Map();
    [...merged.values()].forEach((list,i)=>{for(const e of list)outPortOf.set(e.node,`out${i+1}`);});
    // What consumes a read: the call it is an argument or receiver of, the operator it feeds, the
    // exit it leaves by, or — when it reaches none of those — this function itself.
    const consumerOf=id=>{
      for(let n=id,p=parents.get(n);p;n=p,p=parents.get(n)) {
        const held=siteByNode.get(p);
        if(held) {
          const slot=held.site.iteration?-1:held.site.args.findIndex(a=>a&&a.start<=id.start&&id.end<=a.end);
          return {to:held.path,targetSite:sourceSite(p),
            ...(slot>=0?{toPort:`arg${slot+1}`}
              :p.callee&&p.callee.start<=id.start&&id.end<=p.callee.end?{toPort:'receiver'}:{})};
        }
        const op=opByNode.get(`${p.start}:${p.end}`);
        if(op)return {to:op.id};
        const out=outPortOf.get(p);
        if(out)return {to:out};
      }
      return {to:'self'};
    };
    // What a write leaves behind. A binding assigned a traced value is wired from that value's
    // producer; a mutation of the object the binding holds, or an assignment the tracer could
    // not source, is the work of this function and says which gap it is.
    const producerWires=(id,held,name)=>{
      let top=id,above=parents.get(id);
      while(above?.type==='MemberExpression'&&above.object===top){top=above;above=parents.get(top);}
      if(top===id&&above?.type==='AssignmentExpression'&&above.left===id) {
        const found=producers(above.right).filter(p=>p.end);
        if(found.length)return found.map(p=>({from:p.end,to:held.id,label:name,access:'write',
          ...(p.port?{fromPort:p.port}:{}),...(p.site?{sourceSite:p.site}:{})}));
        return [{from:'self',to:held.id,label:name,access:'write',stub:'untraced'}];
      }
      return [{from:'self',to:held.id,label:name,access:'write',
        stub:above?.type==='UpdateExpression'?'update'
          :above?.type==='UnaryExpression'?'deleted-member'
          :above?.type==='CallExpression'&&above.callee===top?'collection-mutation':'member-write'}];
    };
    for(const holder of holders)for(const [b,row] of stateUses(fn,holder.keyOf,holder.owned,stop)) {
      const held=stateNode(holder.node,b,row,row.access);
      for(const site of row.sites) {
        if(site.access!=='write')stateWire({from:held.id,...consumerOf(site.node),label:row.name,access:'read'});
        if(site.access!=='read')for(const w of producerWires(site.node,held,row.name))stateWire(w);
      }
    }
  }
  // Local bookkeeping whose only consumer is owned state is still a step of this flow: the
  // liveness walk above stopped at the drawn boxes, so it is rerun once the state wires exist.
  if(stateWires.some(w=>operatorIds.has(w.from)&&!needed.has(w.from))) {
    for(const w of stateWires)if(operatorIds.has(w.from))needed.add(w.from);
    for(let changed=true;changed;) {
      changed=false;
      for(const w of wires)if(needed.has(w.to)&&operatorIds.has(w.from)&&!needed.has(w.from)) {
        needed.add(w.from);changed=true;
      }
    }
    liveOperators=operators.filter(o=>needed.has(o.id));
    kept=new Set([...drawn.map(c=>c.path),...liveOperators.map(o=>o.id),...params.map(p=>p.port),...outputs.map(o=>o.port)]);
  }
  // A call boundary is a source observation, independent of the merged component box.
  // Preserve each invocation and its reaching argument definitions so a caller's local
  // names can be related to callee ports without guessing a unique upstream origin.
  const resultAt=call=>{
    let value=call,parent=parents.get(value);
    while(parent&&['AwaitExpression','ChainExpression'].includes(parent.type)){value=parent;parent=parents.get(value);}
    if(parent?.type==='VariableDeclarator'&&parent.init===value)
      return {kind:'binding',expression:expression(parent.id),site:sourceSite(parent)};
    if(parent?.type==='AssignmentExpression'&&parent.right===value&&parent.operator==='=')
      return {kind:'binding',expression:expression(parent.left),site:sourceSite(parent)};
    if(parent?.type==='ReturnStatement'||parent?.type==='ThrowStatement')return {kind:parent.type==='ThrowStatement'?'throw':'return',site:sourceSite(parent)};
    if(parent?.type==='ExpressionStatement')return {kind:'unused',site:sourceSite(parent)};
    if(fn.body===value&&fn.body.type!=='BlockStatement')return {kind:'return',site:sourceSite(value)};
    return {kind:'expression'};
  };
  const callBindings=order.flatMap(c=>c.sites.map(site=>({callee:c.node.path,...sourceSite(site.node),
    kind:site.node.type==='NewExpression'?'construct':'call',
    ...(assertionAt(site,c.node.path)?{assertion:assertionAt(site,c.node.path)}:{}),
    ...(gateOf(site)?{gate:gateOf(site)}:{}),
    ...(site.node.optional?{optional:true}:{}),...(site.inner?{executionUnknown:true}:{}),
    ...(site.relation.possible?{possibleTarget:true}:{}),
    ...(site.relation.selections&&Object.keys(site.relation.selections).length?{selections:{...site.relation.selections}}:{}),
    ...(callableValues(site)?{callable:{...valueDescription(site.node.callee),expression:expression(site.node.callee),
      producers:callableValues(site).filter(p=>p.end).map(p=>({endpoint:p.end,...(p.port?{port:p.port}:{}),
        ...(p.label?{label:p.label}:{}),...(p.site?{site:p.site}:{})}))}}:{}),
    arguments:site.args.map((arg,i)=>({position:i+1,...valueDescription(arg),expression:expression(arg),
      ...(arg.type==='SpreadElement'?{spread:true}:{}),
      ...(site.args.slice(0,i+1).some(a=>a.type==='SpreadElement')?{positionUnknown:true}:{}),
      producers:producers(arg).filter(p=>p.end).map(p=>({endpoint:p.end,...(p.port?{port:p.port}:{}),
        ...(p.label?{label:p.label}:{}),...(p.site?{site:p.site}:{})}))})),
    // An iteration method's own result is the collection, not what the callback left behind.
    result:site.iteration?{kind:'expression'}:resultAt(site.node),resultUses:[]}))).sort((a,b)=>a.start-b.start||a.callee.localeCompare(b.callee));
  const callBySite=new Map(callBindings.map(call=>[`${call.file}:${call.start}:${call.end}:${call.callee}`,call]));
  const producingCall=p=>p.site&&callBySite.get(`${p.site.file}:${p.site.start}:${p.site.end}:${p.endpoint}`);
  // Receiver alternatives selected by the same lookup are correlated: a value made by
  // one choice cannot reach the consumer belonging to a different choice. Separate
  // lookups have different selection identities and remain conservative.
  const compatibleSelections=(left,right)=>!left||!right||!Object.keys(left).some(key=>
    Object.hasOwn(right,key)&&left[key]!==right[key]);
  for(const use of callBindings)for(const arg of use.arguments)
    arg.producers=arg.producers.filter(p=>{
      const producer=producingCall(p);return !producer||compatibleSelections(producer.selections,use.selections);
    });
  const compatibleDefUse=w=>{
    if(w.provenance!=='ast-def-use')return true;
    const producer=producingCall({endpoint:w.from,site:w.sourceSite});
    const consumer=producingCall({endpoint:w.to,site:w.targetSite});
    return !producer||!consumer||compatibleSelections(producer.selections,consumer.selections);
  };
  for(const use of callBindings)for(const p of use.callable?.producers??[]) {
    const call=producingCall(p);if(!call)continue;
    call.resultUses.push({kind:'callable',callee:use.callee,label:use.callable.expression,
      site:{file:use.file,line:use.line,column:use.column,start:use.start,end:use.end}});
  }
  for(const use of callBindings)for(const arg of use.arguments)for(const p of arg.producers) {
    const call=producingCall(p);if(!call)continue;
    call.resultUses.push({kind:'argument',callee:use.callee,site:{file:use.file,line:use.line,column:use.column,start:use.start,end:use.end},
      position:arg.position,...(arg.positionUnknown?{positionUnknown:true}:{}),...(p.label?{label:p.label}:{})});
  }
  for(const w of captureWires) {
    const call=producingCall({endpoint:w.from,site:w.sourceSite}),child=childFunctions.get(w.to);if(!call||!child)continue;
    const use={kind:'capture',callee:w.to,port:w.toPort,label:w.label,site:sourceSite(child)};
    if(!call.resultUses.some(item=>JSON.stringify(item)===JSON.stringify(use)))call.resultUses.push(use);
  }
  const operatorById=new Map(liveOperators.map(op=>[op.id,op]));
  for(const w of operatorWires) {
    const call=producingCall({endpoint:w.from,site:w.sourceSite}),op=operatorById.get(w.to);if(!call||!op)continue;
    call.resultUses.push({kind:'operator',operator:op.id,port:w.toPort,...(w.label?{label:w.label}:{}),
      site:{file:op.file,line:op.line,...(op.column?{column:op.column}:{}),...(op.start!==undefined?{start:op.start}:{}),...(op.end!==undefined?{end:op.end}:{})}});
  }
  [...merged.values()].forEach((list,i)=>{for(const exit of list)for(const p of returnValues(exit.value)) {
    const call=producingCall({endpoint:p.end,site:p.site});if(!call)continue;
    call.resultUses.push({kind:exit.kind,port:`out${i+1}`,line:exit.node.loc.start.line});
  }});
  const seenRequire=new Set();
  const page={flow:true,generated:true,authored:[],
    node:{handle:node.handle,path:node.path,label:node.label,foot:foot(node),file:node.file,line:node.line,endLine:node.endLine,
      lines:node.endLine-node.line+1,kind:node.kind},
    inputs:params,outputs,
    requires:requires.filter(r=>{const k=`${r.text}\n${r.message??''}\n${r.line}`;if(seenRequire.has(k))return false;seenRequire.add(k);return true;}),
    formulas:[],
    components:drawn,
    callBindings,
    operators:liveOperators.map(({key,...op})=>op),
    ...(state.length?{state}:{}),
    // A capture whose binding became a state node is drawn through that node instead, so the
    // value is not also carried straight to the member as a second edge.
    wires:[...wires.filter(w=>live(w)&&compatibleDefUse(w)&&!(w.kind==='capture'&&stateBindings.has(w.binding))),...stateWires],
    external:unlinked.filter(u=>u.state==='external'),
    unresolved:unlinked.filter(u=>u.state==='unresolved'),uncertainty};
  if(!built)return page;
  // The class page is this construction flow plus the class itself: its members as boxes, the
  // fields they share, and each member's callers outside the class.
  const shared=classPage(node,{graph,projection,asts},ast,head,built);
  const enclosed=path=>{const d=byAnchor(graph).get(path);return d&&d.start>=built.start&&d.end<=built.end;};
  const member=c=>c.calls===0&&!enclosed(c.path)
    ?{...c,links:['ast-member'],provenance:'ast-member',closure:undefined,captures:undefined}:c;
  return {...page,components:page.components.map(member),ports:shared.ports,
    wires:[...page.wires,...shared.wires],
    ...(shared.stateFields?{stateFields:shared.stateFields}:{}),
    ...(shared.stateful?{stateful:true}:{}),
    uncertainty:[...uncertainty,...shared.uncertainty??[]]};
}

// The agent read: components once, everything else by handle or port; gates once; locations in
// one form; provenance only where the mechanism is not the plain AST default for that element.
export function flowPacket(context,target,{evidence=false}={}) {
  const page=flowPage(context,target);
  const handle=new Map(page.components.map(c=>[c.path,c.handle]));
  const gates=[],gateIndex=g=>{
    if(!g)return undefined;
    const at=gates.findIndex(x=>x.text===g.text&&x.kind===g.kind&&
      JSON.stringify(x.source??x.terms??null)===JSON.stringify(g.source??g.terms??null));
    if(at>=0)return at;
    return gates.push({text:g.text,kind:g.kind,...(g.name?{name:g.name}:{}),...(g.source?{source:g.source}:{}),...(g.terms?{terms:g.terms}:{})})-1;
  };
  const end=x=>handle.get(x)??x;
  const repeated=new Set(page.components.filter(c=>c.calls>1).map(c=>c.path));
  // `label` is the declaration path below its file, so `path` is `file::label` and is dropped.
  const component=c=>({index:c.handle,label:c.path.slice(c.file.length+2),file:c.file,line:c.line,endLine:c.endLine,lines:c.lines,
    ...(c.shape?{shape:c.shape}:{}),...(c.assertion?{assertion:c.assertion}:{}),...(c.closure?{closure:true}:{}),...(c.captures?{captures:c.captures}:{}),
    ...(c.calls===1?{}:{calls:c.calls}),...(c.gate?{gate:gateIndex(c.gate)}:{}),
    ...(c.links.join()==='ast-call-site'?{}:{links:c.links}),
    ...(evidence?{sites:c.sites.map(({provenance,...s})=>s)}:{})});
  const site=u=>({call:u.call,line:u.line,column:u.column,rule:u.rule,
    ...(u.registration?{registration:u.registration}:{}),...(u.candidates?{candidates:u.candidates}:{})});
  const wire=w=>({from:end(w.from),to:end(w.to),...(w.label?{label:w.label}:{}),kind:w.kind,
    ...(w.stateField?{stateField:w.stateField}:{}),...(w.callKind?{callKind:w.callKind}:{}),...(w.source?{source:w.source}:{}),...(w.possibleTarget?{possibleTarget:true}:{}),
    ...(repeated.has(w.from)&&w.sourceSite?{sourceSite:w.sourceSite}:{}),
    ...(repeated.has(w.to)&&w.targetSite?{targetSite:w.targetSite}:{}),
    ...(w.fromPort?{fromPort:w.fromPort}:{}),...(w.toPort?{toPort:w.toPort}:{}),...(w.expression?{expression:w.expression}:{}),
    ...(w.positionUnknown?{positionUnknown:true}:{}),...(w.spread?{spread:true}:{}),
    ...(w.access?{access:w.access}:{}),...(w.stub?{stub:w.stub}:{}),
    ...(['ast-choice','ast-iteration','ast-normal-backedge','ast-invocation','ast-collection','ast-update','ast-closure-value','ast-closure-capture','ast-closure-binding','closure-state'].includes(w.provenance)?{provenance:w.provenance}:{}),
    ...(w.gate?{gate:gateIndex(w.gate)}:{}),...(w.provenance==='state-thread'?{provenance:'state-thread',order:'source'}:{})});
  const packet={flow:true,generated:true,index:page.node.handle,path:page.node.path,
    ...(page.stateful?{stateful:true}:{}),
    ...(context.shapes.scalarReductions?.has(page.node.path)?{shape:'scalar-reduction'}:context.shapes.numericalExpressions?.has(page.node.path)?{shape:'numerical-expression'}:{}),
    file:page.node.file,line:page.node.line,endLine:page.node.endLine,lines:page.node.lines,kind:page.node.kind,
    ...(page.components.length||page.operators?.length?{}:{leaf:true}),
    inputs:page.inputs.map(({provenance,...p})=>p),
    outputs:page.outputs.map(({provenance,kind,gate,...o})=>({...o,...(kind==='return'?{}:{kind}),...(gate?{gate:gateIndex(gate)}:{})})),
    // `by` and `file`+`label` name the callee the way a component does, so a renumbered region is
    // followed here too; `index` is that callee's page.
    requires:page.requires.map(({provenance,by,handle,...r})=>({...r,by,index:handle})),
    formulas:page.formulas.map(f=>({index:f.handle,label:f.path.slice(f.file.length+2),file:f.file,lines:f.lines})),
    components:page.components.map(component),
    ...(page.callBindings?.length?{invocationSites:true,callBindings:page.callBindings.map(({gate,...call})=>({...call,...(gate?{gate:gateIndex(gate)}:{})}))}:{}),
    ...(page.operators?.length?{operators:page.operators.map(({gate,...op})=>({...op,...(gate?{gate:gateIndex(gate)}:{})}))}:{}),
    ...(page.ports?{ports:page.ports}:{}),...(page.stateFields?{stateFields:page.stateFields}:{}),
    // Closure-owned state: the holder's own bindings this page draws, with the declaration site
    // that names each one. They are nodes of the drawing, never called declarations.
    ...(page.state?.length?{state:page.state}:{}),
    wires:page.wires.map(wire),
    gates,
    calledFrom:[],couplings:[],
    // A call site with no target in any scanned root is a platform operation; one whose target is
    // scanned source the map does not cover is an outside call, and its box names that target.
    unresolved:page.unresolved.map(site),platform:page.external.length,
    outside:(page.operators??[]).filter(op=>op.scope==='outside').length,
    ...(page.uncertainty?.length?{uncertainty:page.uncertainty}:{}),
    ...(evidence?{externalSites:page.external.map(site)}:{})};
  // `gates` is filled while the rows above are built; it is placed after them for reading order.
  return packet;
}

export async function loadFlow({repo=fileURLToPath(new URL('../../',import.meta.url)),files,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const list=files??await sourceFiles(repo,scanRoots),sources=new Map();
  const read=async file=>{const text=await readSource(file);sources.set(file,text);return text;};
  const started=Date.now();
  const graph=await extractGraph({repo,files:list,importAliases,literalCouplings:true,receiverCalls:true,readSource:read});
  const linked=Date.now();
  const projection=projectGraph(graph),asts=new Map();
  for(const [file,text] of sources)asts.set(file,parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true}));
  const parsed=Date.now();
  const shapes=classify({graph,projection,asts});
  return {graph,projection,sources,asts,shapes,
    timings:{link:linked-started,parse:parsed-linked,shapes:Date.now()-parsed}};
}
