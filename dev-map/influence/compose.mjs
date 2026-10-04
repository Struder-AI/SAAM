// Composition for the compositional analysis (plans/dev-maps.md#analysis). Takes the per-file
// summaries from compile.mjs and composes them over the call graph in one points-to solve:
//
// - A callable's closed operations run once (its *base*), shared by every call.
// - Its open operations, the summary proper, are instantiated per call: each call site gets an
//   instance whose parameters, `this`, result and fresh returned objects are its own, so values
//   return only to the call that supplied them. A call made from inside an instance gets its own
//   instance in turn, so the context is the whole call path, not a fixed depth.
// - A call path that reaches a callable already on it (recursion, a strongly connected component
//   of the call graph) reuses that instance: the component's summaries meet in one fixed point.
// - A nested callable's function object is per instance when it captures open variables, and its
//   instances resolve those variables through the instance that created it.
// - Callables never called get one default instance, as the old engine analysed every body once.
//
// Loads, stores, calls, constructors and the platform model follow constraints.mjs; derive.mjs
// reads the result unchanged: one record per callable (inClone false) plus one per instance.

const ELEMENT='[]';
const INSERT=new Set(['push','unshift','splice','set','add','fill']);
const PRIMITIVE_ROOTS=new Set(['Math','Number','isNaN','isFinite','parseInt','parseFloat','String','Boolean','encodeURIComponent','decodeURIComponent']);
const PRIMITIVE_METHODS=new Set(['includes','indexOf','lastIndexOf','findIndex','findLastIndex','startsWith','endsWith','test','has','some','every','join','toString','toFixed','toPrecision','localeCompare','charCodeAt','codePointAt','charAt','isArray','hasOwn','hasOwnProperty','trim','trimStart','trimEnd','toLowerCase','toUpperCase','padStart','padEnd','repeat','replace','replaceAll','stringify','isInteger','isSafeInteger','isFinite','isNaN','now','getTime','valueOf','delete','size','byteLength','readUInt8','readUInt16LE','readUInt32LE','readInt32LE','readFloatLE','readDoubleLE','writeUInt8','writeUInt16LE','writeUInt32LE','writeInt32LE','writeFloatLE','writeDoubleLE','digest','randomUUID','toISOString','normalize','dirname','basename','extname','relative','isAbsolute','existsSync']);

export function compose(pt,units,{platformModules=new Map(),maxDepth=Infinity,maxInstances=Infinity,trace}={}) {
  const functions=[];const unresolvedImports=[];const unresolvedSeen=new Set();
  const platformObjects=new Map(),platformResults=new Map(),constructed=new Map(),memo=new Set();
  const once=key=>memo.has(key)?false:(memo.add(key),true);
  const stats={instances:0,defaultInstances:0,sliceOps:0,folded:0,foldedByCallable:0,depthCapped:0,budgetCapped:0,openOps:0,closedOps:0,maxDepth:0,danglingEnv:0};

  function platform(path,value,known=value!==undefined) {
    let o=platformObjects.get(path);
    if(o===undefined){o=pt.object({kind:'platform',name:path,value,known});platformObjects.set(path,o);}
    return o;
  }
  function platformRoot(name) {
    if(platformModules.has(name))return platform(name,platformModules.get(name));
    if(name in globalThis)return platform(name,globalThis[name]);
    return platform(name);
  }
  const PLATFORM_PROTO=platform('platform.prototype',undefined,false);
  const UNKNOWN=platform('platform.unknown');
  const PROTOS={'Array.prototype':platform('Array.prototype',Array.prototype),'Object.prototype':platform('Object.prototype',Object.prototype),'Function.prototype':platform('Function.prototype',Function.prototype)};
  const isPlatform=o=>pt.objects[o].kind==='platform';
  const isCallable=o=>pt.objects[o].kind==='function';
  function platformChild(o,name) {
    const obj=pt.objects[o];
    if(!obj.known)return UNKNOWN;
    if(name===null||name===ELEMENT)return undefined;
    let v;try{if(obj.value==null||!(name in Object(obj.value)))return undefined;v=obj.value[name];}catch{return UNKNOWN;}
    return platform(obj.name+'.'+name,v,true);
  }

  // --- callables, records, bases --------------------------------------------------------------
  const byKey=new Map();
  for(const u of units.values())for(const F of u.functions){F.unit=u;byKey.set(F.key,F);}
  const nsOf=new Map();
  for(const file of units.keys())nsOf.set(file,pt.object({kind:'object',shape:'module',name:file,owner:null}));
  const parentOf=F=>F.owner>=0?F.unit.functions[F.owner]:null;
  const reps=new Map();
  function rep(F) {
    let r=reps.get(F);if(r)return r;
    const p=parentOf(F);
    r={id:functions.length,name:F.name,kind:F.kind,file:F.file,line:F.line,end:F.end,owner:p?rep(p).id:undefined,key:F.key,
      inClone:false,module:F.module,stores:[],reads:new Set(),calls:[],ret:undefined,thisNode:undefined,F};
    functions.push(r);reps.set(F,r);
    return r;
  }
  const bases=new Map();const tasks=[];
  let nextInstance=0;
  function base(F) {
    let b=bases.get(F);if(b)return b;
    const rec=rep(F);
    b={id:nextInstance++,F,rec,map:new Int32Array(F.n).fill(-1),slots:new Array(F.slots.length),env:null,parent:null,depth:0,base:true};
    bases.set(F,b);
    for(let i=0;i<F.nOwn;i++)if(!F.open[i])b.map[i]=pt.node();
    for(let j=0;j<F.env.length;j++){const i=F.nOwn+j;if(F.open[i])continue;const e=F.env[j];
      b.map[i]=base(byKey.get(e.key)).map[e.local];}
    F.slots.forEach((sp,i)=>{if(!sp.open)b.slots[i]=newObject({...sp,index:i},b);});
    if(!F.open[F.ret])rec.ret=b.map[F.ret];
    tasks.push([b,F.closedOps]);stats.closedOps+=F.closedOps.length;
    return b;
  }
  const fnObjects=[];const heap=new Map();
  function newObject(sp,inst) {
    if(sp.fn!==undefined) {
      const C=inst.F.unit.functions[sp.fn];
      const o=pt.object({kind:'function',fn:rep(C),name:C.name??'(anonymous)',owner:inst.rec.id,F:C,env:inst,inTransfer:!!inst.transfer,merged:undefined});
      pt.add(pt.field(o,'__proto__'),PROTOS['Function.prototype']);
      // Every function object made outside a call context is analysed once, called or not.
      if(!inst.transfer){fnObjects.push(o);merged(o);}
      return o;
    }
    // Heap context: one object per allocation site and the call site that made the instance,
    // so object counts stay bounded by sites however deep the call path.
    const key=inst.F.key+'|'+sp.index+'|'+(inst.siteId??'');
    let o=heap.get(key);if(o!==undefined)return o;
    o=pt.object({kind:'object',shape:sp.shape,name:sp.name,owner:inst.rec.id,file:inst.F.file,line:sp.line});
    if(sp.proto)pt.add(pt.field(o,'__proto__'),PROTOS[sp.proto]);
    heap.set(key,o);
    return o;
  }

  // --- instances ------------------------------------------------------------------------------
  // A function object has one *merged* instance: all its open operations, with the arguments of
  // every call, recording its calls, reads and writes for derive.mjs (the union over contexts).
  // Each call also gets a *transfer* instance running only the return slice, which records
  // nothing and alone supplies the call's result, so results never reach another caller.
  const SINK={push(){},add(){}};
  const instanceByKey=new Map();
  function resolveEnv(env,e) {
    let x=env;for(let k=1;k<e.up&&x;k++)x=x.env;
    if(!x||x.F.key!==e.key||x.map[e.local]<0){stats.danglingEnv++;return pt.node();}
    return x.map[e.local];
  }
  function instantiate(fo,parent,depth,transfer,siteId) {
    const obj=pt.objects[fo];const F=obj.F;
    const b=base(F);
    const rec=transfer?{id:b.rec.id,stores:SINK,reads:SINK,calls:SINK}:b.rec;
    const I={id:nextInstance++,F,rec,fo,env:obj.env,parent,depth,siteId,transfer,map:new Int32Array(F.n),slots:new Array(F.slots.length)};
    for(let i=0;i<F.n;i++) {
      if(!F.open[i])I.map[i]=b.map[i];
      else if(i<F.nOwn)I.map[i]=pt.node();
      else I.map[i]=resolveEnv(obj.env,F.env[i-F.nOwn]);
    }
    F.slots.forEach((sp,i)=>{I.slots[i]=sp.open?newObject({...sp,index:i},I):b.slots[i];});
    I.params=F.params.map(p=>I.map[p]);
    I.rest=F.rest>=0?I.map[F.rest]:undefined;
    I.restObj=F.restSlot>=0?I.slots[F.restSlot]:undefined;
    I.thisNode=I.map[F.thisL];I.ret=I.map[F.ret];
    const ops=transfer?F.sliceOps:F.openOps;
    if(transfer){stats.instances++;stats.sliceOps+=ops.length;if(depth>stats.maxDepth)stats.maxDepth=depth;}
    else{rec.ret=I.ret;rec.thisNode=I.thisNode;stats.defaultInstances++;stats.openOps+=ops.length;}
    tasks.push([I,ops]);
    return I;
  }
  function merged(fo) {
    const obj=pt.objects[fo];
    if(obj.inTransfer)return undefined;
    return obj.merged??=instantiate(fo,null,0,false,'');
  }
  // The transfer instance a call from `caller` at `site` uses for function object fo. The context
  // is the call path through transfer instances; a path reaching fo again (recursion, a strongly
  // connected component) reuses that instance, so the component's summaries meet in one fixed
  // point.
  function transferFor(fo,caller,site) {
    const F=pt.objects[fo].F;
    let sameCallable=0;
    for(let x=caller;x&&x.transfer;x=x.parent) {
      if(x.fo===fo){stats.folded++;return x;}
      if(x.F===F&&++sameCallable>=2){stats.foldedByCallable++;return x;}
    }
    let parent=caller.transfer?caller:null,depth=caller.transfer?caller.depth+1:1,key;
    // Beyond the depth or instance bound, a call shares one instance per function object and
    // site, and so do the calls made from it.
    if(depth>maxDepth){stats.depthCapped++;parent=null;depth=maxDepth;key=`${fo}|${site.id}`;}
    else if(stats.instances>=maxInstances){stats.budgetCapped++;parent=null;depth=maxDepth;key=`${fo}|${site.id}`;}
    else key=`${fo}|${caller.id}|${site.id}`;
    let I=instanceByKey.get(key);
    if(!I){I=instantiate(fo,parent,depth,true,site.id);instanceByKey.set(key,I);}
    return I;
  }
  // The instances a call binds: the transfer instance first (it gives the result), then the
  // merged one, which sees every call's arguments.
  function targetsOf(fo,caller,site){const T=transferFor(fo,caller,site);const M=merged(fo);return M&&M!==T?[T,M]:[T];}

  // --- constraint semantics (as constraints.mjs) ----------------------------------------------
  function loadFrom(o,name,target,reader) {
    if(!once(`l${o}|${name}|${target}`))return;
    if(isPlatform(o)){const c=platformChild(o,name);if(c!==undefined)pt.add(target,c);return;}
    if(name===null) {
      pt.onField(o,(f,fnode)=>{if(f==='__proto__')return;pt.edge(fnode,target);reader?.reads.add(fnode);});
    } else {
      const fnode=pt.field(o,name);pt.edge(fnode,target);reader?.reads.add(fnode);
      if(name!=='__proto__')pt.on(pt.field(o,'__proto__'),p=>loadFrom(p,name,target,reader));
    }
  }
  function load(b,name,target,reader){pt.on(b,o=>loadFrom(o,name,target,reader));}
  function store(b,name,value,I,site) {
    I.rec.stores.push({base:b,name,site});
    if(value===undefined)return;
    pt.on(b,o=>{
      if(!once(`s${o}|${name}|${value}`))return;
      if(isPlatform(o)){pt.on(value,v=>{if(isCallable(v))invokedByPlatform(v,I,site);});return;}
      if(name===null) {
        pt.field(o,'*');
        pt.onField(o,(f,fnode)=>{if(f!=='__proto__')pt.edge(value,fnode);});
      } else pt.edge(value,pt.field(o,name));
    });
  }
  function copyFields(src,dst,overridden) {
    pt.on(src,o=>{if(isPlatform(o))return;pt.onField(o,(name,fnode)=>{if(name!=='__proto__'&&!overridden?.has(name))pt.edge(fnode,pt.field(dst,name));});});
  }
  function invokedByPlatform(fobj,I,site,feed) {
    if(!once(`p${fobj}|${site.uid}`))return;
    const Cs=targetsOf(fobj,I,site);
    site.platformCallbacks.push(Cs[0].rec.id);
    for(const C of Cs) {
      for(const p of C.params){pt.add(p,UNKNOWN);if(feed!==undefined)pt.edge(feed,p);}
      if(C.rest!==undefined)pt.add(C.rest,UNKNOWN);
      if(!C.F.arrow)pt.add(C.thisNode,UNKNOWN);
    }
    if(feed!==undefined)pt.edge(Cs[0].ret,feed);
  }
  function loadElements(n,target,reader){pt.on(n,o=>{if(!isPlatform(o))loadFrom(o,ELEMENT,target,reader);});}
  function platformCall(site,I,thisNode,args,result,method,callee) {
    if(!once(`pc${site.uid}`))return;
    site.platform=true;site.receiver=thisNode;
    const reader=I.rec;
    const root=callee===undefined?'':pt.objects[callee].name.split('.')[0];
    const primitive=PRIMITIVE_ROOTS.has(root)||PRIMITIVE_METHODS.has(method)||root==='JSON'&&method==='stringify';
    let elements;
    if(primitive)elements=pt.node();
    else {
      const prKey=site.id+'|'+(I.siteId??'');let pr=platformResults.get(prKey);
      if(pr===undefined){pr=pt.object({kind:'value',name:'platform result',owner:I.rec.id,site:site.id});platformResults.set(prKey,pr);}
      pt.add(result,pr);pt.add(pt.field(pr,'__proto__'),PLATFORM_PROTO);
      elements=pt.field(pr,ELEMENT);
      if(thisNode!==undefined){loadElements(thisNode,elements,reader);loadElements(thisNode,result,reader);}
    }
    for(const a of args) {
      if(!primitive)loadElements(a,elements,reader);
      pt.on(a,o=>{if(isCallable(o))invokedByPlatform(o,I,site,elements);});
      if(thisNode!==undefined&&INSERT.has(method)){store(thisNode,ELEMENT,a,I,site);site.inserts=true;}
    }
    if(method==='assign'&&args.length>1)for(const s of args.slice(1))pt.on(args[0],t=>{if(!isPlatform(t))copyFields(s,t);});
  }
  function bindArguments(C,args) {
    const at=args.spreadAt??-1;
    args.forEach((a,i)=>{
      if(at>=0&&i>=at){for(let j=i;j<C.params.length;j++)pt.edge(a,C.params[j]);}
      else if(i<C.params.length)pt.edge(a,C.params[i]);
      if(i>=C.params.length||at>=0&&i>=at)if(C.rest!==undefined)pt.edge(a,pt.field(C.restObj,ELEMENT));
    });
  }
  function dispatch(o,site,I,thisNode,args,result,method) {
    const obj=pt.objects[o];
    if(obj.kind==='function') {
      if(!once(`d${o}|${site.uid}`))return;
      const Cs=targetsOf(o,I,site);
      site.targets.push(Cs[0].rec.id);
      for(const C of Cs){bindArguments(C,args);if(thisNode!==undefined&&!C.F.arrow)pt.edge(thisNode,C.thisNode);}
      pt.edge(Cs[0].ret,result);
    } else if(obj.kind==='resolver') {
      if(args[0]!==undefined)pt.edge(args[0],pt.field(obj.target,ELEMENT));
    } else if(obj.kind==='platform'||obj.kind==='value') {
      if(['call','apply'].includes(method)&&thisNode!==undefined) {
        pt.on(thisNode,fo=>{if(!isCallable(fo))return;
          if(!once(`ca${fo}|${site.uid}`))return;
          const Cs=targetsOf(fo,I,site);site.targets.push(Cs[0].rec.id);
          let t;if(method==='apply'&&args[1]!==undefined){t=pt.node();load(args[1],ELEMENT,t,I.rec);}
          for(const C of Cs) {
            if(!C.F.arrow&&args[0]!==undefined)pt.edge(args[0],C.thisNode);
            if(method==='call')bindArguments(C,args.slice(1));
            else if(t!==undefined)for(const p of C.params)pt.edge(t,p);
          }
          pt.edge(Cs[0].ret,result);});
        return;
      }
      if(method==='bind'&&thisNode!==undefined){pt.edge(thisNode,result);return;}
      platformCall(site,I,thisNode,args,result,method,o);
    }
  }
  function construct(site,I,callee,args,result) {
    pt.on(callee,o=>{
      const obj=pt.objects[o];
      const key=site.id+'|'+(I.siteId??'')+'|'+o;
      let inst=constructed.get(key);
      if(inst===undefined){inst=pt.object({kind:isPlatform(o)?'value':'object',name:'new '+obj.name,owner:I.rec.id,site:site.id});constructed.set(key,inst);}
      pt.add(result,inst);
      if(obj.kind==='function') {
        pt.edge(pt.field(o,'prototype'),pt.field(inst,'__proto__'));
        if(once(`n${o}|${site.uid}`)){const Cs=targetsOf(o,I,site);site.targets.push(Cs[0].rec.id);
          for(const C of Cs){bindArguments(C,args);pt.add(C.thisNode,inst);}pt.edge(Cs[0].ret,result);}
      } else if(isPlatform(o)) {
        const proto=obj.known&&obj.value?.prototype?platform(obj.name+'.prototype',obj.value.prototype):PLATFORM_PROTO;
        pt.add(pt.field(inst,'__proto__'),proto);
        if(obj.name==='Promise') {
          const resolver=pt.object({kind:'resolver',target:inst,name:'resolve'});
          for(const a of args)pt.on(a,fo=>{if(!isCallable(fo))return;
            if(!once(`pr${fo}|${site.uid}`))return;const Cs=targetsOf(fo,I,site);site.targets.push(Cs[0].rec.id);for(const C of Cs)for(const p of C.params)pt.add(p,resolver);});
        } else platformCall(site,I,undefined,args,result,'new',o);
      }
    });
  }

  // Direct call targets: a module-level function, possibly re-exported.
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
    const M=F.unit.functions[0];
    const slot=F.unit.iface.fnSlot[key];if(slot===undefined)return undefined;
    return base(M).slots[slot];
  }

  let siteCount=0;
  const newSite=(I,spec)=>({id:spec.id,uid:siteCount++,fn:I.rec.id,line:spec.line,text:spec.text,targets:[],platformCallbacks:[],platform:false,resultUsed:spec.resultUsed});
  function run(I,ops) {
    const M=I.map,SL=I.slots,R=I.rec,F=I.F;
    const args=op=>{const a=op.args.map(x=>M[x]);if(op.spreadAt>=0)a.spreadAt=op.spreadAt;return a;};
    for(const op of ops) {
      switch(op.k) {
        case 'E':pt.edge(M[op.a],M[op.b]);break;
        case 'PLAT':pt.add(M[op.n],op.how==='unknown'?UNKNOWN:platformRoot(op.name));break;
        case 'NS':{
          let o;
          if(op.file&&nsOf.has(op.file))o=nsOf.get(op.file);
          else if(op.file===null)o=platformModules.has(op.spec)?platform(op.spec,platformModules.get(op.spec)):platform(op.spec);
          else{const k=F.file+'|'+op.spec+'|'+op.line;if(!unresolvedSeen.has(k)){unresolvedSeen.add(k);unresolvedImports.push({file:F.file,spec:op.spec,line:op.line});}o=platform('unresolved:'+op.spec);}
          pt.add(M[op.n],o);break;}
        case 'ALLOC':pt.add(M[op.n],SL[op.s]);break;
        case 'SELF':pt.add(M[op.n],I.fo);break;
        case 'FE':pt.edge(M[op.v],pt.field(SL[op.s],op.name));break;
        case 'FSTAR':{const v=M[op.v],o=SL[op.s];pt.edge(v,pt.field(o,'*'));pt.onField(o,(_,f)=>pt.edge(v,f));break;}
        case 'FSLOT':pt.add(pt.field(SL[op.s],op.name),SL[op.s2]);break;
        case 'FPLAT':pt.add(pt.field(SL[op.s],op.name),PROTOS[op.path]);break;
        case 'LOAD':load(M[op.b],op.name,M[op.t],R);break;
        case 'STORE':store(M[op.b],op.name,op.v>=0?M[op.v]:undefined,I,newSite(I,op.site));break;
        case 'COPYF':copyFields(M[op.src],SL[op.s],op.over.length?new Set(op.over):undefined);break;
        case 'CALL':{const site=newSite(I,op.site);R.calls.push(site);const a=args(op);const th=op.th>=0?M[op.th]:undefined;const r=M[op.r];const method=op.method;
          pt.on(M[op.c],o=>dispatch(o,site,I,th,a,r,method));break;}
        case 'NEW':{const site=newSite(I,op.site);R.calls.push(site);site.construct=true;construct(site,I,M[op.c],args(op),M[op.r]);break;}
        case 'SCALL':{
          const site=newSite(I,op.site);R.calls.push(site);
          const fo=staticObject(op.target);const a=args(op);const r=M[op.r];
          if(fo===undefined){pt.on(M[op.fb],o=>dispatch(o,site,I,undefined,a,r,undefined));break;}
          const Cs=targetsOf(fo,I,site);
          site.targets.push(Cs[0].rec.id);for(const C of Cs)bindArguments(C,a);pt.edge(Cs[0].ret,r);
          break;}
        case 'ENS':pt.edge(M[op.v],pt.field(nsOf.get(F.file),op.name));break;
        case 'LOADNS':load(M[op.b],op.name,pt.field(nsOf.get(F.file),op.ename),R);break;
        case 'REEXP':{const ns=nsOf.get(F.file);
          pt.on(M[op.b],o=>{if(isPlatform(o))return;pt.onField(o,(name,fnode)=>{if(name!=='default'&&name!=='__proto__')pt.edge(fnode,pt.field(ns,name));});});break;}
        default:throw Error('unknown op '+op.k);
      }
    }
  }

  // Solve: run pending summaries and propagate until nothing changes.
  for(const u of units.values())base(u.functions[0]);
  while(tasks.length||pt.queue.length) {
    if(tasks.length){const [I,ops]=tasks.pop();run(I,ops);if(trace&&trace())return {pt,functions,stats,stopped:true};}
    else{pt.solve(trace?2000:Infinity);if(trace&&trace())return {pt,functions,stats,stopped:true};}
  }
  for(const r of functions){if(r.ret===undefined)r.ret=pt.node();if(r.thisNode===undefined)r.thisNode=pt.node();}
  return {functions,unmodelled:[],unresolvedImports,namespaces:nsOf,platformObjects,stats};
}
