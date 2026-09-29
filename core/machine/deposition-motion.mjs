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

// A press is a metered, stationary-XY down-and-return action inside an
// attachment layer. It is not a steep surface-following deposition curve.
// Validate geometry independently of the producer's role name or claim.
export function validateDepositionAction(stroke){
  const action=stroke.depositionAction;if(!action)return false;
  const points=stroke.points,start=points[0],epsilon=1e-8;
  requireThat(action.kind==='press'&&Number.isFinite(action.depthMm)&&action.depthMm>0&&
    Number.isFinite(action.layerHeightMm)&&action.layerHeightMm>action.depthMm&&!stroke.closed&&points.length>=3,
    'A deposition press needs positive depth strictly within its attachment layer.');
  requireThat(points.every(point=>point.length===3&&point.every(Number.isFinite)&&
    Math.hypot(point[0]-start[0],point[1]-start[1])<=epsilon)&&distance(start,points.at(-1))<=epsilon,
    'A deposition press must stay at one XY position and return to its starting point.');
  const bottom=Math.min(...points.map(point=>point[2])),turn=points.findIndex(point=>point[2]===bottom);
  requireThat(Math.abs(start[2]-bottom-action.depthMm)<=epsilon&&turn>0&&turn<points.length-1&&
    points.slice(1).every((point,i)=>i<turn?point[2]<points[i][2]:point[2]>points[i][2]),
    'A deposition press must descend by its declared depth and return without extra excursions.');
  return true;
}

// Resolve authored surface/rotary intent before pose-sensitive joins. This
// adaptation consumes geometry frames; region stroke fields never emit poses.
export function prepareReferenceMotion(result,machine){
  let angle=0;
  return {...result,operations:result.operations.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>{
    if(!stroke.motionIntent)return stroke;
    const {motionIntent,referenceAlong,...curve}=stroke;
    requireThat(motionIntent.kind==='rotary-surface'&&machine.capabilities.includes('tool-orientation')&&machine.capabilities.includes('coordinated-rotary'),
      'Surface rotary motion needs coordinated rotation and tool orientation.');
    const center=motionIntent.centerMm,t=motionIntent.tiltDeg*Math.PI/180;
    requireThat(Array.isArray(center)&&center.length===3&&center.every(Number.isFinite)&&Number.isFinite(t), 'Surface rotary motion needs a finite center and tilt.');
    const poses=curve.points.map((point,i)=>{
      requireThat(Math.hypot(point[0]-center[0],point[1]-center[1])>1e-6,'Surface rotary motion crosses the rotary axis.');
      const raw=-Math.atan2(point[1]-center[1],point[0]-center[0])*180/Math.PI;
      angle=raw+360*Math.round((angle-raw)/360);
      const n=curve.normals[i],along=referenceAlong[i],v=normalize(subtract(along,scale(n,dot(along,n)))),up=normalize(cross(v,n));
      return {rotaryDeg:angle,toolAxis:n.map((x,k)=>-Math.sin(t)*x-Math.cos(t)*v[k]),toolUp:up};
    });
    return {...curve,poses};
  })}))};
}

export function prepareDepositionMotion(result,machine){
  const oriented=machine.capabilities.includes('tool-orientation');
  return {...result,operations:result.operations.map(operation=>{
    const strokes=operation.strokes.map(original=>{
    let stroke=original;
    const pressing=validateDepositionAction(stroke);
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
    if(stroke.volumesMm3?.length&&stroke.volumesMm3.every(volume=>volume===0))return stroke;
    const normals=stroke.points.map((_,i)=>stroke.frameSamples?.[i]?.normal??stroke.normals?.[i]??
      stroke.segmentMetadata?.[Math.min(i,stroke.segmentMetadata.length-1)]?.surfaceNormal??[0,0,1]);
    if(oriented){
      const poses=normals.map((normal,i)=>surfacePose(normal,stroke.frameSamples?.[i]?.v));
      return {...stroke,poses};
    }
    const inclination=Math.max(pressing?0:maximumPathAngle(stroke.points),...normals.map(normal=>Math.acos(Math.max(-1,Math.min(1,normalize(normal)[2])))*180/Math.PI));
    requireThat(inclination<=1e-7||machine.capabilities.includes('nonplanar')&&inclination<=(machine.nonplanar?.maxAngleDeg??0)+1e-7,
      `Operation ${operation.id} needs ${inclination.toFixed(3)}° fixed-axis deposition; ${machine.id} permits ${machine.nonplanar?.maxAngleDeg??0}°. A surface-following nozzle requires tool-orientation support.`);
    return stroke;
  });
  return {...operation,strokes,order:strokes.some(stroke=>stroke.poses)?'given':operation.order};
  })};
}
