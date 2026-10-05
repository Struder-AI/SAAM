#!/usr/bin/env node
// Native installers report fixed stages (no paths, names or error text) through
// Application's consented diagnostics owner, and claim or complete an update's
// home tmp workspace:
//   installer-report.mjs <home> stage <stage> [--first-run]
//   installer-report.mjs <home> claim|complete <workspace> <token> [pid]
import {resolve} from 'node:path';
import {createDiagnosticReports} from '../core/application/diagnostics.mjs';
import {createInstalledReleaseService} from './release-service.mjs';
import {readInstance,controlRequest} from '../core/application/control.mjs';
import {claimTemporaryHandoff,completeTemporaryHandoff} from '../core/application/temporary-workspace.mjs';
const [home,action,value,...rest]=process.argv.slice(2);
if(!home)throw Error('Installer reporting requires the SAAM home.');
process.env.SAAM_DATA=resolve(home);
if(action==='claim')await claimTemporaryHandoff(value,rest[0],Number(rest[1]));
else if(action==='complete')await completeTemporaryHandoff(value,rest[0]);
else if(action==='stage'){
  if(!['failed','candidate-verified','starting','launch-requested'].includes(value))throw Error('Unknown installer diagnostic stage.');
  const event={kind:'installer',stage:value},options={firstRun:rest.includes('--first-run'),complete:value==='failed'};
  const instance=await readInstance().catch(()=>null);
  try{if(!instance)throw Error('No running SAAM.');await controlRequest(instance,{command:'record-diagnostic',event,options},{waitMs:3000});}
  catch{
    const reports=createDiagnosticReports({home});
    if(options.firstRun)await reports.firstRun(event,{complete:options.complete}).catch(()=>{});
    const service=await createInstalledReleaseService({reports});
    if(service){try{await service.recordDiagnostic(event);await service.flushDiagnostics();}finally{service.close();}}
  }
}else throw Error('Unknown installer reporting action.');
