// Close an authored mesh patch vertically to a horizontal plane. The roof's
// triangulation survives, including holes and disconnected components.
import {makeMesh} from './mesh.mjs';
import {requireThat} from './tolerance.mjs';

export function closeMeshPatchToPlane(mesh,{triangleIndices,planeZMm,offsetMm=0}){
  requireThat(Array.isArray(mesh?.vertices)&&mesh.vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)), 'Mesh patch needs finite XYZ vertices.');
  requireThat(Number.isFinite(planeZMm)&&Number.isFinite(offsetMm),'Mesh patch plane and vertical offset must be finite.');
  requireThat(Array.isArray(triangleIndices)&&triangleIndices.length>0&&new Set(triangleIndices).size===triangleIndices.length,'Select distinct mesh patch triangles.');
  const vertices=[],roof=[],indices=new Map(),edges=new Map();
  function vertex(id){
    requireThat(Number.isSafeInteger(id)&&id>=0&&id<mesh.vertices.length,'Invalid mesh patch vertex index.');
    if(!indices.has(id)){
      const [x,y,z]=mesh.vertices[id];
      requireThat(z+offsetMm>planeZMm,'Every lowered patch vertex must lie above its closure plane; change the patch or gap.');
      indices.set(id,vertices.length);vertices.push([x,y,z+offsetMm]);
    }
    return indices.get(id);
  }
  for(const id of triangleIndices){
    requireThat(Number.isSafeInteger(id)&&id>=0&&id<mesh.triangles?.length,'Invalid mesh patch triangle index.');
    const triangle=mesh.triangles[id];
    requireThat(Array.isArray(triangle)&&triangle.length===3,'Invalid mesh patch triangle.');
    const ids=triangle.map(vertex),[a,b,c]=ids.map(i=>vertices[i]);
    const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    requireThat(area!==0,'Mesh patch has a vertical or degenerate triangle; select a roof with a nonzero XY projection.');
    const top=area>0?ids:[ids[0],ids[2],ids[1]];roof.push(top);
    for(let k=0;k<3;k++){
      const from=top[k],to=top[(k+1)%3],key=from<to?`${from}:${to}`:`${to}:${from}`;
      if(!edges.has(key))edges.set(key,[]);edges.get(key).push([from,to]);
    }
  }
  const count=vertices.length,triangles=[...roof];
  for(let i=0;i<count;i++){const [x,y]=vertices[i];vertices.push([x,y,planeZMm]);}
  for(const [a,b,c] of roof)triangles.push([a+count,c+count,b+count]);
  for(const incidences of edges.values()){
    requireThat(incidences.length<=2,'Mesh patch has a nonmanifold edge.');
    if(incidences.length===2){
      requireThat(incidences[0][0]===incidences[1][1]&&incidences[0][1]===incidences[1][0],'Mesh patch folds over itself in XY; select separate accessible roof patches.');
    }else{
      const [a,b]=incidences[0];triangles.push([a,a+count,b+count],[a,b+count,b]);
    }
  }
  // The ordinary ingestion boundary checks manifold fans and self-intersections;
  // point-only joins and overlapping projections are never trimmed silently.
  makeMesh(vertices,triangles,{name:'closed mesh patch'});
  return {shape:'mesh',vertices,triangles,source:null};
}
