import {resolve} from 'node:path';
import {initBundle,proposedPlan} from '../../../core/print/bundle.mjs';
import {staggeredWeldSites} from './weld.mjs';
// A box is six flat patches, each a 2 × 2 net of shared corners (GEOMETRY.md).
const splineBox=({runMm:x,widthMm:y,heightMm:z})=>{
  const face=(name,a,b,c,d)=>({name,degreeU:1,degreeV:1,controlPoints:[[a,b],[c,d]]});
  return {shape:'spline',patches:[face('top',[0,0,z],[0,y,z],[x,0,z],[x,y,z]),face('bottom',[0,0,0],[0,y,0],[x,0,0],[x,y,0]),
    face('front',[0,0,0],[0,0,z],[x,0,0],[x,0,z]),face('right',[x,0,0],[x,0,z],[x,y,0],[x,y,z]),
    face('back',[0,y,0],[0,y,z],[x,y,0],[x,y,z]),face('left',[0,0,0],[0,0,z],[0,y,0],[0,y,z])]};
};
const [directory,...flags]=process.argv.slice(2);
if(!directory||flags.some(f=>f!=='--sparse'))throw new Error('Use example.mjs <new-print-directory> [--sparse].');
const plan=await proposedPlan('ultimaker-s5');
plan.geometry=splineBox({runMm:24,widthMm:16,heightMm:9});
plan.skills['draped-skin'].enabled=false;
if(flags.includes('--sparse')){plan.skills['full-fill'].enabled=false;plan.skills['planar-infill'].enabled=true;}
plan.skills['plastic-weld'].enabled=true;
plan.skills['plastic-weld'].sites=staggeredWeldSites({columns:1,rows:1,levels:2,pitchMm:12,xMm:6,yMm:8});
await initBundle(resolve(directory),plan,{machineId:'ultimaker-s5'});
console.log('Created unapproved plastic-weld coupon: '+resolve(directory));
