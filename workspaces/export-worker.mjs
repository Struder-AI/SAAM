import {parentPort,workerData} from 'node:worker_threads';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadWorkspaceRuntime,workspacePieces} from '../core/extensions/workspaces.mjs';
import {initBundle} from '../core/print/bundle.mjs';
import {replaceFile} from '../core/file-write.mjs';

// One handoff operation for every workspace. Only Bundle persists part state.
export async function createWorkspaceBundles({extensionId,extension,design,directory,appRoot,dataRoot},progress=()=>{}){
  const loaded=await loadWorkspaceRuntime(extensionId,{appRoot,dataRoot});
  if(JSON.stringify(loaded.extension)!==JSON.stringify(extension))throw Error('The workspace extension changed before construction. Reopen it before saving bundles.');
  const {definition}=loaded,normalized=await definition.normalize(design);
  const pieces=workspacePieces(await definition.pieces(normalized)),created=[];
  await mkdir(directory,{recursive:false});
  const source={schema:'saam-workspace-export/1',workspace:extensionId,extension,design:normalized,stage:'constructing',bundles:created};
  const record=()=>replaceFile(join(directory,'export.json'),JSON.stringify(source,null,2));
  await writeFile(join(directory,'design.json'),JSON.stringify(normalized,null,2),{flag:'wx'});
  await record();
  try{
    for(const piece of pieces){
      progress({stage:'constructing',piece:piece.id,completed:created.length,total:pieces.length});
      const contribution=await definition.construct(structuredClone(normalized),piece.id);
      const {plan,source:constructionSource,requirements,report}=contribution??{};
      if(!plan||typeof plan!=='object'||Array.isArray(plan)||!constructionSource||!requirements)throw Error(`Workspace piece ${piece.id} needs a recipe, source and construction requirements.`);
      // No Bundle, machine, export, approval or revision fields cross this boundary.
      const fields=new Set(['schema','generatorVersion','geometry','process','skills','slices','modulations','experimental','composition']);
      for(const key of Object.keys(plan))if(!fields.has(key))throw Error(`Workspace construction cannot supply ${key}.`);
      const workspace={schema:'saam-workspace-source/1',extension,source:constructionSource,requirements};
      await initBundle(join(directory,piece.id),{...plan,workspace});
      created.push({id:piece.id,path:piece.id,piece,...(report===undefined?{}:{report})});
      await record();
      progress({stage:'created',piece:piece.id,completed:created.length,total:pieces.length,bundles:[...created]});
    }
    source.stage='complete';await record();return source;
  }catch(error){source.stage='failed';source.error=error.message;await record();throw error;}
}

if(parentPort){
  try{parentPort.postMessage({stage:'complete',result:await createWorkspaceBundles(workerData,message=>parentPort.postMessage(message))});}
  catch(error){parentPort.postMessage({stage:'failed',error:error.message});}
}
