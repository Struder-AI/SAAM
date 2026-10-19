// Builder-only debug verification (machine-verify) for adapters that have no
// physical trial yet: writes transient bytes from the reviewed neutral path,
// interprets them and compares with writer facts. Nothing is exported or saved.
//   node scripts/machine-verify.mjs BUNDLE_DIR
import {loadBundle} from '../core/print/bundle.mjs';
import {loadExtensionEntry,machineCatalog} from '../core/extensions/library.mjs';
import {Export,exportProgram} from '../core/export/registry.mjs';
import {readMotionArtifact} from '../core/print/path-artifact.mjs';
import {VERSION,BUILD_DATE} from '../core/print/version.mjs';

const state=await loadBundle(process.argv[2],{program:true}),output=state.completedOutput;
if(!output?.machine)throw Error(state.programError??'Review a saved toolpath with a selected printer first.');
const verify=await loadExtensionEntry(machineCatalog().get(output.machine.id)?.extension,'machine-verify');
const {bytes,report}=await exportProgram(await readMotionArtifact(state.dir,output.path),output.plan,output.machine,
  {generatorVersion:VERSION,buildDate:BUILD_DATE});
const program=verify(bytes,output.plan,output.machine,Export);
const pair=(verified,reported)=>({verified,reported,difference:verified-reported});
console.log(JSON.stringify({output:output.plan.output,outputId:output.id,checks:program.checks,moves:program.moves.length,
  seconds:pair(program.seconds,report.seconds),volumeMm3:pair(program.volumeMm3,report.volumeMm3),
  estimatedRelayVolumeMm3:pair(program.summary.estimatedRelayVolumeMm3,report.estimatedRelayVolumeMm3)},null,2));
