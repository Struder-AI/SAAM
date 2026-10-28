import {Worker} from 'node:worker_threads';
import {heapCeilingMb} from '../memory.mjs';
import {retainObservation,observationSession} from '../contracts/observations.mjs';

// Worker heaps use the shared available-memory policy; explicit process
// --max-old-space-size flags retain Node's own override semantics.
export function computationWorker(entry,workerData){
  return new Worker(entry,{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:heapCeilingMb()},workerData});
}
// A worker that exhausts its heap reaches the supervisor as
// ERR_WORKER_OUT_OF_MEMORY; say what ran out, on what, and how large the heap was.
export function workerMemoryError(error,subject,{detail='',code='WORKER_MEMORY_EXHAUSTED',heapMb}={}){
  if(error?.code!=='ERR_WORKER_OUT_OF_MEMORY')return error;
  return Object.assign(Error(`${subject} exhausted its ${heapMb?`${(heapMb/1024).toFixed(1)} GiB `:''}worker heap${detail}. Its ceiling uses free memory when the job starts; it is not total installed RAM. Close competing work and retry. The input is unchanged.`),{code,cause:error});
}

// Callers own staging cleanup and publication. Settle after worker termination
// so cancelled preparation cannot write late results or retain native resources.
// Workers that publish ask before-commit; cancellation ends before the ack.
export function runComputationJob(entry,input,{signal,progress,beforeCommit,onAuxiliaryFinding,subject='This computation'}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const observations=input.observationFlow?observationSession(input.observationFlow.directory,{ownerId:input.observationFlow.retentionOwner}):null;
    const workerInput=input.observationFlow?{...input,observationFlow:{...input.observationFlow,directory:observations?input.observationFlow.directory:null,capture:observations?.producer}}:input;
    let worker;
    try{worker=computationWorker(entry,workerInput);}catch(error){void observations?.seal();reject(error);return;}
    const heapMb=worker.resourceLimits.maxOldGenerationSizeMb;
    const state={settled:false,committing:false},progressFinding={kind:'progress-notification',count:0,firstError:null,lastError:null};
    function progressFailed(error){
      let detail;
      try{detail={name:String(error?.name??'Error'),message:String(error?.message??error),...(error?.code?{code:String(error.code)}:{})};}
      catch{detail={name:'Error',message:'Progress notification failed; error detail unavailable'};}
      progressFinding.count++;progressFinding.firstError??=detail;progressFinding.lastError=detail;
      // This optional diagnostic sink cannot become another work dependency.
      try{Promise.resolve(onAuxiliaryFinding?.({...progressFinding})).catch(()=>{});}catch{}
    }
    function publishProgress(value){
      try{Promise.resolve(progress?.(value)).catch(progressFailed);}catch(error){progressFailed(error);}
    }
    const finish=async(error,value)=>{
      if(state.settled)return;
      state.settled=true;signal?.removeEventListener('abort',abort);
      // The first terminal event chooses the outcome. A later abort while the
      // already-finished worker is being released cannot rewrite that fact.
      let failure=!state.committing&&signal?.aborted?signal.reason:error;
      try{await worker.terminate();}catch(stopped){error??=stopped;}
      // Sealed captures belong to the receiver, including on cancellation. Their
      // scanner is an observation resource; it cannot rewrite this job outcome.
      void observations?.seal();
      failure??=error;
      if(failure)reject(failure);else resolve(value);
    };
    const abort=()=>{if(!state.committing){if(observations)Atomics.store(observations.producer.control,1,1);void finish(signal.reason);}};
    signal?.addEventListener('abort',abort,{once:true});
    worker.on('message',message=>{
      if(state.settled)return;
      if(message.type==='result')void finish(null,message.value);
      else if(message.type==='error')void finish(Object.assign(Error(message.error.message),message.error));
      else if(message.type==='contract-observation')void retainObservation(input.observationFlow?.directory,message.record);
      else if(message.type==='contract-observation-ready'&&message.sessionId===observations?.producer.id)observations.kick();
      else if(message.type==='progress'){
        publishProgress(message.value);
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
    worker.on('error',error=>{void finish(workerMemoryError(error,subject,{heapMb}));});
    worker.on('exit',code=>{if(!state.settled)void finish(Error(`Computation worker exited without a result (${code}).`));});
    if(signal?.aborted)abort();
  });
}
