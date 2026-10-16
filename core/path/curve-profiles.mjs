// Deposition channels on an immutable source parameter. Shape/frame mathematics
// belongs to Geometry; this module owns profile admission and side semantics.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {validatePose,interpolatePose} from './pose.mjs';
import {interpolateDirection,dot,DIRECTION_TOLERANCE} from '../geom/frame.mjs';
import {restrictBezierLine} from '../geom/bezier-net.mjs';
import {FLOAT64_EPSILON} from '../dimensions.mjs';

export const keyed=profile=>profile!==null&&typeof profile==='object'&&!Array.isArray(profile)&&Array.isArray(profile.knots);
export function profileInterval(profile,u,side='right'){
  const knots=profile.knots,index=keyIndex(knots,u,side);
  return [knots[index],knots[index+1]];
}
function keyIndex(knots,u,side){
  const state={lo:0,hi:knots.length-1};
  while(state.hi-state.lo>1){const mid=Math.floor((state.lo+state.hi)/2);if(knots[mid][0]<u||side==='right'&&knots[mid][0]===u)state.lo=mid;else state.hi=mid;}
  return state.lo;
}
export function interiorKeys(knots,from,to){
  const start=keyIndex(knots,from,'right')+1,end=keyIndex(knots,to,'left')+1;
  return knots.slice(start,end).filter(([u])=>u>from&&u<to);
}
export function validateKeys(knots,validate){
  requireThat(Array.isArray(knots)&&knots.length>=2&&knots[0][0]===0&&knots.at(-1)[0]===1,'Profile keys must cover [0,1].');
  for(const [i,key] of knots.entries()){
    requireThat(Array.isArray(key)&&key.length===2&&Number.isFinite(key[0])&&(!i||key[0]>knots[i-1][0]),'Profile parameters must strictly increase.');
    validate(key[1]);
  }
}
const scalar=value=>requireThat(Number.isFinite(value),'Profile value must be finite.');
const normal=value=>requireThat(Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)&&Math.abs(Math.hypot(...value)-1)<DIRECTION_TOLERANCE,'Material normal must be a unit vector.');
export function validateProfile(profile,channel){
  if(!keyed(profile)){validateValue(profile,channel);return;}
  const interpolation=channel==='pose'?'frame':channel==='materialNormal'?'slerp':null;
  requireThat(interpolation?profile.interpolation===interpolation:['step','linear'].includes(profile.interpolation),'Invalid profile interpolation.');
  validateKeys(profile.knots,value=>validateValue(value,channel));
  if(channel==='materialNormal')for(const [i,[,value]] of profile.knots.entries())if(i)
    requireThat(dot(value,profile.knots[i-1][1])>-1+DIRECTION_TOLERANCE**2,'Antipodal normals need an authored intermediate direction.');
}
function validateValue(value,channel){
  if(channel==='pose')validatePose(value);else if(channel==='materialNormal')normal(value);else scalar(value);
}
// Profile interpolation and local range estimates share finite scalar arithmetic.
export function interpolateScalar(x,y,t){
  if(t===0||x===y)return x;if(t===1)return y;
  const delta=y-x,value=Number.isFinite(delta)?x+delta*t:x*(1-t)+y*t;
  return Math.max(Math.min(x,y),Math.min(Math.max(x,y),value));
}
export function profileAt(profile,u,side='right'){
  if(!keyed(profile))return profile;
  const [[a,x],[b,y]]=profileInterval(profile,u,side),t=(u-a)/(b-a);
  if(profile.interpolation==='step')return u===1&&side!=='left'?y:x;
  if(profile.interpolation==='linear')return interpolateScalar(x,y,t);
  if(profile.interpolation==='frame')return interpolatePose(x,y,t);
  return interpolateDirection(x,y,t);
}
// Every traversal query is right-continuous at its start and inward at its end.
// Admission explicitly requests the outgoing endpoint when checking all values.
export function profileValues(profile,from,to,{endSide='left'}={}){
  if(!keyed(profile))return [profile];
  return [profileAt(profile,from),...interiorKeys(profile.knots,from,to).map(([,value])=>value),profileAt(profile,to,endSide)];
}
export function scalarRange(profile,from,to,options){
  const values=profileValues(profile,from,to,options);
  return values.reduce(([lo,hi],value)=>[Math.min(lo,value),Math.max(hi,value)],[Infinity,-Infinity]);
}

// Compile cumulative material once. Point density, interval density and partial
// volume all consume these authored interval rates, never tiny differences of
// independently evaluated accumulated totals. Area material uses the same field
// machinery with arc length as its measure instead of source parameter.
export function prepareMaterialProfile(material){
  if(!material)return null;
  if(material.kind==='area')return {measure:'length',density:material.areaMm2};
  requireThat(material.interpolation===undefined||['linear','monotone'].includes(material.interpolation),'Invalid cumulative material interpolation.');
  const intervals=material.knots.slice(1).map(([to,total],i)=>{
    const [from,previous]=material.knots[i],volumeMm3=total-previous,rate=volumeMm3/(to-from);
    requireThat(Number.isFinite(rate),'Authored material rate must be finite.');
    return {from,to,volumeMm3,rate};
  });
  for(const [i,span] of intervals.entries()){
    const a=material.interpolation==='monotone'?Math.min(span.rate,intervals[i-1]?.rate??span.rate):span.rate;
    const b=material.interpolation==='monotone'?Math.min(span.rate,intervals[i+1]?.rate??span.rate):span.rate;
    // Hermite volume endpoints and shared nonnegative slopes. Each endpoint
    // slope is at most this secant, so every derivative Bernstein control is
    // nonnegative. The primitive is monotone, C1, and retains every total.
    const middle=(span.rate-a)+(span.rate-b)+span.rate;
    requireThat(Number.isFinite(middle),'Material transition exceeds numerical rate precision.');
    span.coefficients=[[a],[middle],[b]];
  }
  return {measure:'parameter',knots:material.knots,intervals};
}
function materialInterval(material,u,side){return material.intervals[keyIndex(material.knots,u,side)];}
function restrictedRates(span,from,to){
  return restrictBezierLine(span.coefficients,[(from-span.from)/(span.to-span.from),(to-span.from)/(span.to-span.from)]).map(row=>row[0]);
}
export function materialProfileDensity(material,u,side='right'){
  if(material.measure==='length')return profileAt(material.density,u,side);
  const span=materialInterval(material,u,side),t=(u-span.from)/(span.to-span.from),[a,b,c]=span.coefficients.map(row=>row[0]);
  return interpolateScalar(interpolateScalar(a,b,t),interpolateScalar(b,c,t),t);
}
export function materialProfileRange(material,from,to){
  if(material.measure==='length')return scalarRange(material.density,from,to);
  const state={low:Infinity,high:-Infinity};
  for(let i=keyIndex(material.knots,from,'right');i<material.intervals.length;i++){
    const span=material.intervals[i];if(span.from>=to)break;
    const values=restrictedRates(span,Math.max(from,span.from),Math.min(to,span.to));
    const guard=values.every(value=>value===values[0])?0:FLOAT64_EPSILON*8*Math.max(...values.map(Math.abs));
    state.low=Math.min(state.low,Math.max(0,Math.min(...values)-guard));state.high=Math.max(state.high,Math.max(...values)+guard);
  }
  return [state.low,state.high];
}
export function materialProfileVolume(material,from,to){
  const sum={value:0,remainder:0};
  const first=keyIndex(material.knots,from,'right');
  for(let i=first;i<material.intervals.length;i++){
    const span=material.intervals[i];if(span.from>=to)break;
    const a=Math.max(from,span.from),b=Math.min(to,span.to);
    const values=restrictedRates(span,a,b),mean=interpolateScalar(interpolateScalar(values[0],values[2],.5),values[1],1/3);
    const volume=a===span.from&&b===span.to?span.volumeMm3:mean*(b-a);
    const adjusted=volume-sum.remainder,next=sum.value+adjusted;
    sum.remainder=(next-sum.value)-adjusted;sum.value=next;
  }
  return sum.value;
}
