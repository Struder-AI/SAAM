import {requireThat} from '../private/toolpath/numeric.mjs';
import {validateDirectionPair,interpolateDirectionPair} from '../geom/frame.mjs';
import {BUILD_SCALE_MM,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
// Authored SAAMpath pose conventions, independent of machine configuration.

// Pose resolution (radians, or unit-vector components): a turn that moves a point
// at build scale by less than print resolution cannot change a print. Shape judgement.
export const POSE_RESOLUTION=PRINT_RESOLUTION_MM/BUILD_SCALE_MM;
export const POSE_RESOLUTION_DEG=POSE_RESOLUTION*180/Math.PI;

export const uprightPose=()=>({rotaryDeg:0,toolAxis:[0,0,-1],toolUp:[0,1,0]});
export function validatePose(p){
  requireThat(p&&Number.isFinite(p.rotaryDeg),'A pose needs an unwrapped rotary angle.');
  validateDirectionPair(p.toolAxis,p.toolUp);
  return p;
}
export const samePose=(a,b)=>Math.abs(a.rotaryDeg-b.rotaryDeg)<POSE_RESOLUTION_DEG&&['toolAxis','toolUp'].every(k=>a[k].every((v,i)=>Math.abs(v-b[k][i])<POSE_RESOLUTION));
// Nominal command-space interpolation; the controller's acceleration and joint
// trajectory are deliberately not represented. Re-orthogonalize the tool basis.
export function interpolatePose(a,b,t){
  const [toolAxis,toolUp]=interpolateDirectionPair([a.toolAxis,a.toolUp],[b.toolAxis,b.toolUp],t);
  return {toolAxis,toolUp,rotaryDeg:a.rotaryDeg+(b.rotaryDeg-a.rotaryDeg)*t};
}
