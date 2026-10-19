// File staging and publication stay with the caller of cancellable Geometry work.
import {mkdir,writeFile,access,mkdtemp,rm,copyFile,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSTLRepair} from '../geom/stl-repair.mjs';

export async function repairSTL(sourceBytes,options={}){
  const {repairedBytes,report,start}=await prepareSTLRepair(sourceBytes,options);
  report.elapsedSeconds=(performance.now()-start)/1000;options.progress?.({stage:'complete',percent:100});return {repairedBytes,report};
}
export async function repairSTLFiles(directory,source,options={}){
  options.signal?.throwIfAborted();
  const destination=resolve(directory);try{await access(destination);throw Object.assign(Error('EEXIST: repair destination already exists.'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
  const parent=dirname(destination),temporary=await mkdtemp(join(parent,'.'+basename(destination)+'-repair-')),publication={owned:false};
  try{
    const {report,start}=await prepareSTLRepair(source,{...options,destination:join(temporary,'repaired.stl')});options.signal?.throwIfAborted();
    if(typeof source==='string'){await copyFile(source,join(temporary,'original.stl'));const copiedHash=createHash('sha256');for await(const chunk of createReadStream(join(temporary,'original.stl'),{signal:options.signal}))copiedHash.update(chunk);if(copiedHash.digest('hex')!==report.sourceSha256)throw Error('Source changed during repair; no result accepted.');}
    else await writeFile(join(temporary,'original.stl'),source,{flag:'wx',signal:options.signal});
    report.elapsedSeconds=(performance.now()-start)/1000;await writeFile(join(temporary,'repair.json'),JSON.stringify(report,null,2)+'\n');options.signal?.throwIfAborted();
    await mkdir(destination);publication.owned=true;for(const name of ['original.stl','repaired.stl','repair.json'])await rename(join(temporary,name),join(destination,name));publication.owned=false;options.progress?.({stage:'complete',percent:100});return report;
  }finally{
    if(dirname(temporary)!==parent)throw Error('Unexpected repair staging path');
    await rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:100});
    if(publication.owned)await rm(destination,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
}
