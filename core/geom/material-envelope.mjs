// Saved material geometry contains values, never travel rules or callbacks.
import {evaluateSurface} from './surface-evaluation.mjs';
import {referenceHeight,heightReferenceRange} from './height-slice.mjs';
import {pointInRegion,pointSegmentDistance,segmentIntersection} from '../region/region2d.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,FLOAT64_EPSILON} from '../dimensions.mjs';

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

// A connection needs its owned footprint and a height query, never surface area.
// Only structurally horizontal charts become planar material. A sampled flat
// boundary cannot establish that the unsampled interior is flat.
export function surfaceConnectionMaterial(surface,region,{lineWidthMm=.4,sampleStepMm=.5}={}){
  if(!region.length)return null;
  const flat=points=>{
    if(!points.length)return false;
    let low=Infinity,high=-Infinity;for(const point of points){low=Math.min(low,point[2]);high=Math.max(high,point[2]);}
    return high-low<=FLOAT64_EPSILON*64*Math.max(1,Math.abs(low),Math.abs(high));
  };
  const horizontal=chart=>{
    if(chart.kind==='slice-chart')return horizontal(chart.slice);
    if(chart.kind==='height-field'){
      if(chart.reference.kind==='spline')return horizontal(chart.reference.patch);
      return flat(heightReferenceRange(chart.reference,region).map(z=>[0,0,z]));
    }
    const native=chart.patch??chart;
    if(native.cp)return flat(Array.from({length:native.cp.length/4},(_,i)=>[0,0,native.cp[4*i+2]/native.cp[4*i+3]]));
    const record=chart.referenceRecord??chart;
    if(['offset-chart','mapped-surface'].includes(record.representation))return horizontal(record.source);
    if(record.representation!=='surface-region')return false;
    const {geometry,selection}=record;
    if(selection.kind==='spline')return horizontal(geometry.patches.find(patch=>patch.name===selection.patch)??{});
    return flat(selection.rows.flat().map(index=>geometry.vertices[index]));
  };
  const graph=surface.kind==='height-field'||surface.kind==='plane'&&Math.abs(surface.normal[2])>PRINT_RESOLUTION_MM;
  const planar=surface.kind==='plane'||horizontal(surface);
  if(!graph&&!planar)return null;
  const world=region.map(loop=>loop.map(uv=>evaluateSurface(surface,uv).point));
  let zMm=-Infinity,low=Infinity;for(const loop of world)for(const point of loop){zMm=Math.max(zMm,point[2]);low=Math.min(low,point[2]);}
  const loops=world.map(loop=>loop.map(p=>p.slice(0,2)));
  if(planar&&zMm-low<=PRINT_RESOLUTION_MM)return {kind:'planar',loops,zMm,lineWidthMm};
  return graph?{kind:'surface',loops,surface,lineWidthMm,sampleStepMm,sagMm:0}:null;
}
