import {Worker} from 'node:worker_threads';
import {totalmem} from 'node:os';

// Heap ceiling for every SAAM worker thread: three quarters of the memory this
// process may use (the OS constraint where one is set, else physical memory).
// Without it Node gives a worker V8's default, about a quarter of RAM capped near
// 4 GiB, which fails large jobs on machines with room to spare. One job dominates
// memory while it runs; the other quarter is for the OS, the runtime's main thread,
// Studio's browser and the native helper. The ceiling is not reserved, only where
// V8 gives up: past physical memory a job would page the machine to a standstill
// instead of failing with a named error. A --max-old-space-size flag given to the
// process overrides it (V8 flags are process-wide).
export function workerResourceLimits(){
  const physical=totalmem(),constrained=process.constrainedMemory?.()||0;
  const usable=constrained>0&&constrained<physical?constrained:physical;
  return {maxOldGenerationSizeMb:Math.floor(usable*3/4/1048576)};
}
// A worker that exhausts this heap reaches the supervisor as
// ERR_WORKER_OUT_OF_MEMORY; say what ran out, on what, and how large the heap was.
export function workerMemoryError(error,subject,{detail='',code='WORKER_MEMORY_EXHAUSTED'}={}){
  if(error?.code!=='ERR_WORKER_OUT_OF_MEMORY')return error;
  const gib=(workerResourceLimits().maxOldGenerationSizeMb/1024).toFixed(1);
  return Object.assign(Error(`${subject} ran out of memory${detail}: its ${gib} GiB heap (three quarters of this machine's memory) was exhausted. Nothing is simplified automatically; a machine with more RAM can finish it.`),{code,cause:error});
}

// Callers own staging cleanup and publication. Settle after worker termination
// so cancelled preparation cannot write late results or retain native resources.
// Workers that publish ask before-commit; cancellation ends before the ack.
export function runComputationJob(entry,input,{signal,progress,beforeCommit,subject='This computation'}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(entry,{execArgv:[],resourceLimits:workerResourceLimits(),workerData:input});
    const state={settled:false,committing:false};
    const finish=async(error,value)=>{
      if(state.settled)return;
      state.settled=true;signal?.removeEventListener('abort',abort);
      try{await worker.terminate();}catch(stopped){error??=stopped;}
      const failure=!state.committing&&signal?.aborted?signal.reason:error;
      if(failure)reject(failure);else resolve(value);
    };
    const abort=()=>{if(!state.committing)void finish(signal.reason);};
    signal?.addEventListener('abort',abort,{once:true});
    worker.on('message',message=>{
      if(message.type==='result')void finish(null,message.value);
      else if(message.type==='error')void finish(Object.assign(Error(message.error.message),message.error));
      else if(message.type==='progress'){
        try{progress?.(message.value);}catch(error){void finish(error);}
      }else if(message.type==='before-commit'){
        void (async()=>{
          if(state.settled||state.committing)return;
          if(!beforeCommit)throw Error('This computation has no publication owner.');
          signal?.throwIfAborted();await beforeCommit();signal?.throwIfAborted();
          if(state.settled)return;
          state.committing=true;signal?.removeEventListener('abort',abort);
          worker.postMessage({type:'commit'});
        })().catch(error=>{void finish(error);});
      }
    });
    worker.on('error',error=>{void finish(workerMemoryError(error,subject));});
    worker.on('exit',code=>{if(!state.settled)void finish(Error(`Computation worker exited without a result (${code}).`));});
    if(signal?.aborted)abort();
  });
}
