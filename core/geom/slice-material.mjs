import {solidKernel} from './solid.mjs';
// Nominal owned slice volumes, independent of emitted beads or machine motion.
// Native planes clip segments exactly in their chart. Evaluated charts use the
// same bounded ray representation as material preparation at print resolution.
import {prepareSurfaceRay,surfaceRayIntersections} from './surface-ray.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {clipLineToRegion} from './curve-region.mjs';
import {pointInRegion,pointSegmentDistance} from '../region/region2d.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {normalize,dot} from './tolerance.mjs';

const onRegion=(p,loops)=>pointInRegion(p,loops)||loops.some(loop=>loop.some((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<=ROUNDING_MM));

export function prepareSliceMaterial(layer,{sampleStepMm=.2}={}){
  const {slice,region}=layer;
  if(!slice||!region?.length)return null;
  const center=region[0][0],normal=evaluateSurface(slice,center).normal;
  const direction=normalize(layer.direction??layer.gap?.direction??normal);
  const advance=layer.translationMm??layer.gap?.advanceMm??(layer.heightMm??layer.gap?.normalMm)/Math.abs(dot(normal,direction));
  const points=slice.kind==='plane'?region.flat().flatMap(uv=>{const p=evaluateSurface(slice,uv).point;return [p,p.map((v,k)=>v-advance*direction[k])];}):null;
  const bounds=points?{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))}:null;
  return {slice,region,direction,advance,bounds,query:prepareSurfaceRay(slice,direction,{points:region.flat(),sampleStepMm})};
}

const materialHits=(material,point)=>surfaceRayIntersections(material.query,point).map(hit=>({...hit,distanceMm:hit.distanceMm-(material.distanceOffsetMm??0)}));

export function offsetSliceMaterial(material,offsetMm){
  const delta=material.direction.map(v=>v*offsetMm);
  return {...material,distanceOffsetMm:(material.distanceOffsetMm??0)+offsetMm,
    bounds:material.bounds?{min:material.bounds.min.map((v,k)=>v+delta[k]),max:material.bounds.max.map((v,k)=>v+delta[k])}:null};
}

function segmentContacts(material,a,b,includeBase,boundary=true){
  if(!material)return [];
  const {slice,region,advance}=material,lower=includeBase?-advance-ROUNDING_MM:-advance+ROUNDING_MM;
  if(material.bounds&&[0,1,2].some(k=>Math.max(a[k],b[k])<material.bounds.min[k]-ROUNDING_MM||Math.min(a[k],b[k])>material.bounds.max[k]+ROUNDING_MM))return [];
  const inside=p=>boundary?onRegion(p,region):pointInRegion(p,region)&&!region.some(loop=>loop.some((a,i)=>pointSegmentDistance(p,a,loop[(i+1)%loop.length])<=ROUNDING_MM));
  const holds=hit=>(includeBase?hit.distanceMm>=lower:hit.distanceMm>lower)&&hit.distanceMm<=ROUNDING_MM&&inside(hit.chartPoint);
  if(slice.kind==='plane'){
    const first=materialHits(material,a)[0],last=materialHits(material,b)[0];if(!first||!last)return [];
    const delta=last.distanceMm-first.distanceMm;
    let low=0,high=1;
    if(delta===0){if(first.distanceMm<lower||first.distanceMm>ROUNDING_MM||!includeBase&&first.distanceMm===lower)return [];}
    else {
      const cuts=[(lower-first.distanceMm)/delta,(ROUNDING_MM-first.distanceMm)/delta].sort((x,y)=>x-y);
      low=Math.max(low,cuts[0]);high=Math.min(high,cuts[1]);if(low>=high)return [];
    }
    const direction=last.chartPoint.map((v,k)=>v-first.chartPoint[k]);
    if(Math.hypot(...direction)===0)return inside(first.chartPoint)?[[low,high]]:[];
    const clipped=clipLineToRegion(first.chartPoint,direction,region,{range:[low,high]});
    return [...clipped.spans,...clipped.contacts].filter(([lo,hi])=>hi>lo&&(boundary||inside(first.chartPoint.map((v,k)=>v+(lo+hi)/2*direction[k]))));
  }
  // Curved ownership retains print-resolution footprint samples, rather than
  // inferring an affine chart between the ends of a nonlinear projection.
  const count=Math.max(1,Math.ceil(Math.hypot(...b.map((v,k)=>v-a[k]))/PRINT_RESOLUTION_MM)),contacts=[];
  for(let i=0;i<=count;i++)if(materialHits(material,a.map((v,k)=>v+(b[k]-v)*i/count)).some(holds))
    contacts.push([Math.max(0,(i-.5)/count),Math.min(1,(i+.5)/count)]);
  return contacts;
}

export function sliceMaterialTouches(material,points,{includeBase=false}={}){
  if(!material||!points.length)return false;
  if(points.length===1)return segmentContacts(material,points[0],points[0],includeBase).length>0;
  return points.slice(1).some((point,index)=>segmentContacts(material,points[index],point,includeBase).length>0);
}

// Assign coincident interfaces to the earliest owning slice. Geometry returns
// only the uncovered footprint, so a later closed slab cannot claim the same
// boundary again or impose an unnecessary successor prerequisite.
export function subtractSliceMaterial(material,footprints,{includeBase=true,boundary=true}={}){
  const remaining=[],covered=[];let touched=false;
  for(const points of footprints)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],contacts=segmentContacts(material,a,b,includeBase,boundary).sort((x,y)=>x[0]-y[0]);
    if(!contacts.length){remaining.push([a,b]);continue;}
    touched=true;let from=0;
    const at=t=>a.map((v,k)=>v+t*(b[k]-v));
    for(const [lo,hi] of contacts){if(lo>from)remaining.push([at(from),at(lo)]);if(hi>Math.max(lo,from))covered.push([at(Math.max(lo,from)),at(hi)]);from=Math.max(from,hi);}
    if(from<1)remaining.push([at(from),b]);
  }
  return {remaining,covered,touched};
}

export function clipFootprintsToBounds(footprints,bounds){
  if(!bounds)return footprints;
  const result=[];
  for(const points of footprints)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];let low=0,high=1;
    for(let k=0;k<3&&low<=high;k++){
      const d=b[k]-a[k];
      if(d===0){if(a[k]<bounds.min[k]-PRINT_RESOLUTION_MM||a[k]>bounds.max[k]+PRINT_RESOLUTION_MM){low=1;high=0;}}
      else {const cuts=[(bounds.min[k]-PRINT_RESOLUTION_MM-a[k])/d,(bounds.max[k]+PRINT_RESOLUTION_MM-a[k])/d].sort((x,y)=>x-y);low=Math.max(low,cuts[0]);high=Math.min(high,cuts[1]);}
    }
    if(low<=high)result.push([a.map((v,k)=>v+low*(b[k]-v)),a.map((v,k)=>v+high*(b[k]-v))]);
  }
  return result;
}

// Exact convex decomposition of a planar nominal owned slab. null means this
// chart needs a different volume proof, never that its material is absent.
export async function sliceMaterialSolids(material){
  if(!material)return {parts:[],bounds:null};
  if(material.slice.kind!=='plane')return null;
  const kernel=await solidKernel(),vertices=material.region.flat();
  const triangles=kernel.triangulate(material.region),parts=triangles.map(triangle=>{
    const top=triangle.map(index=>evaluateSurface(material.slice,vertices[index]).point);
    return {vertices:[...top,...top.map(point=>point.map((v,k)=>v-material.advance*material.direction[k]))]};
  });
  return {parts,bounds:material.bounds};
}

// Mesh surface footprints include triangle interiors, not only their boundary.
export function triangleFootprints(triangles,{sampleStepMm=.2,offset=[0,0,0]}={}){
  return triangles.flatMap(([a,b,c])=>{
    const count=Math.max(1,Math.ceil(Math.max(Math.hypot(...b.map((v,k)=>v-a[k])),Math.hypot(...c.map((v,k)=>v-a[k])))/sampleStepMm));
    return Array.from({length:count+1},(_,i)=>[b,c].map(end=>a.map((v,k)=>v+(end[k]-v)*i/count+offset[k])));
  });
}
