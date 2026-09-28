import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {splineBox} from '../../../core/geom/spline-solid.mjs';
const block=(runMm,widthMm,heightMm)=>splineBox({runMm,widthMm,heightMm});
export function starterPlan(){
  const plan=defaults(loadMachine('ultimaker-s5'));
  plan.geometry={shape:'assembly',parts:[
    {id:'base',xMm:0,yMm:0,zMm:0,geometry:block(48,32,4)},
    {id:'fin',xMm:6,yMm:12,zMm:4,geometry:block(36,8,10)}
  ]};
  plan.placement={xMm:130,yMm:100};
  plan.skills['draped-skin'].enabled=false;
  Object.assign(plan.skills['planar-infill'],{enabled:true,pattern:'rectilinear',density:.2,perimeters:2});
  Object.assign(plan.skills['full-fill'],{mode:'solid-surfaces',bottomLayers:3,topLayers:3});
  return plan;
}
