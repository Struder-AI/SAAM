// Bundle's saved source and execution reader. Display and generation retain the
// same admission, identity checks and compatibility for older motion artifacts.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {saamPath,joinSaamPath} from '../path/saampath.mjs';

export async function readPathArtifact(directory,artifact){
  const path=JSON.parse(await readFile(resolve(directory,artifact.file)));
  return path.schema==='saampath/3'?saamPath(path):path;
}
export async function readMotionArtifact(directory,artifact){
  if(!artifact.scheduleFile)return JSON.parse(await readFile(resolve(directory,artifact.motionFile??artifact.file)));
  const deposition=await readPathArtifact(directory,artifact),schedule=JSON.parse(await readFile(resolve(directory,artifact.scheduleFile)));
  if(deposition.schema==='saampath/2'){
    if(schedule.sourcePathId!==artifact.id)throw Error('Saved schedule source identity mismatch.');
    // Historical artifacts remain read-only input to the shared compatibility reader.
    return Object.freeze({sourcePathId:artifact.id,deposition,schedule});
  }
  return joinSaamPath({sourcePathId:artifact.id,deposition,schedule});
}
