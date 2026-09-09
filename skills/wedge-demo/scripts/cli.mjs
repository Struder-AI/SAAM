import { resolve } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { initBundle, generateBundle, loadBundle, deliver, root, adjustBundle, upgradeBundle, rememberSetup } from './bundle.mjs';

const [command='help',arg,patchFile]=process.argv.slice(2);
const dir=resolve(arg??resolve(root,'Prints/s5-wedge-demo'));
try {
  if(command==='init')console.log(await initBundle(dir));
  else if(command==='upgrade'){await upgradeBundle(dir);console.log('Bundle upgraded. Settings and toolpath require confirmation again.');}
  else if(command==='adjust') {
    if(!patchFile)throw new Error('Supply a JSON patch file after the print directory.');
    const state=await adjustBundle(dir,JSON.parse(await readFile(resolve(patchFile),'utf8')));
    console.log(JSON.stringify({revision:state.revision,plan:state.plan},null,2));
  }
  else if(command==='remember-setup')console.log(await rememberSetup(dir));
  else if(command==='demo') {
    try{await access(resolve(dir,'plan.json'));}catch{await initBundle(dir);}
    console.log(await generateBundle(dir,{development:true}));
    console.log(`Development preview only; no human approvals created.\nPrint: ${dir}\nOpen Studio with npm run studio`);
  } else if(command==='generate')console.log(await generateBundle(dir));
  else if(command==='check') {
    const state=await loadBundle(dir);
    if(state.programError)throw new Error(state.programError);
    if(!state.program)throw new Error('No generated program.');
    console.log(JSON.stringify({summary:state.program.summary,geometryApproved:state.geometryApproved,planApproved:state.planApproved,toolpathApproved:state.toolpathApproved,limitations:state.limitations},null,2));
  } else if(command==='deliver')console.log(await deliver(dir));
  else console.log('Usage: node skills/wedge-demo/scripts/cli.mjs init|demo|generate|check|deliver|upgrade|remember-setup [print-directory]\n       node skills/wedge-demo/scripts/cli.mjs adjust <print-directory> <patch.json>');
} catch(error){console.error(error.message);process.exitCode=1;}
