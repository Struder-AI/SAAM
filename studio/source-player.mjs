import {interpretMachineStudy} from '../core/export/machine-study.mjs';
import {interpretGriffin} from '../core/export/griffin.mjs';
import {interpretBambuSource} from '../core/export/bambu-player.mjs';
import {interpretDobotFiles} from '../core/export/dobot-player.mjs';
import {interpretDensoFiles} from '../core/export/denso-player.mjs';
import {moveStore} from './move-store.mjs';

// Inputs are the exact checked machine source, plus its locked machine setup.
// Both runtimes execute the same modal/Lua interpreter used by export checks.
export function decodeSource(sources,plan,machine,{compact=true}={}) {
  const options=compact?{moves:moveStore()}:{};
  let program;
  if(plan.output==='machine-study')program=interpretMachineStudy(sources['motion.json'],options);
  else if(plan.output==='griffin-gcode')program=interpretGriffin(sources.program,plan,machine,options);
  else if(plan.output==='bambu-gcode')program=interpretBambuSource(sources.program,plan,machine,options);
  else if(plan.output==='dobot-lua')program=interpretDobotFiles(sources,plan,machine,options);
  else if(plan.output==='denso-pacscript')program=interpretDensoFiles(sources,plan,machine,options);
  else throw new Error('Unsupported machine source: '+plan.output);
  delete program.code;delete program.sources;
  return program;
}

export async function fetchSources(state,fetcher=fetch,cryptoApi=globalThis.crypto) {
  const sources={};
  const query=new URLSearchParams({printId:state.printId,revision:state.revision,exportHash:state.exportHash});
  const response=await fetcher('/api/sources?'+query);
  if(!response.ok)throw new Error((await response.json()).error);
  const expected=new Map(state.program.sources.map(s=>[s.name,s.sha256])),decoder=new TextDecoder('utf-8',{fatal:true});
  let pending='';
  const accept=async line=>{
    const entry=JSON.parse(line);
    if(!expected.has(entry.name)||Object.hasOwn(sources,entry.name)||typeof entry.text!=='string')throw new Error('Unexpected or duplicate program source.');
    const bytes=new TextEncoder().encode(entry.text),hash=Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==expected.get(entry.name))throw new Error('Program changed while loading. Reload before reviewing.');
    sources[entry.name]=entry.text;
  };
  const reader=response.body.getReader();
  try{for(;;){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});
    let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);if(line)await accept(line);}
  }pending+=decoder.decode();if(pending)await accept(pending);
  }finally{await reader.cancel();reader.releaseLock();}
  if(Object.keys(sources).length!==expected.size)throw new Error('Missing program source.');
  return sources;
}
