// Result images are frames returned by the connected Studio viewer. This owner
// only stores them for the operation; scene preparation and drawing stay in Studio.
import {writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createTemporaryWorkspace} from './temporary-workspace.mjs';

export function createResultImages(){
  const owned={workspace:null,current:new Map(),retired:new Set()};
  async function folder(){return (owned.workspace??=createTemporaryWorkspace('visual-check')).then(workspace=>workspace.directory);}
  async function retire(){
    for(const file of owned.retired)try{await rm(file,{force:true});owned.retired.delete(file);}catch(error){if(!['EBUSY','EPERM','EACCES'].includes(error.code))throw error;}
  }
  async function write(ownerId,bundleId,kind,png){
    const directory=await folder(),stem=String(bundleId).replace(/[^A-Za-z0-9_-]+/g,'_').slice(-48)+'-'+kind;
    const file=resolve(directory,`${stem}-${randomUUID()}.png`),key=JSON.stringify([ownerId,bundleId,kind]);
    await writeFile(file,png,{flag:'wx'});
    const previous=owned.current.get(key);
    owned.current.set(key,{ownerId,bundleId,file});
    if(previous)owned.retired.add(previous.file);
    await retire();return file;
  }
  return {
    async capture(studio,bundleId,before,after,resultStage,ownerId='local'){
      const geometry=Boolean(after?.geometryKey)&&(resultStage==='geometry'||after.geometryKey!==before?.geometryKey);
      const toolpath=Boolean(after?.generationKey)&&(resultStage==='toolpath'||after.generationKey!==before?.generationKey);
      if(!geometry&&!toolpath)return null;
      const result={source:'studio-viewer'};
      for(const stage of ['geometry','toolpath']){
        if(stage==='geometry'&&!geometry||stage==='toolpath'&&!toolpath)continue;
        try{
          if(!studio)throw Error('No Studio is attached to this result.');
          const frame=await studio.captureView({bundleId,target:after,stage});
          result[stage]=await write(ownerId,bundleId,stage,frame.png);
          if(frame.phases)result.phases=frame.phases;
        }catch(error){result[stage+'Error']=error.message;}
      }
      if(result.geometry||result.toolpath)result.lifetime='Read each PNG before handing this bundle back. Hand-back expires its paths; replacement, chat closure and runtime shutdown also remove them.';
      return result;
    },
    async release(ownerId,bundleId){
      for(const [key,current]of owned.current)if(current.ownerId===ownerId&&(bundleId===undefined||current.bundleId===bundleId)){owned.current.delete(key);owned.retired.add(current.file);}
      await retire();
    },
    async close(){const workspace=await owned.workspace?.catch(()=>null);await workspace?.release();}
  };
}
