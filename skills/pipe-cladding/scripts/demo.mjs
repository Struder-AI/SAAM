// Explicit development setup; never remembered as an installation calibration.
import {claddingAssignment} from '../../../core/print/cladding-constructions.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {clampedKnots} from '../../../core/geom/spline-solid.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// A tube written as four spline patches that share one periodic cubic basis
// around the axis: the exterior, the bore and the two annular ends ruled
// between them. radiusAt(angle, t) gives the exterior control radius at
// height fraction t on a clamped cubic grid of `rows` controls (linear when
// rows is 2). Uniform cubic B-splines sit slightly inside their control
// circle, so control radii are scaled to put the curve's knots on the radius.
export function splineTube({columns,rows=2,heightMm,boreRadiusMm,radiusAt}){
  const degreeV=Math.min(3,rows-1),vKnots=clampedKnots(rows,degreeV);
  const grevilleV=j=>vKnots.slice(j+1,j+degreeV+1).reduce((a,b)=>a+b,0)/degreeV;
  const onCurve=(4+2*Math.cos(2*Math.PI/columns))/6;
  const ring=(radius,z,i)=>{const a=2*Math.PI*(i%columns)/columns,r=radius/onCurve;return [r*Math.cos(a),r*Math.sin(a),z];};
  const around=Array.from({length:columns+3},(_,i)=>i);
  const knotsU=Array.from({length:columns+7},(_,i)=>i-3);
  const outer=around.map(i=>Array.from({length:rows},(_,j)=>ring(radiusAt(2*Math.PI*(i%columns)/columns,grevilleV(j)),heightMm*grevilleV(j),i)));
  const bore=around.map(i=>[ring(boreRadiusMm,0,i),ring(boreRadiusMm,heightMm,i)]);
  return {shape:'spline',patches:[
    {name:'outer',degreeU:3,degreeV,knotsU,controlPoints:outer},
    {name:'bore',degreeU:3,degreeV:1,knotsU,controlPoints:bore},
    {name:'bottom',degreeU:3,degreeV:1,knotsU,controlPoints:around.map((i,k)=>[bore[k][0],outer[k][0]])},
    {name:'top',degreeU:3,degreeV:1,knotsU,controlPoints:around.map((i,k)=>[bore[k][1],outer[k][rows-1]])}]};
}

// The exterior patch, over its whole periodic domain, is the clad surface.
export const tubeSurface=columns=>({kind:'spline',patch:'outer',periodicU:true,normalSide:1,uvBounds:[[0,columns],[0,1]]});

export function developmentPipePlan(machine=loadMachine('denso-vs068a4-rc8a')){
  const plan=defaults(machine),columns=24;
  plan.geometry=splineTube({columns,heightMm:12,boreRadiusMm:8,radiusAt:()=>10.4});
  plan.placement={xMm:0,yMm:0};
  plan.slices.assignments.push(claddingAssignment({id:'pipe-cladding',surface:tubeSurface(columns)}));
  plan.setup.nozzleC=210;plan.process.skinSpeedMmS=8;
  Object.assign(plan.setup.denso,{configurationSource:'SYNTHETIC DEVELOPMENT FIXTURE. Not calibration of the user installation.',toolFrame:1,workFrame:1,armGroup:1,figure:1,
    extrusionOutput:64,extrusionRateMm3S:0.64,rotaryInterface:'rc8a-relative-ex'});
  return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const directory=resolve(process.argv[2]??'Prints/development/denso-rc8a-pipe');
  await initBundle(directory,developmentPipePlan(),{machineId:'denso-vs068a4-rc8a'});
  const checks=await generateBundle(directory,{development:true});
  console.log(JSON.stringify({directory,moves:checks.moves,minutes:checks.estimatedMinutes,mode:checks.mode,note:'Synthetic setup, no approvals, no hardware execution.'},null,2));
}
