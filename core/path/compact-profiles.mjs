// Publication compacts generated fields once, independent of their producer.
// Exact endpoints and zero-material intervals survive; every approximation is
// bounded over complete source intervals, rather than checked only at samples.
import {interpolateDirection,prepareDirectionInterpolation,directionInterpolationError,DIRECTION_TOLERANCE} from '../geom/frame.mjs';
import {keyed,profileAt} from './curve-profiles.mjs';

function directionAngle(a,b){
  const sine=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
  return Math.atan2(sine,a.reduce((sum,value,k)=>sum+value*b[k],0));
}
function directionProof(profile,first,last,tolerance,prepared){
  if(last===first+1)return 0;
  const [a,x]=profile.knots[first],[b,y]=profile.knots[last],maximum={angle:0};
  const candidate=u=>interpolateDirection(x,y,(u-a)/(b-a),prepared);
  function check(lo,hi,p,q,sourceAngle){
    const left=candidate(lo),right=candidate(hi),candidateAngle=prepared.angle*(hi-lo)/(b-a);
    const chordBound=directionInterpolationError(p,q,left,right,sourceAngle,candidateAngle);
    if(chordBound<=tolerance){maximum.angle=Math.max(maximum.angle,chordBound);return true;}
    const middle=(lo+hi)/2,r=profileAt(profile,middle),error=directionAngle(r,candidate(middle));
    if(error>tolerance||!(middle>lo&&middle<hi))return false;
    return check(lo,middle,p,r,sourceAngle/2)&&check(middle,hi,r,q,sourceAngle/2);
  }
  for(let i=first;i<last;i++)if(!check(profile.knots[i][0],profile.knots[i+1][0],profile.knots[i][1],profile.knots[i+1][1],
    prepareDirectionInterpolation(profile.knots[i][1],profile.knots[i+1][1]).angle))return null;
  return maximum.angle;
}
function compactDirection(profile,tolerance){
  if(!keyed(profile)||profile.knots.length<=2)return {profile,error:0};
  const kept=[profile.knots[0]],maximum={error:0},pending=[[0,profile.knots.length-1]];
  while(pending.length){
    const [first,last]=pending.pop();
    if(last===first+1){kept.push(profile.knots[last]);continue;}
    const [a,x]=profile.knots[first],[b,y]=profile.knots[last],worst={error:0,index:-1};
    if(directionAngle(x,y)>=Math.PI-DIRECTION_TOLERANCE){const middle=Math.floor((first+last)/2);pending.push([middle,last],[first,middle]);continue;}
    const prepared=prepareDirectionInterpolation(x,y);
    for(let i=first+1;i<last;i++){
      const [u,value]=profile.knots[i],error=directionAngle(value,interpolateDirection(x,y,(u-a)/(b-a),prepared));
      if(error>worst.error){worst.error=error;worst.index=i;}
    }
    if(worst.error<=tolerance/2){
      const proof=directionProof(profile,first,last,tolerance,prepared);
      if(proof!==null){kept.push(profile.knots[last]);maximum.error=Math.max(maximum.error,proof);continue;}
    }
    const cut=worst.index>first?worst.index:Math.floor((first+last)/2);
    pending.push([cut,last],[first,cut]);
  }
  const result=kept.length===2&&directionAngle(kept[0][1],kept[1][1])===0?kept[0][1]:{...profile,knots:kept};
  return {profile:result,error:maximum.error};
}
function compactScalar(profile){
  if(!keyed(profile)||profile.knots.length<=2)return profile;
  const kept=[profile.knots[0]];
  for(let i=1;i<profile.knots.length-1;i++){
    const [a,x]=kept.at(-1),[u,value]=profile.knots[i],[b,y]=profile.knots[i+1];
    if(profile.interpolation==='step'?x!==value:value!==x+(y-x)*(u-a)/(b-a))kept.push(profile.knots[i]);
  }
  kept.push(profile.knots.at(-1));
  return kept.every(([,value])=>value===kept[0][1])?kept[0][1]:{...profile,knots:kept};
}
export function compactCurveProfiles(profiles,{normalToleranceRad}){
    const normals=compactDirection(profiles.materialNormal,normalToleranceRad),axis=compactDirection(profiles.toolAxis,normalToleranceRad);
    return {profiles:{...profiles,rateMm3PerMm:compactScalar(profiles.rateMm3PerMm),aspectRatio:compactScalar(profiles.aspectRatio),
      speedMmS:compactScalar(profiles.speedMmS),materialNormal:normals.profile,toolAxis:axis.profile},normalErrorRad:Math.max(normals.error,axis.error),volumeErrorMm3:0};
}
