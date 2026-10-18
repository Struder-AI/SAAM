import {bezierPieces} from './surface-intersection.mjs';
import {restrictBezierNet,splitBezierNet} from './bezier-net.mjs';
import {convexBounds,convexIntersects,boundsOverlap} from './convex-clearance.mjs';
import {intersect} from '../region/intersection.mjs';
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
  const top=slice.kind==='plane'?region.flat().map(uv=>evaluateSurface(slice,uv).point):slice.kind==='patch'?
    Array.from({length:slice.patch.cp.length/4},(_,i)=>[0,1,2].map(k=>slice.patch.cp[i*4+k]/slice.patch.cp[i*4+3])):null;
  const points=top?.flatMap(p=>[p,p.map((v,k)=>v-advance*direction[k])]);
  const bounds=points?points.reduce((box,p)=>({min:box.min.map((v,k)=>Math.min(v,p[k])),max:box.max.map((v,k)=>Math.max(v,p[k]))}),
    {min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}):null;
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
  if(material.slice.kind!=='plane')return material.slice.kind==='patch'?{parts:[],bounds:material.bounds,material}:null;
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

// Three-valued nominal volume contact: false is a hull separation proof, true
// has an actual material witness, null retains unresolved boundary contact.
// Bezier subdivision refines geometry only; it never inspects deposited paths.
export function sliceMaterialVolumeContact(material,volume){
  if(material.bounds&&!boundsOverlap(material.bounds,convexBounds(volume),ROUNDING_MM))return false;
  for(const point of volume.vertices??[])if(materialHits(material,point).some(hit=>hit.distanceMm>=-material.advance-ROUNDING_MM&&hit.distanceMm<=ROUNDING_MM&&onRegion(hit.chartPoint,material.region)))return true;
  if(material.slice.kind!=='patch')return null;
  const pending=[...bezierPieces(material.slice.patch)];let unresolved=false;
  while(pending.length){
    const piece=pending.pop(),rectangle=[[[piece.u[0],piece.v[0]],[piece.u[1],piece.v[0]],[piece.u[1],piece.v[1]],[piece.u[0],piece.v[1]]]],region=intersect(material.region,rectangle);
    if(!region.length)continue;
    const uv=region.flat(),bounds=[0,1].map(k=>[Math.min(...uv.map(p=>p[k])),Math.max(...uv.map(p=>p[k]))]);
    const ranges=bounds.map(([a,b],k)=>{const domain=piece[k?'v':'u'];return [(a-domain[0])/(domain[1]-domain[0]),(b-domain[0])/(domain[1]-domain[0])];});
    const net=restrictBezierNet(piece.net,ranges),top=net.flat().map(p=>p.slice(0,3).map(v=>v/p[3]));
    const hull={vertices:[...top,...top.map(p=>p.map((v,k)=>v-material.advance*material.direction[k]))]};
    if(!convexIntersects(hull,volume,ROUNDING_MM))continue;
    const center=bounds.map(([a,b])=>(a+b)/2),probes=[...uv,...(onRegion(center,region)?[center]:[])];
    for(const point of probes){const top=evaluateSurface(material.slice,point).point;
      for(const fraction of [0,.5,1])if(convexIntersects({vertices:[top.map((v,k)=>v-fraction*material.advance*material.direction[k])]},volume,ROUNDING_MM))return true;
    }
    const box=convexBounds({vertices:top}),diameter=Math.hypot(...box.max.map((v,k)=>v-box.min[k]));
    if(diameter<=PRINT_RESOLUTION_MM){unresolved=true;continue;}
    const extent=[Math.max(...net[0].map((_,j)=>Math.hypot(...net[0][j].slice(0,3).map((v,k)=>v/net[0][j][3]-net.at(-1)[j][k]/net.at(-1)[j][3])))),
      Math.max(...net.map(row=>Math.hypot(...row[0].slice(0,3).map((v,k)=>v/row[0][3]-row.at(-1)[k]/row.at(-1)[3]))))];
    const axis=extent[0]>=extent[1]?0:1,domain=bounds[axis],mid=(domain[0]+domain[1])/2;
    if(!(mid>domain[0]&&mid<domain[1])){unresolved=true;continue;}
    const children=splitBezierNet(net,axis);
    for(let i=0;i<2;i++)pending.push({...piece,net:children[i],u:axis?bounds[0]:[i?mid:domain[0],i?domain[1]:mid],
      v:axis?[i?mid:domain[0],i?domain[1]:mid]:bounds[1]});
  }
  return unresolved?null:false;
}
