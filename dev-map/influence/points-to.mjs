// Inclusion-based (Andersen) points-to solving over abstract objects, one per allocation site.
// A node is a variable or temporary; its set holds the objects it may refer to. Copy edges
// propagate whole sets; listeners attached to a node fire once per object that reaches it, which
// is how loads, stores and calls unfold as targets are discovered. Field nodes are created on
// demand per (object, field). Solving runs a worklist of newly reached objects to a fixed point.

export class PointsTo {
  constructor() {
    this.pts=[];this.succ=[];this.delta=[];this.listeners=[];this.queue=[];this.queued=[];
    this.objects=[];this.fields=new Map();this.fieldNames=[];this.fieldListeners=[];
    this.edgeCount=0;this.propagations=0;
  }
  node() {
    const n=this.pts.length;
    this.pts.push(new Set());this.succ.push(null);this.delta.push(null);this.listeners.push(null);this.queued.push(false);
    return n;
  }
  object(info) {
    const o=this.objects.length;this.objects.push(info);this.fieldNames.push(null);this.fieldListeners.push(null);
    return o;
  }
  add(n,o) {
    const set=this.pts[n];if(set.has(o))return;
    set.add(o);(this.delta[n]??=[]).push(o);
    if(!this.queued[n]){this.queued[n]=true;this.queue.push(n);}
  }
  edge(a,b) {
    if(a===b)return;
    const out=this.succ[a]??=new Set();if(out.has(b))return;
    out.add(b);this.edgeCount++;
    for(const o of this.pts[a])this.add(b,o);
  }
  // Calls fn(o) for every object that reaches n, now and later.
  on(n,fn) {
    (this.listeners[n]??=[]).push(fn);
    for(const o of [...this.pts[n]])fn(o);
  }
  field(o,name) {
    const key=o+'\u0000'+name;let n=this.fields.get(key);
    if(n!==undefined)return n;
    n=this.node();this.fields.set(key,n);
    (this.fieldNames[o]??=[]).push(name);
    for(const fn of this.fieldListeners[o]??[])fn(name,n);
    return n;
  }
  // Calls fn(name, node) for every field of o, now and later.
  onField(o,fn) {
    (this.fieldListeners[o]??=[]).push(fn);
    for(const name of [...(this.fieldNames[o]??[])])fn(name,this.fields.get(o+'\u0000'+name));
  }
  solve() {
    const {queue}=this;
    while(queue.length) {
      const n=queue.pop();this.queued[n]=false;
      const d=this.delta[n];if(!d)continue;this.delta[n]=null;
      this.propagations+=d.length;
      const out=this.succ[n];
      if(out)for(const b of out)for(const o of d)this.add(b,o);
      const ls=this.listeners[n];
      if(ls)for(let i=0;i<ls.length;i++)for(const o of d)ls[i](o);
    }
  }
}
