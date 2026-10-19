import {requireThat} from '../private/export/numeric.mjs';
import {PROGRAM_DECIMALS,XYZ_PROGRAM_DECIMALS,PROGRAM_SLACK_MM} from '../dimensions.mjs';
import {Kinematics} from '../machine/kinematics.mjs';
import {validateTemperatureC} from '../private/export/temperature.mjs';
import {loadExtensionEntry,machineCatalog} from '../extensions/library.mjs';
import {gcodeMotion} from './gcode-motion.mjs';
import {packZip,unpackZip,crc32} from './zip.mjs';
import {encodePng} from './png.mjs';
import {prepareExportPath} from './prepare-path.mjs';
import {validateSetup} from '../machine/rules.mjs';
import {createMotionReport} from '../path/motion-report.mjs';
import {knownSeconds} from '../path/saampath.mjs';
import {settingsDefaults} from '../machine/settings.mjs';
import {currentMachineSnapshot} from '../machine/profile.mjs';

// The plug: besides the prepared path and settings, the only operations an
// adapter receives. Frame math is Geometry's stateless library (no part data);
// kinematics is what the extension's own kinematics plug is built from.
export const Export=Object.freeze({
  number:(value,quantity)=>Number(value.toFixed(quantity==='xyz'?XYZ_PROGRAM_DECIMALS:PROGRAM_DECIMALS)),slackMm:PROGRAM_SLACK_MM,
  gcodeMotion,knownSeconds,packZip,unpackZip,crc32,encodePng,temperatureC:validateTemperatureC,
  frame:Kinematics.frame,kinematics:Kinematics
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
// What the program writer still lacks, or null when it can write: a machine,
// its output's exporter, then the installation that exporter requires. The
// writer checks the same again (prepareExportPath). Agent and person both read
// it, so it states what is missing rather than whose step comes next.
export async function programReadiness(plan,machine){
  if(!machine)return 'No printer selected yet; its program is written once one is chosen.';
  try{validateSetup(plan,machine,{required:true,adapter:await machineAdapter(plan,machine)});return null;}
  catch(error){return `The ${machine.name} program is not written yet: ${error.message}`;}
}
// The exact selected-machine motion the adapter writes.
export async function preparePath(path,plan,machine){
  return prepareExportPath(path,plan,machine,await machineAdapter(plan,machine));
}
// The prepared path's own totals: requested timing and commanded volume.
function measuredPath(prepared,lineWidthMm){
  const state={report:null};
  const actions={*[Symbol.iterator](){
    const report=state.report?null:createMotionReport(prepared.initialPosition,lineWidthMm);
    for(const action of prepared.actions){report?.record(action);yield action;}
    if(report)state.report=report.result();
  }};
  return {path:{...prepared,actions},totals(){
    if(!state.report)for(const action of actions){/* Complete a writer that did not consume the stream. */}
    return state.report;
  }};
}
// Prepares the path once and writes it. The report is what Bundle stores:
// the adapter's notice, limitations and estimates (the path's own totals when
// the adapter gives none), the move count and the short-travel advisory.
export async function exportProgram(path,plan,locked,release){
  const adapter=await machineAdapter(plan,locked),{machine,notes}=currentMachineSnapshot(locked),prepared=prepareExportPath(path,plan,machine,adapter);
  // defaultProcess: the profile's process defaults, for a writer that needs a
  // value the authored one cannot give (a robot command needs a positive time).
  const measured=measuredPath(prepared,plan.process.lineWidthMm);
  const {bytes,report}=adapter.export(measured.path,{machine,setup:plan.setup,process:plan.process,output:plan.output,release,defaultProcess:settingsDefaults(machine).process}),totals=measured.totals();
  const untimed=report.seconds===undefined?totals.untimedMoves:report.untimedMoves??0;
  const limitations=[...notes,...prepared.notes,...report.limitations??[],...(untimed?[`The time estimate excludes ${untimed} move(s) with no positive speed.`]:[])];
  return {bytes,...(prepared.schedule?{executionSchedule:prepared.schedule}:{}),report:{...report,limitations,moves:totals.moves,seconds:report.seconds??totals.seconds,
    volumeMm3:report.volumeMm3??totals.volumeMm3,shortTravel:totals.shortTravel}};
}
