import {validateDirectionPair,interpolateDirectionPair,axisFrame} from '../geom/frame.mjs';
import {BUILD_SCALE_MM,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
// Bundle's neutral SAAMpath pose contract. CAM chooses the orientations;
// Geometry supplies direction mathematics, without toolhead conventions.
// A SAAMpath pose is the toolhead's orientation in the part frame: {toolAxis,
// toolUp}. Machine axes (arm joints, rotary tables) come from the machine's
// kinematics. Fields beyond the two directions, such as an older path's
// rotaryDeg, are ignored.

// Pose resolution (radians, or unit-vector components): a turn that moves a point
// at build scale by less than print resolution cannot change a print. Shape judgement.
export const POSE_RESOLUTION=PRINT_RESOLUTION_MM/BUILD_SCALE_MM;
export const POSE_RESOLUTION_DEG=POSE_RESOLUTION*180/Math.PI;

export const uprightPose=()=>({toolAxis:[0,0,-1],toolUp:[0,1,0]});
// A computation frame supplies no authored roll. Machine adapters choose their
// feasible roll independently from this deterministic numerical basis.
export function axisPose(toolAxis){
  const frame=axisFrame(toolAxis);
  return {toolAxis:[...toolAxis],toolUp:frame.map(row=>row[1])};
}
export function validatePose(p){
  validateDirectionPair(p?.toolAxis,p?.toolUp);
  return p;
}
export const samePose=(a,b)=>['toolAxis','toolUp'].every(k=>a[k].every((v,i)=>Math.abs(v-b[k][i])<POSE_RESOLUTION));
// Nominal command-space interpolation; the controller's acceleration and joint
// trajectory are deliberately not represented. Re-orthogonalize the tool basis.
export function interpolatePose(a,b,t){
  const [toolAxis,toolUp]=interpolateDirectionPair([a.toolAxis,a.toolUp],[b.toolAxis,b.toolUp],t);
  return {toolAxis,toolUp};
}
