import {resolve} from 'node:path';
import {initBundle,proposedPlan,generateBundle,loadBundle} from '../../../core/print/bundle.mjs';
import {applyHeatSet} from '../../../core/print/heat-set.mjs';
// A box is six flat patches, each a 2 × 2 net of shared corners (GEOMETRY.md).
const splineBox=({runMm:x,widthMm:y,heightMm:z})=>{
  const face=(name,a,b,c,d)=>({name,degreeU:1,degreeV:1,controlPoints:[[a,b],[c,d]]});
  return {shape:'spline',patches:[face('top',[0,0,z],[0,y,z],[x,0,z],[x,y,z]),face('bottom',[0,0,0],[0,y,0],[x,0,0],[x,y,0]),
    face('front',[0,0,0],[0,0,z],[x,0,0],[x,0,z]),face('right',[x,0,0],[x,0,z],[x,y,0],[x,y,z]),
    face('back',[0,y,0],[0,y,z],[x,y,0],[x,y,z]),face('left',[0,0,0],[0,0,z],[0,y,0],[0,y,z])]};
};

const directory=resolve(process.argv[2]??'Prints/development/heat-set-inserts');
const plan=await proposedPlan('ultimaker-s5');
plan.geometry=splineBox({runMm:54,widthMm:32,heightMm:12});
plan.placement={xMm:80,yMm:80};
plan.skills['draped-skin'].enabled=false;
Object.assign(plan.slices.assignments[0],{loops:2,fillDensity:0.15});
await initBundle(directory,plan,{machineId:'ultimaker-s5'});
await applyHeatSet(directory,{feature:{id:'metric',insertId:'spirol-29-m3-long',positionMm:[14,16,12]}});
await applyHeatSet(directory,{feature:{id:'imperial',insertId:'spirol-19-4-40-short',positionMm:[40,16,12]}});
const checks=await generateBundle(directory,{development:true});
const state=await loadBundle(directory);
console.log(JSON.stringify({directory,checks,toolpathApproved:state.toolpathApproved},null,2));
