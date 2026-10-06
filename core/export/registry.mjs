import {requireThat,distance} from '../private/export/numeric.mjs';
import {PROGRAM_DECIMALS,PROGRAM_SLACK_MM} from '../dimensions.mjs';
import {rotateZ,rotatePointZ,interpolateDirectionPair,validateDirectionPair} from '../geom/frame.mjs';
import {validateTemperatureC} from '../private/export/temperature.mjs';
import {loadExtensionEntry,machineCatalog} from '../extensions/library.mjs';
import {gcodeMotion} from './gcode-motion.mjs';
import {packZip,unpackZip,crc32} from './zip.mjs';
import {prepareExportPath} from './prepare-path.mjs';
import {preparedTravelAdvisory} from './travel-advisory.mjs';

// The plug: besides the prepared path and settings, the only operations an
// adapter receives. Frame math is Geometry's stateless library (no part data).
export const Export=Object.freeze({
  number:value=>Number(value.toFixed(PROGRAM_DECIMALS)),slackMm:PROGRAM_SLACK_MM,
  gcodeMotion,packZip,unpackZip,crc32,temperatureC:validateTemperatureC,
  frame:Object.freeze({rotateZ,rotatePointZ,interpolateDirectionPair,validateDirectionPair})
});

// The selected output's adapter, from the machine extension shipping the
// profile: {output, poses, settings:{key?, validate?}, export(prepared, settings)}.
export async function machineAdapter(plan,machine,options){
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false,declaration.reason??`No exporter for ${declaration.id}.`);
  const extension=machineCatalog(options).get(machine.id)?.extension;
  requireThat(extension,`No machine extension provides ${machine.id}.`);
  const adapter=(await loadExtensionEntry(extension,'machine-adapter',options))(Export);
  requireThat(adapter?.output===declaration.id&&typeof adapter.export==='function',`No exporter for ${declaration.id}.`);
  return adapter;
}
// The exact selected-machine motion the adapter writes (and Studio draws).
export async function preparePath(path,plan,machine){
  return prepareExportPath(path,plan,machine,await machineAdapter(plan,machine));
}
// The prepared path's own totals: requested timing and commanded volume.
function pathTotals(prepared){
  let from=prepared.initialPosition,moves=0,seconds=0,volumeMm3=0;
  for(const action of prepared.actions){
    if(action.kind==='move'){moves++;seconds+=action.durationSeconds??distance(from,action.to)/action.speedMmS;volumeMm3+=action.volumeMm3;from=action.to;}
    else if(action.kind==='extrude'){seconds+=action.volumeMm3/action.flowMm3S;volumeMm3+=action.volumeMm3;}
    else if(action.kind==='dwell')seconds+=action.seconds;
  }
  return {moves,seconds,volumeMm3};
}
// Prepares the path once and writes it. The report is what Bundle stores:
// the adapter's notice, limitations and estimates (the path's own totals when
// the adapter gives none), the move count and the short-travel advisory.
export async function exportProgram(path,plan,machine,release){
  const adapter=await machineAdapter(plan,machine),prepared=prepareExportPath(path,plan,machine,adapter);
  const {bytes,report}=adapter.export(prepared,{machine,setup:plan.setup,process:plan.process,output:plan.output,release}),totals=pathTotals(prepared);
  return {bytes,report:{limitations:[],...report,moves:totals.moves,seconds:report.seconds??totals.seconds,
    volumeMm3:report.volumeMm3??totals.volumeMm3,shortTravel:preparedTravelAdvisory(prepared,plan)}};
}
