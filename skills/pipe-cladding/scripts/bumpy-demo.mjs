import {developmentPipePlan} from './demo.mjs';
import {clampedKnots} from '../../../core/geom/spline-tube.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function bumpyPlan(){
  const plan=developmentPipePlan(),nu=16,nv=8,height=32,knots=clampedKnots(nv,3);
  // Fixed pseudo-random phases make regeneration/review deterministic.
  let seed=20260910;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const phase=[random(),random(),random()].map(x=>2*Math.PI*x);
  const controlPoints=Array.from({length:nu},(_,i)=>Array.from({length:nv},(_,j)=>{
    const angle=2*Math.PI*i/nu,v=(knots[j+1]+knots[j+2]+knots[j+3])/3;
    // Repeat radial end controls to give a level normal-offset edge at the bed.
    const t=j<2?0:j>nv-3?1:v;
    const r=13.40+2.34*Math.sin(2*angle+phase[0]+2.8*t)+1.00*Math.cos(3*angle+phase[1]-4*t)+.445*Math.sin(angle+phase[2]+6*t);
    return [r*Math.cos(angle),r*Math.sin(angle),height*v];
  }));
  plan.geometry={shape:'spline-tube',innerRadiusMm:8,heightMm:height,controlPoints};
  plan.skills['full-fill'].perimeters=3;plan.skills['full-fill'].fillOverlap=.15;
  Object.assign(plan.skills['pipe-cladding'],{shells:6,sampleStepMm:.65,toleranceMm:.01,maxPoints:500000,
    surface:{kind:'spline',patch:'outer',periodicU:true,normalSide:1,uvBounds:[[0,16],[0,1]]}});
  return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directory=resolve(process.argv[2]??'Prints/development/denso-bumpy-spline');
  await initBundle(directory,bumpyPlan(),{machineId:'denso-vp6242-rc8'});
  console.log('Created bumpy spline geometry: '+directory);
  const checks=await generateBundle(directory,{development:true});console.log(JSON.stringify(checks,null,2));
}
