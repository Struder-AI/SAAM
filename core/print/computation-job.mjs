import {Worker} from 'node:worker_threads';
import {totalmem} from 'node:os';

// Every SAAM worker thread starts here. Its heap ceiling is three quarters of
// the memory this process may use: the OS constraint where one is set, else
// physical memory. Node's default, about a quarter of RAM capped near 4 GiB,
// fails large jobs on machines with room to spare. One job dominates memory while
// it runs; the other quarter is for the OS, the runtime's main thread, Studio's
// browser and the native helper. The ceiling reserves nothing; it is where V8
// gives up, so a job fails with a named error before it pages the machine to a
// standstill. A --max-old-space-size given to the process overrides it.
function heapCeilingMb(){
  const physical=totalmem(),constrained=process.constrainedMemory?.()||0;
  return Math.floor((constrained>0&&constrained<physical?constrained:physical)*3/4/1048576);
}
export function computationWorker(entry,workerData){
  return new Worker(entry,{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:heapCeilingMb()},workerData});
}
// A worker that exhausts its heap reaches the supervisor as
// ERR_WORKER_OUT_OF_MEMORY; say what ran out, on what, and how large the heap was.
export function workerMemoryError(error,subject,{detail='',code='WORKER_MEMORY_EXHAUSTED'}={}){
  if(error?.code!=='ERR_WORKER_OUT_OF_MEMORY')return error;
  return Object.assign(Error(`${subject} ran out of memory${detail}: its ${(heapCeilingMb()/1024).toFixed(1)} GiB heap, sized to this machine, was exhausted. Nothing is simplified automatically; a machine with more RAM can finish it.`),{code,cause:error});
}

// Callers own staging cleanup and publication. Settle after worker termination
// so cancelled preparation cannot write late results or retain native resources.
// Workers that publish ask before-commit; cancellation ends before the ack.
export function runComputationJob(entry,input,{signal,progress,beforeCommit,subject='This computation'}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=computationWorker(entry,input);
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
