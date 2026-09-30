// Derive optional Slice orientation output. Machine compatibility belongs to export.
import {dot,normalize,subtract,scale,distance,requireThat} from '../geom/tolerance.mjs';
import {strokeRange} from '../path/deposition.mjs';
import {validatePose,uprightPose} from '../path/pose.mjs';

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

// Slice opts into orientation output before pose-sensitive joins. Its baseline
// is standard print-Z alignment unless following the slice normal is requested.
export function prepareReferenceMotion(result){
  return {...result,operations:result.operations.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>{
    if(!stroke.motionIntent)return stroke;
    const {motionIntent,...curve}=stroke;
    requireThat(motionIntent.kind==='derived-pose'&&typeof motionIntent.alignToSliceNormal==='boolean',
      'Slice pose output needs a derived alignment choice.');
    const poses=curve.points.map((point,i)=>{
      if(!motionIntent.alignToSliceNormal)return uprightPose();
      const sourceNormal=curve.normals?.[i]??curve.frameSamples?.[i]?.normal;
      requireThat(sourceNormal,'Slice-normal pose output needs a produced normal at every point.');
      const n=normalize(sourceNormal),axis=n.map(v=>-v);
      const along=curve.referenceAlong?.[i]??curve.frameSamples?.[i]?.v??(Math.abs(n[1])<.9?[0,1,0]:[1,0,0]);
      const up=normalize(subtract(along,scale(axis,dot(along,axis))));
      return validatePose({rotaryDeg:0,toolAxis:axis,toolUp:up});
    });
    return {...curve,poses};
  })}))};
}

// Geometry validation does not choose poses from the selected machine. A pose
// exists only when a producer derives it for an enabled output mode.
export function prepareDepositionMotion(result){
  return {...result,operations:result.operations.map(operation=>{
    const strokes=operation.strokes.map(original=>{
      validateDepositionAction(original);
      const stroke=original.poses&&original.closed?strokeRange(original):original;
      if(stroke.poses){
        requireThat(stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
        stroke.poses.forEach(validatePose);
      }
      return stroke;
    });
    return {...operation,strokes,order:strokes.some(stroke=>stroke.poses)?'given':operation.order};
  })};
}
