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
  const localOf=new Map();
  const localTo=cf=>{
    let l=localOf.get(cf);if(l)return l;
    const instance=byId[cf].kind==='class'?pt.pts[byId[cf].thisNode]:null;
    l=o=>{
      if(instance?.has(o)||isInstance?.(o,cf))return true;
      const w=objectOwner(o);if(w==null)return false;
      const cw=canon(w);
      return cw===cf||lexicalAncestor(cf,cw)||!command[cw]&&callees(cf).has(cw);
    };
    localOf.set(cf,l);return l;
  };
  // Each copy's callees at its own call sites (the copy analysed for that site), with platform
  // callbacks: what a call of this copy runs.
  // `during`: the callee runs inside the caller's call (a direct call, or a callback a platform
  // model runs synchronously); a later callback (a handler, a promise reaction) runs after it, as
  // may an async function or a generator's body unless the call is awaited.
  const finishes=(t,s)=>!(byId[t].async||byId[t].generator)||!!s.node?.awaited&&!byId[t].generator;
  const calleesOf=byId.map(f=>{const out=new Map();const put=(t,during)=>{if(!out.has(t)||!during)out.set(t,during);};
    for(const s of f.calls){for(const t of s.targets)put(t,finishes(t,s));const sync=new Set(s.syncCallbacks??[]);for(const t of s.platformCallbacks)put(t,sync.has(t)&&!byId[t].async&&!byId[t].generator);}
    for(const st of f.stores)for(const t of st.site?.platformCallbacks??[])put(t,false);
    return out;});
  const callersOf=byId.map(()=>[]);
  for(const f of byId)for(const [t,during] of calleesOf[f.id])if(t!==f.id)callersOf[t].push({c:f.id,during});
  // What one call of each copy changes that the callable cannot keep to itself (`reached`): its
  // own effects (stores and world effects below) and every effect of a callee it runs, except
  // writes to objects local to it. A callee writing an object the caller allocated (its working
  // state, a constructor filling its own instance) is the caller writing it, which is no effect
  // (the rule for the caller's own writes above). Sound for roles: a callable none of whose
  // reached effects remain changes nothing that existed before its call, so an object it made
  // can reach another callable only through what it returns. Platform effects never become local.
  let reached=byId.map(()=>({state:new Set(),platform:false}));
  const computeEffects=()=>{
    for(const e of effects){e.state.clear();e.platform=0;}
    reached=byId.map(()=>({state:new Set(),platform:false}));
    for(const f of byId) {
      const cf=canon(f.id);
      const local=localTo(cf);
      const into=effects[cf],r=reached[f.id];
      for(const st of f.stores)for(const o of pt.pts[st.base]) {
        if(local(o))continue;
        const k=pt.objects[o].kind;
        if(k==='platform'){into.platform++;r.platform=true;}
        else if((k!=='function'||st.name!=='prototype')&&observed(o,cf)){into.state.add(o);r.state.add(o);}
      }
      // World effects come from the platform models (platform-models.mjs). Logging is left out.
      for(const s of f.calls)if(s.platform&&s.effects&&[...s.effects].some(e=>e!=='log')) {
        // A platform method acting on an object this callable owns stays inside it.
        if(!(s.receiver!==undefined&&pt.pts[s.receiver].size&&[...pt.pts[s.receiver]].every(o=>pt.objects[o].kind!=='platform'&&local(o)))){into.platform++;r.platform=true;}
      }
    }
    // Callee effects reach each caller copy, to a fixed point. A copy with a platform effect needs
    // no state set: it is a command in every caller.
    const queue=byId.map(f=>f.id).filter(id=>reached[id].platform||reached[id].state.size),queued=new Set(queue);
    while(queue.length) {
      const t=queue.pop();queued.delete(t);const rt=reached[t];
      for(const {c,during} of callersOf[t]) {
        const rc=reached[c];if(rc.platform)continue;
        let grew=false;
        if(rt.platform){rc.platform=true;rc.state.clear();grew=true;}
        else{const local=during?localTo(canon(c)):()=>false;for(const o of rt.state)if(!rc.state.has(o)&&!local(o)){rc.state.add(o);grew=true;}}
        if(grew&&!queued.has(c)){queued.add(c);queue.push(c);}
      }
    }
  };
  // Whether a call of copy b changes something outside its caller. A callable exported, module
  // load code, one with no known caller or one run later is called from outside (its effects
  // escape). Otherwise every caller is known (as for folding below) and runs it during its own
  // call: an effect escapes only if some caller does not own the object it changes. A helper
  // changing only its callers' working state (freeing their native handles, filling the
  // instance its constructor made) answers them like a query: what it changed is the caller's,
  // visible only through the caller (reached).
  const escapes=b=>{
    const r=reached[b];if(!r.platform&&!r.state.size)return false;
    const cb=canon(b),B=byId[cb];
    if(r.platform||B.module||exported.has(cb)||!callersOf[b].length)return true;
    for(const {c,during} of callersOf[b]) {
      if(!during)return true;
      const local=localTo(canon(c));
      for(const o of r.state)if(!local(o))return true;
    }
    return false;
  };
  // Roles: command if a call of it has an effect that reaches outside it (its own, or a
  // callee's not local to it), to a fixed point; repeated until ownership (which depends on
  // roles) stops changing them. Ownership is not monotone in roles, so a role state can recur:
  // that is an oscillation, reported with the callables whose roles keep changing, never passed
  // off as a settled result.
  const seenStates=new Map();
  let roleRounds=0,roleOscillation=null;
  for(;;) {
    roleRounds++;
    computeEffects();
    const next=byId.map(()=>false);
    for(const f of byId)if(!next[canon(f.id)]&&escapes(f.id))next[canon(f.id)]=true;
    for(const f of byId)if(canon(f.id)!==f.id)next[f.id]=next[canon(f.id)];
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
  // A query's writes all change its callers' own objects (escapes): no state.
  for(const f of reps)if(!command[f.id])effects[f.id].state.clear();
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
  // Module load code is a leaf too (plans/dev-maps.md#leaves): a function reading a module-level
  // variable receives what that load code initialised (`initialises`, constraints.mjs moduleRead).
  // An importer (or a dynamic import) decides only whether the imported module's load code runs,
  // so it influences that load code only when the load code acts (a command): importing a module
  // whose load code only defines bindings changes nothing the importer or anyone else receives
  // (what it initialises is drawn as `initialises`). A module load left with no arrow is reported
  // as arrowless (summary.arrowlessLeaves.moduleLoad), never given one.
  let importActivations=0,importActivationsDropped=0;
  for(const [a,b] of moduleActivations?.()??[]) {
    const from=canon(a),to=canon(b);if(from===to)continue;
    if(command[to]){arrow(from,to,'activation');importActivations++;}else importActivationsDropped++;
  }
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
  // A leaf acts if its entry acts: every callable folded into it runs only within a call of the
  // entry, whose role already holds what their effects change outside it (reached). Writes a
  // folded callable makes to objects local to a query entry are that leaf's working state.
  const leafCommand=byId.map(()=>false);
  for(const l of leaves)leafCommand[l]=command[l];
  for(const f of reps){const l=find(f.id);if(l!==f.id&&!command[l]&&effects[f.id].state.size){const local=localTo(l);for(const o of [...effects[f.id].state])if(local(o))effects[f.id].state.delete(o);}}
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
    edges,arrows:[...arrows.values()],command,leafCommand,effects,readersOf,both,leaves,home,canon,exported,uncalled,arrowless,
    summary:{roleRounds,...(roleOscillation?{roleOscillation}:{}),callables:reps.length,copies:byId.length-reps.length,modules:reps.filter(f=>f.module).length,exported:exported.size,
      callEdges:edges.filter(e=>e.via==='call').length,platformCallbackEdges:edges.filter(e=>e.via==='platform').length,
      roles:roleCount,answersAndActs:both.length,arrows:arrows.size,arrowKinds,importActivations:{kept:importActivations,queryLoadsDropped:importActivationsDropped},pairs:pairArrowsOf([...arrows.values()],x=>x).summary,
      state:{objects:stateNodes,arrowsThroughStateNodes:stateArrows,writerReaderPairs:pairArrows},
      leaves:leaves.size,leafRoles:{query:[...leaves].filter(l=>!leafCommand[l]).length,command:[...leaves].filter(l=>leafCommand[l]).length},
      leafState:{objects:leafStateObjects,writerReaderPairs:leafWriterReaderPairs},folded:reps.length-leaves.size,uncalledUnexported:uncalled.length,
      arrowlessLeaves:{total:arrowless.length,moduleLoad:arrowless.filter(l=>byId[l].module).length,uncalledUnexported:arrowless.filter(l=>uncalled.some(f=>f.id===l)).length}}
  };
}
