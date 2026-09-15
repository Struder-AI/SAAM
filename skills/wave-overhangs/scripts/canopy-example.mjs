import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {referencePatch} from '../../../core/geom/reference-surface.mjs';
import {offsetSurfaceRegion} from '../../../core/region/surface-offset.mjs';
import {regionArea} from '../../../core/region/region2d.mjs';

// A flat central knot span attaches to the entire top of the box. Simple
// internal knots keep the surrounding tensor-product cubic surface C2.
export function canopyExamplePlan(machine=loadMachine(),progress=()=>{}){
  const plan=defaults(machine),knots=[0,0,0,0,.1,.2,.3,.4,.6,.7,.8,.9,1,1,1,1];
  const greville=Array.from({length:12},(_,i)=>(knots[i+1]+knots[i+2]+knots[i+3])/3);
  const z=[0,3.5,-3.5,0,0,0,0,0,0,3.5,-3.5,0];
  const halfWidth=plan.process.lineWidthMm/2,boxWidth=24+plan.process.lineWidthMm;
  const surface={degreeU:3,degreeV:3,knotsU:knots,knotsV:knots,
    controlPoints:greville.map((u,i)=>greville.map((v,j)=>[120*u-48+halfWidth,120*v-48+halfWidth,10+z[i]+z[j]]))};
  const patch=referencePatch(surface),seedUv=[[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]];
  const chart=[[[0,0],[1,0],[1,1],[0,1]]];
  let domainUv=seedUv;
  // Use a constant surface-distance outline, producing a rounded canopy.
  // The half-spacing margin lets the last complete ring end before the rim.
  for(let i=0;i<111;i++){
    domainUv=offsetSurfaceRegion(patch,domainUv,i===110?.15:.3,{
      toleranceMm:.01,maxStepMm:.3,precisionUv:1e-10,maxEvaluations:2000000,
      constraintLoopsUv:chart}).loopsUv;
    if(i%10===0)progress({outlineStep:i+1,total:111});
  }
  // The designed canopy has one exterior and no holes. Offset-union rounding
  // can leave microscopic internal loops; those do not define this outline.
  domainUv=[domainUv.reduce((a,b)=>Math.abs(regionArea([a]))>Math.abs(regionArea([b]))?a:b)];
  plan.geometry={shape:'box',runMm:boxWidth,widthMm:boxWidth,heightMm:10};
  plan.skills['draped-skin'].enabled=false;
  plan.skills['wave-overhangs']={...plan.skills['wave-overhangs'],enabled:true,
    lineSpacingMm:.3,propagationStepMm:.3,maxEvaluations:20000000,
    slices:[{id:'four-sided-canopy',reason:'The central 24 × 24 mm spline plateau follows the box top perimeter centerline at Z=10, accounting for half a bead at each box edge. Grow a rounded, wavy canopy about 33 mm beyond every side in one continuous slice.',
      surface,domainUv,seedUv,afterParts:[null],beforeParts:[]}]};
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw new Error('Provide a new print directory for this development example.');
  const {initBundle,generateBundle,loadBundle}=await import('../../../core/print/bundle.mjs');
  const dir=resolve(process.argv[2]),plan=canopyExamplePlan(loadMachine(),p=>console.log(JSON.stringify(p)));
  await initBundle(dir,plan);
  const result=await generateBundle(dir,{development:true}),state=await loadBundle(dir);
  console.log(JSON.stringify({directory:dir,mode:result.mode,waves:state.pathSummary.waveOverhangs.map(r=>({waves:r.waves,passes:r.continuity.passes,evaluations:r.evaluations,points:r.points}))},null,2));
}
