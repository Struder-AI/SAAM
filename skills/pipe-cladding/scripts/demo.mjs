// Explicit development setup; never remembered as an installation calibration.
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function developmentPipePlan(machine=loadMachine('denso-vp6242-rc8')){
  const plan=defaults(machine);
  plan.geometry={shape:'pipe',innerRadiusMm:8,outerRadiusMm:10.4,heightMm:12,toleranceMm:0.01};
  plan.placement={xMm:0,yMm:0};plan.skills['draped-skin'].enabled=false;plan.skills['pipe-cladding'].enabled=true;
  plan.setup.nozzleC=210;plan.process.skinSpeedMmS=8;
  Object.assign(plan.setup.denso,{configurationSource:'SYNTHETIC DEVELOPMENT FIXTURE. Not calibration of the user installation.',toolFrame:1,workFrame:1,armGroup:1,figure:1,
    extrusionOutput:64,extrusionRateMm3S:0.64,rotaryInterface:'rc8-relative-ex'});
  return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directory=resolve(process.argv[2]??'Prints/development/denso-rc8-pipe');
  await initBundle(directory,developmentPipePlan(),{machineId:'denso-vp6242-rc8'});
  const checks=await generateBundle(directory,{development:true});
  console.log(JSON.stringify({directory,moves:checks.moves,minutes:checks.estimatedMinutes,mode:checks.mode,note:'Synthetic setup, no approvals, no hardware execution.'},null,2));
}
