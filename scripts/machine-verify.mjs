// Builder-only debug verification (machine-verify) for adapters that have no
// physical trial yet: executes a print's checked program in the adapter's
// verifier and compares it with the report stored at generation.
//   node scripts/machine-verify.mjs BUNDLE_DIR
import {loadBundle} from '../core/print/bundle.mjs';

const verifiers={'dobot-lua':()=>import('../core/export/dobot-player.mjs'),'denso-pacscript':()=>import('../core/export/denso-player.mjs')};
const state=await loadBundle(process.argv[2],{program:true}),output=state.completedOutput;
if(!output)throw Error(state.programError??'The print has no checked program. Generate it first.');
const load=verifiers[output.plan.output];
if(!load)throw Error('No machine-verify for '+output.plan.output+'.');
const program=(await load()).verify(state.checkedBytes,output.plan,output.machine),report=state.program;
const pair=(verified,reported)=>({verified,reported,difference:verified-reported});
console.log(JSON.stringify({output:output.plan.output,outputId:output.id,checks:program.checks,moves:program.moves.length,
  seconds:pair(program.seconds,report.seconds),volumeMm3:pair(program.volumeMm3,report.volumeMm3),
  estimatedRelayVolumeMm3:pair(program.summary.estimatedRelayVolumeMm3,report.estimatedRelayVolumeMm3)},null,2));
