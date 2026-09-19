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
import {classify,functionAt} from './shapes.mjs';
import {importAliases} from './generate.mjs';

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
    const at=`${r.evidence[0].file}:${r.evidence[0].start}`;
    (map.get(at)??map.set(at,[]).get(at)).push(r);
  }
  targetIndex.set(graph,map);return map;
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
    if(n.type==='FunctionDeclaration'&&n.id)declare(fnScope(s),n.id.name);
    for(const c of kids(n))hoistVars(c,s);
  };
  function declarations(n,s) {
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
function gateFor(parent,child,text) {
  if(parent.type==='IfStatement'&&parent.consequent===child)return {text:src(text,parent.test),kind:'if'};
  if(parent.type==='IfStatement'&&parent.alternate===child)return {text:`!(${src(text,parent.test)})`,kind:'else'};
  if(parent.type==='ConditionalExpression'&&parent.consequent===child)return {text:src(text,parent.test),kind:'ternary'};
  if(parent.type==='ConditionalExpression'&&parent.alternate===child)return {text:`!(${src(text,parent.test)})`,kind:'ternary'};
  if(parent.type==='LogicalExpression'&&parent.right===child)
    return {text:parent.operator==='&&'?src(text,parent.left):parent.operator==='||'?`!(${src(text,parent.left)})`:`${src(text,parent.left)} == null`,kind:parent.operator};
  if(['ForStatement','WhileStatement'].includes(parent.type)&&parent.body===child&&parent.test)return {text:src(text,parent.test),kind:'loop'};
  if(['ForOfStatement','ForInStatement'].includes(parent.type)&&parent.body===child)
    return {text:`${parent.type==='ForOfStatement'?'of':'in'} ${src(text,parent.right)}`,kind:'loop'};
  if(parent.type==='SwitchCase'&&parent.test&&parent.consequent.includes(child))return {text:`case ${src(text,parent.test)}`,kind:'case'};
  if(parent.type==='CatchClause'&&parent.body===child)return {text:'caught',kind:'catch'};
  return null;
}
const shown=gates=>[...gates].reverse().find(g=>g.kind!=='loop')??gates.at(-1)??null;
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

export function flowPage({graph,projection,sources,asts,shapes},target) {
  const {node}=select(projection,target);
  if(!node||node.kind==='module')throw Error(`A flow page needs a function, method or class node; ${target} is not one.`);
  const declaration=byAnchor(graph).get(node.path)??(()=>{throw Error(`No declaration for ${node.path}.`);})();
  const text=sources.get(node.file)??(()=>{throw Error(`No source for ${node.file}.`);})();
  const ast=asts?.get(node.file)??parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});
  const head=n=>({handle:n.handle,path:n.path,label:n.label,foot:foot(n),file:n.file,line:n.line,endLine:n.endLine,
    lines:n.endLine-n.line+1,kind:n.kind});

  // The function this node is: the declaration's own node, or the function it holds.
  const fn=functionAt(ast,declaration.start,declaration.end);
  // A class holds no body of its own; what it is, is the members declared inside it.
  if(!fn)return {flow:true,generated:true,authored:[],node:head(node),inputs:[],outputs:[],requires:[],
    components:node.children.map((child,i)=>({...head(child),order:i+1,calls:0,links:['ast-member'],provenance:'ast-member',sites:[]})),
    wires:[],external:[],unresolved:[]};
  const {binding,parameter}=scopeTree(fn);
  const key=n=>binding(n)?.id??null;

  // Call sites this node owns. A child node's body is its own page, so the walk stops there.
  const stop=new Set(node.children.map(c=>c.start));
  const sites=[],exits=[];
  (function walk(n,gates,inner){
    if(n!==fn&&stop.has(n.start))return;
    if(n.type==='CallExpression'||n.type==='NewExpression')sites.push({node:n,gates:[...gates]});
    // A return or throw inside a nested callback leaves that callback, not this body.
    if(!inner&&n.type==='ReturnStatement')exits.push({kind:'return',node:n,value:n.argument,name:n.argument?src(text,n.argument):src(text,n),gate:shown(gates)});
    if(!inner&&n.type==='ThrowStatement')exits.push({kind:'throw',node:n,value:n.argument,name:thrown(n.argument,text),gate:shown(gates)});
    for(const c of kids(n)){const g=gateFor(n,c,text);walk(c,g?[...gates,g]:gates,inner||(n!==fn&&functions.has(n.type)));}
  })(fn,[],false);
  sites.sort((a,b)=>a.node.start-b.node.start);
  if(fn.body.type!=='BlockStatement')exits.push({kind:'return',node:fn.body,value:fn.body,name:src(text,fn.body),gate:null});

  const targets=callTargets(graph);

  // Components, in order of first appearance: a local closure where it is declared, any
  // other callee at its first call site. An assertion becomes a requirement, a formula stays
  // in the wires it passes data through, and neither is drawn as a step.
  const components=new Map(),unlinked=[],requires=[],childAt=new Map(node.children.map(c=>[c.start,c]));
  const rules=graph.callSites?.unlinked??{},externalRule=new Set(Object.keys(graph.callSites?.external??{}));
  const held=n=>shapes.formulas.has(n.path)||shapes.assertions.has(n.path);
  for(const child of node.children)if(!held(child))components.set(child.path,{node:child,order:child.start,sites:[],links:new Set(['ast-closure'])});
  for(const site of sites) {
    const found=targets.get(`${node.file}:${site.node.start}`)??[];
    const receiver=site.node.callee.type==='MemberExpression'
      ?site.node.callee.object.type==='Identifier'?site.node.callee.object:site.node.callee.object.type==='ThisExpression'?site.node.callee.object:null:null;
    if(!found.length) {
      const rule=rules[`${node.file}:${site.node.start}`]??'unaccounted';
      unlinked.push({call:src(text,site.node.callee),line:site.node.loc.start.line,column:site.node.loc.start.column+1,
        state:externalRule.has(rule)?'external':'unresolved',rule});
      continue;
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
          line:site.node.loc.start.line,by:to.path,provenance:'ast-assertion'});
        continue;
      }
      if(shapes.formulas.has(to.path))continue;
      let c=components.get(to.path);
      if(!c)components.set(to.path,c={node:to,order:site.node.start,sites:[],links:new Set()});
      c.order=Math.min(c.order,site.node.start);
      c.sites.push({...site,receiver,relation:r,args:site.node.arguments});
      c.links.add(linkOf(r));
    }
  }
  const order=[...components.values()].sort((a,b)=>a.order-b.order);
  order.forEach((c,i)=>{c.index=i+1;});

  // Wires. A parameter reaching a call is an input wire; a call result bound to a name and
  // later passed on is a data wire; a receiver called more than once is a state thread.
  const params=fn.params.map((p,i)=>({port:`in${i+1}`,name:name(p)??src(text,p),provenance:'ast-param'}));
  const ports=new Map();
  fn.params.forEach((p,i)=>{for(const v of patternNames(p)){const b=parameter(v);if(b)ports.set(b.id,{port:`in${i+1}`,label:v});}});
  const produced=new Map();
  const producers=n=>{
    if(!n)return [];
    if(['AwaitExpression','ChainExpression'].includes(n.type))return producers(n.argument??n.expression);
    if(n.type==='ConditionalExpression')return [...producers(n.consequent),...producers(n.alternate)];
    if(n.type==='LogicalExpression')return [...producers(n.left),...producers(n.right)];
    if(n.type==='CallExpression'||n.type==='NewExpression') {
      const to=(targets.get(`${node.file}:${n.start}`)??[]).map(r=>projection.owner.get(r.to)).filter(t=>t&&t!==node&&t.kind!=='module');
      const drawn=to.filter(t=>!held(t));
      if(drawn.length)return drawn.map(t=>({end:t.path}));
      // A formula or assertion draws no box; what was handed to it keeps flowing.
      return to.length?(n.arguments??[]).flatMap(a=>producers(a)):[];
    }
    for(const root of roots(n)) {
      const b=key(root),carried=produced.get(b)??(ports.has(b)?[{end:ports.get(b).port,label:root.name}]:null);
      if(carried)return carried;
    }
    return [];
  };
  (function bind(n){
    if(n!==fn&&stop.has(n.start)) {
      // A local closure is itself a component; the name or object it is stored in carries it.
      const child=childAt.get(n.start),at=n.type==='ExpressionStatement'?n.expression:n;
      const held=at.type==='VariableDeclarator'?at.id:at.type==='AssignmentExpression'?at.left:null;
      for(const root of held?roots(held):[])
        if(child&&key(root))produced.set(key(root),[...produced.get(key(root))??[],{end:child.path,label:root.name}]);
      return;
    }
    if(n.type==='VariableDeclarator'&&n.init) {
      const from=producers(n.init);
      if(from.length)for(const id of patternIds(n.id))if(key(id))produced.set(key(id),from.map(f=>({...f,label:id.name})));
    }
    if(['ForOfStatement','ForInStatement'].includes(n.type)) {
      const from=producers(n.right),id=n.left.declarations?.[0]?.id??n.left;
      if(from.length&&id.type==='Identifier'&&key(id))produced.set(key(id),from.map(f=>({...f,label:f.label??src(text,n.right)})));
    }
    for(const c of kids(n))bind(c);
  })(fn);

  const wires=[],seen=new Set();
  const wire=w=>{const k=`${w.from}\n${w.to}\n${w.label}\n${w.kind}`;if(seen.has(k))return;seen.add(k);wires.push(w);};
  const gateOf=site=>{const g=shown(site.gates);return g?{text:g.text,kind:g.kind,provenance:'ast-guard'}:null;};
  for(const c of order) {
    const to=c.node.path;
    for(const site of c.sites) {
      const gate=gateOf(site),carried=new Set();
      // A call written inside another call's arguments hands its result straight over.
      for(const arg of site.args) {
        const inner=['AwaitExpression','ChainExpression'].includes(arg.type)?arg.argument??arg.expression:arg;
        if(inner.type!=='CallExpression'&&inner.type!=='NewExpression')continue;
        for(const p of producers(inner))if(p.end!==to) {
          carried.add(p.end);wire({from:p.end,to,label:'',kind:'data',provenance:'ast-nested-call',...(gate?{gate}:{})});
        }
      }
      for(const arg of site.args)for(const root of roots(arg)) {
        const b=key(root);if(!b||carried.has(b))continue;carried.add(b);
        if(ports.has(b))wire({from:ports.get(b).port,to,label:root.name,kind:'data',provenance:'ast-param',...(gate?{gate}:{})});
        for(const p of produced.get(b)??[])if(p.end!==to)
          wire({from:p.end,to,label:p.label??root.name,kind:'data',provenance:'ast-def-use',...(gate?{gate}:{})});
      }
      // A call reached only under a test, carrying no named argument, is a gate wire from
      // whatever the call is made on. With no source for it the gate stays on the component.
      const rb=site.receiver&&key(site.receiver);
      if(!carried.size&&gate&&rb&&ports.has(rb))
        wire({from:ports.get(rb).port,to,label:'',kind:'gate',provenance:'ast-guard',gate});
    }
  }
  // A receiver called more than once carries the object between those calls, in call order.
  const threads=new Map();
  for(const c of order)for(const site of c.sites)if(site.receiver) {
    const rk=site.receiver.type==='ThisExpression'?'this':key(site.receiver);
    if(!rk)continue;
    (threads.get(rk)??threads.set(rk,[]).get(rk)).push({start:site.node.start,to:c.node.path,
      receiver:site.receiver.type==='ThisExpression'?'this':site.receiver.name});
  }
  const threaded=[];
  for(const [rk,list] of threads) {
    const steps=list.sort((a,b)=>a.start-b.start).filter((s,i,all)=>i===0||all[i-1].to!==s.to);
    if(steps.length<2)continue;
    threaded.push(...steps);
    const label=steps[0].receiver;
    if(ports.has(rk))wire({from:ports.get(rk).port,to:steps[0].to,label,kind:'state',provenance:'state-thread'});
    for(let i=1;i<steps.length;i++)wire({from:steps[i-1].to,to:steps[i].to,label,kind:'state',provenance:'state-thread'});
  }
  // What leaves the body: every return and every throw reachable in it, each with the test it
  // is written under. Exits that leave the same thing are one port.
  // Exits that leave the same thing under the same test are one port; a second test is a
  // second way out and keeps its own port, so no guard is dropped.
  const merged=new Map();
  for(const e of exits) {
    const k=`${e.kind}\n${e.name}\n${e.gate?.text??''}`;
    (merged.get(k)??merged.set(k,[]).get(k)).push(e);
  }
  const outputs=[...merged.values()].map((list,i)=>
    ({port:`out${i+1}`,name:list[0].name,kind:list[0].kind,lines:list.map(e=>e.node.loc.start.line),
      ...(list[0].gate?{gate:{text:list[0].gate.text,kind:list[0].gate.kind,provenance:'ast-guard'}}:{}),
      provenance:list[0].kind==='throw'?'ast-throw':'ast-return'}));
  // A thread's last step before an exit reaches that exit: the return value may be a bare
  // tag, but the object the body was writing to leaves through it.
  threaded.sort((a,b)=>a.start-b.start);
  [...merged.values()].forEach((list,i)=>{for(const e of list) {
    const provenance=e.kind==='throw'?'ast-throw':'ast-return';
    for(const p of producers(e.value))wire({from:p.end,to:`out${i+1}`,label:p.label??'',kind:'return',provenance});
    for(const root of roots(e.value))for(const p of produced.get(key(root))??[])
      wire({from:p.end,to:`out${i+1}`,label:p.label??root.name,kind:'return',provenance});
    const last=threaded.filter(s=>s.start<e.node.start).at(-1);
    if(last)wire({from:last.to,to:`out${i+1}`,label:last.receiver,kind:'return',provenance:'state-thread'});
  }});

  const present=c=>({handle:c.node.handle,path:c.node.path,label:c.node.label,foot:foot(c.node),
    file:c.node.file,line:c.node.line,endLine:c.node.endLine,lines:c.node.endLine-c.node.line+1,
    order:c.index,calls:c.sites.length,links:[...c.links].sort(),provenance:'ast-call-site',
    sites:c.sites.map(s=>({line:s.node.loc.start.line,column:s.node.loc.start.column+1,
      ...(s.receiver?{receiver:s.receiver.type==='ThisExpression'?'this':s.receiver.name}:{}),link:linkOf(s.relation),provenance:'ast-call-site'})),
    ...(c.sites.every(s=>gateOf(s))&&new Set(c.sites.map(s=>gateOf(s).text)).size===1?{gate:{...gateOf(c.sites[0])}}:{})});

  const drawn=order.map(present);
  const kept=new Set([...drawn.map(c=>c.path),...params.map(p=>p.port),...outputs.map(o=>o.port)]);
  const live=w=>kept.has(w.from)&&kept.has(w.to);
  const seenRequire=new Set();
  return {flow:true,generated:true,authored:[],
    node:{handle:node.handle,path:node.path,label:node.label,foot:foot(node),file:node.file,line:node.line,endLine:node.endLine,
      lines:node.endLine-node.line+1,kind:node.kind},
    inputs:params,outputs,
    requires:requires.filter(r=>{const k=`${r.text}\n${r.message??''}\n${r.line}`;if(seenRequire.has(k))return false;seenRequire.add(k);return true;}),
    components:drawn,
    wires:wires.filter(live),
    external:unlinked.filter(u=>u.state==='external'),
    unresolved:unlinked.filter(u=>u.state==='unresolved')};
}

// The agent read: components once, everything else by handle or port; gates once; locations in
// one form; provenance only where the mechanism is not the plain AST default for that element.
export function flowPacket(context,target,{evidence=false}={}) {
  const page=flowPage(context,target);
  const handle=new Map(page.components.map(c=>[c.path,c.handle]));
  const gates=[],gateIndex=g=>{
    if(!g)return undefined;
    const at=gates.findIndex(x=>x.text===g.text&&x.kind===g.kind);
    return at>=0?at:gates.push({text:g.text,kind:g.kind})-1;
  };
  const end=x=>handle.get(x)??x;
  // `label` is the declaration path below its file, so `path` is `file::label` and is dropped.
  const component=c=>({index:c.handle,label:c.path.slice(c.file.length+2),file:c.file,line:c.line,endLine:c.endLine,lines:c.lines,
    ...(c.calls===1?{}:{calls:c.calls}),...(c.gate?{gate:gateIndex(c.gate)}:{}),
    ...(c.links.join()==='ast-call-site'?{}:{links:c.links}),
    ...(evidence?{sites:c.sites.map(({provenance,...s})=>s)}:{})});
  const site=u=>({call:u.call,line:u.line,...(evidence?{column:u.column}:{}),rule:u.rule});
  const wire=w=>({from:end(w.from),to:end(w.to),...(w.label?{label:w.label}:{}),kind:w.kind,
    ...(w.gate?{gate:gateIndex(w.gate)}:{}),...(w.provenance==='state-thread'?{provenance:'state-thread'}:{})});
  const packet={flow:true,generated:true,index:page.node.handle,path:page.node.path,
    file:page.node.file,line:page.node.line,endLine:page.node.endLine,lines:page.node.lines,kind:page.node.kind,
    ...(page.components.length?{}:{leaf:true}),
    inputs:page.inputs.map(({provenance,...p})=>p),
    outputs:page.outputs.map(({provenance,kind,gate,...o})=>({...o,...(kind==='return'?{}:{kind}),...(gate?{gate:gateIndex(gate)}:{})})),
    requires:page.requires.map(({provenance,by,...r})=>r),
    components:page.components.map(component),
    wires:page.wires.map(wire),
    gates,
    calledFrom:[],couplings:[],
    unresolved:page.unresolved.map(site),external:page.external.length,
    ...(evidence?{externalSites:page.external.map(site)}:{})};
  // `gates` is filled while the rows above are built; it is placed after them for reading order.
  return packet;
}

const slug=path=>path.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
// Layout and viewer are the shared Python ones; flow.py adds only provenance styling.
export async function buildFlow(targets,out,{repo=fileURLToPath(new URL('../../',import.meta.url))}={}) {
  const {mkdir}=await import('node:fs/promises'),{spawn}=await import('node:child_process');
  const context=await loadFlow({repo});
  const pages=targets.map(target=>{const packet=flowPage(context,target);return {...packet,key:slug(packet.node.path)};});
  const sources=Object.fromEntries([...new Set(pages.flatMap(p=>[p.node.file,...p.components.map(c=>c.file)]))]
    .map(file=>[file,context.sources.get(file)]));
  await mkdir(out,{recursive:true});
  const child=spawn(process.env.PYTHON??'python',[fileURLToPath(new URL('./flow.py',import.meta.url)),out],
    {stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONPATH:fileURLToPath(new URL('./',import.meta.url))}});
  child.stdin.end(JSON.stringify({pages,sources}));
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`Flow renderer exited ${code}`)));});
  return `${out}: ${pages.map(p=>p.key+'.svg').join(', ')}`;
}

export async function loadFlow({repo=fileURLToPath(new URL('../../',import.meta.url)),files,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const list=files??await sourceFiles(repo),sources=new Map();
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
