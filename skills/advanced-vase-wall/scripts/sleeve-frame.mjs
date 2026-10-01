import {surfaceIsoCurve} from '../../../core/geom/surface-curves.mjs';
import {sampleCurveIntervals} from '../../../core/geom/curve-sampling.mjs';
import {requireThat,distance} from '../../../core/private/extensions/numeric.mjs';
// Horizontal periodic-patch sections retain NURBS form through offset and
// crossing resolution. Sampling supplies perimeter correspondence afterward.
import {evaluateCurve} from '../../../core/geom/nurbs.mjs';
import {prepareCurveOffsets} from '../../../core/geom/curve-offset.mjs';
import {contourPath} from '../../../core/geom/contour-path.mjs';
import {prepareContourFamily} from '../../../core/geom/prepared-contours.mjs';


export function horizontalSleeveCurve(patch,v,z){
  const curve=surfaceIsoCurve(patch,1,v);
  for(let i=0;i<curve.n;i++)requireThat(Math.abs(curve.cp[i*4+2]/curve.cp[i*4+3]-z)<=1e-8,
    'Horizontal sleeve contours require patch V to reproduce actual Z; bent sleeves need a different chart.');
  return curve;
}

export function sampleCurveContour(pieces,toleranceMm){
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Curve contour sampling needs a positive tolerance.');
  const points=[];
  for(const curve of pieces){
    const breaks=[...new Set([curve.domain[0],...curve.knots.filter(t=>t>curve.domain[0]&&t<curve.domain[1]),curve.domain[1]])];
    const samples=sampleCurveIntervals({at:t=>evaluateCurve(curve,t),cuts:breaks,toleranceMm,stepMm:Infinity});
    const first=samples[0].point.slice(0,2);
    if(!points.length)points.push(first);
    else requireThat(distance(points.at(-1),first)<=1e-6,'Resolved contour pieces do not meet.');
    points.push(...samples.slice(1).map(s=>s.point.slice(0,2)));
  }
  requireThat(points.length>=4&&distance(points[0],points.at(-1))<=1e-6,'A sleeve offset must retain a closed contour.');
  return points.slice(0,-1);
}

export function prepareSleeveContours({patch,rangeMm,toleranceMm=.005,stepMm=.4}){
  requireThat(patch&&Array.isArray(rangeMm)&&rangeMm.length===2&&rangeMm.every(Number.isFinite)&&rangeMm[1]>rangeMm[0],
    'Sleeve contours need a patch and a positive finite height range.');
  const [start,end]=rangeMm,[v0,v1]=patch.domainV,cache=new Map();
  let nativeSections=0,resolvedCrossings=0;
  function curveAt(z,depth){
    requireThat(Number.isFinite(z)&&Number.isFinite(depth)&&z>=start-1e-9&&z<=end+1e-9,'Sleeve contour height is outside its reference interval.');
    const v=v0+Math.max(0,Math.min(1,(z-start)/(end-start)))*(v1-v0);
    let prepared=cache.get(z);
    if(!prepared){
      const curve=horizontalSleeveCurve(patch,v,z);
      prepared={source:curve,offsets:prepareCurveOffsets({curves:[{curve,closed:true}]})};
      if(cache.size>=128)cache.delete(cache.keys().next().value);
      cache.set(z,prepared);nativeSections++;
    }
    const resolved=prepared.offsets.offset(depth);resolvedCrossings+=resolved.report.crossings;
    requireThat(resolved.curves.length===1&&resolved.curves[0].closed,
      `Sleeve contour offset split, opened or collapsed at Z ${z} mm, offset ${depth} mm; choose a smaller offset or an explicit branch.`);
    const loop=sampleCurveContour(resolved.curves[0].pieces,toleranceMm/2);
    const anchor=evaluateCurve(prepared.source,prepared.source.domain[0]).point.slice(0,2);
    return contourPath(loop,anchor);
  }
  const prepared=prepareContourFamily({curveAt,startMm:start,endMm:end,stepMm,toleranceMm:toleranceMm/2});
  return {curveAt,
    at:(phase,z,depth=0)=>[...prepared.at(phase,z,depth),z],
    report:()=>({nativeSections,resolvedCrossings,...prepared.report(),offsetMode:'native-contour',contourToleranceMm:toleranceMm})};
}
