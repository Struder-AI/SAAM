import {randomUUID} from 'node:crypto';

// Runtime owns these lifetimes. Operation owners still settle their numerical
// workers/resources and choose their own result; observations cannot choose it.
export function createOwnedJobs(){
  const active=new Map(),pending=new Set(),observerFindings=new Map();
  let closing;
  const read=job=>{
    const {controller,cancellation,projection,event,settled,...record}=job;
    return {...record,cancellable:!settled&&job.status!=='committing'&&!controller.signal.aborted,
      elapsedMs:Date.now()-job.startedAt,estimatedRemainingMs:null};
  };
  function auxiliary(job,step,error){
    const detail={jobId:job.jobId,bundleId:job.bundleId,step,message:String(error?.message??error)};
    const before=observerFindings.get(job.ownerId);
    observerFindings.set(job.ownerId,{count:(before?.count??0)+1,first:before?.first??detail,last:detail});
  }
  function observe(job,step,action){
    try{Promise.resolve(action()).catch(error=>auxiliary(job,step,error));}
    catch(error){auxiliary(job,step,error);}
  }
  function cancelJob(job,quitting=false){
    const kind=job.kind??'import';
    if(job.settled)return {cancelled:false,committing:false,kind,jobId:job.jobId};
    if(job.status==='committing')return {cancelled:false,committing:true,kind,jobId:job.jobId};
    job.controller.abort(Object.assign(Error(quitting?'SAAM is quitting.':job.cancellation.message),
      {name:'AbortError',code:job.cancellation.code}));
    return {cancelled:true,committing:false,kind,jobId:job.jobId};
  }
  function run({ownerId,bundleId,studioInstanceId=null,kind,status,progress,cancellation,commitStage,project,event},action){
    if(closing)return Promise.reject(Error('The SAAM application is quitting.'));
    const job={ownerId,jobId:randomUUID(),bundleId,studioInstanceId,...(kind?{kind}:{}),status,
      startedAt:Date.now(),progress,controller:new AbortController(),cancellation,event,settled:false};
    // Projection admission checks the captured Studio target and exclusivity.
    // Its refusal is an admission failure, unlike later display notifications.
    try{
      job.projection=project?.({read:()=>read(job),cancel:()=>cancelJob(job)});
      if(job.projection?.selectionVersion)job.selectionVersion=job.projection.selectionVersion;
    }catch(error){return Promise.reject(error);}
    active.set(job.jobId,job);
    const publish=()=>observe(job,'progress',()=>job.projection?.publish());
    const scope=Object.freeze({id:job.jobId,signal:job.controller.signal,elapsedMs:()=>Date.now()-job.startedAt,
      progress(value){job.progress=value;publish();},
      beforeCommit(stage=commitStage){
        job.controller.signal.throwIfAborted();job.status='committing';job.progress={stage};publish();
      },
      event(name,detail){observe(job,'event',()=>event?.(name,{...detail,jobId:job.jobId,printId:bundleId}));}
    });
    // Admission precedes the first action; register its lifetime before allowing
    // asynchronous work so shutdown also drains jobs without an active call.
    const task=Promise.resolve().then(()=>{publish();scope.signal.throwIfAborted();return action(scope);}).finally(async()=>{
      job.settled=true;active.delete(job.jobId);
      try{await job.projection?.finish();}catch(error){auxiliary(job,'projection-cleanup',error);}
    });
    pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));
    return task;
  }
  return Object.freeze({run,
    list({ownerId}={}){return [...active.values()].filter(job=>ownerId===undefined||job.ownerId===ownerId).map(read);},
    cancel(jobId,{ownerId}={}){
      const job=active.get(jobId);
      if(!job||job.ownerId!==ownerId)throw Error('Read an active jobId owned by this chat before cancelling.');
      return cancelJob(job);
    },
    findings(ownerId){const value=observerFindings.get(ownerId);return value?structuredClone(value):null;},
    close(){
      if(!closing){
        // Close admission before aborting: abort listeners may attempt new work.
        let finish;closing=new Promise(resolve=>{finish=resolve;});
        for(const job of active.values())cancelJob(job,true);
        void Promise.allSettled([...pending]).then(()=>{observerFindings.clear();finish();});
      }
      return closing;
    }
  });
}
