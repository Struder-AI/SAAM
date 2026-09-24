// Spatial material ownership at the shared planar-region boundary. A roof's
// sampled reserve is defined only over its actual footprint; extrapolated field
// samples must never truncate another component or material outside that roof.
import {difference,intersect,levelSetCoverage,levelSetRegion} from './boolean.mjs';
import {regionArea} from './region2d.mjs';
import {requireThat,TOLERANCE} from '../geom/tolerance.mjs';

export function reservationFootprint(reserve){
  const footprint=reserve?.footprint??reserve?.skinRegion;
  requireThat(Array.isArray(footprint),'A spatial reservation needs an explicit footprint.');
  return footprint;
}

function bounds(region){
  const box={min:[Infinity,Infinity],max:[-Infinity,-Infinity]};
  for(const loop of region)for(const p of loop)for(let i=0;i<2;i++){
    box.min[i]=Math.min(box.min[i],p[i]);box.max[i]=Math.max(box.max[i],p[i]);
  }
  return box;
}
function boundsOverlap(left,right){
  const a=bounds(left),b=bounds(right);
  return [0,1].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>TOLERANCE.point);
}

export function clipReservedRegion(region,z,reserve){
  requireThat(Number.isFinite(z),'Reservation layer height must be finite.');
  if(!reserve||!region.length)return region;
  const footprint=reservationFootprint(reserve);
  if(!boundsOverlap(region,footprint))return region;
  // A bounded process cavity supplies exact planar sections instead of a roof
  // height field. All planar material owners consume the same reservation.
  if(reserve.regionAt)return difference(region,reserve.regionAt(z));
  const coverage=levelSetCoverage(reserve.field,z);
  if(coverage==='all')return region;
  // Subtract only the material actually owned by the roof at this height. For
  // partial coverage, first intersect with the footprint to avoid exporting
  // the sampled/extrapolated field's rectangular boundary into other parts.
  const blocked=coverage==='none'?footprint:difference(footprint,levelSetRegion(reserve.field,z));
  return difference(region,blocked);
}

function surfaceHeight(surface,x,y){
  const sample=surface.topAt(x,y),height=typeof sample==='number'?sample:sample?.zMm;
  requireThat(Number.isFinite(height),'Lower surface does not cover a requested deposition point.');
  return height;
}

// A lower interface owns its footprint. Unknown support outside it must not be
// treated as a zero-height plane or silently discarded from the requested part.
export function clipAboveSurface(region,z,surface){
  requireThat(Number.isFinite(z)&&typeof surface?.topAt==='function'&&surface.field,'A lower surface needs a sampled field and native topAt query.');
  const footprint=reservationFootprint(surface);
  const uncovered=difference(region,footprint);
  let perimeter=0;
  for(const loop of region)for(let i=0;i<loop.length;i++)perimeter+=Math.hypot(loop[i][0]-loop[(i+1)%loop.length][0],loop[i][1]-loop[(i+1)%loop.length][1]);
  requireThat(Math.abs(regionArea(uncovered))<=TOLERANCE.point*Math.max(1,perimeter),'Lower surface does not cover the consumer region; choose a covering deposited interface.');
  // Material must have a positive gap. At an exactly touching layer, floating
  // surface arithmetic must not create a near-zero sheet/offset contour.
  const level=z-TOLERANCE.point;
  const covered=intersect(region,footprint),coverage=levelSetCoverage(surface.field,level);
  if(coverage==='all')return [];
  if(coverage==='none')return covered;
  return difference(covered,levelSetRegion(surface.field,level));
}

// Resolve horizontal deposition above any published surface interface. Layers
// stay horizontal; only their initial local material gap varies. The native
// query is sampled at bounded spatial steps and at quarter points to check the
// linear gap model. This is bounded numerical sampling, not a proof about an
// arbitrary unsampled surface.
export function surfaceStroke({points2d,z,nominalHeightMm,widthMm,surface,closed=false,
  maxStepMm=0.2,toleranceMm=TOLERANCE.chord}){
  requireThat(Array.isArray(points2d)&&points2d.length>=2&&points2d.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)),'A surface-aware stroke needs finite XY points.');
  requireThat(Number.isFinite(z)&&Number.isFinite(nominalHeightMm)&&nominalHeightMm>0&&Number.isFinite(widthMm)&&widthMm>0,'Invalid horizontal surface deposition dimensions.');
  requireThat(Number.isFinite(maxStepMm)&&maxStepMm>0&&Number.isFinite(toleranceMm)&&toleranceMm>0,'Invalid surface sampling limits.');
  requireThat(typeof surface?.topAt==='function','A lower surface needs a native topAt query.');
  const source=points2d.map(p=>p.slice(0,2));
  if(closed&&Math.hypot(source[0][0]-source.at(-1)[0],source[0][1]-source.at(-1)[1])>TOLERANCE.point)source.push([...source[0]]);
  const sample=point=>{
    const raw=z-surfaceHeight(surface,...point);
    requireThat(raw>=-toleranceMm,'Horizontal stroke crosses above-surface clipping boundary; refine the surface sampling before generation.');
    return {point,gap:Math.max(0,Math.min(nominalHeightMm,raw))};
  };
  const points=[],volumesMm3=[],segmentMetadata=[],gapsMm=[];
  const append=(a,b,length,error)=>{
    if(!points.length){points.push([...a.point,z]);gapsMm.push(a.gap);}
    points.push([...b.point,z]);gapsMm.push(b.gap);
    const gap=(a.gap+b.gap)/2;
    volumesMm3.push(length*widthMm*gap);
    segmentMetadata.push({gapMm:gap,lowerSurfaceGapStartMm:a.gap,lowerSurfaceGapEndMm:b.gap,sampledGapErrorMm:error});
  };
  // Subdivision follows the observed gap error and the spatial step; how deep it
  // goes is the stroke's own length over the coincident-point tolerance. A
  // segment that still misses its tolerance at that width sits on a step in the
  // published surface, which no further subdivision can model.
  const split=(a,b)=>{
    const length=Math.hypot(b.point[0]-a.point[0],b.point[1]-a.point[1]);
    if(length<=TOLERANCE.point)return;
    const probes=[0.25,0.5,0.75].map(t=>sample(a.point.map((v,i)=>v+(b.point[i]-v)*t)));
    const error=Math.max(...probes.map((p,i)=>Math.abs(p.gap-(a.gap+(b.gap-a.gap)*(i+1)/4))));
    if(length>maxStepMm||error>toleranceMm){
      requireThat(length>2*TOLERANCE.point,'Lower-surface gap does not converge: the published surface steps within a coincident-point width of this stroke.');
      split(a,probes[1]);split(probes[1],b);
    }
    else append(a,b,length,error);
  };
  let previous=sample(source[0]);
  for(let i=1;i<source.length;i++){const next=sample(source[i]);split(previous,next);previous=next;}
  requireThat(points.length>=2&&volumesMm3.some(v=>v>0),'No positive material gap remains above the lower surface.');
  return {points,volumesMm3,segmentMetadata,gapsMm};
}
