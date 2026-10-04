// Benchmark support for dev-map/influence/JELLY.md: compare Jelly's call graph
// (https://github.com/cs-au-dk/jelly, run outside the repository) with the runtime traces and with
// our analysis. Jelly is not a SAAM dependency; this script only reads its JSON output.
//
//   node dev-map/influence/trace/jelly-to-keys.mjs convert --jelly CG.json --out A.json [--strip PREFIX]
//       Jelly call graph (`jelly -b BASE -j CG.json FILES...`) to the `run.mjs --out` shape
//       compare.mjs reads: every in-scope function becomes a leaf with the analysis key (file + ':' +
//       acorn start offset), every call edge an arrow of kind `call`. --strip removes the path from
//       BASE to this repository when BASE is wider (so Jelly reaches dependencies through a junction).
//   node dev-map/influence/trace/jelly-to-keys.mjs diff --dir TRACES --jelly A.json --ours B.json [--out FILE]
//       Per observed call, whether Jelly has the edge and whether our map covers it (by role, as
//       compare.mjs, and as any arrow between the pair); plus static edges each has that the other lacks.
//
// Position mapping. Jelly reports 1-based line:column spans from Babel. A function maps to the
// acorn node starting at the same line and column: function nodes directly; a class or object
// method (Babel starts it at its key or modifier) to its value's function; a class to its explicit
// constructor, or the class node without one; module code (1:1 of a whole file) to the Program.
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as acorn from 'acorn';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const argv=process.argv.slice(2);
const option=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};

const FUNCTION=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const CLASS=new Set(['ClassDeclaration','ClassExpression']);

// line:col (1-based col) -> {key,name,line} for every callable start a Jelly function may report.
function positions(file) {
  const text=readFileSync(resolve(repo,file),'utf8');
  let ast;
  for(const sourceType of ['module','script']) {
    try{ast=acorn.parse(text,{ecmaVersion:'latest',sourceType,locations:true,allowHashBang:true});break;}catch{}
  }
  const at=new Map();
  if(!ast)return at;
  const put=(loc,node,name)=>{const k=loc.line+':'+(loc.column+1);if(!at.has(k))at.set(k,{key:file+':'+node.start,line:node.loc.start.line,name:name??'(anonymous)'});};
  const nameOf=p=>p.computed?'[computed]':p.key.type==='Identifier'?p.key.name:p.key.type==='PrivateIdentifier'?'#'+p.key.name:String(p.key.value);
  const visit=(node,hint)=>{
    if(!node||typeof node.type!=='string')return;
    if(FUNCTION.has(node.type))put(node.loc.start,node,node.id?.name??hint);
    if(CLASS.has(node.type)) {
      const ctor=node.body.body.find(m=>m.type==='MethodDefinition'&&m.kind==='constructor');
      put(node.loc.start,ctor?ctor.value:node,node.id?.name??hint);
    }
    if((node.type==='MethodDefinition'||(node.type==='Property'&&(node.method||node.kind!=='init')))&&FUNCTION.has(node.value?.type)) {
      // Jelly reports a method at its start or, after `static`, at its key.
      put(node.loc.start,node.value,nameOf(node));
      put(node.key.loc.start,node.value,nameOf(node));
    }
    if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')hint=node.id.name;
    else if(node.type==='Property'||node.type==='PropertyDefinition')hint=node.key&&!node.computed?nameOf(node):hint;
    else if(!FUNCTION.has(node.type))hint=undefined;
    for(const k in node) {
      if(k==='loc'||k==='type'||k==='start'||k==='end')continue;
      const v=node[k];
      if(Array.isArray(v))for(const c of v)visit(c,hint);else if(v&&typeof v.type==='string')visit(v,hint);
    }
  };
  visit(ast);
  at.set('module',{key:file+':'+ast.start,line:1,name:'(module)'});
  return at;
}

// Scope: the same rule as dev-map/influence/run.mjs. Jelly functions outside it (dependencies,
// out-of-scope SAAM files) are platform code, so a path A -> platform... -> B is the call A -> B,
// as the traces see it (they record the SAAM callable current when B is entered).
const ROOTS=/^(core|studio|skills|workspaces|scripts|adapters)\/|^packaging\/(application|launch|build|native-repair)\.mjs$/;
const OUT=/(^|\/)(tests?|demos?|bench|benchmarks?|fixtures?|examples?|vendor|node_modules)\/|\.test\.|\.min\.|^scripts\/(bench|bambu-audit)|^packaging\/(windows|macos)\//;
const inScope=f=>/\.(mjs|js)$/.test(f)&&ROOTS.test(f)&&!OUT.test(f);

// strip: the prefix of Jelly's file names (relative to its base directory) that leads to this
// repository, when Jelly ran with a wider base directory so it could reach dependencies.
function convert(cg,{strip=''}={}) {
  const files=cg.files.map(f=>{f=f.replace(/\\/g,'/');return strip&&f.startsWith(strip)?f.slice(strip.length):strip?'(outside)/'+f:f;});
  const cache=new Map();
  const posOf=i=>{const f=files[i];if(!cache.has(f)){let p=null;if(inScope(f))try{p=positions(f);}catch{}cache.set(f,p);}return cache.get(f);};
  const fns=new Map(),unmapped=[];
  for(const [id,loc] of Object.entries(cg.functions)) {
    const [fi,l1,c1,l2,c2]=loc.split(':').map(Number);
    const file=files[fi],pos=posOf(fi);
    if(!pos){fns.set(+id,{external:true,file});continue;}
    let hit=pos.get(l1+':'+c1);
    // Module code: Jelly spans the whole file from 1:1 (a function at 1:1 ends earlier).
    if(l1===1&&c1===1) {
      const lastLine=readFileSync(resolve(repo,file),'utf8').split(/\r\n|\r|\n/).length;
      if(l2>=lastLine-1||!hit)hit={...pos.get('module'),module:true};
    }
    if(!hit){unmapped.push({file,loc:`${l1}:${c1}-${l2}:${c2}`});fns.set(+id,{unmapped:true,file});continue;}
    fns.set(+id,{...hit,file});
  }
  const name=f=>`${f.file}:${f.line} ${f.name}@${f.key.slice(f.key.lastIndexOf(':')+1)}`;
  const leaves=new Map();
  for(const f of fns.values())if(f.key&&!leaves.has(f.key))leaves.set(f.key,{leaf:name(f),key:f.key});
  const succ=new Map();
  for(const [a,b] of cg.fun2fun)(succ.get(a)??succ.set(a,[]).get(a)).push(b);
  // Internal callees reached from a through external functions only.
  const viaExternal=new Map();
  const reach=x=>{
    if(viaExternal.has(x))return viaExternal.get(x);
    const out=new Set(),seen=new Set([x]),stack=[x];
    while(stack.length)for(const y of succ.get(stack.pop())??[]) {
      if(seen.has(y))continue;seen.add(y);
      if(fns.get(y)?.external)stack.push(y);else out.add(y);
    }
    viaExternal.set(x,out);return out;
  };
  const arrows=new Map();let direct=0,throughPlatform=0,unmappedEdges=0,moduleLoads=0;
  const add=(x,y,how)=>{
    if(!x?.key||!y?.key){unmappedEdges++;return;}
    if(x.key===y.key)return;
    // Module loading (import edges into module code) is not a call the traces or our map count.
    if(y.module){moduleLoads++;return;}
    const k=x.key+'>'+y.key;
    if(!arrows.has(k)){arrows.set(k,{from:name(x),to:name(y),fromKey:x.key,toKey:y.key,kind:'call',count:1,via:how});how==='direct'?direct++:throughPlatform++;}
  };
  for(const [a,b] of cg.fun2fun) {
    const x=fns.get(a),y=fns.get(b);
    if(x?.external)continue;
    if(!y?.external)add(x,y,'direct');
    else for(const z of reach(b))add(x,fns.get(z),'platform');
  }
  return {summary:{source:'jelly',jellyFiles:files.length,inScopeFiles:files.filter(inScope).length,jellyFunctions:Object.keys(cg.functions).length,
      mappedFunctions:leaves.size,unmappedFunctions:unmapped.length,externalFunctions:[...fns.values()].filter(f=>f.external).length,callables:leaves.size,
      callEdges:arrows.size,directEdges:direct,edgesThroughPlatformCode:throughPlatform,moduleLoadEdgesLeftOut:moduleLoads,edgesWithUnmappedEnds:unmappedEdges},
    unmapped,arrows:[...arrows.values()],leaves:[...leaves.values()]};
}

// Our map's arrows back to call edges: an answer B -> A is the call A -> B; the rest are calls.
const oursCalls=analysis=>new Set(analysis.arrows.filter(a=>a.fromKey&&a.toKey).map(a=>a.kind==='answer'?a.toKey+'>'+a.fromKey:a.fromKey+'>'+a.toKey));
const anyArrow=analysis=>{const s=new Set();for(const a of analysis.arrows){s.add(a.fromKey+'>'+a.toKey);s.add(a.toKey+'>'+a.fromKey);}return s;};

// Observed calls by key, as compare.mjs counts them: no module evaluation, no event-loop entries,
// no self-calls.
function observedPairs(dir) {
  const files=[];
  const walk=(d,wf)=>{for(const n of readdirSync(d)){const p=join(d,n);if(statSync(p).isDirectory())walk(p,wf??n);else if(/^trace-.*\.json$/.test(n))files.push({p,wf});}};
  walk(dir);
  const pairs=new Map();
  for(const {p,wf} of files) {
    const t=JSON.parse(readFileSync(p,'utf8'));
    const fns=new Map(t.functions.map(f=>[f.id,f])),sites=new Map(t.sites.map(s=>[s.id,s]));
    for(const e of t.edges) {
      const to=fns.get(e.to);if(to.kind==='module'||e.from===0)continue;
      const from=fns.get(e.from);if(from.key===to.key)continue;
      const k=from.key+'>'+to.key;
      const o=pairs.get(k)??{from,to,n:0,sites:new Set(),async:new Set(),workflows:new Set()};
      o.n+=e.n;o.workflows.add(wf);for(const a of Object.keys(e.async??{}))o.async.add(a);
      for(const [sid] of e.sites){const s=sites.get(sid);o.sites.add(`${s.file}:${s.line} ${s.text}`);}
      pairs.set(k,o);
    }
  }
  return pairs;
}

async function diff(dir,jelly,ours) {
  const {compare}=await import('./compare.mjs');
  const pairs=observedPairs(dir);
  // Causes as compare.mjs assigns them (by trace label), from Jelly's run, then ours.
  const label=f=>`${f.file}:${f.line} ${f.name}`;
  const causes=new Map();
  for(const r of [compare(jelly,dir),compare(ours,dir)])for(const m of r.misses)causes.set(m.from+' > '+m.to,m.cause);
  const jc=new Set(jelly.arrows.map(a=>a.fromKey+'>'+a.toKey)),oc=oursCalls(ours),oa=anyArrow(ours);
  const roles=new Map();for(const a of ours.arrows)roles.set(a.fromKey+'>'+a.toKey,(roles.get(a.fromKey+'>'+a.toKey)??new Set()).add(a.kind));
  const oursRole=(a,b)=>roles.get(b+'>'+a)?.has('answer')||[...(roles.get(a+'>'+b)??[])].some(k=>k!=='answer');
  const count=(list,key)=>{const c={};for(const x of list){const k=key(x);c[k]=(c[k]??0)+1;}return Object.fromEntries(Object.entries(c).sort((a,b)=>b[1]-a[1]));};
  const rows=[...pairs].map(([k,o])=>{const [a,b]=k.split('>');
    return {k,o,jelly:jc.has(k),oursCall:oc.has(k),oursRole:!!oursRole(a,b),oursAny:oa.has(k),cause:causes.get(label(o.from)+' > '+label(o.to))??'(covered)'};});
  const n=f=>rows.filter(f).length;
  const item=r=>({from:label(r.o.from),to:label(r.o.to),calls:r.o.n,cause:r.cause,async:[...r.o.async],sites:[...r.o.sites].slice(0,3),workflows:[...r.o.workflows]});
  const jMiss=rows.filter(r=>!r.jelly),oMiss=rows.filter(r=>!r.oursRole);
  // Static call edges where both ends are callables both analyses know.
  const jKeys=new Set(jelly.leaves.map(l=>l.key)),oKeys=new Set([...ours.leaves.map(l=>l.key),...ours.leaves.flatMap(l=>l.foldedKeys??[]),...ours.arrows.flatMap(a=>[a.fromKey,a.toKey])]);
  const common=e=>{const [a,b]=e.split('>');return jKeys.has(a)&&jKeys.has(b)&&oKeys.has(a)&&oKeys.has(b);};
  const jOnly=[...jc].filter(e=>common(e)&&!oc.has(e)),oOnly=[...oc].filter(e=>common(e)&&!jc.has(e));
  const exercised=new Set([...pairs.values()].map(o=>o.from.key));
  return {
    observedPairs:rows.length,
    jelly:{covered:n(r=>r.jelly),misses:jMiss.length},
    ours:{coveredByRole:n(r=>r.oursRole),coveredAsCall:n(r=>r.oursCall),coveredByAnyArrow:n(r=>r.oursAny),misses:oMiss.length},
    missedByJellyOnly:n(r=>!r.jelly&&r.oursRole),missedByOursOnly:n(r=>r.jelly&&!r.oursRole),missedByBoth:n(r=>!r.jelly&&!r.oursRole),
    missedByBothAsCalls:n(r=>!r.jelly&&!r.oursCall),
    jellyMissCauses:count(jMiss,r=>r.cause),
    jellyOnlyMissCauses:count(jMiss.filter(r=>r.oursRole),r=>r.cause),
    oursOnlyMissCauses:count(oMiss.filter(r=>r.jelly),r=>r.cause),
    bothMissCauses:count(oMiss.filter(r=>!r.jelly),r=>r.cause),
    staticEdges:{jelly:jc.size,ours:oc.size,shared:[...jc].filter(e=>oc.has(e)).length,
      jellyOnlyAmongCommonCallables:jOnly.length,oursOnlyAmongCommonCallables:oOnly.length,
      jellyOnlyFromExercisedCallers:jOnly.filter(e=>exercised.has(e.split('>')[0])).length,
      oursOnlyFromExercisedCallers:oOnly.filter(e=>exercised.has(e.split('>')[0])).length},
    lists:{missedByJellyOnly:jMiss.filter(r=>r.oursRole).map(item),missedByOursOnly:oMiss.filter(r=>r.jelly).map(item),
      missedByBoth:oMiss.filter(r=>!r.jelly).map(item),jellyOnlyEdges:jOnly,oursOnlyEdges:oOnly,
      jellyOnlyFromExercised:jOnly.filter(e=>exercised.has(e.split(">")[0])),oursOnlyFromExercised:oOnly.filter(e=>exercised.has(e.split(">")[0]))}
  };
}

const command=argv[0];
if(command==='convert') {
  const out=convert(JSON.parse(readFileSync(option('--jelly'),'utf8')),{strip:option('--strip')});
  writeFileSync(option('--out'),JSON.stringify(out,null,1));
  console.log(JSON.stringify(out.summary,null,1));
} else if(command==='diff') {
  const r=await diff(resolve(option('--dir')),JSON.parse(readFileSync(option('--jelly'),'utf8')),JSON.parse(readFileSync(option('--ours'),'utf8')));
  if(option('--out'))writeFileSync(option('--out'),JSON.stringify(r,null,1));
  const {lists,...head}=r;console.log(JSON.stringify(head,null,1));
} else console.log('Usage: jelly-to-keys.mjs convert --jelly CG.json --out A.json | diff --dir TRACES --jelly A.json --ours B.json [--out FILE]');
