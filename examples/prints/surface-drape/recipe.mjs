import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {clampedKnots} from '../../../core/geom/spline-solid.mjs';
// A block whose cubic top follows a grid of control heights: top controls sit on
// the Greville abscissae so the footprint is exact, and each wall is ruled down
// from the top's boundary row, sharing its control points (GEOMETRY.md).
const splineBlock=({runMm,widthMm,heightsMm})=>{
  const nu=heightsMm.length,nv=heightsMm[0].length,pu=Math.min(3,nu-1),pv=Math.min(3,nv-1);
  const greville=(n,p)=>{const k=clampedKnots(n,p);return Array.from({length:n},(_,i)=>k.slice(i+1,i+p+1).reduce((a,b)=>a+b,0)/p);};
  const x=greville(nu,pu).map(g=>g*runMm),y=greville(nv,pv).map(g=>g*widthMm);
  const wall=(points,degree)=>({degreeU:degree,degreeV:1,controlPoints:points.map(([px,py,h])=>[[px,py,0],[px,py,h]])});
  return {shape:'spline',patches:[
    {name:'top',degreeU:pu,degreeV:pv,controlPoints:x.map((px,i)=>y.map((py,j)=>[px,py,heightsMm[i][j]]))},
    {name:'bottom',degreeU:1,degreeV:1,controlPoints:[[[0,0,0],[0,widthMm,0]],[[runMm,0,0],[runMm,widthMm,0]]]},
    {name:'front',...wall(x.map((px,i)=>[px,0,heightsMm[i][0]]),pu)},
    {name:'right',...wall(y.map((py,j)=>[runMm,py,heightsMm[nu-1][j]]),pv)},
    {name:'back',...wall(x.map((px,i)=>[px,widthMm,heightsMm[i][nv-1]]),pu)},
    {name:'left',...wall(y.map((py,j)=>[0,py,heightsMm[0][j]]),pv)}]};
};
export function surfaceDrapePlan(){
const plan=defaults(loadMachine('ultimaker-s5'));
// Transverse waves plus a linear 6 mm fall across Y. The Y heights follow
// the spline's Greville coordinates, so every valley has a downhill outlet.
const wave=[0,2,4,0,-4,-2,0],rise=[0,1,3,5,6];
plan.geometry=splineBlock({runMm:100,widthMm:60,heightsMm:wave.map(z=>rise.map(y=>10+z+y))});
plan.placement={xMm:135,yMm:95};
Object.assign(plan.skills['planar-infill'],{enabled:true,pattern:'gyroid',density:0.25,perimeters:3});
Object.assign(plan.skills['full-fill'],{mode:'solid-surfaces',bottomLayers:4,topLayers:4});
Object.assign(plan.skills['draped-skin'],{layers:3,normalMm:0.2,strokeAngleDeg:0,sampleStepMm:0.4,surveyStepMm:0.4});
return plan;
}
