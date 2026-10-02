import {resolveMaterialGeometry} from './build.mjs';
import {tessellateSolid} from './boolean-display.mjs';
import {makeMesh} from './mesh.mjs';
import {pointTriangleDistanceSquared} from './mesh-distance.mjs';
import {containsPoint} from './query.mjs';
import {requireThat} from './tolerance.mjs';

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
  return signed&&magnitude>1e-12&&containsPoint(prepared,point)?-magnitude:magnitude;
}
