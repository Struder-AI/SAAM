import {requireThat} from '../private/export/numeric.mjs';
import {PROGRAM_DECIMALS,XYZ_PROGRAM_DECIMALS,PROGRAM_SLACK_MM} from '../dimensions.mjs';
import {Kinematics} from '../machine/kinematics.mjs';
import {loadExtensionEntry,machineCatalog} from '../extensions/library.mjs';
import {gcodeMotion,gcodeStream} from './gcode-motion.mjs';
import {packZip,unpackZip,crc32} from './zip.mjs';
import {encodePng} from './png.mjs';
import {prepareExportPath} from './prepare-path.mjs';
import {createMotionReport} from '../path/motion-report.mjs';
import {knownSeconds} from '../path/saampath.mjs';
import {settingsDefaults} from '../machine/settings.mjs';
import {storedMachineSnapshot} from '../machine/profile.mjs';
import {canonicalJson} from '../canonical-json.mjs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {createExportDirectory,createArtifactSink,ownExportArtifact,removeExportDirectory} from './artifact-sink.mjs';

// The plug: besides the prepared path and settings, the only operations an
// adapter receives. Frame math is Geometry's stateless library (no part data);
// kinematics is what the extension's own kinematics plug is built from.
export const Export=Object.freeze({
  number:(value,quantity)=>Number(value.toFixed(quantity==='xyz'?XYZ_PROGRAM_DECIMALS:PROGRAM_DECIMALS)),slackMm:PROGRAM_SLACK_MM,
  gcodeMotion,gcodeStream,knownSeconds,packZip,unpackZip,crc32,encodePng,
  frame:Kinematics.frame,kinematics:Kinematics
});

// The selected output's adapter, from the machine extension shipping the
// profile: {output, poses, settings:{key?, validate?}, write(prepared, settings, sink)}.
export async function machineAdapter(plan,machine,options){
  requireThat(plan.output!==null,'Select a supported output format before Export.');
  const declaration=machine.outputs.find(o=>o.id===plan.output);
  requireThat(declaration,'Machine does not declare the requested output.');
  requireThat(declaration.implemented!==false,declaration.reason??`No exporter for ${declaration.id}.`);
  const extension=machineCatalog(options).get(machine.id)?.extension;
  requireThat(extension,`No machine extension provides ${machine.id}.`);
  const adapter=(await loadExtensionEntry(extension,'machine-adapter',options))(Export);
  requireThat(adapter?.output===declaration.id&&typeof adapter.write==='function',`No exporter for ${declaration.id}.`);
  return adapter;
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
export async function exportArtifact(path,plan,locked,release,{directory,signal,beforeCommit,onProgress,appRoot,dataRoot}={}){
  requireThat(typeof directory==='string','Export requires an owned preparation directory.');
  const sink=await createArtifactSink(directory,{signal});
  try{
  signal?.throwIfAborted();
  const machine=storedMachineSnapshot(locked),adapter=await machineAdapter(plan,machine,{appRoot,dataRoot}),prepared=prepareExportPath(path,plan,machine,adapter,{onProgress});
  // defaultProcess: the profile's process defaults, for a writer that needs a
  // value the authored one cannot give (a robot command needs a positive time).
  const measured=measuredPath(prepared,plan.process.lineWidthMm);
  const settings={machine,setup:plan.setup,process:plan.process,output:plan.output,release,defaultProcess:settingsDefaults(machine).process};
  const {report}=await adapter.write(measured.path,settings,sink.writer);
  const totals=measured.totals();
  const untimed=report.seconds===undefined?totals.untimedMoves:report.untimedMoves??0;
  const limitations=[...prepared.notes,...report.limitations??[],...(untimed?[`The time estimate excludes ${untimed} move(s) with no positive speed.`]:[])];
  await sink.candidate();signal?.throwIfAborted();await beforeCommit?.();
  const artifact=await sink.finish({committed:Boolean(beforeCommit)});
  // The program is traceable to the installed profile and writer that made it.
  const written={machineId:machine.id,profileDigest:createHash('sha256').update(canonicalJson(machine)).digest('hex'),output:adapter.output};
  return {artifact,report:{...report,written,limitations,moves:totals.moves,seconds:report.seconds??totals.seconds,
    volumeMm3:report.volumeMm3??totals.volumeMm3,shortTravel:totals.shortTravel}};
  }catch(error){try{await sink.abort();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}
}

// Current source diagnostic callers need complete bytes. They materialize the
// same artifact operation explicitly; worker/download delivery never does.
export async function exportProgram(path,plan,locked,release,{temporaryRoot=tmpdir(),signal,appRoot,dataRoot}={}){
  const directory=await createExportDirectory(temporaryRoot);let owned;
  try{
    const {artifact,...result}=await exportArtifact(path,plan,locked,release,{directory,signal,appRoot,dataRoot});owned=ownExportArtifact(artifact);
    return {...result,bytes:await owned.materialize()};
  }finally{if(owned)await owned.release();else await removeExportDirectory(directory);}
}
