// A radial profile becomes ordinary rational geometry in an arbitrary frame.
// The authored surfaces retain exact circular cross-sections and linear axial
// intervals; callers choose dimensions without knowing knots or control weights.
import {rodFrame,point} from './frame.mjs';
import {requireThat} from './tolerance.mjs';
import {loftProfiles} from './solid-profiles.mjs';

const circle=[[1,0,1],[1,1,Math.SQRT1_2],[0,1,1],[-1,1,Math.SQRT1_2],[-1,0,1],[-1,-1,Math.SQRT1_2],[0,-1,1],[1,-1,Math.SQRT1_2],[1,0,1]];
const circleKnots=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1];

export function revolvedProfile({positionMm,axis,profile}){
  requireThat(Array.isArray(positionMm)&&positionMm.length===3&&positionMm.every(Number.isFinite),'Revolution positionMm needs finite XYZ.');
  requireThat(Array.isArray(axis)&&axis.length===3&&axis.every(Number.isFinite)&&Math.hypot(...axis)>0,'Revolution axis needs a nonzero finite direction.');
  requireThat(Array.isArray(profile)&&profile.length>=2&&profile.every((entry,i)=>Array.isArray(entry)&&entry.length===2&&entry.every(Number.isFinite)&&entry[1]>0&&(!i||entry[0]>profile[i-1][0])),
    'Revolution profile needs increasing [axialMm, radiusMm] pairs with positive radii.');
  const length=Math.hypot(...axis),frame=rodFrame(positionMm,positionMm.map((v,k)=>v+axis[k]/length));
  const profiles=profile.map(([s,r])=>({degree:2,knots:[...circleKnots],controlPoints:circle.map(([x,y])=>point(frame,[x*r,y*r,s])),weights:circle.map(([, ,w])=>w)}));
  return loftProfiles({name:'revolution',profiles,centers:[point(frame,[0,0,profile[0][0]]),point(frame,[0,0,profile.at(-1)[0]])]});
}
