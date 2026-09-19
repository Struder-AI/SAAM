import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';

// Substitute only the expensive job implementations, retaining the actual worker
// entry point, worker_threads transport, acknowledgements and lifetime.
const jobs=`
async function run(mode,directory,source,options){
  options.progress({stage:'start',mode,directory,source,setting:options.setting,geometry:!!options.onGeometry});
  if(options.fail)throw Object.assign(new TypeError('repair failed'),{code:'TEST_REPAIR',changes:{faces:2},meshDiagnostic:{closed:false}});
  if(options.onGeometry){
    await options.onGeometry({stage:'geometry',completed:1});
    options.progress({stage:'acknowledged',completed:1});
    await options.onGeometry({stage:'geometry',completed:2});
  }
  if(options.noBytes)return {report:{mode}};
  const storage=new Uint8Array([99,10,20,30,88]),bytes=storage.subarray(1,4),result={repairedBytes:bytes,report:{mode}};
  setImmediate(()=>{if(storage.byteLength!==5||bytes.byteLength!==3)process.exitCode=42;});
  return options.freeze?Object.freeze(result):result;
}
export const repairSTL=(source,options)=>run('bytes',undefined,source,options);
export const repairSTLFiles=(directory,source,options)=>run('files',directory,source,options);
export const importOrRepairSTLBundle=(directory,source,options)=>run('import',directory,source,options);
`;

async function runWorker(t,job,onMessage=()=>{}){
  const directory=await mkdtemp(join(tmpdir(),'saam-worker-stages-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const source=await readFile(process.env.SAAM_WORKER_BASELINE??new URL('../print/mesh-repair-worker.mjs',import.meta.url),'utf8');
  await writeFile(join(directory,'worker.mjs'),source);
  await writeFile(join(directory,'repair-stl.mjs'),jobs);
  await writeFile(join(directory,'import-stl.mjs'),jobs);
  const worker=new Worker(join(directory,'worker.mjs'),{execArgv:[],workerData:job});
  t.after(()=>worker.terminate());
  const messages=[];
  await new Promise((resolve,reject)=>{
    worker.on('message',message=>{messages.push(message);try{onMessage(message,worker,messages);}catch(error){reject(error);}});
    worker.on('error',reject);
    worker.on('exit',code=>{try{assert.equal(code,0);resolve();}catch(error){reject(error);}});
  });
  return messages;
}

test('worker dispatch preserves import/files/fallback and copies exact transfer bytes without detaching job storage',{timeout:10000},async t=>{
  for(const mode of ['import','files','bytes','unrecognized']){
    const messages=await runWorker(t,{mode,directory:'/bundle',source:'source.stl',options:{setting:7}});
    const expected=mode==='import'||mode==='files'?mode:'bytes';
    assert.deepEqual(messages[0],{type:'progress',event:{stage:'start',mode:expected,directory:expected==='bytes'?undefined:'/bundle',source:'source.stl',setting:7,geometry:false}});
    assert.equal(messages.length,2);assert.equal(messages[1].type,'result');
    assert.deepEqual(messages[1].result.report,{mode:expected});
    assert.deepEqual([...messages[1].result.repairedBytes],[10,20,30]);
    assert.equal(messages[1].result.repairedBytes.buffer.byteLength,3);
  }
});

test('geometry chunks wait for matching acknowledgement; unknown IDs do not release the pending chunk',{timeout:10000},async t=>{
  const messages=await runWorker(t,{mode:'bytes',source:'mesh',geometry:true,options:{noBytes:true}},(message,worker,seen)=>{
    if(message.type!=='geometry')return;
    assert.equal(message.id,message.event.completed-1);
    if(message.id===0){
      worker.postMessage({type:'geometry-ack',id:999});
      const length=seen.length;
      setTimeout(()=>{assert.equal(seen.length,length);worker.postMessage({type:'geometry-ack',id:0});},20);
    }else worker.postMessage({type:'geometry-ack',id:message.id});
  });
  assert.deepEqual(messages.map(m=>m.type==='progress'?m.event.stage:m.type),['start','geometry','acknowledged','geometry','result']);
  assert.deepEqual(messages.at(-1).result,{report:{mode:'bytes'}});
});

test('abort and geometry rejection settle the job as errors and close the worker',{timeout:10000},async t=>{
  for(const abort of [true,false]){
    const messages=await runWorker(t,{mode:'bytes',source:'mesh',geometry:true,options:{}},(message,worker)=>{
      if(message.type==='geometry')worker.postMessage(abort?{type:'abort'}:{type:'geometry-ack',id:message.id,error:'geometry rejected'});
    });
    assert.equal(messages.length,3);const error=messages.at(-1);
    assert.equal(error.type,'error');assert.equal(error.error.name,abort?'AbortError':'Error');
    if(!abort)assert.equal(error.error.message,'geometry rejected');
    assert.deepEqual(Object.keys(error.error),['message','name','code','changes','meshDiagnostic']);
  }
});

test('worker preserves structured failure fields and closes without a result',{timeout:10000},async t=>{
  const messages=await runWorker(t,{mode:'files',source:'mesh',options:{fail:true}});
  assert.deepEqual(messages.at(-1),{type:'error',error:{message:'repair failed',name:'TypeError',code:'TEST_REPAIR',changes:{faces:2},meshDiagnostic:{closed:false}}});
  assert.equal(messages.length,2);
});

test('response preparation accepts frozen job results without mutating or transferring their storage',{timeout:10000,skip:!!process.env.SAAM_WORKER_BASELINE},async t=>{
  const messages=await runWorker(t,{mode:'bytes',source:'mesh',options:{freeze:true}});
  assert.equal(messages.at(-1).type,'result');
  assert.deepEqual([...messages.at(-1).result.repairedBytes],[10,20,30]);
});
