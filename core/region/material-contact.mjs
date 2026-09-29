// Measure a translated course against finalized material. Existing chart
// columns use their immediate predecessor; entering columns use surrounding
// owners. Sparse missing strands never become a filled support sheet.
import {beadContactAlong} from '../path/deposited-curves.mjs';
import {pointInRegion,pointSegmentDistance} from './region2d.mjs';
import {dot,requireThat} from '../geom/tolerance.mjs';

export function materialContact(curves,{layer,bounds,support,maxNormalGapMm=Infinity,required=false}){
  const direction=layer.direction??layer.slice.normal??[0,0,1];
  const pitch=layer.slice.kind==='plane'?layer.heightMm/dot(layer.slice.normal,direction):layer.heightMm;
  const previousRegion=support.previousRegion??[],envelope=Math.hypot(...bounds.max.map((v,k)=>v-bounds.min[k]));
  const report={samples:0,minGapMm:Infinity,maxGapMm:0},after=new Set();
  const distancesMm=curves.map(curve=>curve.points.map((point,i)=>{
    const chart=curve.chartPoints[i],normal=curve.normals[i];
    const established=pointInRegion(chart,previousRegion)||previousRegion.some(loop=>loop.some((a,j)=>pointSegmentDistance(chart,a,loop[(j+1)%loop.length])<1e-8));
    const segments=established?support.previousSegments:support.surroundingSegments;
    const contact=segments.length?beadContactAlong(segments,point,direction,{maxDistanceMm:envelope}):null;
    requireThat(!required||contact,`Layer ${layer.index} has an uncovered required predecessor contact.`);
    if(!contact)return Math.min(pitch,direction[2]>1e-9?Math.max(0,(point[2]-bounds.min[2])/direction[2]):pitch);
    const normalGap=contact.distanceMm*dot(normal,direction);
    requireThat(normalGap<=maxNormalGapMm+1e-8,`Layer ${layer.index}: actual predecessor gap ${normalGap.toFixed(4)} mm exceeds selected tool bead-height limit ${maxNormalGapMm} mm.`);
    report.samples++;report.minGapMm=Math.min(report.minGapMm,normalGap);report.maxGapMm=Math.max(report.maxGapMm,normalGap);after.add(contact.operationId);
    return contact.distanceMm;
  }));
  return {distancesMm,direction,after:[...after],report};
}
