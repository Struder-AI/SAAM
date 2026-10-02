import {requireThat} from '../private/toolpath/numeric.mjs';
import {validateDirectionPair,interpolateDirectionPair} from '../geom/frame.mjs';
// Authored SAAMpath pose conventions, independent of machine configuration.

export const uprightPose=()=>({rotaryDeg:0,toolAxis:[0,0,-1],toolUp:[0,1,0]});
export function validatePose(p){
  requireThat(p&&Number.isFinite(p.rotaryDeg),'A pose needs an unwrapped rotary angle.');
  validateDirectionPair(p.toolAxis,p.toolUp);
  return p;
}
export const samePose=(a,b)=>Math.abs(a.rotaryDeg-b.rotaryDeg)<1e-9&&['toolAxis','toolUp'].every(k=>a[k].every((v,i)=>Math.abs(v-b[k][i])<1e-9));
// Nominal command-space interpolation; the controller's acceleration and joint
// trajectory are deliberately not represented. Re-orthogonalize the tool basis.
export function interpolatePose(a,b,t){
  const [toolAxis,toolUp]=interpolateDirectionPair([a.toolAxis,a.toolUp],[b.toolAxis,b.toolUp],t);
  return {toolAxis,toolUp,rotaryDeg:a.rotaryDeg+(b.rotaryDeg-a.rotaryDeg)*t};
}
