// Compare runtime traces (runtime.mjs files under a directory) with the analysis output of
// `node dev-map/influence/run.mjs --depth 2 --out FILE all`. Reports every observed influence the
// map lacks, grouped by cause, and how much of the analysed code the traces exercised.
//
// Matching. The analysis names a callable "file:line name"; a trace knows its file, start offset,
// line and a best-effort name. A trace callable matches the analysis callables on its file and
// line, narrowed by name when a line holds several. If the analysis output carries `fromKey`/
// `toKey` (file:offset) on arrows and `key` on leaves, those are used instead.
//
// Coverage of an observed call A -> B: the map has B -> A as an answer (B a query), or A -> B as
// an activation, acknowledged activation or two-way arrow (B a command). Self-calls, module
// evaluation (entries into module load code) and entries with no SAAM callable current (the
// event loop) are not pairs and are counted separately.
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

function traceFiles(dir) {
  const out=[];
  for(const name of readdirSync(dir)) {
    const p=join(dir,name);
    if(statSync(p).isDirectory())out.push(...traceFiles(p).map(f=>({...f,workflow:f.workflow??name})));
    else if(/^trace-.*\.json$/.test(name))out.push({path:p});
  }
  return out;
}

export function compare(analysis,dir,{examples=5}={}) {
  // --- the analysis -------------------------------------------------------------------
  const parseName=s=>{const m=/^(.*?):(\d+) (.*)$/.exec(s);return {file:m[1],line:+m[2],name:m[3]};};
  const callables=new Map();// full name -> {file,line,name,role,key}
  for(const l of analysis.leaves??[]) {
    callables.set(l.leaf,{...parseName(l.leaf),role:l.role,key:l.key,leaf:l.leaf});
    for(const f of l.folded??[])if(!callables.has(f))callables.set(f,{...parseName(f),leaf:l.leaf});
  }
  const arrowKey=(a,b)=>a+'\u0000'+b;
  const arrows=new Map();// from\0to -> Set(kind)
  for(const a of analysis.arrows) {
    for(const x of [a.from,a.to])if(!callables.has(x))callables.set(x,{...parseName(x)});
    const k=arrowKey(a.from,a.to);(arrows.get(k)??arrows.set(k,new Set()).get(k)).add(a.kind);
    // Roles of folded callables follow from their arrows.
    if(a.kind==='answer')callables.get(a.from).inferredRole??='query';
    else callables.get(a.to).inferredRole='command';
  }
  const byLine=new Map(),byKey=new Map();
  for(const [full,c] of callables){const k=c.file+':'+c.line;(byLine.get(k)??byLine.set(k,[]).get(k)).push(full);if(c.key)byKey.set(c.key,full);}
  const unmodelledAt=new Map();
  for(const u of analysis.unmodelled??[])if(u.file)(unmodelledAt.get(u.file+':'+u.line)??unmodelledAt.set(u.file+':'+u.line,[]).get(u.file+':'+u.line)).push(u.kind);

  // --- traces ---------------------------------------------------------------------------
  const ambiguous=new Set(),absent=new Map();
  const matchCache=new Map();
  const match=f=>{
    const key=f.key;if(matchCache.has(key))return matchCache.get(key);
    let m;
    if(byKey.has(key))m=[byKey.get(key)];
    else {
      const all=byLine.get(f.file+':'+f.line)??[];
      if(all.length<=1)m=all;
      else {
        const named=all.filter(x=>callables.get(x).name===f.name);
        m=named.length?named:all;
        if(m.length>1)ambiguous.add(key);
      }
    }
    if(!m.length)absent.set(key,f);
    matchCache.set(key,m);return m;
  };
  const label=f=>`${f.file}:${f.line} ${f.name}`;
  const lastName=s=>String(s??'').split('.').pop();

  const observed=new Map();// caller key>callee key -> aggregated observation
  const exercised=new Set(),exercisedTrace=new Set();
  const rootEntries=new Map();
  let calls=0,threads=0;const workflows=new Set(),failedInstrumentation=[];
  for(const tf of traceFiles(dir)) {
    const t=JSON.parse(readFileSync(tf.path,'utf8'));
    threads++;workflows.add(tf.workflow);
    failedInstrumentation.push(...t.instrumentation.failed);
    const fns=new Map(t.functions.map(f=>[f.id,f])),sites=new Map(t.sites.map(s=>[s.id,s]));
    for(const e of t.edges) {
      calls+=e.n;
      const to=fns.get(e.to);
      exercisedTrace.add(to.key);for(const m of match(to))exercised.add(m);
      if(to.kind==='module')continue;
      if(e.from===0){const r=rootEntries.get(to.key)??{fn:to,n:0,workflows:new Set()};r.n+=e.n;r.workflows.add(tf.workflow);rootEntries.set(to.key,r);continue;}
      const from=fns.get(e.from);
      if(from.key===to.key)continue;
      const k=from.key+'>'+to.key;
      const o=observed.get(k)??{from,to,n:0,platform:0,sites:new Map(),async:{},workflows:new Set()};
      o.n+=e.n;o.platform+=e.platform;o.workflows.add(tf.workflow);
      for(const [type,n] of Object.entries(e.async??{}))o.async[type]=(o.async[type]??0)+n;
      for(const [sid,n] of e.sites){const s=sites.get(sid);o.sites.set(s.file+':'+s.start,{...s,n:(o.sites.get(s.file+':'+s.start)?.n??0)+n});}
      observed.set(k,o);
    }
  }

  // --- coverage of each observed pair ----------------------------------------------------
  const misses=[];let covered=0;
  const confirmedArrows=new Set();
  for(const o of observed.values()) {
    const A=match(o.from),B=match(o.to);
    let ok=false;
    for(const a of A)for(const b of B) {
      const ans=arrows.get(arrowKey(b,a)),act=arrows.get(arrowKey(a,b));
      if(ans?.has('answer')){ok=true;confirmedArrows.add(arrowKey(b,a));}
      if(act&&[...act].some(x=>x!=='answer')){ok=true;confirmedArrows.add(arrowKey(a,b));}
    }
    if(ok){covered++;continue;}
    misses.push({o,A,B});
  }

  // --- causes ---------------------------------------------------------------------------
  const causeOf=({o,A,B})=>{
    if(!A.length)return 'caller not in the analysis';
    if(!B.length)return 'callee not in the analysis';
    const sites=[...o.sites.values()];
    const direct=sites.filter(s=>s.kind==='new'?lastName(s.callee)===o.to.name||o.to.kind==='class':s.callee==='super'?o.to.kind==='class':lastName(s.callee)===lastName(o.to.name));
    const unmodelled=[...sites.map(s=>s.file+':'+s.line),o.from.file+':'+o.from.line,o.to.file+':'+o.to.line].flatMap(k=>unmodelledAt.get(k)??[]);
    if(unmodelled.length)return `shape the analysis records as unmodelled (${[...new Set(unmodelled)].sort().join(', ')})`;
    if(o.to.kind==='accessor')return 'getter or setter entered by a property access';
    if(o.to.kind==='generator')return 'generator body resumed by its consumer';
    if(o.to.kind==='class'&&!direct.length&&!sites.length)return 'class constructor or field initialiser entered without a call site';
    if(direct.length) {
      const s=direct[0];
      if(s.kind==='new')return 'direct construction: call edge missing';
      if(s.callee==='super')return 'super(...) call: edge missing';
      if(/^this\./.test(s.text))return 'direct call through this: edge missing';
      if(s.text.includes('.'))return 'direct method call: edge missing';
      return 'direct call by name: edge missing';
    }
    if(sites.length)return 'callback invoked synchronously by a platform call';
    return 'callback invoked later by the platform (asynchronous)';
  };
  // Within a callback cause, which platform calls (by method) or asynchronous resources.
  const detailOf=(cause,{o})=>{
    if(cause.startsWith('callback invoked synchronously'))return [...new Set([...o.sites.values()].map(s=>'.'+lastName(s.callee)+'()'))];
    if(cause.startsWith('callback invoked later'))return Object.keys(o.async).length?Object.keys(o.async):['(no async resource: platform caller kept the current callable)'];
    return [];
  };
  const groups=new Map();
  for(const m of misses) {
    const cause=causeOf(m);
    const g=groups.get(cause)??{cause,count:0,detail:{},examples:[]};groups.set(cause,g);
    g.count++;
    for(const d of detailOf(cause,m))g.detail[d]=(g.detail[d]??0)+1;
    const site=[...m.o.sites.values()].sort((a,b)=>b.n-a.n)[0];
    if(g.examples.length<examples)g.examples.push({
      from:label(m.o.from),to:label(m.o.to),
      site:site?`${site.file}:${site.line} ${site.text}(...)`:undefined,
      mapCandidates:m.A.length>1||m.B.length>1?{from:m.A,to:m.B}:undefined,
      calls:m.o.n,workflows:[...m.o.workflows]});
  }
  const byCause=[...groups.values()].sort((a,b)=>b.count-a.count);
  for(const g of byCause)g.detail=Object.fromEntries(Object.entries(g.detail).sort((a,b)=>b[1]-a[1]));

  const analysed=[...callables.values()].length;
  const area=f=>f.split('/').slice(0,2).join('/');
  const coverageByArea={};
  for(const [full,c] of callables){const a=area(c.file);const r=coverageByArea[a]??(coverageByArea[a]={callables:0,exercised:0});r.callables++;if(exercised.has(full))r.exercised++;}
  const summary={
    workflows:[...workflows],threads,callsObserved:calls,
    instrumentationFailures:failedInstrumentation.length,
    // Without keys in the analysis output, callables sharing "file:line name" are one name.
    analysedCallables:analysis.summary?.callables,analysedCallableNames:analysed,exercisedCallables:exercised.size,
    exercisedShare:Math.round(1000*exercised.size/analysed)/10+'%',
    observedPairs:observed.size,coveredPairs:covered,misses:misses.length,
    mapArrows:analysis.arrows.length,arrowsConfirmedByTraces:confirmedArrows.size,
    traceCallablesAbsentFromAnalysis:absent.size,ambiguousMatches:ambiguous.size,
    entriesFromEventLoopOnly:[...rootEntries.keys()].filter(k=>![...observed.values()].some(o=>o.to.key===k)).length,
    missesByCause:Object.fromEntries(byCause.map(g=>[g.cause,g.count]))
  };
  return {summary,byCause,
    absentFromAnalysis:[...absent.values()].map(label),
    coverageByArea:Object.fromEntries(Object.entries(coverageByArea).sort()),
    instrumentationFailures:failedInstrumentation,
    misses:misses.map(m=>({cause:causeOf(m),from:label(m.o.from),to:label(m.o.to),calls:m.o.n,platformEntries:m.o.platform,
      sites:[...m.o.sites.values()].map(s=>`${s.file}:${s.line} ${s.text}(...) x${s.n}`),workflows:[...m.o.workflows]}))};
}
