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

const EFFECT_METHOD=/^(writeFile|appendFile|mkdir|rm|rmdir|unlink|rename|copyFile|cp|symlink|chmod|utimes|truncate|postMessage|send|fetch|dispatchEvent|appendChild|removeChild|replaceChildren|replaceWith|insertBefore|append|prepend|remove|setAttribute|removeAttribute|toggleAttribute|addEventListener|removeEventListener|setTimeout|setInterval|clearTimeout|clearInterval|requestAnimationFrame|cancelAnimationFrame|terminate|close|kill|spawn|exec|execFile|fork|listen|write|end|emit|exit|focus|blur|click|scrollTo|scrollIntoView|play|pause|showModal|setPointerCapture|releasePointerCapture|preventDefault|stopPropagation|abort|pushState|replaceState|reload|assign|open|createWriteStream|unref|ref)$/;

export function derive(pt,{functions,namespaces}) {
  const byId=functions;
  // Lexical nesting, for locality.
  const ancestorOf=(a,b)=>{for(let x=byId[b];x;x=x.owner!==undefined&&x.owner!==null?byId[x.owner]:null)if(x.id===a)return true;return false;};
  const objectOwner=o=>pt.objects[o].owner;
  // A function analysed once per direct call site is still one callable: copies map to the
  // declaration's own analysis (the one not made inside a copy).
  const rep=new Map();for(const f of byId)if(!f.inClone&&!rep.has(f.key))rep.set(f.key,f.id);
  const canon=id=>rep.get(byId[id].key)??id;
  const reps=byId.filter(f=>canon(f.id)===f.id);

  // Exported callables: those a module namespace field may hold.
  const exported=new Set();
  for(const ns of namespaces.values())for(const name of pt.fieldNames[ns]??[]) {
    for(const o of pt.pts[pt.fields.get(ns+'\u0000'+name)])if(pt.objects[o].kind==='function')exported.add(canon(pt.objects[o].fn.id));
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

  // Field node -> (object, name), for reads.
  const fieldOf=new Map();
  for(const [key,n] of pt.fields){const i=key.indexOf('\u0000');fieldOf.set(n,[+key.slice(0,i),key.slice(i+1)]);}

  // Direct effects.
  const effects=byId.map(()=>({state:new Set(),platform:0}));
  for(const f of byId) {
    const instance=f.kind==='class'?pt.pts[f.thisNode]:null;
    const local=o=>{const w=objectOwner(o);return w!==undefined&&w!==null&&(w===f.id||ancestorOf(f.id,w))||instance?.has(o);};
    const into=effects[canon(f.id)];
    for(const st of f.stores)for(const o of pt.pts[st.base]) {
      if(local(o))continue;
      const k=pt.objects[o].kind;
      if(k==='platform')into.platform++;
      else if(k!=='function'||st.name!=='prototype')into.state.add(o);
    }
    for(const s of f.calls)if(s.platform) {
      const method=s.text.split(/[.\s(]/).filter(Boolean).pop();
      if(/^console\./.test(s.text))continue;
      if(EFFECT_METHOD.test(method))into.platform++;
    }
  }

  // Roles: command if it has an effect or activates a command, to a fixed point.
  const command=byId.map(f=>effects[f.id].platform>0||effects[f.id].state.size>0);
  for(let changed=true;changed;) {
    changed=false;
    for(const e of edges)if(!command[e.from]&&command[e.to]){command[e.from]=true;changed=true;}
  }
  const both=reps.filter(f=>command[f.id]&&f.returnsValue&&!f.module&&f.kind!=='class'&&incoming[f.id].some(e=>e.site.resultUsed));

  // Arrows between callables.
  const arrows=new Map();
  const arrow=(from,to,kind)=>{if(from===to)return;const k=from+'>'+to;const a=arrows.get(k);if(a)a.count++;else arrows.set(k,{from,to,kind,count:1});};
  for(const e of edges){if(command[e.to])arrow(e.from,e.to,'activation');else arrow(e.to,e.from,'answer');}

  // State: objects written as an effect, and who reads them.
  const writers=new Map(),readers=new Map();
  for(const f of reps)for(const o of effects[f.id].state)(writers.get(o)??writers.set(o,new Set()).get(o)).add(f.id);
  for(const f of byId)for(const fnode of f.reads){const at=fieldOf.get(fnode);if(!at)continue;const [o]=at;
    if(writers.has(o))(readers.get(o)??readers.set(o,new Set()).get(o)).add(canon(f.id));}
  let stateArrows=0,pairArrows=0,stateNodes=0;
  const touchesState=new Set();
  for(const [o,ws] of writers) {
    const rs=readers.get(o)??new Set();
    const others=[...rs].filter(r=>!ws.has(r)||ws.size>1);
    if(!others.length&&ws.size<2)continue;
    stateNodes++;stateArrows+=ws.size+rs.size;
    for(const w of ws)for(const r of rs)if(w!==r)pairArrows++;
    for(const x of [...ws,...rs])touchesState.add(x);
  }

  // Leaves: fold single-caller private helpers into their caller, repeatedly.
  const home=byId.map(f=>f.id);
  const find=x=>{while(home[x]!==x)x=home[x];return x;};
  for(let changed=true;changed;) {
    changed=false;
    for(const f of reps) {
      if(home[f.id]!==f.id||f.module||exported.has(f.id)||touchesState.has(f.id))continue;
      const callers=new Set(incoming[f.id].map(e=>e.via==='platform'?-1:find(e.from)));
      if(callers.size!==1||callers.has(-1)||callers.has(find(f.id)))continue;
      const [c]=callers;
      if(byId[c].file!==f.file)continue;
      home[f.id]=c;changed=true;
    }
  }
  const leaves=new Set(reps.map(f=>find(f.id)));
  const uncalled=reps.filter(f=>!f.module&&!exported.has(f.id)&&!incoming[f.id].length&&f.kind!=='class');

  const roleCount={query:0,command:0};
  for(const f of reps)roleCount[command[f.id]?'command':'query']++;
  const arrowKinds={};for(const a of arrows.values())arrowKinds[a.kind]=(arrowKinds[a.kind]??0)+1;
  return {
    edges,arrows:[...arrows.values()],command,both,leaves,home,exported,uncalled,
    summary:{callables:reps.length,copies:byId.length-reps.length,modules:reps.filter(f=>f.module).length,exported:exported.size,
      callEdges:edges.filter(e=>e.via==='call').length,platformCallbackEdges:edges.filter(e=>e.via==='platform').length,
      roles:roleCount,answersAndActs:both.length,arrows:arrows.size,arrowKinds,
      state:{objects:stateNodes,arrowsThroughStateNodes:stateArrows,writerReaderPairs:pairArrows},
      leaves:leaves.size,folded:reps.length-leaves.size,uncalledUnexported:uncalled.length}
  };
}
