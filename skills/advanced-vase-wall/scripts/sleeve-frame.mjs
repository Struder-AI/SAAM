import {requireThat,distance} from '../../../core/private/extensions/numeric.mjs';
// Horizontal periodic-patch sections retain NURBS form through offset and
// crossing resolution. Sampling supplies perimeter correspondence afterward.
import {findSpan,basisFunctions,evaluateCurve} from '../../../core/geom/nurbs.mjs';
import {prepareCurveOffsets} from '../../../core/geom/curve-offset.mjs';
import {contourPath} from '../../../core/geom/contour-path.mjs';
import {prepareContourFamily} from '../../../core/geom/prepared-contours.mjs';


export function horizontalSleeveCurve(patch,v,z){
  const {nu,nv,orderU,orderV,knotsU,knotsV,cp,domainU}=patch;
  const span=findSpan(knotsV,nv,orderV,v),basis=basisFunctions(knotsV,span,v,orderV),out=new Float64Array(nu*4);
  for(let i=0;i<nu;i++)for(let k=0;k<orderV;k++)for(let c=0;c<4;c++)out[i*4+c]+=basis[k]*cp[(i*nv+span-orderV+1+k)*4+c];
  for(let i=0;i<nu;i++)requireThat(Math.abs(out[i*4+2]/out[i*4+3]-z)<=1e-8,
    'Horizontal sleeve contours require patch V to reproduce actual Z; bent sleeves need a different chart.');
  return {n:nu,order:orderU,knots:knotsU,cp:out,domain:[...domainU]};
}

export function sampleCurveContour(pieces,toleranceMm){
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Curve contour sampling needs a positive tolerance.');
  const points=[];
  for(const curve of pieces){
    const breaks=[...new Set([curve.domain[0],...curve.knots.filter(t=>t>curve.domain[0]&&t<curve.domain[1]),curve.domain[1]])];
    const at=t=>evaluateCurve(curve,t).point;
    const append=(a,b,pa,pb)=>{
      const mid=(a+b)/2,pm=at(mid),q1=at(a+(b-a)/4),q3=at(a+3*(b-a)/4);
      const error=Math.max(...[[q1,.25],[pm,.5],[q3,.75]].map(([p,t])=>distance(p,pa.map((x,k)=>x+(pb[k]-x)*t))));
      if(error>toleranceMm){
        requireThat(mid>a&&mid<b,'Native curve contour cannot meet its chord tolerance at machine precision.');
        append(a,mid,pa,pm);append(mid,b,pm,pb);return;
      }
      points.push(pb.slice(0,2));
    };
    const first=at(breaks[0]).slice(0,2);
    if(!points.length)points.push(first);
    else requireThat(distance(points.at(-1),first)<=1e-6,'Resolved contour pieces do not meet.');
    for(let i=1;i<breaks.length;i++)append(breaks[i-1],breaks[i],at(breaks[i-1]),at(breaks[i]));
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
