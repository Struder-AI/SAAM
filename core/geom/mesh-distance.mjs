// Bounded nearest-distance queries against the original triangle surface.
import {triangleBVH} from './triangle-bvh.mjs';
import {requireThat} from './tolerance.mjs';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
function segmentSquared(p,a,b){
  const edge=sub(b,a),v=sub(p,a),t=Math.max(0,Math.min(1,dot(v,edge)/dot(edge,edge)));
  return v.reduce((sum,x,k)=>sum+(x-t*edge[k])**2,0);
}
export function pointTriangleDistanceSquared(p,a,b,c){
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),aa=dot(ab,ab),cc=dot(ac,ac),bc=dot(ab,ac),pa=dot(ap,ab),pc=dot(ap,ac),den=aa*cc-bc*bc;
  if(den>0){
    const u=(pa*cc-pc*bc)/den,v=(pc*aa-pa*bc)/den;
    if(u>=0&&v>=0&&u+v<=1)return ap.reduce((sum,x,k)=>sum+(x-u*ab[k]-v*ac[k])**2,0);
  }
  return Math.min(segmentSquared(p,a,b),segmentSquared(p,b,c),segmentSquared(p,c,a));
}
export function createMeshDistanceQuery(mesh){
  requireThat(mesh?.kind==='triangle-mesh','Mesh distance queries require validated triangle geometry.');
  const tree=triangleBVH(mesh.vertices,mesh.triangles);
  return (point,limitMm)=>{
    requireThat(point.length===3&&point.every(Number.isFinite)&&Number.isFinite(limitMm)&&limitMm>0,'Mesh distance needs finite XYZ and a positive distance limit.');
    let best=Infinity;
    tree.query(point.map(v=>v-limitMm),point.map(v=>v+limitMm),i=>{
      const t=mesh.triangles[i];best=Math.min(best,pointTriangleDistanceSquared(point,...t.map(j=>mesh.vertices[j])));
    });
    return best<=limitMm*limitMm?Math.sqrt(best):Infinity;
  };
}
