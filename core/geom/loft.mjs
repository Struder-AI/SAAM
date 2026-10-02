// Public construction: corresponding planar polygon sections, in millimetres.
import {solidKernel} from './solid.mjs';
import {makeMesh} from './mesh.mjs';
import {requireThat} from './tolerance.mjs';

export async function loftPolygons(sections) {
  requireThat(Array.isArray(sections)&&sections.length>=2,'A loft needs at least two sections.');
  const n=sections[0].points.length;
  requireThat(n>=3&&sections.every((s,i)=>Number.isFinite(s.z)&&(!i||s.z>sections[i-1].z)&&s.points.length===n&&s.points.every(p=>p.length===2&&p.every(Number.isFinite))),'Loft sections need increasing Z and corresponding XY vertices.');
  const kernel=await solidKernel(),vertices=sections.flatMap(s=>s.points.map(p=>[...p,s.z])),triangles=[];
  const area=sections[0].points.reduce((sum,p,i)=>{const q=sections[0].points[(i+1)%n];return sum+p[0]*q[1]-q[0]*p[1];},0);
  const flip=area<0;
  for(let k=0;k<sections.length-1;k++)for(let i=0;i<n;i++){
    const j=(i+1)%n,a=k*n,b=(k+1)*n;
    triangles.push(...[[a+i,a+j,b+j],[a+i,b+j,b+i]].map(t=>flip?t.reverse():t));
  }
  for(const [index,up] of [[0,false],[sections.length-1,true]]){
    const points=sections[index].points;
    for(const raw of kernel.triangulate([flip?[...points].reverse():points])){
      const t=raw.map(i=>flip?n-1-i:i);
      triangles.push((up?t:[...t].reverse()).map(i=>index*n+i));
    }
  }
  const mesh=makeMesh(vertices,triangles);
  return {shape:'mesh',vertices:mesh.vertices,triangles:mesh.triangles,source:null};
}
