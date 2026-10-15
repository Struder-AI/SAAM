import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,normalize,dot} from '../private/toolpath/numeric.mjs';
// Local process gaps on mapped surface curves. Geometry mapping supplies XYZ
// and optional normals; sampled lower heights describe the supporting material.
// The normal projection is a local rectangular-bead model, not an exact offset.


import {maximumPathAngle} from '../path/deposition.mjs';
import {contactSpans} from '../path/contact-curves.mjs';
import {POSE_RESOLUTION_DEG} from '../path/pose.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

// A sample inside its supporting material has a zero gap: nothing is deposited
// there, never a negative volume. -> {curves, report, spans} (contactSpans).
export function surfaceGapCurves(curves,{slice,lowerHeightsMm=null,distancesMm=null,direction=[0,0,1],maxAngleDeg=90}) {
  requireThat(Array.isArray(distancesMm??lowerHeightsMm)&&(distancesMm??lowerHeightsMm).length===curves.length,'Surface gaps need sampled contact distances or lower heights for every curve.');
  const report={minGapMm:Infinity,maxGapMm:-Infinity,minNormalGapMm:Infinity,maxNormalGapMm:-Infinity,maxMappedSlopeDeg:0},spans=[];
  const result=curves.map((curve,j)=>{
    requireThat((distancesMm??lowerHeightsMm)[j].length===curve.points.length,'Surface gaps need one contact sample per mapped point.');
    const normals=curve.normals??curve.points.map((point,i)=>evaluateSurface(slice,curve.chartPoints?.[i]??point).normal);
    const samples=curve.points.map((point,i)=>{
      const normal=normals[i],cosine=dot(normal,direction),measured=distancesMm?distancesMm[j][i]:point[2]-lowerHeightsMm[j][i];
      requireThat(cosine>ROUNDING_RELATIVE,'Stacking direction is tangent to or reverses across the slice.');
      requireThat(Number.isFinite(measured),'Surface gaps need finite contact samples.');
      const gap=Math.max(0,measured);
      const slopeDeg=Math.acos(Math.min(1,Math.abs(normal[2])))*180/Math.PI;
      report.maxMappedSlopeDeg=Math.max(report.maxMappedSlopeDeg,slopeDeg);
      return {gap,normalGap:gap*cosine,slopeDeg,point,status:measured<0?'penetrating':null};
    });
    spans.push(...contactSpans(samples));
    const pathSlope=maximumPathAngle(curve.points);
    report.maxMappedSlopeDeg=Math.max(report.maxMappedSlopeDeg,pathSlope);
    requireThat(report.maxMappedSlopeDeg<=maxAngleDeg+POSE_RESOLUTION_DEG,`Mapped surface slope ${report.maxMappedSlopeDeg.toFixed(4)} degrees exceeds reference limit ${maxAngleDeg} degrees.`);
    const heightsMm=[],segmentMetadata=[];
    for(let i=1;i<samples.length;i++) {
      const a=samples[i-1],b=samples[i],gap=(a.gap+b.gap)/2,normalGap=(a.normalGap+b.normalGap)/2;
      heightsMm.push(normalGap);
      segmentMetadata.push({...curve.segmentMetadata?.[i-1],gapMm:gap,normalGapMm:normalGap,beadHeightMm:normalGap,
        surfaceNormal:normalize(normals[i].map((v,k)=>v+normals[i-1][k])),slopeDeg:(a.slopeDeg+b.slopeDeg)/2});
      report.minGapMm=Math.min(report.minGapMm,gap);report.maxGapMm=Math.max(report.maxGapMm,gap);
      report.minNormalGapMm=Math.min(report.minNormalGapMm,normalGap);report.maxNormalGapMm=Math.max(report.maxNormalGapMm,normalGap);
    }
    const {mappingReport,...mapped}=curve;
    return {...mapped,normals,closed:false,heightsMm,segmentMetadata};
  });
  return {curves:result,report,spans};
}
