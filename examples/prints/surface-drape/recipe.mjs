import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
export function surfaceDrapePlan(){
const plan=defaults(loadMachine('ultimaker-s5'));
plan.geometry={shape:'spline-top',runMm:60,widthMm:45,cpU:7,cpV:5,heightsMm:Array.from({length:7},(_,i)=>Array.from({length:5},(_,j)=>Number((8+2*Math.sin(2*Math.PI*i/6)*Math.sin(Math.PI*j/4)).toFixed(5))))};
plan.placement={xMm:135,yMm:95};
Object.assign(plan.skills['planar-infill'],{enabled:true,pattern:'gyroid',density:0.25,perimeters:3});
Object.assign(plan.skills['full-fill'],{mode:'solid-surfaces',bottomLayers:4,topLayers:4});
Object.assign(plan.skills['draped-skin'],{layers:3,normalMm:0.2,strokeAngleDeg:0,sampleStepMm:0.4,surveyStepMm:0.4});
return plan;
}
