import {isAbsolute,basename} from 'node:path';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {selectSettings,machineBounds} from '../machine/settings.mjs';
import {admitMachineSetupStore} from '../machine/query-operations.mjs';
import {prepareSTLImport,releaseSTLImport} from '../geom/import-stl.mjs';
import {commitSTLImport} from './import-stl.mjs';
import {repairSTLFiles} from '../print/repair-stl.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {summary} from '../print/summary.mjs';

async function verifyAsset(asset,signal){
  const hash=createHash('sha256');let length=0;
  for await(const chunk of createReadStream(asset.path,{signal})){hash.update(chunk);length+=chunk.length;}
  if(length!==asset.byteLength||hash.digest('hex')!==asset.sha256)throw Error('Acquired source changed; no result accepted.');
}

// Runtime's STL import orchestration: acquire and verify the asset, select the
// machine's Settings and bounds, run the Geometry import and hand the part to
// part execution (commitSTLImport). Bundle only stores the result.
export function createBundleSourceOperations({directory,paths,machineSetupsPath,assets,runJob,appRoot,dataRoot}){
  const roots={appRoot,dataRoot};
  paths=paths===undefined?undefined:Object.freeze({...paths});
  async function importSTL(bundleId,dir,{source,units,machineId,machineSetups}){
    const preparedSelection=await selectSettings(machineId,{...roots,machineSetups});
    const bounds=structuredClone(machineBounds(preparedSelection.machine,preparedSelection.settings.setup.tool));
    return runJob({bundleId,status:'importing',progress:{stage:'import'}},async job=>{
      const {signal}=job;let asset,candidate,phase='acquire';
      job.event('import-started',{importDiagnostic:{stage:'acquire',...(source.kind==='thingi10k'?{dataset:{provider:'Thingi10K',fileId:source.fileId}}:{})}});
      let previous='import';
      const progress=value=>{job.progress(value);if(value.stage==='repair'&&previous!=='repair')job.event('import-repair-started',{elapsedMs:job.elapsedMs()});previous=value.stage;};
      try{
        asset=await assets.acquire(source,{signal});signal.throwIfAborted();
        phase='geometry';await verifyAsset(asset,signal);
        candidate=await prepareSTLImport(asset.path,{paths,units,bounds,attribution:asset.downloaded?.attribution,signal,progress});
        let committed;
        try{
          if(candidate.importDiagnostic?.sourceSha256&&candidate.importDiagnostic.sourceSha256!==asset.sha256)throw Error('Acquired source changed during import; no result accepted.');
          phase='bundle';committed=await commitSTLImport(dir,candidate,{preparedSelection,signal,progress,beforeCommit:job.beforeCommit});phase='cleanup';
        }finally{await releaseSTLImport(candidate);}
        job.event('import-completed',{importDiagnostic:candidate.importDiagnostic});
        return asset.downloaded?{...asset.downloaded,...committed,imported:true,nextStep:'Show the imported geometry in Studio with its dimensions. Export happens only from Studio.'}:committed;
      }catch(error){
        const downloaded=asset?.downloaded??error.acquiredSource;
        const importDiagnostic=error.importDiagnostic??{...candidate?.importDiagnostic,stage:phase,
          ...(downloaded?{sourceSha256:downloaded.attribution.sha256,dataset:{provider:downloaded.attribution.provider,fileId:downloaded.attribution.fileId,revision:downloaded.attribution.revision}}:{}),
          failure:{name:error.name,code:error.code??null,message:error.message}};
        error.importDiagnostic??=importDiagnostic;
        if(downloaded&&!signal.aborted&&(phase==='geometry'||phase==='bundle'||error.acquiredSource)){
          const sourcePath=asset?await assets.retainFailed(asset).catch(retention=>{importDiagnostic.evidenceError=retention.message;return null;}):null;
          if(!asset)importDiagnostic.evidenceError='The acquired download could not be captured: '+error.message;
          importDiagnostic.evidence=sourcePath&&basename(sourcePath);
          const result={...downloaded,sourcePath,imported:false,error:error.message,importDiagnostic,
            nextStep:'The downloaded original is kept as diagnostics evidence at sourcePath until another downloaded import fails. Automatic repair could not accept this input; explain the reported failure and choose a corrected source or ask a builder to diagnose it.'};
          job.event('import-failed',{error:error.message,importDiagnostic});return result;
        }
        job.event(signal.aborted?'import-cancelled':'import-failed',{error:error.message,importDiagnostic});throw error;
      }finally{if(asset)await assets.release(asset);}
    });
  }
  return {
    async importStlBundle({bundleId,sourcePath,units,machineId}){
      if(!isAbsolute(sourcePath))throw Error('Choose an absolute path to a local .stl source file.');
      if(!(await stat(sourcePath)).isFile())throw Error('STL source must be a regular file.');
      const dir=await directory(bundleId,{create:true}),machineSetups=await admitMachineSetupStore(machineSetupsPath);
      await importSTL(bundleId,dir,{source:{kind:'local',path:sourcePath},units,machineId,machineSetups});
      return summary(bundleId,await loadBundle(dir));
    },
    async importThingi10kBundle({bundleId,fileId,machineId,units}){
      const dir=await directory(bundleId,{create:true});
      const machineSetups=await admitMachineSetupStore(machineSetupsPath);
      const result=await importSTL(bundleId,dir,{source:{kind:'thingi10k',fileId},units,machineId,machineSetups});
      return {...result,...(result.imported?summary(bundleId,await loadBundle(dir)):{bundleId})};
    },
    async repairStl({sourcePath,outputDirectory,units,...limits}){
      if(!isAbsolute(sourcePath))throw Error('Choose an absolute path to a local .stl source file.');
      if(!isAbsolute(outputDirectory))throw Error('Choose an absolute path for the new repair directory.');
      return runJob({bundleId:null,kind:'stl-repair',status:'repairing',progress:{stage:'read-source'}},async job=>{
        const asset=await assets.acquire({kind:'local',path:sourcePath},{signal:job.signal});
        try{
          await verifyAsset(asset,job.signal);
          return {jobId:job.id,directory:outputDirectory,report:await repairSTLFiles(outputDirectory,asset.path,{...limits,units,signal:job.signal,progress:job.progress})};
        }finally{await assets.release(asset);}
      });
    }
  };
}
