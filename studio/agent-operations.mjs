import {tourStatus} from './tour.mjs';
import {requestPrintId} from '../core/application/chat-requests.mjs';
import {checkedPhaseColours} from '../core/print/phase-colours.mjs';

function agentTour(status){
  if(!status.editLesson)return status;
  const {printId,...lesson}=status.editLesson;
  return {...status,editLesson:{bundleId:printId,...lesson}};
}

// Runtime admits identities and retains server lifetime; this controller owns
// review selection and tour decisions. CLI supplies existing Bundle value queries.
export function createStudioAgentOperations({libraryRoot,binding,ownerId,lifecycle,values,commands={}}){
  const preferredByPrint=new Map();
  const status=()=>tourStatus(libraryRoot,binding,values.readSnapshot);
  async function requireTourOwner(){
    const guide=await status(),instanceId=guide.studioOwner?.instanceId;
    if(guide.active&&instanceId&&!lifecycle.owned.has(instanceId))throw Error('The active tour is attached to another chat. Explicitly capture its bundle first.');
    if(instanceId&&lifecycle.transferring.has(instanceId))throw Error('The tour Studio is transferring to another chat.');
    return guide;
  }
  return {
    async setPhaseColours(input){
      return commands.setPhaseColours({...input,phaseColours:checkedPhaseColours(input.phaseColours)});
    },
    async startTour({startAtLayer}){
      await requireTourOwner();
      const studio=await lifecycle.acquire(null);
      await studio.server.startTour();
      const bundleId=requestPrintId(libraryRoot,studio.server.currentPrint());
      if(startAtLayer)await studio.server.setStartAt({layer:startAtLayer});
      const browserOpenRequested=await lifecycle.show(studio);
      return {bundleId,studioInstanceId:studio.server.agentSession().instanceId,url:studio.url,browserOpenRequested,tour:agentTour(await status())};
    },
    async getTour({after,waitMs=0}){
      const deadline=Date.now()+waitMs;
      for(;;){
        const snapshot=await status(),cursor=JSON.stringify([snapshot.active,snapshot.completed,snapshot.step,snapshot.canNext,snapshot.selected]);
        if(cursor!==after||Date.now()>=deadline)return {...agentTour(snapshot),cursor};
        await new Promise(resolve=>setTimeout(resolve,Math.min(500,Math.max(0,deadline-Date.now()))));
      }
    },
    async setTourStartAt({startAt,...scope}){
      const studio=lifecycle.owned.get((await requireTourOwner()).studioOwner?.instanceId);
      if(!studio)throw Error('Open the tour in Studio before choosing its start layer.');
      return agentTour(await studio.server.setStartAt(startAt,scope));
    },
    async requestReview({bundleId,studioInstanceId,startAt,inspection,...viewOptions},{expectedStudio}={}){
      if(inspection&&startAt)throw Error('startAt is available only in normal review.');
      const epochs=new Map([...lifecycle.all.values()].map(s=>[s,s.server.reviewEpoch?.()]));
      const {dir,state}=await values.readBundle(bundleId,inspection?{program:false}:undefined);
      const retained=inspection?await values.selectInspection({bundleId,directory:dir,observationId:inspection.observationId}):null;
      const viewPath=await lifecycle.reviewPath({dir,...viewOptions})??'';
      const existing=[...lifecycle.all.values()].find(candidate=>candidate.server.currentPrint()===dir);
      if(existing&&existing.ownerId!==ownerId)throw Error('This bundle is attached to another chat. Explicitly capture it before reviewing.');
      const chosen=studioInstanceId?lifecycle.owned.get(studioInstanceId):existing;
      if(studioInstanceId&&!chosen)throw Error('That Studio instance is not attached to this chat.');
      if(existing&&chosen&&existing!==chosen)throw Error('This bundle already has a Studio instance. Use that window.');
      // Acquire the window without changing its selection. The one queued open
      // below checks the supplied starting identity, even for another bundle.
      const session=chosen??await lifecycle.acquire(null,{expectedStudio});
      await session.server.openPrint(dir,{expectedStudio,inspection:retained,expectedReviewEpoch:epochs.get(session)});
      preferredByPrint.set(bundleId,session.server.agentSession().instanceId);
      if(startAt)await session.server.setStartAt(startAt);
      const url=session.url+viewPath,browserOpenRequested=await lifecycle.show(session,url);
      const stage=startAt||state.outputId||state.review?.path?'toolpath':'geometry';
      const visualCheck=retained?null:await lifecycle.capture(session.server,bundleId,null,state.workEvidence,stage,ownerId,{waitForViewer:browserOpenRequested});
      return {...values.summary(bundleId,state),studioInstanceId:session.server.agentSession().instanceId,url,browserOpenRequested,visualCheck,
        ...(retained?{inspection:session.server.inspectionSelection()}:{} )};
    },
    async closeStudioSession({studioInstanceId}){
      const session=lifecycle.owned.get(studioInstanceId);
      if(!session)throw Error('That Studio instance is not owned by this agent.');
      const {printId,...record}=session.server.agentSession();
      await session.server.shutdown();
      return {bundleId:printId,...record,connected:false};
    },
    release(studioInstanceId){for(const [id,instance] of preferredByPrint)if(instance===studioInstanceId)preferredByPrint.delete(id);}
  };
}
