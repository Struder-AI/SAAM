import {developmentPipePlan,tubeSurface,splineTube} from './demo.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function bumpyPlan(){
  const plan=developmentPipePlan(),columns=16;
  // Fixed pseudo-random phases make regeneration/review deterministic.
  let seed=20260910;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const phase=[random(),random(),random()].map(x=>2*Math.PI*x);
  // Radial end controls hold still near both ends, for a level normal-offset
  // edge at the bed.
  const radiusAt=(angle,v)=>{const t=v<.1?0:v>.9?1:v;
    return 13.40+2.34*Math.sin(2*angle+phase[0]+2.8*t)+1.00*Math.cos(3*angle+phase[1]-4*t)+.445*Math.sin(angle+phase[2]+6*t);};
  plan.geometry=splineTube({columns,rows:8,heightMm:32,boreRadiusMm:8,radiusAt});
  plan.skills['full-fill'].perimeters=3;plan.skills['full-fill'].fillOverlap=.15;
  Object.assign(plan.skills['pipe-cladding'],{shells:6,sampleStepMm:.65,toleranceMm:.01,surface:tubeSurface(columns)});
  return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directory=resolve(process.argv[2]??'Prints/development/denso-bumpy-spline');
  await initBundle(directory,bumpyPlan(),{machineId:'denso-vs068a4-rc8a'});
  console.log('Created bumpy spline geometry: '+directory);
  const checks=await generateBundle(directory,{development:true});console.log(JSON.stringify(checks,null,2));
}
