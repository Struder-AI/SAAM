import {requireThat} from '../private/export/numeric.mjs';
import {exportGriffin,interpretGriffin} from './griffin.mjs';
import {exportBambu,interpretBambu,exportAndInterpretBambu} from './bambu.mjs';
import {exportDobot,interpretDobot} from './dobot.mjs';
import {exportDenso,interpretDenso} from './denso.mjs';

import {withTravelAdvisory} from './travel-advisory.mjs';
import {unpackZip} from './zip.mjs';
const adapters={
  'denso-pacscript':{export:exportDenso,interpret:interpretDenso},
  'griffin-gcode':{export:exportGriffin,interpret:(bytes,plan,machine,options)=>interpretGriffin(Buffer.isBuffer(bytes)?bytes.toString('utf8'):bytes,plan,machine,options)},
  'bambu-gcode':{export:exportBambu,interpret:interpretBambu,exportAndInterpret:exportAndInterpretBambu},
  'dobot-lua':{export:exportDobot,interpret:interpretDobot}
};
export function outputAdapter(plan,machine){
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false&&adapters[declaration.id],declaration.reason??`No exporter/interpreter for ${declaration.id}.`);
  return adapters[declaration.id];
}
export const exportProgram=(path,plan,machine,release)=>{
  return outputAdapter(plan,machine).export(path,plan,machine,release);
};
export const decodeProgram=(code,plan,machine,options={})=>withTravelAdvisory(outputAdapter(plan,machine).interpret(code,plan,machine,options));

// Generation decodes the emitted commands for summaries and display. Source
// loading extracts text without replaying motion or auditing the writer.
export function exportAndDecodeProgram(path,plan,machine,release){
  const adapter=outputAdapter(plan,machine);
  if(adapter.exportAndInterpret){
    const result=adapter.exportAndInterpret(path,plan,machine,release);
    return {...result,program:withTravelAdvisory(result.program)};
  }
  const bytes=adapter.export(path,plan,machine,release);
  return {bytes,program:withTravelAdvisory(adapter.interpret(bytes,plan,machine))};
}

// Bundle already owns the exact artifact hash and locked settings. Extract the
// source inventory without executing a machine-language decoder.
export function readProgramSources(bytes,plan,machine){
  outputAdapter(plan,machine);
  if(plan.output==='griffin-gcode')return {program:typeof bytes==='string'?bytes:Buffer.from(bytes).toString('utf8')};
  const entries=unpackZip(bytes);
  const source=name=>{const value=entries.get(name);requireThat(value,'Missing program source: '+name);return value.toString('utf8');};
  if(plan.output==='bambu-gcode')return {program:source('Metadata/plate_1.gcode')};
  if(plan.output==='dobot-lua')return {'global.lua':source('global.lua'),'src1.lua':source('src1.lua'),'src0.lua':source('src0.lua')};
  if(plan.output==='denso-pacscript'){
    const manifest=JSON.parse(source('manifest.json'));
    requireThat(manifest.schema==='saam-denso-program/1'&&manifest.entry==='main.pcs'&&Array.isArray(manifest.sourceFiles),
      'Unsupported DENSO source inventory.');
    return Object.fromEntries(manifest.sourceFiles.map(name=>[name,source(name)]));
  }
  throw Error('Unsupported program source output: '+plan.output);
}
