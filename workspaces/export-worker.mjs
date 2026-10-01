import {parentPort,workerData} from 'node:worker_threads';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {wingSections} from './wing/design.mjs';
import {wingHandoff} from './wing/construct.mjs';
import {createFromWorkspace} from '../core/print/workspace.mjs';

async function exportWing(){
  const {design,directory,machineId}=workerData,layout=wingSections(design),created=[];
  await mkdir(directory,{recursive:false});
  const source={schema:'saam-workspace-export/1',workspace:'wing',design:layout.design,machineId,bundles:created};
  await writeFile(join(directory,'design.json'),JSON.stringify(layout.design,null,2));
  for(const piece of layout.pieces){
    parentPort.postMessage({stage:'constructing',piece:piece.id,completed:created.length,total:layout.pieces.length});
    const handoff=await wingHandoff(layout.design,piece.id),dir=join(directory,piece.id);
    await createFromWorkspace(dir,handoff,{machineId});
    created.push({id:piece.id,directory:dir,piece,report:handoff.report});
    await writeFile(join(directory,'export.json'),JSON.stringify(source,null,2));
    parentPort.postMessage({stage:'created',piece:piece.id,completed:created.length,total:layout.pieces.length,bundles:[...created]});
  }
  return source;
}
try{parentPort.postMessage({stage:'complete',result:await exportWing()});}
catch(error){parentPort.postMessage({stage:'failed',error:error.message});}
