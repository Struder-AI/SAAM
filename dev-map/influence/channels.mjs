// Channels between processes and to outside parties (plans/dev-maps.md#arrows and #scope, owner
// 2026-10-04). SAAM runs as several processes (Studio page, Node application, worker threads,
// native helper, relay); influence crosses between them through HTTP, worker messages, child
// processes and files, and reaches outside actors through console, network, files and the page.
//
// Two steps, as for state (state.mjs), so closures analysed separately merge before matching:
// - contactFacts(pt, built, derived, {modules, resolveImport}) after one analysis: every contact
//   a callable makes with another process or the outside, by kind with the evidence the source
//   shows (route path and method, message discriminant values, worker entry, command, file name),
//   strings evaluated from literals, templates, concatenation, module constants, `new URL(x,
//   import.meta.url)` and path joins; a value taken from a parameter is resolved at the
//   callable's call sites (three levels up). Also every file's static imports, for worker
//   closures. run.mjs --out writes these as `contacts`.
// - withChannels(analysis) on a (merged) analysis: matches senders to receivers and adds leaf
//   arrows (`request`/`reply` over HTTP, `spawn` and `message` for workers, `spawn` for a SAAM
//   process started as a child), makes state nodes (state.mjs) and file state nodes, and assigns
//   each outside contact to an actor channel by the rules in ACTOR_RULES, generated from kind and
//   visible target, never per link. A channel is a leaf owned by its actor (`@channel/ACTOR/NAME:0`);
//   a contact no rule takes goes to `@channel/unassigned/KIND:0`. Senders, receivers and contacts
//   that cannot be resolved are returned in `channels.unresolved`, never dropped.
import {stateNodes,mergeStateFacts} from './state.mjs';

const P='\u0001';// marks a parameter in an evaluated string: P+FUNCTION_KEY#INDEX+P
const order=(a,b)=>a<b?-1:a>b?1:0;
const kids=n=>{const out=[];for(const v of Object.values(n)){if(Array.isArray(v)){for(const c of v)if(c&&typeof c.type==='string')out.push(c);}else if(v&&typeof v.type==='string')out.push(v);}return out;};
const isFn=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
const posix=(base,rel)=>{const parts=base.split('/');parts.pop();for(const s of rel.split('/')){if(s==='..')parts.pop();else if(s!=='.'&&s!=='')parts.push(s);}return parts.join('/');};

// Per module: functions by start, module-level string constants, each node's parent.
function moduleIndex(m) {
  const fns=new Map(),consts=new Map(),parent=new Map();
  const walk=(n,p)=>{if(p)parent.set(n,p);if(isFn(n))fns.set(n.start,n);for(const c of kids(n))walk(c,n);};
  walk(m.ast,null);
  for(const s0 of m.ast.body){const s=s0.type==='ExportNamedDeclaration'?s0.declaration:s0;
    if(s?.type==='VariableDeclaration'&&s.kind==='const')for(const d of s.declarations)if(d.id.type==='Identifier'&&d.init)consts.set(d.id.name,d.init);}
  return {fns,consts,parent};
}

// A string the expression evaluates to, '*' standing for what the source does not show. `at`
// records the literal giving the last path segment (a file's declaring site).
function evaluator(file,idx,fn) {
  // Parameters of the callable and of the functions enclosing it, innermost first.
  const params=new Map();
  for(let g=fn;g;g=idx.parent.get(g)){if(!isFn(g))continue;
    g.params.forEach((p,i)=>{const id=p.type==='AssignmentPattern'?p.left:p;if(id.type==='Identifier'&&!params.has(id.name))params.set(id.name,`${file}:${g.start}#${i}`);});}
  // The one const of that name the callable's own body declares (not a nested function's).
  const localConst=name=>{
    if(!fn)return null;const found=[];
    const walk=n=>{if(n!==fn&&isFn(n))return;
      if(n.type==='VariableDeclaration'&&n.kind==='const')for(const d of n.declarations)if(d.id.type==='Identifier'&&d.id.name===name&&d.init)found.push(d.init);
      for(const c of kids(n))walk(c);};
    walk(fn);return found.length===1?found[0]:null;
  };
  // A path inside SAAM's own installation ('@'), its '.' and '..' segments resolved; one that
  // climbs out of it is unknown.
  const own=s=>{
    if(!s.startsWith('@'))return s;
    const out=[];
    for(const seg of s.slice(1).split('/')) {
      if(!seg||seg==='.')continue;
      if(seg!=='..'){out.push(seg);continue;}
      if(!out.length||/[*\u0001]/.test(out.at(-1)))return '*';
      out.pop();
    }
    return '@'+out.join('/');
  };
  const ev=(n,depth=0)=>{
    if(!n||depth>8)return {s:'*'};
    switch(n.type) {
      case 'Literal':return typeof n.value==='string'?{s:n.value,at:n.start}:{s:'*'};
      case 'TemplateLiteral':{let s='',at;n.quasis.forEach((q,i)=>{s+=q.value.cooked;if(q.value.cooked)at=q.start;if(i<n.expressions.length){const e=ev(n.expressions[i],depth+1);s+=e.s;if(e.at!==undefined)at=e.at;}});return {s,at};}
      case 'BinaryExpression':if(n.operator==='+'){const a=ev(n.left,depth+1),b=ev(n.right,depth+1);return {s:a.s+b.s,at:b.at??a.at};}return {s:'*'};
      case 'Identifier':{
        const local=localConst(n.name);
        if(local)return ev(local,depth+1);
        if(params.has(n.name))return {s:P+params.get(n.name)+P};
        if(idx.consts.has(n.name))return ev(idx.consts.get(n.name),depth+1);
        return {s:'*'};}
      case 'AssignmentPattern':return ev(n.left,depth+1);
      case 'AwaitExpression':return ev(n.argument,depth+1);
      case 'NewExpression':
        if(n.callee.name==='URL'&&n.arguments[0]){const a=ev(n.arguments[0],depth+1);const b=n.arguments[1];
          if(b?.type==='MemberExpression'&&b.object.type==='MetaProperty'&&a.s&&!a.s.includes('*')&&!a.s.includes(P))return {s:'@'+posix(file,a.s),at:a.at};return a;}
        return {s:'*'};
      case 'CallExpression':{
        const name=n.callee.type==='MemberExpression'?n.callee.property.name:n.callee.name;
        // import.meta.resolve(name): an installed package, within SAAM's own installation.
        if(name==='resolve'&&n.callee.object?.type==='MetaProperty'&&n.arguments[0])return {s:'@node_modules/'+ev(n.arguments[0],depth+1).s};
        if(/^(join|resolve)$/.test(name??'')&&n.arguments.length){const parts=n.arguments.map(x=>ev(x,depth+1));const last=[...parts].reverse().find(p=>p.at!==undefined);
          return {s:own(parts.map(p=>p.s).join('/')),at:last?.at};}
        if(name==='fileURLToPath'&&n.arguments[0])return ev(n.arguments[0],depth+1);
        if(name==='dirname'&&n.arguments[0]){const a=ev(n.arguments[0],depth+1).s;return {s:/^@[^*\u0001]*$/.test(a)?a.slice(0,Math.max(1,a.lastIndexOf('/'))):'*'};}
        return {s:'*'};
      }
      case 'MemberExpression':
        if(n.object.name==='process'&&n.property.name==='execPath')return {s:'@node'};
        if(n.object.type==='MetaProperty'&&n.property.name==='url')return {s:'@'+file};
        return {s:'*'};
      default:return {s:'*'};
    }
  };
  return ev;
}
const literalValues=(n,names)=>{const out=new Set();
  if(n?.type==='ObjectExpression')for(const p of n.properties)if(p.type==='Property'&&!p.computed&&names.includes(p.key.name??p.key.value)&&p.value.type==='Literal')out.add(`${p.key.name??p.key.value}=${p.value.value}`);
  return out;};
// Discriminant values a receiver tests: x.type === 'v', switch(x.type) case 'v'.
const testedValues=(fnNode,names)=>{const out=new Set();if(!fnNode)return out;
  const prop=n=>n?.type==='MemberExpression'&&!n.computed&&names.includes(n.property.name)?n.property.name:null;
  const walk=n=>{
    if(n.type==='BinaryExpression'&&/^[!=]==?$/.test(n.operator)){const k=prop(n.left)??prop(n.right),v=n.left.type==='Literal'?n.left:n.right.type==='Literal'?n.right:null;if(k&&v&&typeof v.value==='string')out.add(`${k}=${v.value}`);}
    if(n.type==='SwitchStatement'){const k=prop(n.discriminant);if(k)for(const c of n.cases)if(c.test?.type==='Literal')out.add(`${k}=${c.test.value}`);}
    for(const c of kids(n))walk(c);};
  walk(fnNode.body??fnNode);return out;};

const DISCRIMINANTS=['type','stage','command','kind','op'];
// Whether a message handler passes its message (its first parameter, or a name destructured from
// it) to a call as a whole argument.
const forwardsMessage=fnNode=>{
  const p=fnNode?.params?.[0];if(!p)return false;
  const names=new Set(p.type==='Identifier'?[p.name]:p.type==='ObjectPattern'?p.properties.map(q=>q.value?.type==='Identifier'?q.value.name:null).filter(Boolean):[]);
  if(!names.size)return false;
  let hit=false;
  const walk=n=>{if(hit)return;if((n.type==='CallExpression'||n.type==='NewExpression')&&n.arguments.some(a=>a.type==='Identifier'&&names.has(a.name)))hit=true;for(const c of kids(n))walk(c);};
  walk(fnNode.body);return hit;};
// A port a worker thread talks to its starter through: parentPort (a MessagePort), or the worker
// global (self) in a browser worker.
const WORKER_SIDE=/parentPort|MessagePort|^self$|globalThis|WorkerGlobalScope|^postMessage$|^onmessage$/;
export function contactFacts(pt,{functions},derived,{modules=[],resolveImport}={}) {
  const {canon}=derived;
  const mods=new Map(modules.map(m=>[m.file,m])),indexes=new Map();
  const idxOf=file=>{if(!mods.has(file))return null;if(!indexes.has(file))indexes.set(file,moduleIndex(mods.get(file)));return indexes.get(file);};
  const keyOf=id=>functions[canon(id)].key;
  const contacts=[],seen=new Set();
  const add=(f,site,c)=>{const k=`${keyOf(f.id)}|${site?.id??''}|${c.kind}|${JSON.stringify(c)}`;if(seen.has(k))return;seen.add(k);
    contacts.push({key:keyOf(f.id),file:f.file,line:site?.line??f.line,site:site?.id??`${f.file}:${f.start}`,...c});};
  const spawnSites=new Map();// site id -> entry
  const instanceSites=o=>{const x=pt.objects[o];return x?.site?[x.site]:[];};
  // A call's receiver node, or for a property write (worker.onmessage=) the written object's.
  let storeBase=new Map();
  const receiverInfo=s=>{const sites=new Set(),platform=new Set();
    const node=s.receiver??storeBase.get(s);
    if(node===undefined)return {sites,platform};
    for(const o of pt.pts[node]){const x=pt.objects[o];if(x.kind==='platform')platform.add(x.name);for(const id of instanceSites(o))sites.add(id);}
    return {sites,platform};};
  const cbKeys=s=>[...new Set((s.platformCallbacks??[]).map(id=>keyOf(id)))];
  const cbNode=key=>{const i=key.lastIndexOf(':');const file=key.slice(0,i);return mods.has(file)?idxOf(file).fns.get(Number(key.slice(i+1))):null;};
  // A handler that passes the message on whole (receive(message), resolve(data)) takes every
  // value: what it tests itself does not limit what its callee handles.
  const tested=keys=>{const out=new Set();for(const k of keys){const n=cbNode(k);if(forwardsMessage(n))return [];for(const v of testedValues(n,DISCRIMINANTS))out.add(v);}return [...out].sort();};

  for(const f of functions) {
    if(canon(f.id)!==f.id&&!f.inClone)continue;
    const m=mods.get(f.file);if(!m)continue;
    const idx=idxOf(f.file),fnNode=f.module?null:idx.fns.get(f.start);
    const ev=evaluator(f.file,idx,fnNode);
    const sites=[...f.calls,...f.stores.map(st=>st.site).filter(Boolean)];
    storeBase=new Map(f.stores.filter(st=>st.site).map(st=>[st.site,st.base]));
    const storeName=new Map(f.stores.filter(st=>st.site).map(st=>[st.site,st.name]));
    for(const s of sites) {
      const apis=[...(s.apis?.keys()??[])];
      // `worker.onmessage = handler` on a worker a start made (an instance, not a platform
      // object, so the write reaches no platform API): a listener on that worker, the handler
      // the function written there.
      if(!apis.length&&storeName.get(s)==='onmessage') {
        const {sites:rs}=receiverInfo(s);
        if(rs.size){const asg=idx.parent.get(s.node),right=asg?.type==='AssignmentExpression'?asg.right:null;
          const keys=right&&isFn(right)?[`${f.file}:${right.start}`]:[];
          add(f,s,{kind:'worker-listen',sites:[...rs].sort(),handlers:keys,values:tested(keys),receiver:[],setter:true});}
        continue;
      }
      if(!apis.length)continue;
      const node=s.node,args=node?.arguments??[];
      const has=re=>apis.some(a=>re.test(a));
      const effects=s.effects??new Set(),reads=s.worldReads??new Set();
      if(has(/(^|[.\s])fetch$/)&&!has(/^set /)) {
        const method=args[1]?.type==='ObjectExpression'?args[1].properties.find(p=>p.key?.name==='method')?.value:null;
        add(f,s,{kind:'http-send',url:ev(args[0]).s,method:method?.type==='Literal'?method.value:method?'*':'GET',replyUsed:!!s.resultUsed});continue;
      }
      if(has(/(^|[.\s])EventSource$/)){add(f,s,{kind:'http-send',url:ev(args[0]).s,method:'GET',stream:true,replyUsed:true,listeners:[]});continue;}
      // Only `new Worker(...)`: a call whose callee merely may hold the constructor (imprecise
      // points-to through a shared receiver, e.g. this.map.has) starts no thread.
      if(has(/(^|[.\s])Worker$/)&&node?.type==='NewExpression'&&/Worker$/.test(node.callee.name??node.callee.property?.name??'')) {
        const e=ev(args[0]).s;spawnSites.set(s.id,e);
        add(f,s,{kind:'worker-spawn',spawn:s.id,entry:e,api:apis.find(a=>/(^|[.\s])Worker$/.test(a)),data:literalValues(args[1],['workerData']).size>0||args[1]!==undefined});continue;
      }
      // Which side of a worker a message call is on is decided when matching (withChannels): the
      // objects its receiver holds that a worker start made, or else the worker its file runs in.
      if(has(/postMessage$/)) {
        const {sites:rs,platform}=receiverInfo(s);
        add(f,s,{kind:'worker-post',sites:[...rs].sort(),values:[...literalValues(args[0],DISCRIMINANTS)].sort(),receiver:[...platform].sort()});continue;
      }
      const listen=apis.find(a=>/\.(on|once|addListener|addEventListener)$/.test(a)&&!/^set /.test(a));
      const setter=apis.find(a=>/^set .*\.onmessage$/.test(a));
      if(listen&&args[0]?.type==='Literal'&&args[0].value==='message'||setter) {
        const {sites:rs,platform}=receiverInfo(s);const keys=cbKeys(s);
        add(f,s,{kind:'worker-listen',sites:[...rs].sort(),handlers:keys,values:tested(keys),receiver:[...platform].sort()});continue;
      }
      if(listen&&args[0]?.type==='Literal'&&/EventSource/.test(apis.join(' ')))add(f,s,{kind:'stream-listen',event:args[0].value,handlers:cbKeys(s)});
      if(has(/^node:child_process\./)) {
        const cmd=ev(args[0]).s,list=args[1]?.type==='ArrayExpression'?args[1].elements.map(x=>ev(x).s):[];
        const api=apis.find(a=>/child_process/.test(a));
        add(f,s,/ChildProcess\.prototype/.test(api)?{kind:'process-control',api}:{kind:'process-spawn',command:cmd,args:list.slice(0,4),api});continue;
      }
      if(has(/^console\./)){const a=apis.find(x=>/^console\./.test(x));add(f,s,{kind:'console',stream:/\.(log|info|table|dir)$/.test(a)?'stdout':'stderr',api:a});continue;}
      if(has(/Writable\.prototype\.write$|\.end$/)) {
        const {platform}=receiverInfo(s);
        const std=[...platform].find(n=>/^process\.(stdout|stderr)$/.test(n));
        if(std){add(f,s,{kind:'console',stream:std.slice(8),api:std+'.write'});continue;}
      }
      if(has(/^node:fs/)||effects.has('fs')||reads.has('fs')) {
        const a=apis.find(x=>/fs/.test(x))??apis[0];
        const watch=/watch/i.test(a);
        const e=args[0]?ev(args[0]):{s:'*'};
        const write=effects.has('fs')&&!watch,read=reads.has('fs')||watch;
        const atLiteral=e.at!==undefined?`${f.file}:${e.at}`:undefined;
        if(write||read)add(f,s,{kind:write&&read?'file-write':write?'file-write':'file-read',...(write&&read?{alsoReads:true}:{}),path:e.s,api:a,...(atLiteral?{nameAt:atLiteral}:{}),...(watch?{watch:true}:{})});
        continue;
      }
      // A server's own responses and a fetch's response body are the HTTP channel (routes, replies).
      if(effects.has('network')||reads.has('network'))add(f,s,{kind:has(/^node:http\.|^(Response|ReadableStream)|Body/)?'http-serve':'network',api:apis[0]});
      else if(effects.has('dom')||effects.has('ui'))add(f,s,{kind:'ui-out',api:apis[0]});
      else if(reads.has('dom')||reads.has('ui'))add(f,s,{kind:'ui-in',api:apis[0]});
      else if(effects.has('storage')||reads.has('storage'))add(f,s,{kind:'storage',api:apis[0],storageKey:ev(args[0]).s});
    }
    // HTTP routes: comparisons of a request path with a literal, with the method tested beside it.
    if(fnNode||f.module) {
      const root=fnNode?.body??(f.module?m.ast:null);
      const walk=(n,methods)=>{
        if(n!==root&&isFn(n))return;
        if(n.type==='LogicalExpression'&&n.operator==='&&'){const ms=[];const scan=x=>{if(x.type==='LogicalExpression'&&x.operator==='&&'){scan(x.left);scan(x.right);}
          else if(x.type==='BinaryExpression'&&/^[!=]==?$/.test(x.operator)){const mem=x.left.type==='MemberExpression'?x.left:x.right,lit=x.left.type==='Literal'?x.left:x.right;if(mem?.property?.name==='method'&&lit?.type==='Literal')ms.push(lit.value);}};scan(n);methods=ms.length?ms:methods;}
        if(n.type==='BinaryExpression'&&/^[!=]==?$/.test(n.operator)) {
          const mem=n.left.type==='MemberExpression'?n.left:n.right,lit=n.left.type==='Literal'?n.left:n.right;
          if(/^(pathname|url)$/.test(mem?.property?.name??'')&&lit?.type==='Literal'&&typeof lit.value==='string'&&lit.value.startsWith('/'))
            add(f,{id:`${f.file}:${n.start}`,line:n.loc?.start.line},{kind:'http-route',path:lit.value,method:methods?.[0]??'*'});
        }
        if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='startsWith'&&/^(pathname|url)$/.test(n.callee.object.property?.name??'')&&n.arguments[0]?.type==='Literal'&&String(n.arguments[0].value).startsWith('/'))
          add(f,{id:`${f.file}:${n.start}`,line:n.loc?.start.line},{kind:'http-route',path:n.arguments[0].value,prefix:true,method:methods?.[0]??'*'});
        for(const c of kids(n))walk(c,methods);
      };
      if(root)walk(root,null);
    }
  }
  // Parameters: a value a callable takes from its caller is the caller's argument there.
  const callers=new Map();
  for(const e of derived.edges)if(e.via==='call')(callers.get(e.to)??callers.set(e.to,[]).get(e.to)).push(e);
  const byKey=new Map();for(const f of functions)if(canon(f.id)===f.id)byKey.set(f.key,f.id);
  const marker=new RegExp(P+'([^'+P+']*)#(\\d+)'+P,'g'),blank=v=>v.replace(marker,'*');
  const substitute=(value,depth)=>{
    const m=[...value.matchAll(marker)];
    if(!m.length||depth>3)return [{value:blank(value)}];
    const id=byKey.get(m[0][1]),out=[];
    for(const e of callers.get(id)??[]) {
      const caller=functions[e.from],node=e.site.node;if(!node?.arguments)continue;
      const idx=idxOf(caller.file);if(!idx)continue;
      const fnNode=caller.module?null:idx.fns.get(caller.start),ev=evaluator(caller.file,idx,fnNode);
      const v=value.replace(marker,(all,k,i)=>k===m[0][1]?ev(node.arguments[+i]).s:all);
      for(const r of substitute(v,depth+1))out.push({value:r.value,via:r.via??caller.key});
    }
    return out.length?out:[{value:blank(value)}];
  };
  const resolved=[];
  for(const c of contacts) {
    // An `x.onmessage =` listener counts only on an object a worker start made (not an EventSource).
    if(c.setter){delete c.setter;if(!c.sites.some(id=>spawnSites.has(id)))continue;}
    const field=['url','entry','path','command'].find(k=>typeof c[k]==='string'&&c[k].includes(P));
    if(!field){resolved.push(c);continue;}
    const seenV=new Set();
    for(const r of substitute(c[field],0)){if(seenV.has(r.value))continue;seenV.add(r.value);resolved.push({...c,[field]:r.value,...(r.via?{via:r.via}:{})});}
  }
  const imports={};
  for(const m of modules) {
    const out=new Set();
    const walk=n=>{if((n.type==='ImportDeclaration'||n.type==='ExportAllDeclaration'||n.type==='ExportNamedDeclaration'||n.type==='ImportExpression')&&n.source?.type==='Literal'){const t=resolveImport?.(m.file,n.source.value);if(t)out.add(t);}for(const c of kids(n))walk(c);};
    walk(m.ast);imports[m.file]=[...out].sort();
  }
  return {contacts:resolved,imports};
}

// Contacts from several analyses of overlapping code, `lists` largest analysis first: a site (a
// call or comparison, by kind) takes its contacts from the first analysis holding it, since a
// larger one resolves more parameters at more call sites. Imports are a file's own, so united.
export function mergeContactFacts(lists) {
  const contacts=[],taken=new Set(),imports={};
  const siteOf=c=>`${c.kind}|${c.site??`${c.key}|${c.line}`}`;
  for(const l of lists) {
    if(!l)continue;
    const mine=new Set(),seen=new Set();
    for(const c of l.contacts) {
      const s=siteOf(c);if(taken.has(s))continue;mine.add(s);
      const k=JSON.stringify(c);if(!seen.has(k)){seen.add(k);contacts.push(c);}
    }
    for(const s of mine)taken.add(s);
    for(const [f,list] of Object.entries(l.imports??{}))imports[f]??=list;
  }
  return {contacts,imports};
}

// ---- actors -----------------------------------------------------------------------------------
// Outside contacts to actor channels, by kind and visible target (generated, never per link).
// The actors are the authored set's (architecture.json `actors`); a rule whose actor the set does
// not declare is skipped, so its contacts stay unassigned and visible.
export const ACTOR_RULES=[
  {actor:'agent',channel:'saam stdout JSON',test:c=>c.kind==='console'&&c.stream==='stdout'&&/^(scripts\/saam\.mjs|core\/print\/cli\.mjs)$/.test(c.file)},
  {actor:'agent',channel:'saam stderr diagnostics',test:c=>c.kind==='console'&&c.stream==='stderr'&&/^(scripts\/saam\.mjs|core\/print\/cli\.mjs)$/.test(c.file)},
  {actor:'agent',channel:'tool output',test:c=>c.kind==='console'&&/^(scripts|packaging|skills\/[^/]+\/scripts)\//.test(c.file)},
  {actor:'agent',channel:'client launch',test:c=>c.kind==='process-spawn'&&/^packaging\/application\.mjs$/.test(c.file)&&!/node|launch/.test(c.command+c.args.join(' '))},
  {actor:'user',channel:'Studio page',test:c=>(c.kind==='ui-out'||c.kind==='ui-in')&&/^(studio|workspaces|skills\/[^/]+\/ui)\//.test(c.file)},
  {actor:'user',channel:'browser opened',test:c=>c.kind==='process-spawn'&&/rundll32|xdg-open|^open$|\*/.test(c.command)&&/^studio\/browser\.mjs$/.test(c.file)},
  {actor:'user',channel:'tray',test:c=>c.kind==='process-spawn'&&/^packaging\/tray\.mjs$/.test(c.file)},
  {actor:'user',channel:'terminal prompt',test:c=>c.kind==='ui-in'&&/readline/.test(c.api)},
  {actor:'user',channel:'page console',test:c=>c.kind==='console'&&/^(studio|workspaces|skills\/[^/]+\/ui)\//.test(c.file)&&!/server|worker|lifetime/.test(c.file)},
  {actor:'resources',channel:'Thingi10K mirror',test:c=>(c.kind==='http-send'&&/huggingface|thingi/i.test(c.url))||(c.kind==='network'||c.kind==='http-send')&&/^skills\/thingi10k\//.test(c.file)},
  {actor:'resources',channel:'relay service',test:c=>(c.kind==='http-send'||c.kind==='network')&&/^packaging\/release-service\.mjs$/.test(c.file)},
  {actor:'resources',channel:'release downloads',test:c=>(c.kind==='http-send'||c.kind==='network')&&/^packaging\/(update|build)\.mjs$/.test(c.file)},
  {actor:'resources',channel:'local tools (git, compiler)',test:c=>c.kind==='process-spawn'&&(/git|cmake|clang|cl\b|g\+\+|\bcc\b|--version/.test(c.command+' '+c.args.join(' '))
    ||/^(packaging\/build|scripts\/build-[\w-]+)\.mjs$/.test(c.file))},
  {actor:'stl-file',channel:'selected STL',test:c=>c.kind==='file-read'&&(/stl/i.test(c.path)||/import-stl|repair-stl/.test(c.file))},
  {actor:'printer',channel:'delivery folder',test:c=>c.kind==='file-write'&&/delivery/.test(c.path)},
  {actor:'native',channel:'mesh repair process',test:c=>/^process-(spawn|control)$/.test(c.kind)&&(/mesh-repair|saam-mesh/.test(c.command)||/^core\/geom\/mesh-native\.mjs$/.test(c.file))}
];

// ---- matching ---------------------------------------------------------------------------------
const glob=s=>new RegExp('^'+s.split('*').map(x=>x.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$');
const urlPath=u=>{
  if(u==null)return null;
  let s=u;const m=/^(https?:\/\/|\*)([^/]*)(\/.*)?$/.exec(s);
  if(/^https?:\/\//.test(s)){const host=m?.[2]??'';if(!/^(127\.0\.0\.1|localhost|\*)(:|$)/.test(host)&&host!=='*')return {external:host};s=m?.[3]??'/';}
  else if(s.startsWith('*')&&s.length>1){const i=s.indexOf('/',1);s=i<0?'*':'*'+s.slice(i);}
  return {path:s.split('?')[0]};
};
const valuesMeet=(a,b)=>{if(!a?.length||!b?.length)return true;const keys=new Set(b.map(v=>v.split('=')[0]));const sa=a.filter(v=>keys.has(v.split('=')[0]));return !sa.length||sa.some(v=>b.includes(v));};
const basename=p=>{if(!p||p==='*')return null;const last=p.split(/[\\/]/).pop();return last&&!last.includes('*')&&!last.includes('\u0001')?last:null;};

export function withChannels(analysis,{actors=null}={}) {
  if(!analysis.state&&!analysis.contacts)return analysis;
  const leafOf=new Map();
  for(const l of analysis.leaves){leafOf.set(l.key??l.leaf,l.key??l.leaf);for(const k of l.foldedKeys??[])leafOf.set(k,l.key??l.leaf);}
  // A callable known only as a clone's representative: its file's module-load leaf is not its
  // leaf, so it stays unknown and is listed.
  const leaf=k=>leafOf.get(k);
  const leaves=[...analysis.leaves],arrows=[...analysis.arrows];
  const unresolved={senders:[],receivers:[],spawns:[],messages:[],contacts:[],unknownCallables:new Set()};
  const arrow=(from,to,kind,evidence)=>{const f=leaf(from),t=typeof to==='string'&&to.startsWith('@')?to:leaf(to);
    if(!f){unresolved.unknownCallables.add(from);return;}if(!t){unresolved.unknownCallables.add(to);return;}
    if(f!==t)arrows.push({fromKey:f,toKey:t,kind,count:1,...(evidence?{via:evidence}:{})});};
  const counts={};const count=k=>{counts[k]=(counts[k]??0)+1;};

  // State nodes.
  const st=stateNodes(mergeStateFacts([analysis.state??[]]),k=>leaf(k));
  leaves.push(...st.nodes);arrows.push(...st.arrows);for(const k of st.unknownCallables)unresolved.unknownCallables.add(k);
  const {contacts=[],imports={}}=analysis.contacts??{};
  const by=kind=>contacts.filter(c=>c.kind===kind);
  const brief=c=>`${c.file}:${c.line}`;

  // HTTP.
  const routes=by('http-route');const routeHit=new Set();
  for(const c of by('http-send')) {
    const u=urlPath(c.url);
    if(u?.external){c.external=u.external;continue;}
    const path=u?.path;
    const hits=path&&path!=='*'?routes.filter(r=>(r.prefix?glob(path.endsWith('*')?path:path+'*').test(r.path+'x')||path.startsWith(r.path)||glob(path).test(r.path):glob(path).test(r.path)||path===r.path)
      &&(r.method==='*'||c.method==='*'||r.method===c.method)):[];
    // A request to a local path no route takes is listed. One whose target the source does not
    // show (no leading path) is an outside contact: an actor channel takes it, or it is listed
    // with the unassigned contacts.
    if(!hits.length){if(!path?.startsWith('/')){c.external='?';continue;}unresolved.senders.push({at:brief(c),key:c.key,url:c.url,method:c.method,...(c.via?{via:c.via}:{})});continue;}
    for(const r of hits){routeHit.add(r);arrow(c.key,r.key,'request',`${c.method} ${r.path}`);if(c.replyUsed)arrow(r.key,c.key,'reply',`${c.method} ${r.path}`);count('http');}
  }
  for(const r of routes)if(!routeHit.has(r))unresolved.receivers.push({at:brief(r),key:r.key,route:`${r.method} ${r.path}${r.prefix?'*':''}`,note:'no caller found in the analysis'});

  // Workers. A spawn's entry is a module; its thread runs that module's import closure.
  const closure=file=>{const s=new Set([file]),q=[file];while(q.length)for(const d of imports[q.pop()]??[])if(!s.has(d)){s.add(d);q.push(d);}return s;};
  const spawns=new Map();
  for(const c of by('worker-spawn')) {
    const e=c.entry?.startsWith('@')?c.entry.slice(1):c.entry?.startsWith('/')?c.entry.slice(1):null;
    if(!e||!imports[e]){unresolved.spawns.push({at:brief(c),key:c.key,entry:c.entry,note:e?'entry not in the analysis':'entry not visible'});continue;}
    // One start site may run several entries (a parameter resolved at several callers).
    (spawns.get(c.spawn)??spawns.set(c.spawn,[]).get(c.spawn)).push({...c,entryFile:e,files:closure(e)});
    arrow(c.key,`${e}:0`,'spawn',e);count('worker-spawn');
  }
  // A message call is on the starting side when its receiver holds a worker a start made, else on
  // the worker side of every start whose thread runs its file.
  const sideOf=c=>{const own=(c.sites??[]).filter(id=>spawns.has(id)).flatMap(id=>spawns.get(id));
    if(own.length)return {main:own};const runs=[...spawns.values()].flat().filter(s=>s.files.has(c.file));return runs.length?{worker:runs}:null;};
  const listens=by('worker-listen').map(r=>({...r,side:sideOf(r)}));
  for(const r of listens)if(!r.side)unresolved.receivers.push({at:brief(r),key:r.key,kind:r.kind,note:'listens on no worker the analysis saw started, in no worker it saw'});
  for(const c of by('worker-post')) {
    const side=sideOf(c);
    if(!side){unresolved.messages.push({at:brief(c),key:c.key,kind:c.kind,values:c.values,note:'posts to no worker the analysis saw started, from no worker it saw'});continue;}
    let hit=0;
    for(const s of side.main??side.worker)for(const r of listens) {
      if(!r.side||!valuesMeet(c.values,r.values))continue;
      if(side.main?!(r.side.worker??[]).includes(s):!(r.side.main??[]).includes(s))continue;
      for(const h of r.handlers.length?r.handlers:[r.key]){arrow(c.key,h,'message',s.entryFile);hit++;}
    }
    if(!hit)unresolved.messages.push({at:brief(c),key:c.key,kind:c.kind,values:c.values,note:side.main?'no listener in the worker':'no listener on the starting side'});
    else count(side.main?'worker-message':'worker-reply');
  }

  // Child processes running SAAM code.
  for(const c of by('process-spawn')) {
    const script=c.command==='@node'?c.args.find(a=>a.startsWith('@')||/\.mjs$/.test(a)):null;
    const file=script?.startsWith('@')?script.slice(1):script;
    if(file&&imports[file]){arrow(c.key,`${file}:0`,'spawn',file);c.internal=true;count('process-spawn');}
  }

  // Files: a name written by one leaf and read by another is a file state node, declared where
  // the name's literal is (the first writer's), owned like any state.
  const files=new Map();
  for(const c of [...by('file-write'),...by('file-read')]){const n=basename(c.path);if(!n)continue;(files.get(n)??files.set(n,{w:[],r:[]}).get(n))[c.kind==='file-write'?'w':'r'].push(c);if(c.alsoReads)files.get(n).r.push(c);}
  for(const [name,{w,r}] of [...files].sort(([a],[b])=>order(a,b))) {
    const ws=new Set(w.map(c=>leaf(c.key)).filter(Boolean)),rs=new Set(r.map(c=>leaf(c.key)).filter(Boolean));
    if(![...ws].some(x=>[...rs].some(y=>y!==x)))continue;
    const first=list=>list.map(c=>c.nameAt).filter(Boolean).sort()[0];
    const decl=first(w)??first(r);if(!decl)continue;
    const key=`${decl}.2`,line=w.concat(r).find(c=>c.nameAt===decl)?.line??1;
    leaves.push({leaf:`${decl.slice(0,decl.lastIndexOf(':'))}:${line} file ${name}`,key,role:'state',folded:[],foldedKeys:[],state:{file:name,writers:ws.size,readers:rs.size}});
    for(const x of ws)arrows.push({fromKey:x,toKey:key,kind:'writes',count:1});
    for(const y of rs)arrows.push({fromKey:key,toKey:y,kind:'reads',count:1});
    for(const c of [...w,...r])c.internal=true;
    count('file-state');
  }

  // A process-control call (kill, unref) acts on the child its leaf started: it goes where that
  // start goes, SAAM-internal or to the start's channel.
  const starts=new Map();for(const c of by('process-spawn'))(starts.get(leaf(c.key))??starts.set(leaf(c.key),[]).get(leaf(c.key))).push(c);
  for(const c of by('process-control')){const s=starts.get(leaf(c.key));if(!s)continue;if(s.every(x=>x.internal))c.internal=true;else c.controls=s.find(x=>!x.internal);}

  // Outside contacts to actor channels.
  const declared=actors?new Set(actors):null;
  const channelLeaves=new Map();
  const channel=(actor,name)=>{const key=`@channel/${actor}/${name}:0`;
    if(!channelLeaves.has(key)){const l={leaf:`@channel/${actor}:0 ${name}`,key,role:'channel',folded:[],foldedKeys:[],owner:actor==='unassigned'?null:`external:${actor}`,channel:{actor,name}};channelLeaves.set(key,l);leaves.push(l);leafOf.set(key,key);}
    return key;};
  const outside=contacts.filter(c=>!c.internal&&!/^(http-route|http-serve|worker-|stream-listen)/.test(c.kind)&&!(c.kind==='http-send'&&!c.external));
  const assigned={};
  for(const c of outside) {
    if(c.kind==='file-read'&&c.path?.startsWith('@'))continue;// SAAM's own installed files
    const rule=ACTOR_RULES.find(r=>(!declared||declared.has(r.actor))&&r.test(c.controls??c));
    const key=rule?channel(rule.actor,rule.channel):channel('unassigned',c.kind);
    if(!rule)unresolved.contacts.push({at:brief(c),key:c.key,kind:c.kind,...(c.path?{path:c.path}:{}),...(c.command?{command:c.command}:{}),...(c.url?{url:c.url}:{}),...(c.api?{api:c.api}:{})});
    const into=/^(ui-in|file-read)$/.test(c.kind)||c.kind==='network'&&false;
    if(into)arrow(key,c.key,'contact');else {arrow(c.key,key,'contact');if(/^(http-send|process-spawn)$/.test(c.kind))arrow(key,c.key,'contact');}
    const tag=rule?`${rule.actor}/${rule.channel}`:`unassigned/${c.kind}`;assigned[tag]=(assigned[tag]??0)+1;
  }
  const dedup=new Map();for(const a of arrows){const k=`${a.fromKey}\n${a.toKey}\n${a.kind}`;const h=dedup.get(k);if(h)h.count+=a.count??1;else dedup.set(k,{...a});}
  const u={...unresolved,unknownCallables:[...unresolved.unknownCallables].sort()};
  return {...analysis,leaves,arrows:[...dedup.values()],
    channels:{summary:{state:st.summary,links:counts,actorChannels:assigned,
      unresolved:Object.fromEntries(Object.entries(u).map(([k,v])=>[k,v.length]))},unresolved:u}};
}

// ---- SAAM's own files -------------------------------------------------------------------------
// A file contact no actor channel takes and whose name matched no other leaf's (above) mostly
// touches SAAM's own folders: a bundle's files, the SAAM home's state, settings, extensions, temp
// files a helper reads back. Their names are rarely visible, so writer and reader cannot be paired
// by file. Once leaves have owners (solve-middle.mjs ownLeaves), a boundary whose leaves both write
// and read such files keeps them as its own file state: one state node per map-0 owner
// (`@store/OWNER/files:0`, owned by it), its writing leaves `writes` it and it `reads` into its
// reading leaves, joining only leaves of that one boundary. A boundary that only writes or only
// reads them is reaching outside SAAM, and those contacts stay unassigned and listed.
// `model` is leafModel's, `owners` ownLeaves', `nodes` the authored map-0 nodes (for labels).
export function boundaryFileStores(model,owners,{nodes=[]}={}) {
  const W='@channel/unassigned/file-write:0',R='@channel/unassigned/file-read:0';
  const ownerOf=new Map(owners.map(o=>[o.leaf,o.owner])),labelOf=new Map(nodes.map(n=>[n.id,n.label]));
  const groups=new Map();
  for(const a of model.arrows) {
    if(a.kind!=='contact')continue;
    const side=a.to===W?'w':a.from===R?'r':null;if(!side)continue;
    const leaf=side==='w'?a.from:a.to,owner=ownerOf.get(leaf);
    if(!owner||owner.startsWith('external:'))continue;
    const g=groups.get(owner)??groups.set(owner,{w:new Map(),r:new Map(),arrows:[]}).get(owner);
    g[side].set(leaf,(g[side].get(leaf)??0)+(a.count??1));g.arrows.push(a);
  }
  const moved=new Set(),movedLeaves=new Set(),leaves=[],arrows=[],rows=[],summary={};
  for(const [owner,g] of [...groups].sort(([a],[b])=>order(a,b))) {
    if(![...g.w.keys()].some(x=>[...g.r.keys()].some(y=>y!==x)))continue;
    const key=`@store/${owner}/files:0`,label=`${labelOf.get(owner)??owner} files`;
    leaves.push({id:key,name:`@store/${owner}:0 ${label}`,role:'state',folded:[],foldedNames:[],
      state:{store:'files',owner,label,writers:g.w.size,readers:g.r.size}});
    for(const [w,count] of g.w)arrows.push({from:w,to:key,kind:'writes',count});
    for(const [r,count] of g.r)arrows.push({from:key,to:r,kind:'reads',count});
    for(const a of g.arrows)moved.add(a);
    for(const l of [...g.w.keys(),...g.r.keys()])movedLeaves.add(l);
    rows.push({leaf:key,owner,declaration:`@store/${owner}`,via:'boundary files'});
    summary[owner]={writers:g.w.size,readers:g.r.size};
  }
  if(!leaves.length)return {model,owners};
  const kept=[...model.arrows.filter(a=>!moved.has(a)),...arrows],used=new Set(kept.flatMap(a=>[a.from,a.to]));
  const dropped=new Set([W,R].filter(id=>!used.has(id)));
  // The contacts now held as boundary files leave the unresolved list.
  const leafOf=new Map();for(const l of model.leaves){leafOf.set(l.id,l.id);for(const k of l.folded??[])leafOf.set(k,l.id);}
  let channels=model.channels;
  if(channels) {
    const contacts=channels.unresolved.contacts.filter(c=>!(/^file-/.test(c.kind)&&movedLeaves.has(leafOf.get(c.key))));
    const unresolved={...channels.unresolved,contacts};
    channels={...channels,unresolved,summary:{...channels.summary,boundaryFiles:{stores:leaves.length,contacts:channels.unresolved.contacts.length-contacts.length,owners:summary},
      unresolved:Object.fromEntries(Object.entries(unresolved).map(([k,v])=>[k,v.length]))}};
  }
  return {model:{...model,leaves:[...model.leaves.filter(l=>!dropped.has(l.id)),...leaves],arrows:kept,...(channels?{channels}:{})},
    owners:[...owners.filter(o=>!dropped.has(o.leaf)),...rows]};
}
