// A function body is its own flow page: parameters in, the things it calls as components in
// call order, local def-use as wires, guards as gates, what it returns out. Nothing here is
// authored; every element names the mechanism that produced it in `provenance`.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parse} from 'acorn';
import {extractGraph,sourceFiles} from './graph.mjs';
import {projectGraph,select} from './projection.mjs';
import {importAliases} from './generate.mjs';

const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const kids=n=>Object.entries(n).flatMap(([k,v])=>['loc','start','end'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
const clip=(s,n=72)=>s.length>n?s.slice(0,n-1)+'…':s;
const src=(text,n)=>clip(text.slice(n.start,n.end).replace(/\s+/g,' ').trim());
const name=p=>p.type==='Identifier'?p.name:p.type==='AssignmentPattern'?name(p.left):p.type==='RestElement'?`...${name(p.argument)}`
  :p.type==='ObjectPattern'?`{${p.properties.map(q=>q.type==='RestElement'?`...${name(q.argument)}`:q.key?.name??q.key?.value).join(',')}}`
  :p.type==='ArrayPattern'?`[${p.elements.map(e=>e?name(e):'').join(',')}]`:null;
const property=n=>!n.computed?n.property?.name:n.property?.type==='Literal'?String(n.property.value):null;
const foot=n=>`${n.file.slice(n.file.lastIndexOf('/')+1)}:${n.line}-${n.endLine}`;
const linkOf=r=>r.resolvedBy??'ast-call-site';

// The identifiers a value could travel in: the argument itself, the base of a member chain,
// both branches of a choice, the members of a literal. Function arguments are not entered —
// their calls are their own sites.
function roots(n,out=[]) {
  if(!n)return out;
  if(n.type==='Identifier')out.push(n.name);
  else if(n.type==='MemberExpression')roots(n.object,out);
  else if(['AwaitExpression','ChainExpression','SpreadElement','UnaryExpression','YieldExpression','TSNonNullExpression'].includes(n.type))roots(n.argument??n.expression,out);
  else if(n.type==='ConditionalExpression'){roots(n.consequent,out);roots(n.alternate,out);}
  else if(n.type==='LogicalExpression'||n.type==='BinaryExpression'){roots(n.left,out);roots(n.right,out);}
  else if(n.type==='ObjectExpression')for(const p of n.properties)roots(p.value??p.argument,out);
  else if(n.type==='ArrayExpression')for(const e of n.elements)roots(e,out);
  else if(n.type==='TemplateLiteral')for(const e of n.expressions)roots(e,out);
  return out;
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

export function flowPacket({graph,projection,sources},target) {
  const {node}=select(projection,target);
  if(!node||node.kind==='module')throw Error(`--flow needs a function, method or class node; ${target} is not one.`);
  const declaration=graph.declarations.find(d=>d.anchor===node.path&&!d.ambiguousAnchor)??(()=>{throw Error(`No declaration for ${node.path}.`);})();
  const text=sources.get(node.file)??(()=>{throw Error(`No source for ${node.file}.`);})();
  const ast=parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});

  // The function this node is: the declaration's own node, or the function it holds.
  let fn=null;
  (function find(n){if(fn)return;if(n.start===declaration.start&&n.end===declaration.end){
    fn=functions.has(n.type)?n:functions.has(n.value?.type)?n.value:functions.has(n.init?.type)?n.init:functions.has(n.right?.type)?n.right:null;if(fn)return;}
    for(const c of kids(n))find(c);})(ast);
  if(!fn)throw Error(`${node.path} holds no function body to read as a flow.`);

  // Call sites this node owns. A child node's body is its own page, so the walk stops there.
  const stop=new Set(node.children.map(c=>c.start));
  const sites=[];
  (function walk(n,gates){
    if(n!==fn&&stop.has(n.start))return;
    if(n.type==='CallExpression'||n.type==='NewExpression')sites.push({node:n,gates:[...gates]});
    for(const c of kids(n)){const g=gateFor(n,c,text);walk(c,g?[...gates,g]:gates);}
  })(fn,[]);
  sites.sort((a,b)=>a.node.start-b.node.start);

  const byId=new Map(graph.declarations.map(d=>[d.id,d]));
  const targets=new Map();
  for(const r of graph.relations)if(['call','construct'].includes(r.kind)&&byId.has(r.to)) {
    const key=`${r.evidence[0].file}:${r.evidence[0].start}`;
    (targets.get(key)??targets.set(key,[]).get(key)).push(r);
  }
  // What a node calls and who calls it, counting only links the method-name fallback did not
  // invent: that rule cannot exclude a same-named built-in, and its links would otherwise
  // decide whether a box opens a page and whether a callee counts as shared vocabulary.
  const calls=projection.edges.filter(e=>e.relations.some(r=>['call','construct'].includes(r.kind)&&r.resolvedBy!=='unique-method-name'));
  const opens=new Set(calls.map(e=>e.src.path).filter(Boolean));
  const leaf=n=>!calls.some(e=>e.src===n);
  const fanIn=n=>new Set(calls.filter(e=>e.dst===n).map(e=>e.src.file??e.src.external)).size;

  // Components, in order of first appearance: a local closure where it is declared, any
  // other callee at its first call site.
  const components=new Map(),unresolved=[],childAt=new Map(node.children.map(c=>[c.start,c]));
  for(const child of node.children)components.set(child.path,{node:child,order:child.start,sites:[],links:new Set(['ast-closure'])});
  for(const site of sites) {
    const found=targets.get(`${node.file}:${site.node.start}`)??[];
    const receiver=site.node.callee.type==='MemberExpression'
      ?site.node.callee.object.type==='Identifier'?site.node.callee.object.name:site.node.callee.object.type==='ThisExpression'?'this':null:null;
    if(!found.length) {
      unresolved.push({call:src(text,site.node.callee),line:site.node.loc.start.line,column:site.node.loc.start.column+1,
        receiver,provenance:'ast-call-site'});
      continue;
    }
    for(const r of found) {
      const to=projection.owner.get(r.to);
      if(!to||to===node)continue;
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
  const byName=new Map(params.map(p=>[p.name,{port:p.port,label:p.name}]));
  const produced=new Map();
  const producers=n=>{
    if(!n)return [];
    if(['AwaitExpression','ChainExpression'].includes(n.type))return producers(n.argument??n.expression);
    if(n.type==='ConditionalExpression')return [...producers(n.consequent),...producers(n.alternate)];
    if(n.type==='LogicalExpression')return [...producers(n.left),...producers(n.right)];
    if(n.type==='CallExpression'||n.type==='NewExpression')
      return (targets.get(`${node.file}:${n.start}`)??[]).map(r=>projection.owner.get(r.to)).filter(t=>t&&t!==node).map(t=>({component:t.path}));
    for(const root of roots(n))if(produced.has(root))return produced.get(root);
    return [];
  };
  (function bind(n){
    if(n!==fn&&stop.has(n.start)) {
      // A local closure is itself a component; the name or object it is stored in carries it.
      const child=childAt.get(n.start),at=n.type==='ExpressionStatement'?n.expression:n;
      const held=at.type==='VariableDeclarator'?at.id:at.type==='AssignmentExpression'?at.left:null;
      for(const root of held?roots(held):[])
        if(child)produced.set(root,[...produced.get(root)??[],{component:child.path,label:root}]);
      return;
    }
    if(n.type==='VariableDeclarator'&&n.init) {
      const from=producers(n.init);
      if(from.length)for(const id of n.id.type==='Identifier'?[n.id.name]:roots(n.id)??[])produced.set(id,from.map(f=>({...f,label:n.id.type==='Identifier'?n.id.name:id})));
    }
    if(['ForOfStatement','ForInStatement'].includes(n.type)) {
      const from=producers(n.right),id=n.left.declarations?.[0]?.id??n.left;
      if(from.length&&id.type==='Identifier')produced.set(id.name,from.map(f=>({...f,label:f.label??src(text,n.right)})));
    }
    for(const c of kids(n))bind(c);
  })(fn);

  const wires=[],seen=new Set();
  const wire=w=>{const key=`${w.from}\n${w.to}\n${w.label}\n${w.kind}`;if(seen.has(key))return;seen.add(key);wires.push(w);};
  const gateOf=site=>{const g=shown(site.gates);return g?{text:g.text,kind:g.kind,provenance:'ast-guard'}:null;};
  for(const c of order) {
    const to=c.node.path;
    for(const site of c.sites) {
      const gate=gateOf(site),carried=new Set();
      // A call written inside another call's arguments hands its result straight over.
      for(const arg of site.args) {
        const inner=['AwaitExpression','ChainExpression'].includes(arg.type)?arg.argument??arg.expression:arg;
        if(inner.type!=='CallExpression'&&inner.type!=='NewExpression')continue;
        for(const p of producers(inner))if(p.component!==to) {
          carried.add(p.component);wire({from:p.component,to,label:'',kind:'data',provenance:'ast-nested-call',...(gate?{gate}:{})});
        }
      }
      for(const arg of site.args)for(const root of roots(arg)) {
        if(carried.has(root))continue;carried.add(root);
        if(byName.has(root))wire({from:byName.get(root).port,to,label:root,kind:'data',provenance:'ast-param',...(gate?{gate}:{})});
        for(const p of produced.get(root)??[])if(p.component!==to)
          wire({from:p.component,to,label:p.label??root,kind:'data',provenance:'ast-def-use',...(gate?{gate}:{})});
      }
      // A call reached only under a test, carrying no named argument, is a gate wire from
      // whatever the call is made on. With no source for it the gate stays on the component.
      if(!carried.size&&gate&&site.receiver&&byName.has(site.receiver))
        wire({from:byName.get(site.receiver).port,to,label:'',kind:'gate',provenance:'ast-guard',gate});
    }
  }
  // A receiver called more than once carries the object between those calls, in call order.
  const threads=new Map();
  for(const c of order)for(const site of c.sites)if(site.receiver) {
    (threads.get(site.receiver)??threads.set(site.receiver,[]).get(site.receiver)).push({start:site.node.start,to:c.node.path});
  }
  const threaded=[];
  for(const [receiver,list] of threads) {
    const steps=list.sort((a,b)=>a.start-b.start).filter((s,i,all)=>i===0||all[i-1].to!==s.to);
    if(steps.length<2)continue;
    threaded.push(...steps.map(s=>({...s,receiver})));
    if(byName.has(receiver))wire({from:byName.get(receiver).port,to:steps[0].to,label:receiver,kind:'state',provenance:'state-thread'});
    for(let i=1;i<steps.length;i++)wire({from:steps[i-1].to,to:steps[i].to,label:receiver,kind:'state',provenance:'state-thread'});
  }
  // What the body returns, and which component produced it.
  const returns=[];
  (function walk(n){if(n!==fn&&stop.has(n.start))return;if(n!==fn&&functions.has(n.type))return;
    if(n.type==='ReturnStatement'&&n.argument)returns.push(n.argument);
    for(const c of kids(n))walk(c);})(fn);
  if(fn.body.type!=='BlockStatement')returns.push(fn.body);
  // Returns of the same expression are one exit; the page says what leaves, not how often.
  const exits=new Map();
  for(const r of returns) {const t=src(text,r);(exits.get(t)??exits.set(t,[]).get(t)).push(r);}
  const outputs=[...exits].map(([t,list],i)=>({port:`out${i+1}`,name:t,lines:list.map(r=>r.loc.start.line),provenance:'ast-return'}));
  // A thread's last step before an exit reaches that exit: the return value may be a bare
  // tag, but the object the body was writing to leaves through it.
  threaded.sort((a,b)=>a.start-b.start);
  [...exits.values()].forEach((list,i)=>{for(const r of list) {
    for(const p of producers(r))wire({from:p.component,to:`out${i+1}`,label:p.label??'',kind:'return',provenance:'ast-return'});
    for(const root of roots(r))for(const p of produced.get(root)??[])wire({from:p.component,to:`out${i+1}`,label:p.label??root,kind:'return',provenance:'ast-return'});
    const last=threaded.filter(s=>s.start<r.start).at(-1);
    if(last)wire({from:last.to,to:`out${i+1}`,label:last.receiver,kind:'return',provenance:'state-thread'});
  }});

  const present=c=>({handle:c.node.handle,path:c.node.path,label:c.node.label,foot:foot(c.node),file:c.node.file,line:c.node.line,endLine:c.node.endLine,
    order:c.index,calls:c.sites.length,links:[...c.links].sort(),provenance:'ast-call-site',
    sites:c.sites.map(s=>({line:s.node.loc.start.line,column:s.node.loc.start.column+1,...(s.receiver?{receiver:s.receiver}:{}),link:linkOf(s.relation),provenance:'ast-call-site'})),
    ...(c.sites.every(s=>gateOf(s))&&new Set(c.sites.map(s=>gateOf(s).text)).size===1?{gate:{...gateOf(c.sites[0])}}:{}),
    opens:opens.has(c.node.path),vocabulary:vocabulary(c.node),weak:weak(c)});
  // Heuristic `vocabulary`: a callee that calls nothing mapped, spans at most three source
  // lines and is called from at least ten distinct mapped files is shared language, not a step.
  function vocabulary(n) {return leaf(n)&&n.endLine-n.line+1<=3&&fanIn(n)>=10;}
  // Heuristic `unique-method-name-only`: every call site linked by the method-name fallback
  // alone. That rule cannot tell a mapped method from a same-named built-in.
  function weak(c) {return [...c.links].every(l=>l==='unique-method-name');}

  const drawn=order.map(present),keep=drawn.filter(c=>!c.vocabulary&&!c.weak);
  const kept=new Set([...keep.map(c=>c.path),...params.map(p=>p.port),...outputs.map(o=>o.port)]);
  const filtered=drawn.filter(c=>!kept.has(c.path));
  const live=w=>kept.has(w.from)&&kept.has(w.to);
  return {flow:true,generated:true,authored:[],
    node:{handle:node.handle,path:node.path,label:node.label,foot:foot(node),file:node.file,line:node.line,endLine:node.endLine,kind:node.kind},
    inputs:params,outputs,
    components:keep.map(({vocabulary,weak,...c})=>c),
    wires:wires.filter(live),
    vocabulary:filtered.filter(c=>c.vocabulary).map(({vocabulary,weak,...c})=>({...c,provenance:'heuristic:vocabulary'})),
    weak:filtered.filter(c=>!c.vocabulary&&c.weak).map(({vocabulary,weak,...c})=>({...c,provenance:'heuristic:unique-method-name-only'})),
    withheldWires:wires.filter(w=>!live(w)),
    unresolved,
    heuristics:[{name:'heuristic:vocabulary',rule:'callee makes no mapped call, spans <= 3 source lines and is called from >= 10 distinct mapped files',
        filtered:filtered.filter(c=>c.vocabulary).map(c=>c.path)},
      {name:'heuristic:unique-method-name-only',rule:'every call site of this callee was linked by the unique-method-name fallback, which cannot exclude a same-named built-in',
        filtered:filtered.filter(c=>!c.vocabulary&&c.weak).map(c=>c.path)}],
    limits:['Components are possible callees at a site, ordered by first call site; order is not an execution trace.',
      'A gate is the source text of the nearest enclosing test. Early returns, throws and reassignment are not gates and are not shown.',
      'Def-use follows names, not scopes: a shadowed name is read as one binding.',
      'A state thread is the same receiver name at more than one call site, in source order; no mutation or dominance proof.']};
}

const slug=path=>path.replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
// Layout and viewer are the shared Python ones; flow.py adds only provenance styling.
export async function buildFlow(targets,out,{repo=fileURLToPath(new URL('../../',import.meta.url))}={}) {
  const {mkdir}=await import('node:fs/promises'),{spawn}=await import('node:child_process');
  const context=await loadFlow({repo});
  const pages=targets.map(target=>{const packet=flowPacket(context,target);return {...packet,key:slug(packet.node.path)};});
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
  const graph=await extractGraph({repo,files:list,importAliases,literalCouplings:true,receiverCalls:true,readSource:read});
  return {graph,projection:projectGraph(graph),sources};
}
