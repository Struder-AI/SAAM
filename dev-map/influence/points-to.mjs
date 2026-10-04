// Inclusion-based (Andersen) points-to solving over abstract objects, one per allocation site.
// A node is a variable or temporary; its set holds the objects it may refer to. Copy edges
// propagate whole sets; listeners attached to a node fire once per object that reaches it, which
// is how loads, stores and calls unfold as targets are discovered. Field nodes are created on
// demand per (object, field). Solving runs a worklist of newly reached objects to a fixed point
// (difference propagation: a node passes on only the objects it gained since it last ran).
//
// Engineering (measured in DEVLOG 2026-10-04, solver engineering): copy edges are plain integer
// arrays deduplicated by an open-addressing pair table, not one Set per node; fields are a Map
// per object, not string-keyed; listeners see a set's current members without copying it; copy
// cycles collapse into one node. Offline substitution was not adopted: most constraints appear
// only while solving, as listeners add them.

// A set of integer pairs (open addressing over two Int32Arrays). add() reports whether the pair
// is new, which is how constraint generation deduplicates work without string keys.
export class PairSet {
  constructor(bits=12){this.alloc(bits);this.size=0;}
  alloc(bits){this.mask=(1<<bits)-1;this.xs=new Int32Array(1<<bits).fill(-1);this.ys=new Int32Array(1<<bits);}
  slot(x,y){return (Math.imul(x,0x9E3779B1)^Math.imul(y^0x5bd1e995,0x85EBCA77))>>>0&this.mask;}
  add(x,y) {
    if(this.size*2>=this.mask)this.grow();
    const {xs,ys,mask}=this;
    for(let h=this.slot(x,y);;h=(h+1)&mask) {
      const k=xs[h];
      if(k===-1){xs[h]=x;ys[h]=y;this.size++;return true;}
      if(k===x&&ys[h]===y)return false;
    }
  }
  has(x,y) {
    const {xs,ys,mask}=this;
    for(let h=this.slot(x,y);;h=(h+1)&mask){const k=xs[h];if(k===-1)return false;if(k===x&&ys[h]===y)return true;}
  }
  grow() {
    const {xs,ys}=this;this.alloc(Math.log2(xs.length)+1);this.size=0;
    for(let i=0;i<xs.length;i++)if(xs[i]!==-1)this.add(xs[i],ys[i]);
  }
}

// Nodes on a cycle of copy edges always hold the same set, so they are collapsed into one
// representative (union-find); `pts[n]` of a collapsed node is its representative's set.
// Cycles are found by periodic Tarjan passes over the representatives, scheduled against the
// propagation work done since the last pass (cycles form while solving, as listeners add edges).
export class PointsTo {
  constructor({collapse=true}={}) {
    this.pts=[];this.succ=[];this.delta=[];this.listeners=[];this.queue=[];this.queued=[];this.parent=[];this.members=[];
    this.objects=[];this.fieldMaps=[];this.fieldNames=[];this.fieldNodes=[];this.fieldListeners=[];
    this.edges=new PairSet(16);this.fieldCount=0;this.edgeCount=0;this.propagations=0;
    this.fed=[];this.fedWaiters=new Map();
    this.fieldIndex=null;
    this.collapse=collapse;this.collapsed=0;this.cyclePasses=0;this.cycleMs=0;this.passMin=2e5;this.nextPass=this.passMin;
  }
  node() {
    const n=this.pts.length;
    this.pts.push(new Set());this.succ.push(null);this.delta.push(null);this.listeners.push(null);this.queued.push(false);this.parent.push(n);this.members.push(null);
    return n;
  }
  find(n){const p=this.parent;while(p[n]!==n){p[n]=p[p[n]];n=p[n];}return n;}
  object(info) {
    const o=this.objects.length;this.objects.push(info);this.fieldMaps.push(null);this.fieldNames.push(null);this.fieldNodes.push(null);this.fieldListeners.push(null);
    return o;
  }
  add(n,o) {
    n=this.find(n);
    const set=this.pts[n];if(set.has(o))return;
    set.add(o);(this.delta[n]??=[]).push(o);
    if(!this.queued[n]){this.queued[n]=true;this.queue.push(n);}
  }
  // quiet: an edge that does not make b exist (a value that may be at any name, copied into
  // every field: whenFed).
  edge(a,b,quiet=false) {
    a=this.find(a);b=this.find(b);
    if(!quiet&&!this.fed[b])this.feed(b);
    if(a===b||!this.edges.add(a,b))return;
    (this.succ[a]??=[]).push(b);this.edgeCount++;
    const set=this.pts[a];
    if(set.size)for(const o of set)this.add(b,o);
  }
  // A node is fed once something is written into it: an edge into it (not a quiet one), or a
  // write recorded with feed() (a primitive, an object placed directly). A field node made only
  // by a read, or reached only by quiet edges, is not fed: the field need not exist.
  // whenFed(n, fn) calls fn once n is fed.
  feed(n) {
    n=this.find(n);if(this.fed[n])return;this.fed[n]=1;
    const w=this.fedWaiters.get(n);if(w){this.fedWaiters.delete(n);for(const fn of w)fn();}
  }
  whenFed(n,fn) {
    n=this.find(n);
    if(this.fed[n]){fn();return;}
    (this.fedWaiters.get(n)??this.fedWaiters.set(n,[]).get(n)).push(fn);
  }
  // Calls fn(o) for every object that reaches n, now and later. Members added while fn runs
  // reach it through the delta, so only the members present now are visited here.
  on(n,fn) {
    n=this.find(n);
    (this.listeners[n]??=[]).push(fn);
    const set=this.pts[n];let k=set.size;if(!k)return;
    for(const o of set){fn(o);if(--k===0)break;}
  }
  field(o,name) {
    const m=this.fieldMaps[o]??=new Map();
    let n=m.get(name);
    if(n!==undefined)return n;
    n=this.node();m.set(name,n);this.fieldCount++;this.fieldIndex=null;
    (this.fieldNames[o]??=[]).push(name);(this.fieldNodes[o]??=[]).push(n);
    const ls=this.fieldListeners[o];
    if(ls)for(let i=0;i<ls.length;i++)ls[i](name,n);
    return n;
  }
  fieldNode(o,name){return this.fieldMaps[o]?.get(name);}
  // Calls fn(name, node) for every field of o, now and later.
  onField(o,fn) {
    (this.fieldListeners[o]??=[]).push(fn);
    const names=this.fieldNames[o];if(!names)return;
    const nodes=this.fieldNodes[o],k=names.length;
    for(let i=0;i<k;i++)fn(names[i],nodes[i]);
  }
  // Field nodes by "object\0name", for readers written against the string-keyed form.
  get fields() {
    if(this.fieldIndex)return this.fieldIndex;
    const m=new Map();
    for(let o=0;o<this.fieldNames.length;o++){const names=this.fieldNames[o];if(!names)continue;const nodes=this.fieldNodes[o];for(let i=0;i<names.length;i++)m.set(o+'\u0000'+names[i],nodes[i]);}
    return this.fieldIndex=m;
  }
  // Runs to a fixed point, or for at most `steps` nodes (a caller interleaving other work).
  solve(steps=Infinity) {
    const {queue}=this;
    while(queue.length&&steps-->0) {
      if(this.collapse&&this.propagations>=this.nextPass)this.collapseCycles();
      const n=queue.pop();this.queued[n]=false;
      if(this.parent[n]!==n)continue;
      const d=this.delta[n];if(!d)continue;this.delta[n]=null;
      this.propagations+=d.length;
      const out=this.succ[n];
      if(out)for(let i=0;i<out.length;i++){const b=out[i];for(let j=0;j<d.length;j++)this.add(b,d[j]);}
      const ls=this.listeners[n];
      if(ls)for(let i=0;i<ls.length;i++){const fn=ls[i];for(let j=0;j<d.length;j++)fn(d[j]);}
    }
  }
  // Tarjan over representatives; every strongly connected component becomes one node. Also
  // compacts successor lists (representatives, no duplicates, no self edges).
  collapseCycles() {
    const t0=performance.now();this.cyclePasses++;
    const N=this.pts.length,{parent,succ}=this;
    for(let r=0;r<N;r++) {
      const s=succ[r];if(!s||parent[r]!==r)continue;
      const seen=new Set();let k=0;
      for(let i=0;i<s.length;i++){const b=this.find(s[i]);if(b!==r&&!seen.has(b)){seen.add(b);s[k++]=b;}}
      s.length=k;
    }
    const index=new Int32Array(N).fill(-1),low=new Int32Array(N),onStack=new Uint8Array(N);
    const stack=[],work=[],pos=[];let next=0;const sccs=[];
    for(let root=0;root<N;root++) {
      if(parent[root]!==root||index[root]>=0||!succ[root])continue;
      index[root]=low[root]=next++;stack.push(root);onStack[root]=1;work.push(root);pos.push(0);
      while(work.length) {
        const v=work[work.length-1],s=succ[v];const i=pos[pos.length-1];
        if(s&&i<s.length) {
          pos[pos.length-1]++;const w=s[i];
          if(index[w]<0){index[w]=low[w]=next++;stack.push(w);onStack[w]=1;work.push(w);pos.push(0);}
          else if(onStack[w]&&index[w]<low[v])low[v]=index[w];
        } else {
          work.pop();pos.pop();
          if(work.length){const u=work[work.length-1];if(low[v]<low[u])low[u]=low[v];}
          if(low[v]===index[v]) {
            let w;const comp=[];
            do{w=stack.pop();onStack[w]=0;comp.push(w);}while(w!==v);
            if(comp.length>1)sccs.push(comp);
          }
        }
      }
    }
    for(const comp of sccs)this.mergeAll(comp);
    this.cycleMs+=performance.now()-t0;
    this.nextPass=this.propagations+Math.max(this.passMin,this.edgeCount>>1);
  }
  // Merges representatives into one. Each member's listeners and successors have been given
  // its set minus its pending delta; they are owed exactly the rest of the union, delivered
  // here, so the merged node starts with no pending delta.
  mergeAll(comp) {
    let r=comp[0];for(const x of comp)if(this.pts[x].size>this.pts[r].size)r=x;
    const U=this.pts[r];
    const added=[];
    for(const x of comp)if(x!==r)for(const o of this.pts[x])if(!U.has(o)){U.add(o);added.push(o);}
    const owed=[];
    for(const m of comp) {
      const S=this.pts[m],d=this.delta[m];let list;
      if(m===r)list=d?added.concat(d):added;
      else{if(S.size===U.size&&!d)continue;const pending=d?new Set(d):null;list=[];for(const o of U)if(!S.has(o)||pending?.has(o))list.push(o);}
      if(list.length&&(this.listeners[m]||this.succ[m]))owed.push([this.listeners[m],this.succ[m],list]);
    }
    const ls=this.listeners[r]??[],ss=this.succ[r]??[];
    const mr=this.members[r]??=[r];
    for(const x of comp) {
      this.delta[x]=null;
      if(x===r)continue;
      this.collapsed++;this.parent[x]=r;
      for(const m of this.members[x]??[x]){mr.push(m);this.pts[m]=U;}
      this.members[x]=null;
      {const l=this.listeners[x];if(l)for(let i=0;i<l.length;i++)ls.push(l[i]);}
      {const q=this.succ[x];if(q)for(let i=0;i<q.length;i++)ss.push(q[i]);}
      this.listeners[x]=null;this.succ[x]=null;
    }
    this.listeners[r]=ls.length?ls:null;this.succ[r]=ss.length?ss:null;
    for(const [l,s,list] of owed) {
      if(s)for(const b of s)for(const o of list)this.add(b,o);
      if(l)for(const fn of l)for(const o of list)fn(o);
    }
    // Fed if any member was; waiters move to the representative.
    {let anyFed=false;const waiting=[];
      for(const x of comp){if(this.fed[x])anyFed=true;const w=this.fedWaiters.get(x);if(w){this.fedWaiters.delete(x);waiting.push(...w);}}
      if(anyFed){this.fed[r]=1;for(const fn of waiting)fn();}
      else if(waiting.length)this.fedWaiters.set(r,waiting);}
  }
}
