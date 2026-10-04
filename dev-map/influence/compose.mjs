// Composition for the compositional analysis (plans/dev-maps.md#analysis). Takes the per-file
// summaries from compile.mjs and composes them in one points-to solve.
//
// Each callable F has one *summary* (a host of its own): its open operations run once, with every
// value that comes from the call represented by a symbolic object:
// - formals: each parameter, the rest elements, `this`, the function object itself, and each
//   enclosing variable F or a closure inside it uses (its environment);
// - paths: what a field of a symbolic object holds (formal.x, formal.x[]), up to `pathLimit`
//   steps; the path at the limit is folded (it stands for itself and what the summary loads
//   from it);
// - call results: the result of a call whose callee is symbolic (a callback parameter, a method
//   of a parameter), kept as a *deferred call*.
// Objects F allocates in its open operations are *templates*: each instantiation gets a clone.
// Operations whose operands are concrete run on the shared heap directly; a concrete node never
// holds a symbolic object or a template (a write that would is deferred).
//
// A call instantiates the callee's summary in the caller's host (the caller's own summary, or the
// concrete host for module code and closed operations): formals map to the actual nodes, paths to
// loads from them, templates to clones, and deferred items (calls, writes to the caller's objects,
// copies) are re-issued in the host, where they run or are deferred again. Instantiations are one
// per (function object, call site, host) and clones one per (allocation, call site, host), so the
// solve is finite; a callable's result reaches only the call sites that supplied its inputs, up to
// that keying. Every call in every host is wired: soundness does not depend on reaching any
// context first.
//
// Callables never instantiated in the concrete host (uncalled, or called only from code that is
// itself never concrete) get one default concrete instantiation with empty inputs, as the copying
// engine analysed every body once.
//
// Records for derive.mjs: per callable, stores {base node, name, site}, reads (field nodes of
// concrete objects), call sites (targets, platform callbacks, effects, receiver), ret and this.
// Reads and writes on symbolic objects and templates are carried as tags (readers, writer sites)
// and recorded when an instantiation makes them concrete.
import {lookupPlatform,typeOf,familyOf,familyPath,propertyType,BROWSER_ROOTS} from './platform-models.mjs';

const ELEMENT='[]',ANY='\u0001any';
const WRAPPERS={string:String,number:Number,boolean:Boolean,bigint:BigInt};
const SOURCE=/^(this|args\d+\+|args|arg\d+|cb|\?|@[\w-]+)((?:\[\]|\.\*|\.[\w$#]+)*)$/;

// A growing set of tags (reader records or writer sites) with subscribers and links.
let tagIds=0;
class Tags {
  constructor(first){this.id=tagIds++;this.items=[];this.set=new Set();this.subs=null;if(first!==undefined)this.add(first);}
  add(x){if(this.set.has(x))return;this.set.add(x);this.items.push(x);if(this.subs)for(let i=0;i<this.subs.length;i++)this.subs[i](x);}
  each(f){(this.subs??=[]).push(f);for(let i=0;i<this.items.length;i++)f(this.items[i]);}
  link(t){if(t!==this)this.each(x=>t.add(x));}
}

export function compose(pt,units,{platformModules=new Map(),pathLimit=3,progress,debug}={}) {
  const objs=pt.objects;
  // --- node spaces: 0 concrete, a host id for a summary's nodes, -1 for derive-only sinks ------
  const space=[];let cur=0;
  const node0=pt.node.bind(pt),field0=pt.field.bind(pt);
  pt.node=function(){const n=node0();space[n]=cur;return n;};
  pt.field=function(o,name){const prev=cur;cur=objs[o].space??0;try{return field0(o,name);}finally{cur=prev;}};
  const newNode=s=>{const prev=cur;cur=s;const n=pt.node();cur=prev;return n;};
  const sp=o=>objs[o].space??0;
  const memo=new Set();const once=k=>memo.has(k)?false:(memo.add(k),true);
  const stats={summaries:0,instancesConcrete:0,instancesSummary:0,defaultInstances:0,deferredCalls:0,deferredWrites:0,
    formals:0,paths:0,folded:0,callResults:0,templates:0,clones:0,platformApplications:0,danglingEnv:0,danglingFormal:0};
  const unmodelled=[],unresolvedImports=[],unresolvedSeen=new Set(),accessorReads=new Set(),noted=new Set();

  // --- hosts and their event streams ----------------------------------------------------------
  const hosts=[{id:0,concrete:true,events:[],subs:[]}];
  const dirty=[],tasks=[];
  function emit(H,ev){H.events.push(ev);for(const I of H.subs)if(!I.queued){I.queued=true;dirty.push(I);}}
  // A summary object in a concrete node is deferred: the summary's instantiations map it there.
  function put(n,o) {
    if(space[n]===0&&sp(o)!==0){if(once(`w${n}|${o}`)){stats.deferredWrites++;debug?.write?.(n,o,hosts[sp(o)]);emit(hosts[sp(o)],{t:'w',b:n,o});}return;}
    pt.add(n,o);
  }
  function flow(a,b) {
    if(a===b||a===undefined||b===undefined)return;
    if(space[b]===0&&space[a]>0){if(once(`f${a}>${b}`))pt.on(a,o=>put(b,o));return;}
    pt.edge(a,b);
  }
  const nodeWith=(s,o)=>{const n=newNode(s);put(n,o);return n;};

  // --- platform values (as constraints.mjs) -----------------------------------------------------
  const platformObjects=new Map();
  function platform(path,value,known=value!==undefined) {
    let o=platformObjects.get(path);
    if(o===undefined){o=pt.object({kind:'platform',name:path,value,known});platformObjects.set(path,o);}
    return o;
  }
  function unknownRoot(name){const o=platform(name);objs[o].root=true;return o;}
  function platformRoot(name) {
    if(platformModules.has(name))return platform(name,platformModules.get(name));
    if(name in globalThis&&!BROWSER_ROOTS.has(name))return platform(name,globalThis[name]);
    return unknownRoot(name);
  }
  const UNKNOWN=platform('platform.unknown');
  const PLATFORM_PROTO=platform('platform.prototype',undefined,false);
  const PROTOS={'Array.prototype':platform('Array.prototype',Array.prototype),'Object.prototype':platform('Object.prototype',Object.prototype),
    'Function.prototype':platform('Function.prototype',Function.prototype),'RegExp.prototype':platform('RegExp.prototype',RegExp.prototype)};
  const PRIM={};for(const k of ['string','number','boolean','bigint','primitive'])PRIM[k]=pt.object({kind:'primitive',prim:k,name:k});
  function familyObject(x){const fam=familyOf(x.name);return fam?platform(familyPath(fam)):UNKNOWN;}
  function typeObject(type){const t=typeOf(type);return t.family?platform(familyPath(t.family)):platform(t.path,t.value);}
  function platformChild(o,name) {
    const x=objs[o];
    if(!x.known)return x.root&&name!==null&&name!==ELEMENT&&familyOf(x.name)?platform(`${familyOf(x.name)}.${name}`):familyObject(x);
    if(name===null||name===ELEMENT)return undefined;
    const path=x.name+'.'+name;
    const declared=propertyType(path);if(declared!==undefined)return typeObject(declared);
    let v;try{if(x.value==null||!(name in Object(x.value)))return undefined;v=x.value[name];}catch{accessorReads.add(path);return undefined;}
    return platform(path,v,true);
  }
  // A member of a primitive: its wrapper prototype's method, or a primitive.
  function primitiveChild(x,name,target) {
    if(name===null||name===ANY)return;
    for(const k of x.prim==='primitive'?['string','number','boolean']:[x.prim]) {
      if(name===ELEMENT){if(k==='string')put(target,PRIM.string);continue;}
      const C=WRAPPERS[k];let v;try{v=C.prototype[name];}catch{continue;}
      if(typeof v==='function')put(target,platform(`${C.name}.prototype.${name}`,v,true));
      else if(v!=null&&typeof v!=='object'&&PRIM[typeof v])put(target,PRIM[typeof v]);
    }
  }
  function note(kind,site) {
    const k=`${kind}|${site.id}`;if(noted.has(k))return;noted.add(k);
    unmodelled.push({kind,fn:site.fn,file:site.file,line:site.line});
  }

  // --- callables and their records ----------------------------------------------------------------
  const byKey=new Map(),recs=[],recOf=new Map();
  for(const u of units.values())for(const F of u.functions){F.unit=u;byKey.set(F.key,F);}
  function rec(F) {
    let r=recOf.get(F);if(r)return r;
    const p=F.owner>=0?F.unit.functions[F.owner]:null;
    r={id:recs.length,name:F.name,kind:F.kind,file:F.file,line:F.line,end:F.end,owner:p?rec(p).id:undefined,key:F.key,
      inClone:false,module:F.module,stores:[],reads:new Set(),calls:[],ret:undefined,thisNode:undefined};
    recs.push(r);recOf.set(F,r);return r;
  }
  const readerTags=new Map(),siteTags=new Map();
  const readerTag=r=>readerTags.get(r)??readerTags.set(r,new Tags(r)).get(r);
  const siteTag=s=>siteTags.get(s)??siteTags.set(s,new Tags(s)).get(s);
  // Per summary object and field: who reads it, which sites write it.
  function tagsOf(o,which,name) {
    const x=objs[o];const m=x[which]??=new Map();
    let t=m.get(name);if(!t){t=new Tags();m.set(name,t);(x[which+'Names']??=new Tags()).add(name);}
    return t;
  }
  const sites=new Map();let siteCount=0;
  function siteOf(F,spec,kind) {
    const k=F.key+'|'+spec.id+'|'+kind;let s=sites.get(k);if(s)return s;
    const r=rec(F);
    s={id:spec.id,uid:siteCount++,fn:r.id,file:F.file,line:spec.line,text:spec.text,targets:[],platformCallbacks:[],platform:false,
      resultUsed:spec.resultUsed,receiver:newNode(-1),tset:new Set(),pset:new Set(),name:/^[\w$]+$/.test(spec.text??'')?spec.text:undefined};
    s.receiverNode=s.receiver;
    sites.set(k,s);if(kind==='call')r.calls.push(s);
    return s;
  }
  function addTarget(site,id,via) {
    if(via==='platform'){if(!site.pset.has(id)){site.pset.add(id);site.platformCallbacks.push(id);}}
    else if(!site.tset.has(id)){site.tset.add(id);site.targets.push(id);}
  }

  // --- objects --------------------------------------------------------------------------------
  function newSym(s,sym,info) {
    const o=pt.object({kind:'sym',sym,space:s,...info});
    stats[sym==='formal'?'formals':sym==='path'?(info.folded?'folded':'paths'):'callResults']++;
    emit(hosts[s],{t:'s',X:o});
    return o;
  }
  // A path at the depth limit is folded: it stands for itself and everything reached from it
  // through the fields the summary loads from it.
  function child(X,name) {
    const x=objs[X];if(x.folded)return X;
    x.children??=new Map();let P=x.children.get(name);if(P!==undefined)return P;
    P=newSym(x.space,'path',{parent:X,field:name,depth:x.depth+1,folded:x.depth+1>=pathLimit,name:x.name+'.'+(name===ANY?'?':name)});
    x.children.set(name,P);return P;
  }
  // A field of a symbolic object starts out holding its path: what the caller's object holds.
  function fieldOf(o,name) {
    const n=pt.field(o,name);const x=objs[o];
    if(x.kind==='sym'&&name!=='*'){x.init??=new Set();if(!x.init.has(name)){x.init.add(name);pt.add(n,child(o,name));}}
    return n;
  }
  const allocated=new Map();
  function alloc(H,origin,info) {
    const k=origin+'|'+H.id;let o=allocated.get(k);
    if(o===undefined){o=pt.object({...info,space:H.id,origin});allocated.set(k,o);if(H.id)stats.templates++;}
    return o;
  }

  // --- bases (closed operations, concrete) and summaries (open operations) --------------------
  const bases=new Map(),summaries=new Map();
  const envIndex=F=>F.envIdx??=new Map(F.env.map((e,j)=>[e.key+'|'+e.local,j]));
  function envFor(C,F,map) {
    return C.env.map(e=>{
      if(e.up===1)return map[e.local];
      const j=envIndex(F).get(e.key+'|'+e.local);
      if(j===undefined){stats.danglingEnv++;return undefined;}
      return map[F.nOwn+j];
    });
  }
  function slotObject(F,sp_,i,H,map) {
    const r=rec(F);
    if(sp_.fn!==undefined) {
      const C=F.unit.functions[sp_.fn];
      const o=alloc(H,'fn|'+C.key,{kind:'function',F:C,fn:rec(C),name:C.name??'(anonymous)',owner:r.id});
      if(!objs[o].envNodes)objs[o].envNodes=envFor(C,F,map);
      put(fieldOf(o,'__proto__'),PROTOS['Function.prototype']);
      return o;
    }
    const o=alloc(H,F.key+'#'+i,{kind:'object',shape:sp_.shape,name:sp_.name,owner:r.id,file:F.file,line:sp_.line});
    const proto=sp_.proto??(sp_.shape==='regexp'?'RegExp.prototype':undefined);
    if(proto)put(fieldOf(o,'__proto__'),PROTOS[proto]);
    return o;
  }
  function base(F) {
    let b=bases.get(F);if(b)return b;
    b={H:hosts[0],F,rec:rec(F),map:new Int32Array(F.n).fill(-1),slots:new Array(F.slots.length)};
    bases.set(F,b);
    for(let i=0;i<F.nOwn;i++)if(!F.open[i])b.map[i]=newNode(0);
    for(let j=0;j<F.env.length;j++){const i=F.nOwn+j;if(F.open[i])continue;const e=F.env[j];b.map[i]=base(byKey.get(e.key)).map[e.local];}
    F.slots.forEach((s,i)=>{if(!s.open)b.slots[i]=slotObject(F,s,i,hosts[0],b.map);});
    tasks.push([b,F.closedOps]);
    return b;
  }
  function summary(F) {
    let S=summaries.get(F);if(S)return S;
    const b=base(F);
    S={id:hosts.length,F,rec:rec(F),events:[],subs:[],deferred:new Map(),map:new Int32Array(F.n),slots:new Array(F.slots.length),
      formals:{params:[],rest:undefined,this:undefined,self:undefined,env:new Map()}};
    hosts.push(S);summaries.set(F,S);stats.summaries++;
    for(let i=0;i<F.nOwn;i++)S.map[i]=F.open[i]?newNode(S.id):b.map[i];
    for(let j=0;j<F.env.length;j++) {
      const i=F.nOwn+j;
      if(!F.open[i]){S.map[i]=b.map[i];continue;}
      S.map[i]=newNode(S.id);
      const P=newSym(S.id,'formal',{depth:0,name:`${F.name??'(anonymous)'} env ${j}`});
      S.formals.env.set(j,P);pt.add(S.map[i],P);
    }
    F.slots.forEach((s,i)=>{S.slots[i]=s.open?slotObject(F,s,i,S,S.map):b.slots[i];});
    F.params.forEach((p,i)=>{const P=newSym(S.id,'formal',{depth:0,name:`${F.name??'(anonymous)'} param ${i}`});S.formals.params.push(P);pt.add(S.map[p],P);});
    if(F.rest>=0) {
      S.formals.rest=newSym(S.id,'formal',{depth:0,name:`${F.name??'(anonymous)'} rest`});
      pt.add(pt.field(S.slots[F.restSlot],ELEMENT),S.formals.rest);
    }
    if(F.thisL>=0&&F.thisL<F.nOwn&&F.open[F.thisL]){S.formals.this=newSym(S.id,'formal',{depth:0,name:`${F.name??'(anonymous)'} this`});pt.add(S.map[F.thisL],S.formals.this);}
    if(F.openOps.some(op=>op.k==='SELF'))S.formals.self=newSym(S.id,'formal',{depth:0,name:`${F.name??'(anonymous)'} self`});
    S.ret=S.map[F.ret];
    tasks.push([{H:S,F,rec:S.rec,map:S.map,slots:S.slots},F.openOps]);
    return S;
  }

  // --- instantiation: a callee's summary in a host --------------------------------------------
  const insts=new Map(),clones=new Map(),concreteCount=new Map();
  function instantiate(fo,site,J) {
    const key=fo+'|'+site.uid+'|'+J.id;let I=insts.get(key);if(I)return I;
    const x=objs[fo],F=x.F,S=summary(F);
    // A summary calling its own callable: the recursion meets in the summary itself (its
    // parameters receive the recursive arguments, its result answers the recursive call), so
    // a recursive walk does not unfold its paths level by level.
    if(J===S&&S.formals.env.size===0) {
      I={key,J,S,F,fo,site,self:true,params:F.params.map(p=>S.map[p]),restEl:F.rest>=0?pt.field(S.slots[F.restSlot],ELEMENT):undefined,
        thisN:F.thisL>=0?S.map[F.thisL]:newNode(S.id),ret:S.ret};
      insts.set(key,I);stats.selfRecursive=(stats.selfRecursive??0)+1;return I;
    }
    I={key,J,S,F,fo,site,next:0,queued:true,smap:new Map(),nmap:new Map(),cmap:new Map()};
    insts.set(key,I);
    if(J.id===0){stats.instancesConcrete++;concreteCount.set(F,(concreteCount.get(F)??0)+1);}else stats.instancesSummary++;
    const nd=()=>newNode(J.id);
    I.params=F.params.map(nd);I.restEl=F.rest>=0?nd():undefined;I.thisN=nd();I.ret=nd();
    S.formals.params.forEach((P,i)=>I.smap.set(P,I.params[i]));
    if(S.formals.rest!==undefined)I.smap.set(S.formals.rest,I.restEl);
    if(S.formals.this!==undefined)I.smap.set(S.formals.this,I.thisN);
    if(S.formals.self!==undefined)I.smap.set(S.formals.self,nodeWith(J.id,fo));
    for(const [j,P] of S.formals.env) {
      const b=x.envNodes?.[j];
      if(b===undefined){stats.danglingEnv++;I.smap.set(P,nd());continue;}
      I.smap.set(P,b);
      // Writes to a captured variable reach the variable the function object closes over.
      pt.on(S.map[F.nOwn+j],o=>{if(o!==P)mapInto(I,o,b);});
    }
    pt.on(S.ret,o=>mapInto(I,o,I.ret));
    S.subs.push(I);dirty.push(I);
    return I;
  }
  const evCount={};let evTotal=0;
  function pump(I){I.queued=false;const ev=I.S.events;while(I.next<ev.length){const e=ev[I.next++];evCount[e.t]=(evCount[e.t]??0)+1;
    if(progress&&++evTotal%20000===0)progress({inPump:I.F.key,host:I.J.id,S:I.S.id,events:ev.length,next:I.next,evCount,stats,nodes:pt.pts.length,objects:objs.length,memo:memo.size});
    handle(I,e);}}
  function handle(I,ev) {
    const J=I.J;
    switch(ev.t) {
      case 'w':mapInto(I,ev.o,ev.b);return;
      case 'c':{const d=ev.d;
        const r=symNode(I,d.callres);
        const a=d.args.map(n=>mapNode(I,n));a.spreadAt=d.spreadAt;
        if(d.construct)construct(J,d.site,mapNode(I,d.calleeN),a,r);
        else call(J,d.site,mapNode(I,d.calleeN),mapNode(I,d.thisN),a,r,{via:d.via,method:d.method});
        return;}
      case 'copy':{const src=symNode(I,ev.X),dst=mapNode(I,nodeWith(I.S.id,ev.dst));
        pt.on(dst,o=>copyFields(J,src,o,ev.over));return;}
      case 's':{const X=ev.X,x=objs[X];
        // Writes into the caller's objects: a field's content other than its own path.
        pt.onField(X,(name,fn)=>{
          const own=name==='*'?undefined:x.folded?X:x.children?.get(name);
          let v;
          const arm=()=>{if(v!==undefined)return;v=newNode(J.id);
            store(J,symNode(I,X),name==='*'||name===ANY?null:name,v,undefined,tagsOf(X,'writers',name));};
          pt.on(fn,o=>{if(o===own)return;arm();mapInto(I,o,v);});
          tagsOf(X,'writers',name).each(()=>arm());
        });
        // Reads of the caller's objects, recorded once concrete.
        if(x.sym==='path')tagsOf(x.parent,'readers',x.field).each(()=>symNode(I,X));
        return;}
    }
  }
  // The host node standing for a symbolic object of the summary.
  function symNode(I,X) {
    let n=I.smap.get(X);if(n!==undefined)return n;
    const x=objs[X],J=I.J;
    n=newNode(J.id);I.smap.set(X,n);
    if(x.sym==='path') {
      load(J,symNode(I,x.parent),x.field===ANY?null:x.field,n,tagsOf(x.parent,'readers',x.field));
      if(x.folded)pt.onField(X,(name,fn)=>{if(name!=='*')load(J,n,name===ANY?null:name,n,tagsOf(X,'readers',name));});
    } else if(x.sym==='formal')stats.danglingFormal++;
    return n;
  }
  function mapNode(I,n) {
    if(space[n]===0||space[n]===-1)return n;
    let h=I.nmap.get(n);if(h!==undefined)return h;
    h=newNode(I.J.id);I.nmap.set(n,h);
    pt.on(n,o=>mapInto(I,o,h));
    return h;
  }
  function mapInto(I,o,target) {
    if(sp(o)===0){put(target,o);return;}
    if(objs[o].kind==='sym')flow(symNode(I,o),target);
    else put(target,cloneOf(I,o));
  }
  // A template's clone in the host: one per (allocation, call site, host).
  function cloneOf(I,T) {
    let C=I.cmap.get(T);if(C!==undefined)return C;
    const x=objs[T],J=I.J;
    const key=x.origin+'|'+I.site.uid+'|'+J.id;
    C=clones.get(key);
    if(C===undefined) {
      const info={...x,space:J.id};
      for(const k of ['readers','writers','readersNames','writersNames','init','children'])delete info[k];
      if(x.kind==='function')info.envNodes=x.envNodes.map(e=>e===undefined||space[e]===0?e:newNode(J.id));
      if(x.kind==='resolver')info.target=undefined;
      C=pt.object(info);clones.set(key,C);stats.clones++;
    }
    I.cmap.set(T,C);
    const c=objs[C];
    if(x.kind==='resolver'&&c.target===undefined){const t=objs[x.target];c.target=sp(x.target)===0?x.target:t.kind==='sym'?undefined:cloneOf(I,x.target);}
    pt.onField(T,(name,fn)=>{const cf=fieldOf(C,name);pt.on(fn,o=>mapInto(I,o,cf));});
    if(x.kind==='function')x.envNodes.forEach((e,j)=>{const ce=c.envNodes[j];if(e===undefined||ce===undefined||space[e]===0)return;const m=mapNode(I,e);flow(m,ce);flow(ce,m);});
    // Reads and writes on the template become reads and writes on the clone.
    const concrete=J.id===0;let cnode;
    x.readersNames?.each(name=>tagsOf(T,'readers',name).each(r=>{
      if(concrete){if(name!==ANY)r.reads.add(fieldOf(C,name));else pt.onField(C,(f,fn)=>{if(f!=='__proto__')r.reads.add(fn);});}
      else tagsOf(C,'readers',name).add(r);}));
    x.writersNames?.each(name=>tagsOf(T,'writers',name).each(s=>{
      if(concrete){cnode??=nodeWith(0,C);recs[s.fn].stores.push({base:cnode,name:name==='*'?null:name,site:s});}
      else tagsOf(C,'writers',name).add(s);}));
    return C;
  }
  function bindArgs(I,args) {
    const at=args.spreadAt??-1;
    args.forEach((a,i)=>{
      if(a===undefined)return;
      if(at>=0&&i>=at){for(let j=i;j<I.params.length;j++)flow(a,I.params[j]);if(I.restEl!==undefined)flow(a,I.restEl);}
      else if(i<I.params.length)flow(a,I.params[i]);
      else if(I.restEl!==undefined)flow(a,I.restEl);
    });
  }

  // --- semantics in a host ----------------------------------------------------------------------
  function load(H,b,name,target,tags){pt.on(b,o=>loadFrom(H,o,name,target,tags));}
  function readAt(o,name,fn,tags) {
    if(sp(o)===0)tags.each(r=>r.reads.add(fn));
    else tags.link(tagsOf(o,'readers',name));
  }
  function loadFrom(H,o,name,target,tags) {
    if(!once(`l${o}|${name}|${target}|${tags.id}`))return;
    const x=objs[o];
    switch(x.kind) {
      case 'sym':
        if(name===null){fieldOf(o,ANY);pt.onField(o,(f,fn)=>{if(f!=='__proto__')flow(fn,target);});tags.link(tagsOf(o,'readers',ANY));return;}
        flow(fieldOf(o,name),target);tags.link(tagsOf(o,'readers',name));return;
      case 'platform':{const c=platformChild(o,name);if(c!==undefined)put(target,c);return;}
      case 'primitive':primitiveChild(x,name,target);return;
    }
    if(name===null){pt.onField(o,(f,fn)=>{if(f==='__proto__')return;flow(fn,target);readAt(o,f,fn,tags);});return;}
    const fn=fieldOf(o,name);flow(fn,target);readAt(o,name,fn,tags);
    if(name!=='__proto__')pt.on(fieldOf(o,'__proto__'),p=>loadFrom(H,p,name,target,tags));
  }
  function store(H,b,name,value,site,wtags) {
    wtags.each(s=>recs[s.fn].stores.push({base:b,name,site:s}));
    pt.on(b,o=>storeInto(H,o,name,value,site??wtags.items[0],wtags));
  }
  function storeInto(H,o,name,value,site,wtags) {
    if(!once(`s${o}|${name}|${value}|${wtags.id}`))return;
    const x=objs[o];
    if(x.kind==='primitive')return;
    if(x.kind==='platform') {
      // A callable stored on a platform object (a handler) is invoked by the platform with
      // values of the object's family.
      if(site)(site.apis??=new Map()).set(`set ${x.known?x.name:objs[familyObject(x)].name}.${name??'[computed]'}`,'store');
      if(value!==undefined&&site)call(H,site,value,nodeWith(H.id,o),[nodeWith(H.id,x.known?UNKNOWN:familyObject(x))],undefined,{via:'platform'});
      return;
    }
    if(sp(o)!==0)wtags.link(tagsOf(o,'writers',name===null?'*':name));
    if(value===undefined)return;
    if(name===null){fieldOf(o,'*');pt.onField(o,(f,fn)=>{if(f!=='__proto__')flow(value,fn);});}
    else flow(value,fieldOf(o,name));
  }
  // Every field of src's objects onto dst, except names the literal sets after the spread.
  function copyFields(H,src,dst,over) {
    pt.on(src,o=>{
      if(!once(`c${o}|${dst}`))return;
      const x=objs[o];
      if(x.kind==='platform'||x.kind==='primitive')return;
      if(x.kind==='sym') {
        emit(hosts[sp(o)],{t:'copy',X:o,dst,over});
        pt.onField(dst,(name,fn)=>{if(name==='__proto__'||name==='*'||over?.has(name))return;flow(fieldOf(o,name),fn);});
        return;
      }
      pt.onField(o,(name,fn)=>{if(name!=='__proto__'&&name!==ANY&&!over?.has(name))flow(fn,fieldOf(dst,name));});
    });
  }

  function call(H,site,callee,thisNode,args,result,opts){pt.on(callee,o=>dispatch(H,o,site,thisNode,args,result,opts));}
  function dispatch(H,o,site,thisNode,args,result,opts) {
    const x=objs[o];
    switch(x.kind) {
      case 'function':{
        const I=instantiate(o,site,H);
        bindArgs(I,args);
        if(thisNode!==undefined&&!x.F.arrow)flow(thisNode,I.thisN);
        if(result!==undefined)flow(I.ret,result);
        addTarget(site,x.fn.id,opts.via);return;}
      case 'sym':deferCall(H,o,site,thisNode,args,result,opts);return;
      case 'resolver':if(opts.via==='call'&&args[0]!==undefined&&x.target!==undefined)flow(args[0],fieldOf(x.target,ELEMENT));return;
      case 'platform':case 'value':case 'primitive':if(opts.via==='call')platformCall(H,site,o,thisNode,args,result,opts.method);return;
    }
  }
  // A call whose callee is symbolic: kept in the host's summary, re-issued by each instantiation.
  // One per (site, host): symbolic callees reaching the same site share it, so the summary stays
  // finite under recursion.
  function deferCall(H,o,site,thisNode,args,result,opts) {
    const key=`${site.uid}|${opts.via}|${args.length}|${opts.construct?1:0}`;
    let d=H.deferred.get(key);
    if(!d) {
      d={site,calleeN:newNode(H.id),via:opts.via,method:opts.method,construct:!!opts.construct,thisN:newNode(H.id),
        args:args.map(()=>newNode(H.id)),spreadAt:args.spreadAt??-1,result:newNode(H.id)};
      d.callres=newSym(H.id,'callres',{depth:0,name:'result of '+(site.text??site.id)});
      pt.add(d.result,d.callres);
      H.deferred.set(key,d);stats.deferredCalls++;
      emit(H,{t:'c',d});
    }
    pt.add(d.calleeN,o);
    if(thisNode!==undefined)flow(thisNode,d.thisN);
    args.forEach((a,i)=>flow(a,d.args[i]));
    if(result!==undefined)flow(d.result,result);
  }
  function construct(H,site,callee,args,result) {
    site.construct=true;
    pt.on(callee,o=>{
      const x=objs[o];
      if(x.kind==='sym'){deferCall(H,o,site,undefined,args,result,{via:'call',construct:true});return;}
      if(x.kind==='primitive')return;
      const inst=alloc(H,`new|${site.id}|${x.origin??o}`,{kind:x.kind==='platform'?'value':'object',name:'new '+x.name,owner:site.fn,site:site.id,
        ctorOf:x.kind==='function'?x.fn.id:undefined});
      put(result,inst);
      if(x.kind==='function') {
        flow(fieldOf(o,'prototype'),fieldOf(inst,'__proto__'));
        const I=instantiate(o,site,H);bindArgs(I,args);put(I.thisN,inst);flow(I.ret,result);addTarget(site,x.fn.id,'call');
      } else if(x.kind==='platform') {
        const proto=x.known&&x.value?.prototype?platform(x.name+'.prototype',x.value.prototype):x.known?PLATFORM_PROTO:familyObject(x);
        put(fieldOf(inst,'__proto__'),proto);
        platformCall(H,site,o,undefined,args,result,undefined,inst);
      }
    });
  }

  // --- platform models (platform-models.mjs), applied once per (site, API, host) ---------------
  const apps=new Map();
  function platformCall(H,site,o,thisNode,args,result,method,inst) {
    const x=objs[o];
    if(x.parts)return;
    const construct=inst!==undefined;
    const hit=x.kind==='platform'?lookupPlatform({path:x.name,value:x.value,known:x.known,method,name:site.name,construct})
      :x.kind==='value'&&x.name==='platform result'?lookupPlatform({path:'platform.unknown',known:false,method,name:site.name,construct})
      :{api:x.name,notCallable:true};
    site.platform=true;site.member??=method;
    if(thisNode!==undefined)flow(thisNode,site.receiver);
    (site.apis??=new Map()).set(hit.api,hit.notCallable?'not-callable':hit.spec?hit.how:'unmodelled');
    if(hit.notCallable)return;
    const key=`${site.uid}|${hit.api}|${H.id}|${construct?inst:''}|${args.length}`;
    let c=apps.get(key);
    if(!c) {
      c={site,H,rec:recs[site.fn],thisN:newNode(H.id),args:args.map(()=>newNode(H.id)),result:newNode(H.id),inst,api:hit.api,memo:new Map(),cb:undefined};
      c.args.spreadAt=args.spreadAt??-1;
      apps.set(key,c);stats.platformApplications++;
      if(hit.spec){applyModel(hit.spec,c);if(!construct&&!hit.spec.engine&&!hit.spec.out?.length)put(c.result,PRIM.primitive);}
      else{note('platform:'+hit.api,site);genericPlatformCall(c);}
    }
    if(thisNode!==undefined)flow(thisNode,c.thisN);
    args.forEach((a,i)=>flow(a,c.args[i]));
    if(result!==undefined)flow(c.result,result);
  }
  function genericPlatformCall(c) {
    const {H,site,rec:r}=c;
    const pr=alloc(H,'pr|'+site.id,{kind:'value',name:'platform result',owner:r.id,site:site.id});
    put(c.result,pr);put(fieldOf(pr,'__proto__'),PLATFORM_PROTO);
    const elements=fieldOf(c.inst??pr,ELEMENT);
    const tags=readerTag(r);
    const elementsOf=(n,target)=>pt.on(n,o=>{const k=objs[o].kind;if(k!=='platform'&&k!=='primitive')loadFrom(H,o,ELEMENT,target,tags);});
    elementsOf(c.thisN,elements);elementsOf(c.thisN,c.result);
    const p=nodeWith(H.id,UNKNOWN);flow(elements,p);const args=[p];args.spreadAt=0;
    for(const a of c.args){elementsOf(a,elements);call(H,site,a,nodeWith(H.id,UNKNOWN),args,elements,{via:'platform'});}
  }
  const argAt=(c,i)=>i<c.args.length?c.args[i]:c.args.spreadAt>=0?c.args[c.args.spreadAt]:undefined;
  const cbNode=c=>c.cb??=newNode(c.H.id);
  function union(H,list){const present=list.filter(n=>n!==undefined);if(present.length<2)return present[0];const t=newNode(H.id);for(const n of present)flow(n,t);return t;}
  function src(tok,c,key) {
    if(typeof tok==='object')return freshNode(tok,c,key);
    if(c.memo.has(tok))return c.memo.get(tok);
    const m=SOURCE.exec(tok);
    if(!m)throw Error(`Bad platform model source ${tok} (${c.api})`);
    const b=m[1];let n;
    if(b==='this')n=c.inst!==undefined?nodeWith(c.H.id,c.inst):c.thisN;
    else if(b==='cb')n=cbNode(c);
    else if(b==='?')n=nodeWith(c.H.id,UNKNOWN);
    else if(b[0]==='@')n=nodeWith(c.H.id,platform(familyPath(b.slice(1))));
    else if(b==='args'||b.endsWith('+')) {
      const from=b==='args'?0:+b.slice(4,-1);
      const list=c.args.slice(from);
      if(c.args.spreadAt>=0&&from>c.args.spreadAt)list.push(c.args[c.args.spreadAt]);
      n=union(c.H,list);
    } else n=argAt(c,+b.slice(3));
    for(const step of n===undefined?[]:m[2].match(/\[\]|\.\*|\.[\w$#]+/g)??[]) {
      const t=newNode(c.H.id);load(c.H,n,step==='[]'?ELEMENT:step==='.*'?null:step.slice(1),t,readerTag(c.rec));n=t;
    }
    c.memo.set(tok,n);return n;
  }
  function freshNode(spec,c,key) {
    const o=alloc(c.H,`${c.site.id}|${c.api}|${key}`,{kind:'value',name:`${spec.fresh} from ${c.api}`,owner:c.rec.id,site:c.site.id,fresh:spec.fresh});
    const x=objs[o];
    if(!x.typed) {
      x.typed=true;
      const t=typeOf(spec.fresh);
      put(fieldOf(o,'__proto__'),t.family?platform(familyPath(t.family)):platform(t.path,t.value));
      if(t.parts){x.parts=true;pt.onField(o,(name,fn)=>{if(name!=='__proto__')put(fn,o);});}
    }
    fill(o,spec,c,key);
    return nodeWith(c.H.id,o);
  }
  function fill(o,spec,c,key) {
    (spec.el??[]).forEach((s,i)=>{const n=src(s,c,key+'e'+i);if(n!==undefined)flow(n,fieldOf(o,ELEMENT));});
    for(const [name,list] of Object.entries(spec.fields??{}))list.forEach((s,i)=>{const n=src(s,c,`${key}f${name}${i}`);if(n!==undefined)flow(n,fieldOf(o,name));});
    (spec.any??[]).forEach((s,i)=>{const n=src(s,c,key+'a'+i);if(n===undefined)return;
      flow(n,fieldOf(o,'*'));pt.onField(o,(name,fn)=>{if(name!=='__proto__')flow(n,fn);});});
    (spec.copy??[]).forEach((s,i)=>{const n=src(s,c,key+'c'+i);if(n!==undefined)copyFields(c.H,n,o);});
  }
  function applyModel(spec,c) {
    const {site,H}=c;
    if(spec.engine){engineCall(spec.engine,c);return;}
    (spec.out??[]).forEach((s,i)=>{const n=src(s,c,'o'+i);if(n!==undefined)flow(n,c.result);});
    if(c.inst!==undefined)fill(c.inst,spec,c,'i');
    (spec.calls??[]).forEach((k,i)=>{
      const fn=src(k.fn,c,'k'+i);if(fn===undefined)return;
      const params=(k.params??[]).map((list,j)=>union(H,list.map(s=>src(s,c,`p${i}.${j}`))));
      const th=k.this?union(H,k.this.map(s=>src(s,c,`t${i}`))):undefined;
      call(H,site,fn,th,params,cbNode(c),{via:'platform',when:k.when});
    });
    const tag=siteTag(site);
    for(const t of spec.into??[]) {
      if(t.copy) {
        const target=src(t.to,c,'t');if(target===undefined)continue;
        store(H,target,null,undefined,site,tag);
        for(const s of t.copy){const n=src(s,c,'t');if(n!==undefined)pt.on(target,o=>{const k=objs[o].kind;if(k!=='platform'&&k!=='primitive')copyFields(H,n,o);});}
        continue;
      }
      const m=/^(.*?)(\[\]|\.\*)$/.exec(t.to);const b=src(m[1],c,'t');if(b===undefined)continue;
      const name=m[2]==='[]'?ELEMENT:null;
      for(const s of t.from){const n=src(s,c,'t');if(n!==undefined)store(H,b,name,n,site,tag);}
    }
    for(const s of spec.mutates??[]){const b=src(s,c,'m');if(b!==undefined)store(H,b,ELEMENT,undefined,site,tag);}
    for(const s of spec.observe??[])src(s,c,'r');
    if(spec.effect)(site.effects??=new Set()).add(spec.effect);
    if(spec.reads)(site.worldReads??=new Set()).add(spec.reads);
  }
  // Function.prototype.call/apply/bind and the Promise constructor.
  function engineCall(kind,c) {
    const {H,site,args}=c;
    if(kind==='bind'){flow(c.thisN,c.result);return;}
    if(kind==='promise') {
      const res=alloc(H,'resolve|'+site.id,{kind:'resolver',target:c.inst,name:'resolve'});
      const rn=nodeWith(H.id,res);
      for(const a of args)call(H,site,a,undefined,[rn,rn],undefined,{via:'call'});
      return;
    }
    if(kind==='call')call(H,site,c.thisN,args[0],Object.assign(args.slice(1),{spreadAt:args.spreadAt>0?args.spreadAt-1:-1}),c.result,{via:'call'});
    else {
      let a=[];
      if(args[1]!==undefined){const t=newNode(H.id);load(H,args[1],ELEMENT,t,readerTag(c.rec));a=[t];a.spreadAt=0;}
      call(H,site,c.thisN,args[0],a,c.result,{via:'call'});
    }
  }

  // --- module namespaces and direct call targets ------------------------------------------------
  const nsOf=new Map();
  for(const file of units.keys())nsOf.set(file,pt.object({kind:'object',shape:'module',name:file,owner:null}));
  function exportedKey(file,name,seen=new Set()) {
    const u=units.get(file);if(!u||seen.has(file+':'+name))return undefined;seen.add(file+':'+name);
    const e=u.iface.exports[name];
    if(e?.local!==undefined)return u.iface.local[e.local];
    if(e?.from)return exportedKey(e.from,e.name,seen);
    if(!e&&name!=='default')for(const r of u.iface.reexports){const t=r&&exportedKey(r,name,seen);if(t)return t;}
    return undefined;
  }
  function staticObject(target) {
    const key=target.key??exportedKey(target.file,target.name);
    const F=key&&byKey.get(key);if(!F)return undefined;
    const slot=F.unit.iface.fnSlot[key];if(slot===undefined)return undefined;
    return base(F.unit.functions[0]).slots[slot];
  }

  // --- running operations in a host -------------------------------------------------------------
  function run(ctx,ops) {
    const {H,F,map:M,slots:SL,rec:R}=ctx;
    const tags=readerTag(R);
    const argsOf=op=>{const a=op.args.map(x=>M[x]);a.spreadAt=op.spreadAt;return a;};
    for(const op of ops) {
      switch(op.k) {
        case 'E':flow(M[op.a],M[op.b]);break;
        case 'PLAT':put(M[op.n],op.how==='unknown'?UNKNOWN:platformRoot(op.name));break;
        case 'PRIM':put(M[op.n],PRIM[op.prim]??PRIM.primitive);break;
        case 'NS':{
          let o;
          if(op.file&&nsOf.has(op.file))o=nsOf.get(op.file);
          else if(op.file===null)o=platformModules.has(op.spec)?platform(op.spec,platformModules.get(op.spec)):unknownRoot(op.spec);
          else if(/\.json$/.test(op.spec))o=platform(familyPath('json'));
          else{const k=F.file+'|'+op.spec+'|'+op.line;if(!unresolvedSeen.has(k)){unresolvedSeen.add(k);unresolvedImports.push({file:F.file,spec:op.spec,line:op.line});}o=platform('unresolved:'+op.spec);}
          put(M[op.n],o);break;}
        case 'ALLOC':put(M[op.n],SL[op.s]);break;
        case 'SELF':if(H.formals?.self!==undefined)put(M[op.n],H.formals.self);break;
        case 'FE':flow(M[op.v],fieldOf(SL[op.s],op.name));break;
        case 'FSTAR':{const v=M[op.v],o=SL[op.s];flow(v,fieldOf(o,'*'));pt.onField(o,(_,f)=>flow(v,f));break;}
        case 'FSLOT':put(fieldOf(SL[op.s],op.name),SL[op.s2]);break;
        case 'FPLAT':put(fieldOf(SL[op.s],op.name),PROTOS[op.path]);break;
        case 'LOAD':load(H,M[op.b],op.name,M[op.t],tags);break;
        case 'STORE':{const s=siteOf(F,op.site,'store');store(H,M[op.b],op.name,op.v>=0?M[op.v]:undefined,s,siteTag(s));break;}
        case 'COPYF':copyFields(H,M[op.src],SL[op.s],op.over.length?new Set(op.over):undefined);break;
        case 'CALL':{const s=siteOf(F,op.site,'call');call(H,s,M[op.c],op.th>=0?M[op.th]:undefined,argsOf(op),M[op.r],{via:'call',method:op.method});break;}
        case 'NEW':{const s=siteOf(F,op.site,'call');construct(H,s,M[op.c],argsOf(op),M[op.r]);break;}
        case 'SCALL':{
          const s=siteOf(F,op.site,'call');const fo=staticObject(op.target);
          if(fo===undefined)call(H,s,M[op.fb],undefined,argsOf(op),M[op.r],{via:'call'});
          else dispatch(H,fo,s,undefined,argsOf(op),M[op.r],{via:'call'});
          break;}
        case 'ENS':flow(M[op.v],fieldOf(nsOf.get(F.file),op.name));break;
        case 'LOADNS':load(H,M[op.b],op.name,fieldOf(nsOf.get(F.file),op.ename),tags);break;
        case 'REEXP':{const ns=nsOf.get(F.file);
          pt.on(M[op.b],o=>{if(objs[o].kind==='platform')return;pt.onField(o,(name,fnode)=>{if(name!=='default'&&name!=='__proto__')flow(fnode,fieldOf(ns,name));});});break;}
        default:throw Error('unknown op '+op.k);
      }
    }
  }

  // --- solve --------------------------------------------------------------------------------
  let steps=0;const stopAt=debug?.maxMs?Date.now()+debug.maxMs:Infinity;
  function drain() {
    for(;;) {
      if(progress&&++steps%1===0)progress({stats,nodes:pt.pts.length,objects:objs.length,memo:memo.size,edges:pt.edgeCount,propagations:pt.propagations,insts:insts.size,clones:clones.size,dirty:dirty.length,tasks:tasks.length,queue:pt.queue.length});
      if(dirty.length)pump(dirty.pop());
      else if(tasks.length){const [ctx,ops]=tasks.pop();run(ctx,ops);}
      else if(pt.queue.length)pt.solve(500);
      else break;
      if(Date.now()>stopAt){stats.stoppedEarly=true;dirty.length=0;tasks.length=0;pt.queue.length=0;break;}
    }
  }
  const all=[...byKey.values()];
  for(const F of all)rec(F);
  for(const F of all)base(F);
  for(const F of all)if(!F.module)summary(F);
  drain();
  // Callables with no concrete instantiation: one with empty inputs.
  const defaults=all.filter(F=>!F.module&&!concreteCount.has(F));
  for(const F of defaults) {
    const owner=F.owner>=0?F.unit.functions[F.owner]:null;
    const envNodes=F.env.map(e=>{const i=F.nOwn+F.env.indexOf(e);return F.open[i]?newNode(0):base(byKey.get(e.key)).map[e.local];});
    const fo=pt.object({kind:'function',F,fn:rec(F),name:F.name??'(anonymous)',owner:owner?rec(owner).id:undefined,origin:'default|'+F.key,envNodes});
    put(pt.field(fo,'__proto__'),PROTOS['Function.prototype']);
    instantiate(fo,{id:'default:'+F.key,uid:siteCount++},hosts[0]);
    stats.defaultInstances++;
  }
  drain();
  for(const F of all){const r=rec(F);r.ret=F.module?base(F).map[F.ret]??newNode(0):summary(F).ret;r.thisNode=F.module?newNode(0):summary(F).map[F.thisL];}
  if(!(recs.every(r=>r.ret>=0)))for(const r of recs)if(!(r.ret>=0))r.ret=newNode(0);

  // A class's instances, for derive.mjs: objects constructed by it or a class extending it.
  const supers=new Map();
  for(const r of recs)if(r.kind==='class')for(const s of r.calls)if(s.text==='super(...)')for(const t of s.targets)(supers.get(r.id)??supers.set(r.id,new Set()).get(r.id)).add(t);
  function isInstance(o,id) {
    let c=objs[o].ctorOf;if(c===undefined)return false;
    const seen=new Set();const stack=[c];
    while(stack.length){const x=stack.pop();if(x===id)return true;if(seen.has(x))continue;seen.add(x);for(const p of supers.get(x)??[])stack.push(p);}
    return false;
  }
  stats.hosts=hosts.length;stats.instances=insts.size;
  return {functions:recs,unmodelled,unresolvedImports,namespaces:nsOf,platformObjects,accessorReads,isInstance,stats};
}
