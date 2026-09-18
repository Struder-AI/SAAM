import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGridfinityBundle,updateGridfinityBundle} from './bundle.mjs';

const args=process.argv.slice(2),[action,directory,file,...flags]=args;
try{
  if(!['create','update'].includes(action)||!directory||!file)throw new Error('Use gridfinity/scripts/cli.mjs create|update <print-directory> <parameters.json> [--machine <id>] [--revision <hash>] [--part <id>].');
  const options={};
  for(let i=0;i<flags.length;i+=2){
    const key={'--machine':'machineId','--revision':'expectedRevision','--part':'part'}[flags[i]];
    if(!key||!flags[i+1]||Object.hasOwn(options,key))throw new Error('Unknown, duplicate or incomplete option.');
    options[key]=flags[i+1];
  }
  if(action==='create'&&(options.expectedRevision||options.part)||action==='update'&&options.machineId)throw new Error('Machine applies to create; revision and part apply to update.');
  const parameters=JSON.parse(await readFile(resolve(file),'utf8'));
  const state=await (action==='create'?createGridfinityBundle:updateGridfinityBundle)(resolve(directory),parameters,options);
  console.log(JSON.stringify({print:state.dir,revision:state.revision,boundsMm:state.geometry.boundsMm,toolpathApproved:state.toolpathApproved},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
