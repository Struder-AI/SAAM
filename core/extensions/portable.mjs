// Package coordination owns selected closure and library publication. Bundle
// remains the only interpreter/publisher of archive inputs and part state.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {createTemporaryWorkspace} from '../application/temporary-workspace.mjs';
import * as Portable from '../application/portable.mjs';
import {exportExtension,importExtension,readExtensionIdentity,resolveExtensions} from './library.mjs';
import {runPortableBundleJob} from './portable-job.mjs';

export async function shareBundle(directory,packageFile,options={}){
  const inputs=await Portable.readPortableInputs(directory,options);
  const extensions=await resolveExtensions(inputs.requiredExtensionIds,options);
  const owned=options.workspace?null:await createTemporaryWorkspace('portable'),scratch=options.workspace??owned.directory;
  try{
    options.progress?.({stage:'Packaging selected extensions'});
    const packages=[];
    for(const extension of extensions){
      const target=resolve(scratch,extension.id+'.json');await exportExtension(extension.id,target,options);
      packages.push({...extension,bytes:await readFile(target)});
    }
    return await Portable.writePortableArchive(inputs,packages,packageFile,options);
  }finally{await owned?.release();}
}

export async function importBundle(asset,directory,options={}){
  const capsule=await Portable.readPortableAsset(asset,options);
  const owned=options.workspace?null:await createTemporaryWorkspace('portable'),scratch=options.workspace??owned.directory;
  let candidate,result,failure,committedBundle;const installedExtensions=[];
  try{
    candidate=await Portable.admitPortablePart(capsule,directory,{...options,workspace:scratch});
    options.progress?.({stage:'Validating selected extensions'});
    for(const extension of capsule.extensions){
      const file=resolve(scratch,extension.id+'.json');await writeFile(file,extension.bytes,{flag:'wx'});
      await importExtension(file,{...options,dataRoot:resolve(scratch,'validation')});
    }
    const resolved=await resolveExtensions(capsule.requiredExtensionIds,{...options,dataRoot:resolve(scratch,'validation')});
    if(resolved.some(item=>!capsule.extensions.some(record=>record.id===item.id&&record.digest===item.digest)))throw Error('The package does not contain the selected extension dependency closure.');
    const selected=capsule.extensions.filter(record=>resolved.some(item=>item.id===record.id)).map(({bytes,...metadata})=>metadata);
    for(const extension of selected){
      const existing=await readExtensionIdentity(extension.id,options);
      if(existing?.origin==='local'&&existing.digest!==extension.digest)throw Error(`Local extension ${extension.id} has changes. Keep it, or move it aside before importing another copy.`);
    }
    await Portable.preparePortablePart(candidate);
    await Portable.claimPortableDestination(candidate);
    for(const extension of selected)installedExtensions.push(await importExtension(resolve(scratch,extension.id+'.json'),options));
    result=await Portable.publishPortablePart(candidate,selected);
  }catch(error){
    failure=error;
  }finally{
    if(candidate)committedBundle=Portable.portablePartPublication(candidate);
    async function cleanup(action,step){
      try{await action();}
      catch(error){
        if(!failure){failure=error;failure.unfinishedStep=step;}
        else{const detail=step+': '+error.message;failure.cleanupError=failure.cleanupError?failure.cleanupError+'; '+detail:detail;}
      }
    }
    if(candidate)await cleanup(()=>Portable.abandonPortablePart(candidate),'cleanup-import-staging');
    if(owned)await cleanup(()=>owned.release(),'release-import-workspace');
  }
  if(failure){
    if(committedBundle)failure.committedBundle=committedBundle;
    if(installedExtensions.length)failure.installedExtensions=installedExtensions;
    throw failure;
  }
  return {...result,...(installedExtensions.length?{installedExtensions}:{})};
}

export function createPortableExchangeOperations({directory,runJob,assets,appRoot,paths,dataRoot}){
  async function exchange(operation,bundleId,dir,packageFile,instance){
    const eventKind=operation==='share'?'bundle-share':'import';
    return runJob({bundleId,kind:'bundle-'+operation,status:operation==='share'?'sharing':'importing',progress:{stage:'Preparing portable bundle'}},async job=>{
      job.event(eventKind+'-started',{operation:'bundle-'+operation});let asset,result,failure,step='acquire-portable-source';
      const preservePublication=error=>{
        if(operation==='import'&&result){
          error.committedBundle={directory:result.directory,revision:result.revision,editRevision:result.editRevision};
          error.unfinishedStep??=step;
          if(result.installedExtensions)error.installedExtensions=result.installedExtensions;
        }
      };
      try{
        if(operation==='import')asset=await assets.acquire({kind:'local',path:packageFile},{signal:job.signal});
        step='portable-'+operation;
        result=await runPortableBundleJob(operation,dir,packageFile,{asset,appRoot,paths,dataRoot,instance,signal:job.signal,progress:job.progress,beforeCommit:()=>job.beforeCommit(operation==='share'?'Publishing portable ZIP':'Publishing imported bundle')});
        step='record-'+eventKind+'-completed';
        job.event(eventKind+'-completed',{operation:'bundle-'+operation});
      }catch(error){
        failure=error;preservePublication(failure);
        try{job.event(eventKind+(job.signal.aborted&&!failure.committedBundle?'-cancelled':'-failed'),{error:failure.message,operation:'bundle-'+operation,...(failure.installedExtensions?{installedExtensions:failure.installedExtensions}:{}),...(failure.committedBundle?{committedBundle:failure.committedBundle}:{}),...(failure.unfinishedStep?{unfinishedStep:failure.unfinishedStep}:{}),...(failure.cleanupError?{cleanupError:failure.cleanupError}:{})});}
        catch(recording){failure.recordingError=recording.message;}
      }finally{
        if(asset)try{await assets.release(asset);}catch(error){
          if(failure){const detail='release-portable-source: '+error.message;failure.cleanupError=failure.cleanupError?failure.cleanupError+'; '+detail:detail;}
          else{failure=error;step='release-portable-source';preservePublication(failure);}
        }
      }
      if(failure)throw failure;
      return {...result,bundleId};
    });
  }
  return {
    async shareBundle({bundleId,packageFile}){
      if(!isAbsolute(packageFile))throw Error('Choose an absolute path for a new .zip package.');
      return exchange('share',bundleId,await directory(bundleId),/\.zip$/i.test(packageFile)?packageFile:packageFile+'.zip');
    },
    async importBundle({bundleId,packageFile},instance){
      if(!isAbsolute(packageFile))throw Error('Choose an absolute path to a .zip package.');
      return exchange('import',bundleId,await directory(bundleId,{create:true}),packageFile,instance);
    }
  };
}
