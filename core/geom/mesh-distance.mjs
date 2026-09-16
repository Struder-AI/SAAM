// Bounded nearest-distance queries against the original triangle surface.
import {triangleBVH} from './triangle-bvh.mjs';
import {requireThat} from './tolerance.mjs';
// Ledge validation makes millions of these queries. Keep the same projection
// and edge fallback without allocating vectors for every candidate triangle.
function segmentSquared(p,a,b){
  const ex=b[0]-a[0],ey=b[1]-a[1],ez=b[2]-a[2],vx=p[0]-a[0],vy=p[1]-a[1],vz=p[2]-a[2];
  const t=Math.max(0,Math.min(1,(vx*ex+vy*ey+vz*ez)/(ex*ex+ey*ey+ez*ez)));
  return (vx-t*ex)**2+(vy-t*ey)**2+(vz-t*ez)**2;
}
export function pointTriangleDistanceSquared(p,a,b,c){
  const bx=b[0]-a[0],by=b[1]-a[1],bz=b[2]-a[2],cx=c[0]-a[0],cy=c[1]-a[1],cz=c[2]-a[2];
  const px=p[0]-a[0],py=p[1]-a[1],pz=p[2]-a[2];
  const aa=bx*bx+by*by+bz*bz,cc=cx*cx+cy*cy+cz*cz,bc=bx*cx+by*cy+bz*cz;
  const pa=px*bx+py*by+pz*bz,pc=px*cx+py*cy+pz*cz,den=aa*cc-bc*bc;
  if(den>0){
    const u=(pa*cc-pc*bc)/den,v=(pc*aa-pa*bc)/den;
    if(u>=0&&v>=0&&u+v<=1)return (px-u*bx-v*cx)**2+(py-u*by-v*cy)**2+(pz-u*bz-v*cz)**2;
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
      const t=mesh.triangles[i];best=Math.min(best,pointTriangleDistanceSquared(point,mesh.vertices[t[0]],mesh.vertices[t[1]],mesh.vertices[t[2]]));
    });
    return best<=limitMm*limitMm?Math.sqrt(best):Infinity;
  };
}
