import {Worker} from 'node:worker_threads';

// Callers own staging cleanup and publication. Settle after worker termination
// so cancelled preparation cannot write late results or retain native resources.
// Workers that publish ask before-commit; cancellation ends before the ack.
export function runComputationJob(entry,input,{signal,progress,beforeCommit}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(entry,{execArgv:[],workerData:input});
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
    worker.on('error',error=>{void finish(error);});
    worker.on('exit',code=>{if(!state.settled)void finish(Error(`Computation worker exited without a result (${code}).`));});
    if(signal?.aborted)abort();
  });
}
