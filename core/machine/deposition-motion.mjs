// Geometry supplies a bead frame. Machine adaptation chooses nozzle pose and
// checks fixed-axis compatibility here, independently of the slice technique.
import {dot,cross,normalize,subtract,scale,distance,requireThat} from '../geom/tolerance.mjs';
import {maximumPathAngle} from '../path/deposition.mjs';
import {validatePose} from '../path/pose.mjs';

function surfacePose(normal,preferredUp){
  const axis=scale(normalize(normal),-1);
  const seed=preferredUp??[0,1,0];
  let up=subtract(seed,scale(axis,dot(seed,axis)));
  if(Math.hypot(...up)<1e-8){
    const basis=[[1,0,0],[0,1,0],[0,0,1]].sort((a,b)=>Math.abs(dot(a,axis))-Math.abs(dot(b,axis)))[0];
    up=cross(axis,basis);
  }
  return {rotaryDeg:0,toolAxis:axis,toolUp:normalize(up)};
}

export function prepareDepositionMotion(result,machine){
  const oriented=machine.capabilities.includes('tool-orientation');
  return {...result,operations:result.operations.map(operation=>{
    const strokes=operation.strokes.map(original=>{
    let stroke=original;
    if(stroke.stationaryExtrusion)return stroke;
    if(oriented&&stroke.closed){
      const close=distance(stroke.points[0],stroke.points.at(-1))>1e-9;
      stroke={...stroke,closed:false,...(close?Object.fromEntries(['points','normals','frameSamples','poses','curveParameters'].filter(key=>stroke[key]).map(key=>[key,[...stroke[key],key==='curveParameters'?1:stroke[key][0]]])):{})};
    }
    if(stroke.poses){
      requireThat(oriented,`Operation ${operation.id} requires authored tool orientation unavailable on ${machine.id}.`);
      stroke.poses.forEach(validatePose);
      return stroke;
    }
    const normals=stroke.points.map((_,i)=>stroke.frameSamples?.[i]?.normal??stroke.normals?.[i]??
      stroke.segmentMetadata?.[Math.min(i,stroke.segmentMetadata.length-1)]?.surfaceNormal??[0,0,1]);
    if(oriented){
      const poses=normals.map((normal,i)=>surfacePose(normal,stroke.frameSamples?.[i]?.v));
      return {...stroke,poses};
    }
    const inclination=Math.max(maximumPathAngle(stroke.points),...normals.map(normal=>Math.acos(Math.max(-1,Math.min(1,normalize(normal)[2])))*180/Math.PI));
    requireThat(inclination<=1e-7||machine.capabilities.includes('nonplanar')&&inclination<=(machine.nonplanar?.maxAngleDeg??0)+1e-7,
      `Operation ${operation.id} needs ${inclination.toFixed(3)}° fixed-axis deposition; ${machine.id} permits ${machine.nonplanar?.maxAngleDeg??0}°. A surface-following nozzle requires tool-orientation support.`);
    return stroke;
  });
  return {...operation,strokes,order:strokes.some(stroke=>stroke.poses)?'given':operation.order};
  })};
}
