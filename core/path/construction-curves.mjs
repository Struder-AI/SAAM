// One geometry retention boundary for Slice, authored/generated Trace and
// modulation. Native witnesses survive non-geometric edits; changed positions
// receive a new bounded NURBS construction, never the old curve's identity.
import {mappedSurfacePath} from '../geom/surface-path.mjs';
import {fitSampledCurve} from '../geom/curve-fit.mjs';
import {strokeRange} from './deposition.mjs';

export function constructionCurve(input,surface){
  const stroke=input.closed?strokeRange(input):input,points=stroke.points;
  const witness=stroke.nativePath?.points;
  if(witness&&(points===witness||points.length===witness.length&&points.every((point,i)=>point.every((value,k)=>value===witness[i][k]))))return stroke.nativePath;
  const reference=stroke.nativeSurface?.surface??surface,translation=stroke.nativeSurface?.translation??[0,0,0];
  const chart=reference&&(stroke.chartPoints??stroke.frameSamples?.map(frame=>frame.point.slice(0,2)));
  const mapped=reference?mappedSurfacePath(reference,chart,translation.every(value=>value===0)?points:points.map(point=>point.map((value,k)=>value-translation[k]))):null;
  if(mapped&&mapped.geometry.controlPoints.length*3+mapped.geometry.knots.length+(mapped.geometry.weights?.length??0)<points.length*3)
    return {...mapped,geometry:{...mapped.geometry,controlPoints:mapped.geometry.controlPoints.map(point=>point.map((value,k)=>value+translation[k]))},points,mapped:true};
  const fitted=fitSampledCurve(points);
  return fitted?{...fitted,fitted:true}:null;
}
export function retainConstructionCurves(result){
  return {...result,operations:result.operations.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>{
    if(stroke.stationaryExtrusion)return stroke;
    const nativePath=constructionCurve(stroke,operation.slice);
    return nativePath?{...stroke,nativePath}:stroke;
  })}))};
}
