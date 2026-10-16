// A radial profile becomes ordinary rational geometry in an arbitrary frame.
// The authored surfaces retain exact circular cross-sections and linear axial
// intervals; callers choose dimensions without knowing knots or control weights.
import {rodFrame,point} from './frame.mjs';
import {requireThat} from './tolerance.mjs';

const circle=[[1,0,1],[1,1,Math.SQRT1_2],[0,1,1],[-1,1,Math.SQRT1_2],[-1,0,1],[-1,-1,Math.SQRT1_2],[0,-1,1],[1,-1,Math.SQRT1_2],[1,0,1]];
const circleKnots=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1];

export function revolvedProfile({positionMm,axis,profile}){
  requireThat(Array.isArray(positionMm)&&positionMm.length===3&&positionMm.every(Number.isFinite),'Revolution positionMm needs finite XYZ.');
  requireThat(Array.isArray(axis)&&axis.length===3&&axis.every(Number.isFinite)&&Math.hypot(...axis)>0,'Revolution axis needs a nonzero finite direction.');
  requireThat(Array.isArray(profile)&&profile.length>=2&&profile.every((entry,i)=>Array.isArray(entry)&&entry.length===2&&entry.every(Number.isFinite)&&entry[1]>0&&(!i||entry[0]>profile[i-1][0])),
    'Revolution profile needs increasing [axialMm, radiusMm] pairs with positive radii.');
  const length=Math.hypot(...axis),frame=rodFrame(positionMm,positionMm.map((v,k)=>v+axis[k]/length));
  const control=(x,y,s,r,w)=>[...point(frame,[x*r,y*r,s]),w];
  const cap=(name,[s,r])=>({name,degreeU:2,degreeV:1,knotsU:[...circleKnots],
    controlPoints:circle.map(([x,y,w])=>[control(x,y,s,0,w),control(x,y,s,r,w)])});
  return {shape:'spline',patches:[
    {name:'revolution-side',degreeU:2,degreeV:1,knotsU:[...circleKnots],
      controlPoints:circle.map(([x,y,w])=>profile.map(([s,r])=>control(x,y,s,r,w)))},
    cap('revolution-start',profile[0]),cap('revolution-end',profile.at(-1))
  ]};
}
