import {interpretGriffin} from '../core/export/griffin.mjs';
import {interpretBambuSource} from '../core/export/bambu-player.mjs';
import {interpretDobotFiles} from '../core/export/dobot-player.mjs';
import {moveStore} from './move-store.mjs';

// Inputs are the exact checked machine source, plus its locked machine setup.
// Both runtimes execute the same modal/Lua interpreter used by export checks.
export function decodeSource(sources,plan,machine,{compact=true}={}) {
  const options=compact?{moves:moveStore()}:{};
  let program;
  if(plan.output==='griffin-gcode')program=interpretGriffin(sources.program,plan,machine,options);
  else if(plan.output==='bambu-gcode')program=interpretBambuSource(sources.program,plan,machine,options);
  else if(plan.output==='dobot-lua')program=interpretDobotFiles(sources,plan,machine,options);
  else throw new Error('Unsupported machine source: '+plan.output);
  delete program.code;delete program.sources;
  return program;
}

export async function fetchSources(state,fetcher=fetch,cryptoApi=globalThis.crypto) {
  const sources={};
  for(const source of state.program.sources){
    const query=new URLSearchParams({printId:state.printId,revision:state.revision,exportHash:state.exportHash,file:source.name});
    const response=await fetcher('/api/program?'+query);
    if(!response.ok)throw new Error((await response.json()).error);
    const bytes=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==source.sha256)throw new Error('Program changed while loading. Reload before reviewing.');
    sources[source.name]=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  return sources;
}
