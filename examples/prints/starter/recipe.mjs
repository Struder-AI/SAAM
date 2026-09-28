import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
// A box is six flat patches, each a 2 × 2 net of shared corners (GEOMETRY.md).
const splineBox=({runMm:x,widthMm:y,heightMm:z})=>{
  const face=(name,a,b,c,d)=>({name,degreeU:1,degreeV:1,controlPoints:[[a,b],[c,d]]});
  return {shape:'spline',patches:[face('top',[0,0,z],[0,y,z],[x,0,z],[x,y,z]),face('bottom',[0,0,0],[0,y,0],[x,0,0],[x,y,0]),
    face('front',[0,0,0],[0,0,z],[x,0,0],[x,0,z]),face('right',[x,0,0],[x,0,z],[x,y,0],[x,y,z]),
    face('back',[0,y,0],[0,y,z],[x,y,0],[x,y,z]),face('left',[0,0,0],[0,0,z],[0,y,0],[0,y,z])]};
};
const block=(runMm,widthMm,heightMm)=>splineBox({runMm,widthMm,heightMm});
export function starterPlan(){
  const plan=defaults(loadMachine('ultimaker-s5'));
  plan.geometry={shape:'assembly',parts:[
    {id:'base',xMm:0,yMm:0,zMm:0,geometry:block(48,32,4)},
    {id:'fin',xMm:6,yMm:12,zMm:4,geometry:block(36,8,10)}
  ]};
  plan.placement={xMm:130,yMm:100};
  plan.skills['draped-skin'].enabled=false;
  // The default slice assignment is the normal case: 2 loops, 20% fill, 3 solid layers top and bottom.
  return plan;
}
