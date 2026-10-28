// A Studio window's session: the one print it shows, the write reservation and
// edit order it holds for that print, the chat it is attached to, and the review
// (normal or a retained inspection) it presents.
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {withBundleInstance,releaseBundleInstance,bundleInstance,claimBundleInstance,reassignBundleInstance} from '../core/print/studio-ownership.mjs';
import {mkdir} from 'node:fs/promises';

export function createWindowSession(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {attachedTo,chat,displayedResults,instanceId,libraryRoot,note,operations,printDirectory,
    queuedNoted,resolveBundle,restoring,runtimeId,runtimeLabel,selection,session,settlingSelections,
    tourHere,workIdFor}=ctx;
  const changeReview=next=>{
    const leaving=Boolean(session.inspection);session.inspection=next?{...next,selectionId:randomBytes(16).toString('hex')}:null;
    session.reviewEpoch=randomBytes(16).toString('hex');displayedResults.clear();
    if(leaving)session.normalReviewPending=true;
  };
  const runBundleEdit=(target,action,{selectionVersion:version=selection.version}={})=>{
    if(session.closed)return Promise.reject(Error('Studio is closing. Reopen it before editing.'));
    const selected=resolve(target);
    const run=session.editTail.then(async()=>{
      await session.opened;
      if(session.dir!==selected||version!==selection.version)throw Error('The Studio print changed before editing.');
      if(!session.reservation||session.reservedDirectory!==selected)throw Error('This Studio instance has no association with the print. Open it again.');
      return withBundleInstance(selected,session.reservation,()=>action(session.reservation));
    });
    session.editTail=run.catch(()=>{});
    return run;
  };
  const runBundleCreation=(target,action,{selectionVersion:version=selection.version}={})=>{
    const selected=resolve(target);
    const run=session.editTail.then(async()=>{
      await session.opened;
      if(version!==selection.version)throw Error('The Studio print changed before creation.');
      // A reused window leaves its print for the bundle being created.
      if(session.dir&&session.dir!==selected){
        if(operations.active||tourHere(await chat.current.tour.info()))throw Error('The Studio changed before bundle creation.');
        const previous=session.dir;selection.version=randomBytes(16).toString('hex');
        await chat.current.binding.retire?.({directory:previous,studioInstanceId:instanceId});
        if(session.reservation&&session.reservedDirectory===session.dir){await releaseBundleInstance(session.dir,session.reservation);session.reservation=null;session.reservedDirectory=null;}
        session.dir=null;session.opened=Promise.resolve(null);ctx.lifetime.notify('studio-update',{kind:'state',kinds:['print']});
      }
      if(!session.dir&&session.reservation&&session.reservedDirectory!==selected){
        const previous=session.reservedDirectory,claim=session.reservation,version=selection.version;
        const touring=tourHere(await chat.current.tour.info());
        if(operations.active||touring)throw Error('The Studio changed before bundle creation.');
        if(session.dir||selection.version!==version||session.reservation!==claim||session.reservedDirectory!==previous)throw Error('The Studio print changed before creation.');
        // A failed blank creation keeps its claim for same-target repair. A
        // different accepted target ends that exact association, not its files.
        await releaseBundleInstance(previous,claim);
        if(session.dir||selection.version!==version||session.reservation!==claim||session.reservedDirectory!==previous)throw Error('The Studio print changed before creation.');
        session.reservation=null;session.reservedDirectory=null;selection.version=randomBytes(16).toString('hex');
        const nextVersion=selection.version;
        await chat.current.binding.retire?.({directory:previous,studioInstanceId:instanceId});
        if(session.dir||selection.version!==nextVersion||session.reservation)throw Error('The Studio print changed before creation.');
        ctx.lifetime.notify('studio-update',{kind:'state',kinds:['print']});
      }
      const previous=session.reservation&&session.reservedDirectory===selected?await bundleInstance(selected):null;
      if(previous?.token!==session.reservation?.token){session.reservation=null;session.reservedDirectory=null;}
      if(!session.reservation){await mkdir(dirname(selected),{recursive:true});await mkdir(selected);}
      const claim=session.reservation??await claimBundleInstance(selected,{instanceId,ownerId:chat.current.binding.ownerId,restoring,runtimeId,runtimeLabel});
      session.reservation=claim;session.reservedDirectory=selected;operations.active++;operations.creating=true;
      try{return await withBundleInstance(selected,claim,()=>action(claim));}
      finally{operations.creating=false;operations.active--;}
    });
    session.editTail=run.catch(()=>{});return run;
  };
  const releaseInstance=()=>{
    const run=session.editTail.then(async()=>{
      if(session.reservation){await releaseBundleInstance(session.reservedDirectory,session.reservation);session.reservation=null;session.reservedDirectory=null;}
    });
    session.editTail=run.catch(()=>{});
    return run;
  };
  // Switching the viewport does not wait for another bundle's accepted edit.
  // Its original reservation survives only until that edit queue has drained.
  function leaveSelection(){
    if(!session.reservation)return;
    const directory=session.reservedDirectory,entry={claim:session.reservation,tail:session.editTail,retired:true,releasing:false,done:null};
    settlingSelections.set(directory,entry);
    entry.done=entry.tail.then(async()=>{if(entry.retired){entry.releasing=true;await releaseBundleInstance(directory,entry.claim);}}).finally(()=>{
      if(settlingSelections.get(directory)===entry)settlingSelections.delete(directory);
    });
    void entry.done.catch(error=>note('handback-failed',{printId:workIdFor(directory),directory,error:error.message}));
    session.reservation=null;session.reservedDirectory=null;session.editTail=Promise.resolve();
  }
  const openPrint=async input=>{
    await session.opened;
    const next=await printDirectory(input,resolveBundle),adapter=await resolveBundle(next);
    await adapter.loadBundleSnapshot(next,{program:false});
    if(next!==session.dir&&session.reservation&&session.reservedDirectory===next){const previous=session.dir;if(previous)selection.version=randomBytes(16).toString('hex');session.dir=next;session.opened=Promise.resolve(adapter);await selected(previous);changeReview(null);return;}
    if(next!==session.dir){
      const candidate=settlingSelections.get(next);if(candidate?.releasing)await candidate.done;
      const returning=candidate&&!candidate.releasing&&settlingSelections.get(next)===candidate?candidate:null;
      const claim=returning?.claim??await claimBundleInstance(next,{instanceId,ownerId:chat.current.binding.ownerId,restoring,runtimeId,runtimeLabel});
      if(returning)returning.retired=false;
      const previous=session.dir??session.reservedDirectory;selection.version=randomBytes(16).toString('hex');
      leaveSelection();session.dir=next;session.reservation=claim;session.reservedDirectory=next;session.opened=Promise.resolve(adapter);
      if(returning)session.editTail=returning.tail;
      await selected(previous);
    }else session.opened=Promise.resolve(adapter);
    changeReview(null);
  };
  // Commit a selection from any Studio or agent entry point.
  async function selected(previous){
    if(previous)await chat.current.binding.retire?.({directory:previous,studioInstanceId:instanceId});
    note('print-opened',{previousBundleId:workIdFor(previous)});
    ctx.publishProgress(ctx.calculationStatus());
  }
  const validateGeometrySelection=async(adapter,seen)=>{
    const state=(await adapter.loadBundleSnapshot(session.dir,{program:false,live:true})).state;
    if(seen&&(seen.revision!==state.revision||seen.geometryId!==state.geometryId))throw Error('The geometry changed. Review the current shape before confirming.');
  };
  function observeRequest(record){
    if(record.source==='studio'&&record.status==='queued'&&record.studioInstanceId===instanceId&&!queuedNoted.has(record.id)){
      queuedNoted.add(record.id);note('request-queued',{requestId:record.id,requestKind:record.kind,instruction:record.instruction,scope:record.scope??null,printId:record.printId,directory:resolve(libraryRoot,record.printId)});
    }
    if((!record.studioInstanceId||record.studioInstanceId===instanceId)&&record.printId===workIdFor(session.dir))ctx.lifetime.notify('studio-update',{kind:'state',kinds:['requests'],instanceId});
  }
  function replaceAttachment(next,{expectedStudio}={}){
    const run=session.editTail.then(async()=>{
      await session.opened;
      if(session.closed)throw Error('Studio is closing.');
      if(expectedStudio&&(expectedStudio.studioInstanceId!==instanceId||expectedStudio.bundleId!==workIdFor(session.dir)||expectedStudio.selectionVersion!==selection.version))
        throw Object.assign(Error('The Studio target changed before attachment.'),{code:'STUDIO_TARGET_CHANGED',currentStudio:{studioInstanceId:instanceId,bundleId:workIdFor(session.dir),selectionVersion:selection.version}});
      if(ctx.server.attachmentBusy())throw Error('Wait for the current Studio operation to finish before re-pairing.');
      const previous=chat.current.binding;
      if(previous.ownerId===next.ownerId)return ctx.server.agentSession();
      if(session.reservation)session.reservation=await reassignBundleInstance(session.reservedDirectory,session.reservation,next.ownerId);
      if(previous.ownerId!==next.ownerId){
        const version=randomBytes(16).toString('hex');
        if(previous.attachment)await previous.retire?.({studioInstanceId:instanceId,message:'Studio transferred to another chat.'});
        else await previous.attachSelection?.({studioInstanceId:instanceId,printId:workIdFor(session.dir),previousSelectionVersion:selection.version,selectionVersion:version});
        selection.version=version;
      }
      chat.stopRequestFeed();
      const detail={studioInstanceId:instanceId,printId:workIdFor(session.dir),directory:session.dir,selectionVersion:selection.version,previousOwnerId:previous.ownerId,ownerId:next.ownerId,attachment:next.attachment};
      const kind=next.attachment?(previous.attachment?'chat-captured':'chat-attached'):'chat-detached';
      previous.note(kind,detail);
      chat.current=attachedTo(next);
      if(previous.ownerId!==next.ownerId)next.note(kind,detail);
      chat.stopRequestFeed=next.watch(observeRequest);
      ctx.lifetime.notify('studio-update',{kind:'state',kinds:['chat','requests'],instanceId});
      return ctx.server.agentSession();
    });
    session.editTail=run.catch(()=>{});return run;
  }
  return {changeReview,runBundleEdit,runBundleCreation,releaseInstance,leaveSelection,openPrint,selected,validateGeometrySelection,observeRequest,replaceAttachment};
}
