import {resolveMaterialGeometry} from './build.mjs';
import {tessellateSolid} from './boolean-display.mjs';
import {makeMesh} from './mesh.mjs';
import {pointTriangleDistanceSquared} from './mesh-distance.mjs';
import {containsPoint} from './query.mjs';
import {requireThat,cross,subtract,normalize,dot} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE,ROUNDING_MM} from '../dimensions.mjs';

// Native construction and tessellation finish before synchronous sampling.
export async function prepareSolidDistance(geometry,{toleranceMm}){
  const [material]=await resolveMaterialGeometry([geometry]);
  const tessellation=await tessellateSolid(material,{toleranceMm});
  const prepared=tessellation.kind==='triangle-mesh'?tessellation:makeMesh(tessellation.vertices,tessellation.triangles);
  return {prepared,report:{toleranceMm,triangles:prepared.triangles.length,representation:'tessellated solid distance; negative inside'}};
}

// Unbounded nearest distance; containment supplies the optional inside sign.
export function solidDistance(prepared,point,{signed}){
  requireThat(prepared?.kind==='triangle-mesh','Solid-distance fields need async geometry preparation before sampling.');
  let squared=Infinity;
  for(const triangle of prepared.triangles)squared=Math.min(squared,pointTriangleDistanceSquared(point,...triangle.map(i=>prepared.vertices[i])));
  const magnitude=Math.sqrt(squared);
  // A point within print resolution of the surface is on it and keeps a positive distance.
  return signed&&magnitude>PRINT_RESOLUTION_MM&&containsPoint(prepared,point)?-magnitude:magnitude;
}

// At a crease, distinct adjacent face normals define the exterior bisector.
// Coplanar triangulation does not weight one face more heavily than another.
export function solidNormal(prepared,point,{toleranceMm=PRINT_RESOLUTION_MM}={}){
  requireThat(prepared?.kind==='triangle-mesh','Solid normals need prepared manufactured geometry.');
  const state={distanceMm:Infinity,candidates:[]};
  for(const triangle of prepared.triangles){
    const [a,b,c]=triangle.map(i=>prepared.vertices[i]);
    const distance=Math.sqrt(pointTriangleDistanceSquared(point,a,b,c));
    if(distance>state.distanceMm+toleranceMm)continue;
    const vector=cross(subtract(b,a),subtract(c,a)),length=Math.hypot(...vector);
    if(length<=ROUNDING_MM**2)continue;
    if(distance<state.distanceMm){state.distanceMm=distance;state.candidates=state.candidates.filter(candidate=>candidate.distance<=distance+toleranceMm);}
    state.candidates.push({distance,normal:vector.map(value=>value/length)});
  }
  const normals=[];
  for(const candidate of state.candidates)if(!normals.some(normal=>dot(normal,candidate.normal)>1-ROUNDING_RELATIVE))normals.push(candidate.normal);
  requireThat(normals.length,'Selected material has no nondegenerate face normal.');
  return {distanceMm:state.distanceMm,normal:normalize(normals.reduce((sum,normal)=>sum.map((v,k)=>v+normal[k]),[0,0,0]))};
}
