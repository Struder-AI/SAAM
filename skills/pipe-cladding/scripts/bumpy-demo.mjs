import {developmentPipePlan,tubeSurface,splineTube} from './demo.mjs';

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
  Object.assign(plan.slices.assignments[0],{loops:3,fillDensity:1});
  const coating=plan.slices.assignments.find(a=>a.stack?.direction==='normal');
  Object.assign(coating,{within:[{kind:'normal-band',fromMm:0,toMm:1.2}],sampleStepMm:.65,fillOrder:{...coating.fillOrder,toleranceMm:.01},surface:tubeSurface(columns)});
  return plan;
}
