// Saved material geometry contains values, never travel rules or callbacks.
import {evaluateSurface} from './surface-evaluation.mjs';
import {referenceHeight} from './height-slice.mjs';
import {pointInRegion,pointSegmentDistance,segmentIntersection} from '../region/region2d.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';

export function regionContainsSegment(a,b,{loops,index=null,clearanceMm=0}){
  const inside=p=>index?index.contains(p):pointInRegion(p,loops);
  if(!loops||!inside(a)||!inside(b)||!inside([(a[0]+b[0])/2,(a[1]+b[1])/2]))return false;
  const threshold=Math.max(clearanceMm,ROUNDING_MM)-Math.min(clearanceMm/2,PRINT_RESOLUTION_MM);
  const edges=index?index.inCorridor(a,b,threshold):loops.flatMap(loop=>loop.map((c,i)=>[c,loop[(i+1)%loop.length]]));
  for(const [c,d] of edges)if(segmentIntersection(a,b,c,d))return false;
  for(const [c,d] of edges)if(Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b))<threshold)return false;
  return true;
}

export function materialHeight(material,x,y){
  if(material.kind==='planar')return material.zMm;
  const surface=material.surface;
  if(surface.kind==='height-field'&&!referenceHeight(surface.reference,x,y))return NaN;
  if(surface.kind==='plane')return surface.origin[2]-((x-surface.origin[0])*surface.normal[0]+(y-surface.origin[1])*surface.normal[1])/surface.normal[2];
  return evaluateSurface(surface,[x,y]).point[2];
}

// Geometry snapshots retain native numerical arrays in a JSON-readable form.
// Query indexes and native lifetimes are rebuilt privately by their consumers.
export function materialGeometryValue(value){
  if(ArrayBuffer.isView(value))return Array.from(value);
  if(Array.isArray(value))return value.map(materialGeometryValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,materialGeometryValue(item)]));
  if(typeof value==='function')throw Error('Material geometry must contain data, not executable queries.');
  return value;
}

export function heightGeometryValue(geometry){
  if(geometry.kind==='triangle-mesh')return materialGeometryValue({kind:geometry.kind,bounds:geometry.bounds,vertices:geometry.vertices,triangles:geometry.triangles,faceNormals:geometry.faceNormals});
  if(geometry.kind==='boolean')return {kind:geometry.kind,operation:geometry.operation,bounds:materialGeometryValue(geometry.bounds),operands:geometry.operands.map(heightGeometryValue)};
  if(geometry.patches)return materialGeometryValue({patches:geometry.patches,bounds:geometry.bounds});
  throw Error('Saved height reference needs mesh, spline or Boolean material geometry.');
}

// Restore packed admitted normals without revalidating unchanged mesh topology.
export function prepareHeightGeometry(geometry){
  if(geometry.kind==='triangle-mesh')return {...geometry,faceNormals:Float64Array.from(geometry.faceNormals)};
  if(geometry.kind==='boolean')return {...geometry,operands:geometry.operands.map(prepareHeightGeometry)};
  return geometry;
}
