// Deposition channels on an immutable source parameter. Shape/frame mathematics
// belongs to Geometry; this module owns profile admission and side semantics.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {validatePose,interpolatePose} from './pose.mjs';
import {unitDirection,dot,DIRECTION_TOLERANCE} from '../geom/frame.mjs';

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
export function profileAt(profile,u,side='right'){
  if(!keyed(profile))return profile;
  const [[a,x],[b,y]]=profileInterval(profile,u,side),t=(u-a)/(b-a);
  if(profile.interpolation==='step')return u===1&&side!=='left'?y:x;
  if(profile.interpolation==='linear')return x+(y-x)*t;
  if(profile.interpolation==='frame')return interpolatePose(x,y,t);
  const angle=Math.acos(Math.max(-1,Math.min(1,dot(x,y))));
  if(angle<DIRECTION_TOLERANCE)return unitDirection(x.map((v,i)=>v+(y[i]-v)*t));
  return x.map((v,i)=>(v*Math.sin((1-t)*angle)+y[i]*Math.sin(t*angle))/Math.sin(angle));
}
export function profileValues(profile,from,to){
  if(!keyed(profile))return [profile];
  return [profileAt(profile,from),...interiorKeys(profile.knots,from,to).map(([,value])=>value),profileAt(profile,to,'left'),profileAt(profile,to)];
}
export function scalarRange(profile,from,to){
  const values=profileValues(profile,from,to);
  return values.reduce(([lo,hi],value)=>[Math.min(lo,value),Math.max(hi,value)],[Infinity,-Infinity]);
}
