// Publication compacts generated fields once, independent of their producer.
// Exact endpoints and zero-material intervals survive; every approximation is
// bounded over complete source intervals, rather than checked only at samples.
import {interpolateDirection,DIRECTION_TOLERANCE} from '../geom/frame.mjs';
import {restrictBezierLine} from '../geom/bezier-net.mjs';
import {keyed,profileAt,prepareMaterialProfile,materialProfileDeviation} from './curve-profiles.mjs';
import {FLOAT64_EPSILON} from '../dimensions.mjs';

function indexAt(knots,u){
  const state={lo:0,hi:knots.length-1};
  while(state.hi-state.lo>1){const mid=Math.floor((state.lo+state.hi)/2);if(knots[mid][0]<=u)state.lo=mid;else state.hi=mid;}
  return state.lo;
}
function directionAngle(a,b){
  const sine=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
  return Math.atan2(sine,a.reduce((sum,value,k)=>sum+value*b[k],0));
}
function directionProof(profile,first,last,tolerance){
  if(last===first+1)return 0;
  const [a,x]=profile.knots[first],[b,y]=profile.knots[last],maximum={angle:0};
  const candidate=u=>interpolateDirection(x,y,(u-a)/(b-a));
  function check(lo,hi,p,q){
    const middle=(lo+hi)/2,r=profileAt(profile,middle),error=directionAngle(r,candidate(middle));
    const bound=error+(directionAngle(p,q)+directionAngle(candidate(lo),candidate(hi)))/2;
    if(bound<=tolerance){maximum.angle=Math.max(maximum.angle,bound);return true;}
    if(error>tolerance||!(middle>lo&&middle<hi))return false;
    return check(lo,middle,p,r)&&check(middle,hi,r,q);
  }
  for(let i=first;i<last;i++)if(!check(profile.knots[i][0],profile.knots[i+1][0],profile.knots[i][1],profile.knots[i+1][1]))return null;
  return maximum.angle;
}
function compactDirection(profile,tolerance){
  if(!keyed(profile)||profile.knots.length<=2)return {profile,error:0};
  const kept=[profile.knots[0]],maximum={error:0};
  function visit(first,last){
    if(last===first+1){kept.push(profile.knots[last]);return;}
    const [a,x]=profile.knots[first],[b,y]=profile.knots[last],worst={error:0,index:-1};
    if(directionAngle(x,y)>=Math.PI-DIRECTION_TOLERANCE){const middle=Math.floor((first+last)/2);visit(first,middle);visit(middle,last);return;}
    for(let i=first+1;i<last;i++){
      const [u,value]=profile.knots[i],error=directionAngle(value,interpolateDirection(x,y,(u-a)/(b-a)));
      if(error>worst.error){worst.error=error;worst.index=i;}
    }
    if(worst.error<=tolerance/2){
      const proof=directionProof(profile,first,last,tolerance);
      if(proof!==null){kept.push(profile.knots[last]);maximum.error=Math.max(maximum.error,proof);return;}
    }
    const cut=worst.index>first?worst.index:Math.floor((first+last)/2);
    visit(first,cut);visit(cut,last);
  }
  visit(0,profile.knots.length-1);
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
function materialValue(material,u){
  if(u===1)return material.knots.at(-1)[1];
  const i=indexAt(material.knots,u),span=material.intervals[i],t=(u-span.from)/(span.to-span.from),[a,b,c]=span.coefficients.map(row=>row[0]);
  return material.knots[i][1]+(span.to-span.from)*(a*t+(b-a)*t*t+(a-2*b+c)*t*t*t/3);
}
function materialDifference(original,candidate,span){
  const selected=candidate.intervals[indexAt(candidate.knots,span.from)],width=span.to-span.from;
  const rates=restrictBezierLine(selected.coefficients,[(span.from-selected.from)/(selected.to-selected.from),(span.to-selected.from)/(selected.to-selected.from)]);
  const state={value:original.knots[indexAt(original.knots,span.from)][1]-materialValue(candidate,span.from),bound:0};
  state.bound=Math.abs(state.value);
  for(let k=0;k<3;k++){state.value+=width*(span.coefficients[k][0]-rates[k][0])/3;state.bound=Math.max(state.bound,Math.abs(state.value));}
  return state.bound+FLOAT64_EPSILON*32*Math.max(1,Math.abs(state.value),original.knots.at(-1)[1]);
}
function compactMaterial(profile,tolerance){
  if(profile.kind!=='cumulative'||profile.knots.length<=2)return {profile,error:0};
  if(profile.knots.at(-1)[1]===0)return {profile:{...profile,knots:[profile.knots[0],profile.knots.at(-1)]},error:0};
  const original=prepareMaterialProfile(profile),knots=profile.knots,selected=new Set([0,knots.length-1]);
  // A positive strand may not move into an explicitly empty interval, however
  // small its volume. Retain both ends and the adjacent slope witnesses.
  for(let i=1;i<knots.length;i++)if(knots[i][1]===knots[i-1][1]&&
    (i===1||i===knots.length-1||knots[i-2][1]!==knots[i-1][1]||knots[i+1][1]!==knots[i][1]))
    for(const index of [i-2,i-1,i,i+1])if(index>=0&&index<knots.length)selected.add(index);
  function choose(first,last){
    if(last===first+1)return;
    if(materialProfileDeviation(original,knots[first][0],knots[last][0])<=tolerance/4)return;
    const middle=Math.floor((first+last)/2);selected.add(middle);choose(first,middle);choose(middle,last);
  }
  const mandatory=[...selected].sort((a,b)=>a-b);
  for(let i=1;i<mandatory.length;i++)choose(mandatory[i-1],mandatory[i]);
  for(;;){
    if(selected.size===knots.length)return {profile,error:0};
    const indices=[...selected].sort((a,b)=>a-b),candidate={...profile,knots:indices.map(index=>knots[index])};
    const prepared=prepareMaterialProfile(candidate),additions=new Set(),maximum={error:0};
    for(const [i,span] of original.intervals.entries()){
      const error=materialDifference(original,prepared,span);maximum.error=Math.max(maximum.error,error);
      if(error>tolerance)for(const index of [i-1,i,i+1,i+2])if(index>=0&&index<knots.length&&!selected.has(index))additions.add(index);
    }
    if(!additions.size)return maximum.error<=tolerance?{profile:candidate,error:maximum.error}:{profile,error:0};
    for(const index of additions)selected.add(index);
  }
}
// Retaining a native chart changes the source parameter. Compare the two C1
// material laws at corresponding locations on every original edge; normalized
// cumulative differences are cubic Bezier polynomials with these four bounds.
export function materialParameterError(before,after){
  const a=prepareMaterialProfile(before),b=prepareMaterialProfile(after),maximum={error:0};
  for(let i=0;i<a.intervals.length;i++){
    const x=a.intervals[i],y=b.intervals[i],state={difference:a.knots[i][1]-b.knots[i][1]};
    maximum.error=Math.max(maximum.error,Math.abs(state.difference));
    for(let k=0;k<3;k++){
      state.difference+=((x.to-x.from)*x.coefficients[k][0]-(y.to-y.from)*y.coefficients[k][0])/3;
      maximum.error=Math.max(maximum.error,Math.abs(state.difference));
    }
  }
  return maximum.error;
}
export function compactCurveProfiles(profiles,{normalToleranceRad,volumeToleranceMm3}){
  const normals=compactDirection(profiles.materialNormal,normalToleranceRad),material=compactMaterial(profiles.material,volumeToleranceMm3);
  return {profiles:{...profiles,widthMm:compactScalar(profiles.widthMm),speedMmS:compactScalar(profiles.speedMmS),
    materialNormal:normals.profile,material:material.profile},normalErrorRad:normals.error,volumeErrorMm3:material.error};
}
