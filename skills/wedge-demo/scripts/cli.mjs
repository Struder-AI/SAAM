import { resolve } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { initBundle, generateBundle, loadBundle, deliver, root, adjustBundle, upgradeBundle, rememberSetup, checkPathBundle } from './bundle.mjs';

const args=process.argv.slice(2),machineIndex=args.indexOf('--machine');
const machineId=machineIndex<0?undefined:args[machineIndex+1];
if(machineIndex>=0)args.splice(machineIndex,2);
const revisionIndex=args.indexOf('--revision'),expectedRevision=revisionIndex<0?undefined:args[revisionIndex+1];
if(revisionIndex>=0)args.splice(revisionIndex,2);
const [command='help',arg,patchFile]=args;
const dir=resolve(arg??resolve(root,machineId==='bambu-h2d'?'Prints/h2d-wedge-demo':'Prints/s5-wedge-demo'));
try {
  if(revisionIndex>=0&&(!expectedRevision||command!=='adjust'))throw new Error('--revision requires a revision hash and is only supported by adjust.');
  if(machineIndex>=0&&!machineId)throw new Error('Supply a machine ID after --machine.');
  if(machineId&&!['init','demo'].includes(command))throw new Error('--machine is only used when initializing a print.');
  if(command==='init')console.log(await initBundle(dir,undefined,{machineId}));
  else if(command==='upgrade'){await upgradeBundle(dir);console.log('Bundle upgraded. Reopen Studio for the required geometry/settings reviews.');}
  else if(command==='adjust') {
    if(!patchFile)throw new Error('Supply a JSON patch file after the print directory.');
    const state=await adjustBundle(dir,JSON.parse(await readFile(resolve(patchFile),'utf8')),{expectedRevision});
    console.log(JSON.stringify({revision:state.revision,plan:state.plan},null,2));
  }
  else if(command==='remember-setup')console.log(await rememberSetup(dir));
  else if(command==='demo') {
    try{await access(resolve(dir,'plan.json'));}catch{await initBundle(dir,undefined,{machineId});}
    if(machineId&&(await loadBundle(dir,{program:false})).machine.id!==machineId)throw new Error('Existing print uses another machine. Choose a new directory.');
    console.log(await generateBundle(dir,{development:true}));
    console.log(`Development preview only; no human approvals created.\nPrint: ${dir}\nOpen Studio with npm run studio`);
  } else if(command==='generate')console.log(await generateBundle(dir));
  else if(command==='check-path')console.log(JSON.stringify(await checkPathBundle(dir),null,2));
  else if(command==='check') {
    const state=await loadBundle(dir);
    if(state.programError)throw new Error(state.programError);
    console.log(JSON.stringify({revision:state.revision,summary:state.program?.summary??null,geometryApproved:state.geometryApproved,planApproved:state.planApproved,toolpathApproved:state.toolpathApproved,limitations:state.limitations},null,2));
  } else if(command==='deliver')console.log(await deliver(dir));
  else console.log('Usage: node skills/wedge-demo/scripts/cli.mjs init|demo [print-directory] [--machine <machine-id>]\n       node skills/wedge-demo/scripts/cli.mjs generate|check|check-path|deliver|upgrade|remember-setup [print-directory]\n       node skills/wedge-demo/scripts/cli.mjs adjust <print-directory> <patch.json> [--revision <revision>]');
} catch(error){console.error(error.message);process.exitCode=1;}
