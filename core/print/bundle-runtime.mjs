// Each print records the SAAM runtime that last wrote it. Another runtime is
// refused until an agent explicitly takes the print over (capture_bundle).
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {replaceFile} from '../file-write.mjs';

const recordFile=dir=>resolve(dir,'.bundle-runtime.json');
// Prints written before runtimes were recorded belong to the installed release.
const installed=Object.freeze({id:'installed',label:'Installed SAAM',command:'saam',codeRoot:null});

// The orchestrator gives each runtime process its identity; threads and children inherit it.
// Processes without one (tests, tools) neither record nor check runtimes.
export function processRuntime(){
  const value=process.env.SAAM_RUNTIME;
  return value?JSON.parse(value):null;
}

export async function bundleRuntime(dir){
  try{return JSON.parse(await readFile(recordFile(dir),'utf8'));}
  catch(error){if(error.code==='ENOENT')return installed;throw error;}
}

// Callers hold the bundle write lock.
export async function recordBundleRuntime(dir,runtime=processRuntime()){
  if(!runtime)return;
  const next=JSON.stringify({id:runtime.id,label:runtime.label,command:runtime.command,codeRoot:runtime.codeRoot??null})+'\n';
  const current=await readFile(recordFile(dir),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(current!==next)await replaceFile(recordFile(dir),next);
}
