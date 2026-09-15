import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
export function surfaceDrapePlan(){
const plan=defaults(loadMachine('ultimaker-s5'));
// Transverse waves plus a linear 6 mm fall across Y. The Y heights follow
// the spline's Greville coordinates, so every valley has a downhill outlet.
const wave=[0,2,4,0,-4,-2,0],rise=[0,1,3,5,6];
plan.geometry={shape:'spline-top',runMm:100,widthMm:60,cpU:7,cpV:5,heightsMm:wave.map(z=>rise.map(y=>10+z+y))};
plan.placement={xMm:135,yMm:95};
Object.assign(plan.skills['planar-infill'],{enabled:true,pattern:'gyroid',density:0.25,perimeters:3});
Object.assign(plan.skills['full-fill'],{mode:'solid-surfaces',bottomLayers:4,topLayers:4});
Object.assign(plan.skills['draped-skin'],{layers:3,normalMm:0.2,strokeAngleDeg:0,sampleStepMm:0.4,surveyStepMm:0.4});
return plan;
}
