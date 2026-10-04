#!/usr/bin/env node
// Source guidance and map operations. Making runs through the SAAM application.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {contextBudget} from '../core/agent/layers.mjs';
import {root, onboarding, readSkill, readMaps, regenerateMap, contextPacket, developmentAreas} from '../core/agent/toolkit.mjs';

const string={type:'string'}, boolean={type:'boolean'}, many={type:'string',multiple:true};
const schemas={
  'maker-onboarding':{machine:string},
  'builder-onboarding':{area:many,set:string},
  'developer-onboarding':{area:many,set:string},
  'read-skill':{maker:boolean,builder:boolean,developer:boolean,machine:string,all:boolean},
  'read-guidance':{machine:string,all:boolean},
  'context-budget':{machine:many},
  'read-map':{set:string},
  regenerate:{set:string}
};
export const help={commands:{
  'maker-onboarding [--machine ID]':'Read maker context for source guidance work. Installed making uses saam call maker_onboarding.',
  'builder-onboarding [--area AREA] [--set NAME]':'Read builder guidance and consumed component contracts.',
  'developer-onboarding [--area AREA] [--set NAME]':'Read glossary, developer context and map 0.',
  'read-skill ID[#HEADING] [--maker] [--builder] [--developer] [--machine ID] [--all]':'Read selected manual roles or one complete heading.',
  'read-guidance PATH#HEADING [--machine ID] [--all]':'Read a published manual or section with its headings and gates.',
  'read-map ADDRESS [--set NAME]':'Read a map (boxes, leaves as NAME FILE:LINES, arrows) or an arrow @link/MAP/FROM/TO (its leaf arrows). Never returns code.',
  'regenerate [--set NAME]':'Regenerate the maps from source after each task; unchanged code reuses its analysis.',
  'context-budget [--machine ID]':'Measure assembled context and the application operation catalog.'
},developmentAreas:Object.keys(developmentAreas),notes:[
  'Making, Studio, tours, requests and workspace jobs use saam; see core/application/README.md.',
  'Maps: 030-influence (default) for product work; 030-deployment for installation/service work.',
  '--area may repeat. Map indexes change on regeneration; record names and files, not indexes.'
]};

export async function runCLI(args=process.argv.slice(2),{write=value=>console.log(JSON.stringify(value))}={}){
  const [command,...rest]=args;
  try{
    if(!command||['help','--help','-h'].includes(command)){write({ok:true,...help});return;}
    if(!Object.hasOwn(schemas,command))throw Error(`Unknown source toolkit command: ${command}. Making uses saam. Use --help.`);
    const {values:v,positionals}=parseArgs({args:rest,options:schemas[command],allowPositionals:true,strict:true});
    const targetRequired=['read-skill','read-guidance','read-map'].includes(command);
    const targetAllowed=targetRequired||command==='regenerate';
    if(positionals.length>(targetAllowed?1:0)||targetRequired&&!positionals.length)throw Error('Unexpected or missing positional argument. Use --help.');
    const output={};
    if(command.endsWith('-onboarding'))output.result=await onboarding({role:command.replace('-onboarding',''),areas:v.area,machine:v.machine,set:v.set});
    else if(command==='context-budget')output.result=await contextBudget(root,v.machine?{machineIds:v.machine}:{});
    else if(command==='read-skill')output.result=await readSkill(positionals[0],v);
    else if(command==='read-guidance')output.result=await contextPacket([positionals[0]],{machineId:v.machine,all:v.all,headings:true});
    else if(command==='read-map')output.result={maps:await readMaps([positionals[0]],v)};
    else if(command==='regenerate')output.result=await regenerateMap(positionals[0],v);
    write({ok:true,event:'result',command,...output.result});
  }catch(error){write({ok:false,command,stage:'command',error:error.message});process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runCLI();
