// Shared part/bed frame arithmetic. No robot inverse kinematics or feasibility solver.
import {requireThat} from '../geom/tolerance.mjs';
export const uprightPose=()=>({rotaryDeg:0,toolAxis:[0,0,-1],toolUp:[0,1,0]});
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const unit=v=>{const n=Math.hypot(...v);requireThat(n>1e-12,'Degenerate direction.');return v.map(x=>x/n);};
export const rotateZ=(v,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];};
export function validatePose(p){
  requireThat(p&&Number.isFinite(p.rotaryDeg),'A pose needs an unwrapped rotary angle.');
  for(const key of ['toolAxis','toolUp'])requireThat(Array.isArray(p[key])&&p[key].length===3&&p[key].every(Number.isFinite)&&Math.abs(Math.hypot(...p[key])-1)<1e-6,'Tool directions must be unit 3-vectors.');
  requireThat(Math.abs(dot(p.toolAxis,p.toolUp))<1e-6,'Tool directions must be perpendicular.');
  return p;
}
export function bedPoint(point,angle,center,inverse=false){
  const v=rotateZ(point.map((x,i)=>x-center[i]),inverse?-angle:angle);
  return v.map((x,i)=>x+center[i]);
}
export const samePose=(a,b)=>Math.abs(a.rotaryDeg-b.rotaryDeg)<1e-9&&['toolAxis','toolUp'].every(k=>a[k].every((v,i)=>Math.abs(v-b[k][i])<1e-9));
// Nominal command-space interpolation; the controller's acceleration and joint
// trajectory are deliberately not represented. Re-orthogonalize the tool basis.
export function interpolateDirections(a,b,t){
  const mix=(u,v)=>u.map((x,i)=>x+(v[i]-x)*t);
  const axis=unit(mix(a.toolAxis,b.toolAxis)),up=mix(a.toolUp,b.toolUp),projection=dot(up,axis);
  return {toolAxis:axis,toolUp:unit(up.map((x,i)=>x-projection*axis[i]))};
}
