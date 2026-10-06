// Measure a translated course against finalized material. Existing chart
// columns use their immediate predecessor; entering columns use surrounding
// owners. Sparse missing strands never become a filled support sheet.
import {beadContactAlong,depositedBeadSegments} from '../path/deposited-curves.mjs';
import {prepareSliceRay,sliceRayIntersections} from '../geom/slice.mjs';
import {pointInRegion,pointSegmentDistance} from './region2d.mjs';
import {dot} from '../geom/frame.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';

export function materialContact(curves,{id='slice',layer,bounds,support,contactFragments=[],predecessorReference=null,substrateAdaptation=false,required=false}){
  const direction=layer.direction??layer.slice.normal??[0,0,1];
  const pitch=layer.slice.kind==='plane'?layer.heightMm/dot(layer.slice.normal,direction):layer.heightMm;
  const previousRegion=support.previousRegion??[],envelope=Math.hypot(...bounds.max.map((v,k)=>v-bounds.min[k]));
  const inRegion=(point,region)=>pointInRegion(point,region)||region.some(loop=>loop.some((a,i)=>pointSegmentDistance(point,a,loop[(i+1)%loop.length])<1e-8));
  const reference=substrateAdaptation&&predecessorReference?prepareSliceRay(predecessorReference,direction):null;
  const fragments=reference?contactFragments.map(fragment=>({...fragment,queries:fragment.layers.filter(source=>source.slice&&Array.isArray(source.region)).map(source=>({region:source.region,prepared:prepareSliceRay(source.slice,direction)}))})):[];
  const segmentsByFragment=new Map();
  const report={queries:0,samples:0,uncoveredSamples:0,minGapMm:Infinity,maxGapMm:0},after=new Set();
  const distancesMm=curves.map(curve=>curve.points.map((point,i)=>{
    const chart=curve.chartPoints[i],normal=curve.normals[i];
    const established=pointInRegion(chart,previousRegion)||previousRegion.some(loop=>loop.some((a,j)=>pointSegmentDistance(chart,a,loop[(j+1)%loop.length])<1e-8));
    let nominal=pitch,segments=substrateAdaptation?(established?support.previousSegments:support.surroundingSegments):[];
    if(reference&&!established){
      const lower=sliceRayIntersections(reference,point).filter(hit=>hit.distanceMm>=-1e-8).sort((a,b)=>a.distanceMm-b.distanceMm)[0];
      let chosen=null,distanceMm=Infinity;
      if(lower)for(const fragment of fragments)for(const query of fragment.queries)for(const hit of sliceRayIntersections(query.prepared,point)){
        if(hit.distanceMm>=lower.distanceMm-1e-7&&hit.distanceMm<distanceMm&&inRegion(hit.chartPoint,query.region)){chosen=fragment;distanceMm=hit.distanceMm;}
      }
      segments=fragments.filter(fragment=>!fragment.queries.length).flatMap(fragment=>depositedBeadSegments(fragment.operations,{widthMm:fragment.widthMm}));
      if(chosen){
        nominal=distanceMm;
        if(!segmentsByFragment.has(chosen))segmentsByFragment.set(chosen,depositedBeadSegments(chosen.operations,{widthMm:chosen.widthMm}));
        segments=[...segments,...segmentsByFragment.get(chosen)];
      }
    }
    if(segments.length)report.queries++;
    const contact=segments.length?beadContactAlong(segments,point,direction,{maxDistanceMm:envelope}):null;
    if(!contact&&(reference&&!established||segments.length))report.uncoveredSamples++;
    requireThat(!substrateAdaptation||!required||contact,`Slice ${id} layer ${layer.index} has missing required substrate at ${JSON.stringify(point)}. Experimental substrate adaptation requires contact with the selected source.`);
    const distanceMm=contact?.distanceMm??Math.min(nominal,direction[2]>1e-9?Math.max(0,(point[2]-bounds.min[2])/direction[2]):nominal);
    const normalGap=distanceMm*dot(normal,direction);
    if(!contact)return distanceMm;
    report.samples++;report.minGapMm=Math.min(report.minGapMm,normalGap);report.maxGapMm=Math.max(report.maxGapMm,normalGap);after.add(contact.operationId);
    return contact.distanceMm;
  }));
  return {distancesMm,direction,after:[...after],report};
}
