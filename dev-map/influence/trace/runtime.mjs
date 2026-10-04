// Trace runtime: the global __T that instrumented SAAM code (instrument.mjs) reports to, one per
// thread. It keeps the current callable, records each entry as an influence edge from the
// callable that was current (the caller, or the callable that registered an asynchronous
// callback), and writes the thread's trace to $SAAM_TRACE_DIR/trace-PID-THREAD.json.
import {createHook,executionAsyncResource} from 'node:async_hooks';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {threadId,isMainThread,parentPort} from 'node:worker_threads';

const EMPTY=Object.freeze([]);
const SPAN=2**20;// callable ids stay below this

export function createRuntime(dir) {
  const functions=[null],sites=[null];
  const edges=new Map();// caller*SPAN+callee -> {n, sites:Map(site -> count), platform:count}
  const instrumentation={modules:0,failed:[],counts:{}};
  const T={
    cur:0,pend:0,at:'',
    fn(record){functions.push(record);return functions.length-1;},
    site(record){sites.push(record);return sites.length-1;},
    // Entry into callable id: the edge from the current callable, with the pending call site
    // when that site belongs to the current callable (otherwise the platform invoked it).
    e(id) {
      const from=T.cur,p=T.pend;T.pend=0;
      const site=p&&sites[p].fn===from?p:0;
      const k=from*SPAN+id;
      let r=edges.get(k);if(r===undefined){r={n:0,sites:new Map(),platform:0,async:new Map()};edges.set(k,r);}
      r.n++;
      if(site)r.sites.set(site,(r.sites.get(site)??0)+1);
      else {r.platform++;if(p===0)r.async.set(T.at,(r.async.get(T.at)??0)+1);}
      T.cur=id;return from;
    },
    st(site,v){T.pend=site;return v;},
    z(site){T.pend=site;return EMPTY;},
    cl(v){T.pend=0;return v;},
    sp(saved,v){T.cur=saved;return v;},
    // Class field initialisers run as part of the class callable.
    fi(id,init) {
      const saved=T.cur;
      if(saved!==id)T.e(id);
      try{return init();}finally{T.cur=saved;}
    },
    instrumentation
  };

  // Asynchronous callbacks run as the callable current when their resource was created.
  // T.at names the kind of asynchronous resource running (PROMISE, Timeout, FSREQCALLBACK, ...).
  const ctx=new WeakMap(),stack=[];
  createHook({
    init(asyncId,type,trigger,resource){if(resource&&(typeof resource==='object'||typeof resource==='function'))ctx.set(resource,[T.cur,type]);},
    before(){stack.push(T.cur,T.at);const r=executionAsyncResource();const c=r&&ctx.get(r);T.cur=c?c[0]:0;T.at=c?c[1]:'unknown';},
    after(){if(stack.length){T.at=stack.pop();T.cur=stack.pop();}else{T.cur=0;T.at='';}}
  }).enable();

  let flushes=0;
  const dump=()=>({pid:process.pid,threadId,main:isMainThread,argv:process.argv.slice(1),instrumentation,
    functions:functions.slice(1).map((f,i)=>({id:i+1,...f})),
    sites:sites.slice(1).map((s,i)=>({id:i+1,...s})),
    edges:[...edges].map(([k,r])=>({from:Math.floor(k/SPAN),to:k%SPAN,n:r.n,platform:r.platform,sites:[...r.sites],async:Object.fromEntries(r.async)}))});
  T.dump=dump;
  function flush() {
    if(!dir)return;
    flushes++;
    const out=dump();
    try{mkdirSync(dir,{recursive:true});writeFileSync(join(dir,`trace-${process.pid}-${threadId}.json`),JSON.stringify(out));}catch{}
  }
  T.flush=flush;
  process.on('exit',flush);
  setInterval(flush,2000).unref();
  // A worker is often terminated right after it reports; flush before each report.
  if(!isMainThread&&parentPort) {
    const post=parentPort.postMessage.bind(parentPort);
    parentPort.postMessage=(...args)=>{flush();return post(...args);};
  }
  return T;
}
