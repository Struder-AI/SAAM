// From the solved points-to result: call edges, each callable's effects, its role (query or
// command), causal arrows and computed leaves. Prototype rules (milestone 1); see
// plans/dev-maps.md for the intent they approximate.
//
// - An object is local to a callable when that callable, or one nested inside it, allocated it
//   (a constructor's instance included). Writing anything else is an effect.
// - A command has an effect or activates a command; everything else is a query.
// - A query call A -> B draws B -> A (the answer); a command call draws A -> B (activation).
// - A command's write to a SAAM object, and every read of it elsewhere, meet at that object as
//   state: writer -> state -> reader.
// - A callable folds into its only caller when it is unexported, not handed to the platform,
//   and touches no state another leaf reads or writes.

// One arrow per pair of boxes (plans/dev-maps.md#notation). Leaf arrows run from influencer to
// influenced, each `answer`, `activation`, `acknowledged` (dot at its tail) or `both`; boxOf
// maps a leaf to the box drawing it. A pair gets a head at each end some arrow enters, and a
// dot at an end that only receives an outcome.
export function pairArrowsOf(arrows,boxOf) {
  const pairs=new Map();
  for(const a of arrows) {
    const x=boxOf(a.from),y=boxOf(a.to);
    if(x===undefined||y===undefined||x===y)continue;
    const [p,q]=String(x)<String(y)?[x,y]:[y,x];
    const key=p+'\u0000'+q;
    const r=pairs.get(key)??{p,q,head:{p:false,q:false},dot:{p:false,q:false},arrows:[]};
    pairs.set(key,r);r.arrows.push(a);
    const into=y===p?'p':'q',back=into==='p'?'q':'p';
    r.head[into]=true;
    if(a.kind==='both')r.head[back]=true;
    if(a.kind==='acknowledged')r.dot[back]=true;
  }
  const drawn=[...pairs.values()].map(r=>{
    if(r.head.p&&r.head.q)return {from:r.p,to:r.q,ends:'both',arrows:r.arrows};
    const [from,to]=r.head.q?[r.p,r.q]:[r.q,r.p];
    const fromEnd=from===r.p?'p':'q';
    return {from,to,ends:r.dot[fromEnd]?'ack':'one',arrows:r.arrows};
  });
  const summary={};for(const d of drawn)summary[d.ends]=(summary[d.ends]??0)+1;
  return {drawn,summary};
}

export function derive(pt,{functions,namespaces,isInstance,moduleActivations}) {
  const byId=functions;
  // Lexical nesting, for locality.
  const ancestorOf=(a,b)=>{for(let x=byId[b];x;x=x.owner!==undefined&&x.owner!==null?byId[x.owner]:null)if(x.id===a)return true;return false;};
  const objectOwner=o=>pt.objects[o].owner;
  // A function analysed once per direct call site is still one callable: copies map to the
  // declaration's own analysis (the one not made inside a copy).
  const rep=new Map();for(const f of byId)if(!f.inClone&&!rep.has(f.key))rep.set(f.key,f.id);
  // A callable walked only in copies (a closure inside a correlated callback, constraints.mjs)
  // is still one callable: its first copy stands for it.
  for(const f of byId)if(!rep.has(f.key))rep.set(f.key,f.id);
  const canon=id=>rep.get(byId[id].key)??id;
  const reps=byId.filter(f=>canon(f.id)===f.id);

  // Exported callables: those a module namespace field may hold.
  const exported=new Set();
  for(const ns of namespaces.values())for(const name of pt.fieldNames[ns]??[]) {
    for(const o of pt.pts[pt.fieldNode(ns,name)])if(pt.objects[o].kind==='function')exported.add(canon(pt.objects[o].fn.id));
  }

  // Call edges.
  const edges=[],incoming=byId.map(()=>[]),outgoing=byId.map(()=>[]);
  const seen=new Set();
  const addEdge=(from,to,site,via)=>{from=canon(from);to=canon(to);const k=`${from}>${to}>${site.id}>${via}`;if(seen.has(k))return;seen.add(k);
    const e={from,to,site,via};edges.push(e);incoming[to].push(e);outgoing[from].push(e);};
  for(const f of byId)for(const s of f.calls) {
    for(const t of s.targets)addEdge(f.id,t,s,'call');
    for(const t of s.platformCallbacks)addEdge(f.id,t,s,'platform');
  }
  // Callbacks a store hands to a platform object (handlers, properties) are platform-invoked too.
  for(const f of byId)for(const st of f.stores)for(const t of st.site?.platformCallbacks??[])addEdge(f.id,t,st.site,'platform');


  // Ownership. A callable owns what it, a function nested in it, or any copy of either
  // allocated, and a fresh object a query it calls returns (ownership moves with the result:
  // code-shape rule 3). An object a command allocated may have been retained elsewhere, so
  // receiving it confers no ownership; roles and ownership settle together.
  const lexicalAncestor=(a,b)=>{for(let x=byId[b];x;x=x.owner!=null?byId[canon(x.owner)]:null)if(x.id===a)return true;return false;};
  const reach=new Map();
  const callees=f=>{let r=reach.get(f);if(r)return r;r=new Set();const stack=[f];
    while(stack.length){const x=stack.pop();for(const e of outgoing[x])if(e.via==='call'&&!r.has(e.to)){r.add(e.to);stack.push(e.to);}}
    reach.set(f,r);return r;};
  // A write is an effect only if another callable can observe it: state only its writer (and
  // functions nested in it) reads, such as a private cache, stays inside that leaf.
  const fieldObject={get:n=>pt.fieldObj[n]};
  const readersOf=new Map();
  // Objects a callable reads a field of: recorded by object (constraints.mjs), or by field node
  // (compose.mjs).
  const objectsRead=f=>f.readObjects??new Set([...f.reads].map(n=>fieldObject.get(n)).filter(o=>o!==undefined));
  for(const f of byId)for(const o of objectsRead(f))
    (readersOf.get(o)??readersOf.set(o,new Set()).get(o)).add(canon(f.id));
  const observed=(o,cf)=>{for(const r of readersOf.get(o)??[])if(r!==cf&&!lexicalAncestor(cf,r))return true;return false;};
  const effects=byId.map(()=>({state:new Set(),platform:0}));
  let command=byId.map(()=>false);
  const computeEffects=()=>{
    for(const e of effects){e.state.clear();e.platform=0;}
    for(const f of byId) {
      const cf=canon(f.id);
      const instance=f.kind==='class'?pt.pts[f.thisNode]:null;
      const local=o=>{
        if(instance?.has(o)||isInstance?.(o,cf))return true;
        const w=objectOwner(o);if(w==null)return false;
        const cw=canon(w);
        return cw===cf||lexicalAncestor(cf,cw)||!command[cw]&&callees(cf).has(cw);
      };
      const into=effects[cf];
      for(const st of f.stores)for(const o of pt.pts[st.base]) {
        if(local(o))continue;
        const k=pt.objects[o].kind;
        if(k==='platform')into.platform++;
        else if((k!=='function'||st.name!=='prototype')&&observed(o,cf))into.state.add(o);
      }
      // World effects come from the platform models (platform-models.mjs). Logging is left out.
      for(const s of f.calls)if(s.platform&&s.effects&&[...s.effects].some(e=>e!=='log')) {
        // A platform method acting on an object this callable owns stays inside it.
        if(!(s.receiver!==undefined&&pt.pts[s.receiver].size&&[...pt.pts[s.receiver]].every(o=>pt.objects[o].kind!=='platform'&&local(o))))into.platform++;
      }
    }
  };
  // Roles: command if it has an effect or activates a command, to a fixed point; repeated
  // until ownership (which depends on roles) stops changing them. Ownership is not monotone in
  // roles, so a role state can recur: that is an oscillation, reported with the callables
  // whose roles keep changing, never passed off as a settled result.
  const seenStates=new Map();
  let roleRounds=0,roleOscillation=null;
  for(;;) {
    roleRounds++;
    computeEffects();
    const next=byId.map(f=>effects[f.id].platform>0||effects[f.id].state.size>0);
    for(let changed=true;changed;) {
      changed=false;
      for(const e of edges)if(!next[e.from]&&next[e.to]){next[e.from]=true;changed=true;}
    }
    const same=next.every((v,i)=>v===command[i]);
    const state=next.map(v=>v?1:0).join('');
    if(!same&&seenStates.has(state)) {
      const flipping=byId.filter(f=>next[f.id]!==command[f.id]&&canon(f.id)===f.id).map(f=>`${f.file}:${f.line} ${f.name??'(anonymous)'}`);
      roleOscillation={cycleLength:roleRounds-seenStates.get(state),flipping:flipping.slice(0,20),flippingCount:flipping.length,
        cause:'ownership depends on roles: a callee becoming a command stops returned objects counting as owned, which can remove the effect that made it one'};
      command=next.map((v,i)=>v||command[i]);
      break;
    }
    seenStates.set(state,roleRounds);
    command=next;
    if(same)break;
  }
  // What a command returns. Its outcome is nothing, a primitive (a status, an identity, a
  // revision), or a record it made holding only such values or a pending completion; anything
  // else is data the caller can compute with.
  const rets=new Map();
  for(const f of byId)(rets.get(canon(f.id))??rets.set(canon(f.id),[]).get(canon(f.id))).push(f.ret);
  const isOutcomeValue=(o,owner,depth)=>{
    const x=pt.objects[o];
    if(x.kind==='platform')return false;
    if(x.kind==='value'||x.kind==='primitive'||x.kind==='key')return true;
    if(x.kind!=='object')return false;
    const w=x.owner;if(w==null)return false;
    const cw=canon(w);if(cw!==owner&&!lexicalAncestor(owner,cw))return false;
    if(depth>1)return false;
    for(const name of pt.fieldNames[o]??[]) {
      if(name==='__proto__')continue;
      for(const v of pt.pts[pt.fieldNode(o,name)])if(!isOutcomeValue(v,owner,depth+1))return false;
    }
    return true;
  };
  const outcomeOnly=new Map();
  const returnsOutcome=id=>{
    if(outcomeOnly.has(id))return outcomeOnly.get(id);
    let ok=true;
    for(const r of rets.get(id)??[]){for(const o of pt.pts[r])if(!isOutcomeValue(o,id,0)){ok=false;break;}if(!ok)break;}
    outcomeOnly.set(id,ok);return ok;
  };

  // Arrows between callables, pointing from influencer to influenced (plans/dev-maps.md):
  // answer B -> A for a query; activation A -> B for a command whose result A ignores;
  // acknowledged A -> B when A receives only B's outcome (a dot at A); both when A receives
  // data from a command (two heads, banned between leaves).
  const arrows=new Map();
  const arrow=(from,to,kind)=>{if(from===to)return;const k=from+'>'+to+'>'+kind;const a=arrows.get(k);if(a)a.count++;else arrows.set(k,{from,to,kind,count:1});};
  const kindOf=e=>{
    if(!command[e.to])return 'answer';
    if(e.via==='platform'||!e.site.resultUsed)return 'activation';
    return returnsOutcome(e.to)?'acknowledged':'both';
  };
  for(const e of edges){const k=kindOf(e);e.kind=k;if(k==='answer')arrow(e.to,e.from,k);else arrow(e.from,e.to,k);}
  // Module load code is a leaf too (plans/dev-maps.md#leaves): an importer (or a dynamic
  // import) activates the imported module's load code, and a function reading a module-level
  // variable receives what that load code initialised (`initialises`, constraints.mjs moduleRead).
  for(const [a,b] of moduleActivations?.()??[])arrow(canon(a),canon(b),'activation');
  for(const f of byId)for(const m of f.moduleReads??[])arrow(canon(m),canon(f.id),'initialises');
  const both=reps.filter(f=>!f.module&&f.kind!=='class'&&incoming[f.id].some(e=>e.kind==='both'));

  // State: objects written as an effect, and who reads them.
  const writers=new Map(),readers=new Map();
  for(const f of reps)for(const o of effects[f.id].state)(writers.get(o)??writers.set(o,new Set()).get(o)).add(f.id);
  for(const f of byId)for(const o of objectsRead(f)){
    if(writers.has(o))(readers.get(o)??readers.set(o,new Set()).get(o)).add(canon(f.id));}
  let stateArrows=0,pairArrows=0,stateNodes=0;
  for(const [o,ws] of writers) {
    const rs=readers.get(o)??new Set();
    const others=[...rs].filter(r=>!ws.has(r)||ws.size>1);
    if(!others.length&&ws.size<2)continue;
    stateNodes++;stateArrows+=ws.size+rs.size;
    for(const w of ws)for(const r of rs)if(w!==r)pairArrows++;
  }

  // Leaves: a callable folds into the leaf of its single entry, the one callable through which
  // it is reached, repeatedly. A callback handed to the platform (arr.map(cb), p.then(cb), a
  // handler stored on a platform object) is reached through the callable that hands it over
  // (the platform edge's caller). A callable with more than one entry, or none, stays its own
  // leaf; module load code never folds; a leaf stays within one file.
  const home=byId.map(f=>f.id);
  const find=x=>{while(home[x]!==x)x=home[x];return x;};
  for(let changed=true;changed;) {
    changed=false;
    for(const f of reps) {
      if(home[f.id]!==f.id||f.module||!incoming[f.id].length)continue;
      const entries=new Set(incoming[f.id].map(e=>find(e.from)));
      if(entries.size!==1||entries.has(find(f.id)))continue;
      const [c]=entries;
      if(byId[c].file!==f.file)continue;
      home[f.id]=c;changed=true;
    }
  }
  const leaves=new Set(reps.map(f=>find(f.id)));
  // A leaf acts if any callable folded into it acts.
  const leafCommand=byId.map(()=>false);
  for(const f of reps)if(command[f.id])leafCommand[find(f.id)]=true;
  // State between leaves: a folded callable's reads and writes are its leaf's.
  let leafStateObjects=0,leafWriterReaderPairs=0;
  for(const [o,ws0] of writers) {
    const ws=new Set([...ws0].map(find)),rs=new Set([...(readers.get(o)??[])].map(find));
    if(![...rs].some(r=>!ws.has(r))&&ws.size<2)continue;
    leafStateObjects++;
    for(const w of ws)for(const r of rs)if(w!==r)leafWriterReaderPairs++;
  }
  // Every leaf has an arrow (plans/dev-maps.md#leaves): leaves no arrow enters or leaves, other
  // than arrows between callables folded into the same leaf.
  const touched=new Set();
  for(const a of arrows.values()){const x=find(a.from),y=find(a.to);if(x!==y){touched.add(x);touched.add(y);}}
  const arrowless=[...leaves].filter(l=>!touched.has(l));
  const uncalled=reps.filter(f=>!f.module&&!exported.has(f.id)&&!incoming[f.id].length&&f.kind!=='class');

  const roleCount={query:0,command:0};
  for(const f of reps)roleCount[command[f.id]?'command':'query']++;
  const arrowKinds={};for(const a of arrows.values())arrowKinds[a.kind]=(arrowKinds[a.kind]??0)+1;
  return {
    edges,arrows:[...arrows.values()],command,leafCommand,effects,readersOf,both,leaves,home,exported,uncalled,arrowless,
    summary:{roleRounds,...(roleOscillation?{roleOscillation}:{}),callables:reps.length,copies:byId.length-reps.length,modules:reps.filter(f=>f.module).length,exported:exported.size,
      callEdges:edges.filter(e=>e.via==='call').length,platformCallbackEdges:edges.filter(e=>e.via==='platform').length,
      roles:roleCount,answersAndActs:both.length,arrows:arrows.size,arrowKinds,pairs:pairArrowsOf([...arrows.values()],x=>x).summary,
      state:{objects:stateNodes,arrowsThroughStateNodes:stateArrows,writerReaderPairs:pairArrows},
      leaves:leaves.size,leafRoles:{query:[...leaves].filter(l=>!leafCommand[l]).length,command:[...leaves].filter(l=>leafCommand[l]).length},
      leafState:{objects:leafStateObjects,writerReaderPairs:leafWriterReaderPairs},folded:reps.length-leaves.size,uncalledUnexported:uncalled.length,
      arrowlessLeaves:{total:arrowless.length,moduleLoad:arrowless.filter(l=>byId[l].module).length,uncalledUnexported:arrowless.filter(l=>uncalled.some(f=>f.id===l)).length}}
  };
}
