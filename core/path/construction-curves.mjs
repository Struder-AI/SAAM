// One geometry retention boundary for Slice, authored/generated Trace and
// modulation. Native witnesses survive non-geometric edits; changed positions
// receive certified new geometry or retain their faithful samples.
import {mappedSurfacePath} from '../geom/surface-path.mjs';
import {fitSampledCurve,curveStorageReduced} from '../geom/curve-fit.mjs';
import {strokeRange} from './deposition.mjs';
import {prepareNumericalCurve,numericalCurveRegular} from '../geom/curve-query.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

// Finalization transfers these strokes unchanged to publication. Retain failed
// storage fits too, so publication does not repeat an expensive rejected fit.
const retainedCurves=new WeakMap();
function regularGeometry(geometry){
  return numericalCurveRegular(prepareNumericalCurve(geometry));
}

export function constructionCurve(input,surface){
  const retained=retainedCurves.get(input);
  if(retained&&retained.surface===surface)return retained.path;
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
  // Reserve at most 5 microns for fitting, tightened to 1/80 of the smallest
  // deposited dimension. Geometry certifies this caller-owned physical budget;
  // native witnesses above never pass through the sampled-curve fitter.
  const budget={toleranceMm:5*PRINT_RESOLUTION_MM,extentMm:PRINT_RESOLUTION_MM};
  for(const record of [stroke,...stroke.segmentMetadata??[]])
    for(const value of [record.beadWidthMm,record.beadHeightMm,record.normalGapMm])
      if(Number.isFinite(value)&&value>0){budget.toleranceMm=Math.min(budget.toleranceMm,value/80);budget.extentMm=Math.max(budget.extentMm,value);}
  // The parameter carries material. Bound its local metric too: shortening a
  // tiny zigzag while conserving volume would otherwise inflate its section.
  const fitted=fitSampledCurve(points,{planeNormal:normal,toleranceMm:budget.toleranceMm,
    relativeSpeedTolerance:Math.min(1/80,budget.toleranceMm/budget.extentMm)});
  return fitted?{...fitted,fitted:true}:null;
}
export function retainConstructionCurves(result){
  return {...result,operations:result.operations.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>{
    if(stroke.stationaryExtrusion)return stroke;
    const nativePath=constructionCurve(stroke,operation.slice);
    const retained=nativePath?{...stroke,nativePath}:stroke;
    retainedCurves.set(retained,{surface:operation.slice,path:nativePath});
    return retained;
  })}))};
}

// Carry the already selected sampled geometry across an exact zero-edge closure.
export function transferConstructionCurveSelection(source,target,surface){
  const selected=retainedCurves.get(source);
  if(!selected||selected.surface!==surface||selected.path!==null)throw Error('Expected retained sampled construction geometry.');
  const a=source.closed?strokeRange(source):source,b=target.closed?strokeRange(target):target;
  const edges=a.points.slice(1).map((point,i)=>({point,i})).filter(({point,i})=>point.some((value,k)=>value!==a.points[i][k]));
  if(b.points.length!==edges.length+1||edges.some(({point,i},j)=>point.some((value,k)=>value!==b.points[j+1][k])||a.points[i].some((value,k)=>value!==b.points[j][k])))
    throw Error('Construction geometry transfer needs identical ordered positive edges.');
  retainedCurves.set(target,selected);
  return {completed:true};
}
