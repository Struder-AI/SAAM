// One geometry retention boundary for Slice, authored/generated Trace and
// modulation. Native witnesses survive non-geometric edits; changed positions
// receive certified new geometry or retain their faithful samples.
import {mappedSurfacePath} from '../geom/surface-path.mjs';
import {fitSampledCurve,curveStorageReduced} from '../geom/curve-fit.mjs';
import {strokeRange} from './deposition.mjs';
import {prepareNumericalCurve,numericalCurveRegular} from '../geom/curve-query.mjs';

function regularGeometry(geometry){
  return numericalCurveRegular(prepareNumericalCurve(geometry));
}

export function constructionCurve(input,surface){
  const stroke=input.closed?strokeRange(input):input,points=stroke.points;
  const witness=stroke.nativePath?.points;
  if(witness&&(points===witness||points.length===witness.length&&points.every((point,i)=>point.every((value,k)=>value===witness[i][k])))&&
    regularGeometry(stroke.nativePath.geometry))return stroke.nativePath;
  const reference=stroke.nativeSurface?.surface??surface,translation=stroke.nativeSurface?.translation??[0,0,0];
  const chart=reference&&(stroke.chartPoints??stroke.frameSamples?.map(frame=>frame.point.slice(0,2)));
  const mapped=reference?mappedSurfacePath(reference,chart,translation.every(value=>value===0)?points:points.map(point=>point.map((value,k)=>value-translation[k]))):null;
  const geometry=mapped?{...mapped.geometry,controlPoints:mapped.geometry.controlPoints.map(point=>point.map((value,k)=>value+translation[k]))}:null;
  if(mapped&&curveStorageReduced(geometry,points)&&regularGeometry(geometry))return {...mapped,geometry,points,mapped:true};
  // A positional fit alone does not certify the material frame: a near-stop
  // can tilt an orthogonalized bead despite tiny centerline error. Automatic
  // fitting of sampled deposition therefore retains a constant material plane.
  // Unproved frames keep the original polyline; native/mapped witnesses above
  // already carry their own construction geometry.
  const normalAt=i=>stroke.normals?.[i]??stroke.frameSamples?.[i]?.normal??stroke.segmentMetadata?.[Math.min(i,points.length-2)]?.surfaceNormal;
  const normal=normalAt(0);
  if(!normal||points.some((_,i)=>normalAt(i)?.some((value,k)=>value!==normal[k])??true))return null;
  const fitted=fitSampledCurve(points,{planeNormal:normal});
  return fitted?{...fitted,fitted:true}:null;
}
export function retainConstructionCurves(result){
  return {...result,operations:result.operations.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>{
    if(stroke.stationaryExtrusion)return stroke;
    const nativePath=constructionCurve(stroke,operation.slice);
    return nativePath?{...stroke,nativePath}:stroke;
  })}))};
}
