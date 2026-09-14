// Shared Manifold C++/WASM boundary. Callers own and delete returned solids.
import Module from 'manifold-3d';
import {makeMesh} from './mesh.mjs';
import {requireThat} from './tolerance.mjs';
let runtime;
export const solidKernel=()=>runtime??=Module().then(module=>{module.setup();return module;});

// MeshGL stores Float32 positions. Carry their residual in three property
// channels so distinct nearby double-precision vertices do not collapse on
// export. Honor the kernel's explicit seam welds, never proximity-weld geometry.
export function preciseSolidMesh(solid){
  // Leave the first three property slots available to the kernel's tracked
  // normals: exporting a normal-bearing solid normalizes those slots.
  const encoded=solid.setProperties(6,(out,p,old)=>{for(let a=0;a<3;a++){out[a]=a<old.length?old[a]:0;out[3+a]=p[a]-Math.fround(p[a]);}});
  try{
    const mesh=encoded.getMesh(-1),n=mesh.vertProperties.length/mesh.numProp,parent=Array.from({length:n},(_,i)=>i);
    const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    for(let i=0;i<mesh.mergeFromVert.length;i++)parent[root(mesh.mergeFromVert[i])]=root(mesh.mergeToVert[i]);
    const vertices=[],triangles=[],ids=new Map();
    const vertex=i=>{const r=root(i);if(!ids.has(r)){const o=r*mesh.numProp;ids.set(r,vertices.length);vertices.push([0,1,2].map(a=>mesh.vertProperties[o+a]+mesh.vertProperties[o+6+a]));}return ids.get(r);};
    for(let i=0;i<mesh.triVerts.length;i+=3)triangles.push([vertex(mesh.triVerts[i]),vertex(mesh.triVerts[i+1]),vertex(mesh.triVerts[i+2])]);
    return {vertices,triangles};
  }finally{encoded.delete();}
}

export function solidFromMesh(kernel,mesh){
  const input=new kernel.Mesh({numProp:3,vertProperties:Float32Array.from(mesh.vertices.flat()),triVerts:Uint32Array.from(mesh.triangles.flat())});
  const solid=new kernel.Manifold(input);
  if(solid.status()!=='NoError'){const status=solid.status();solid.delete();throw new Error('Solid input: '+status);}
  if(solid.volume()<=0){solid.delete();throw new Error('Solid input must enclose positive material volume with outward winding.');}
  return solid;
}
export function meshFromSolid(solid){
  requireThat(solid.status()==='NoError'&&!solid.isEmpty(),'Text operation produced an invalid or empty solid.');
  const mesh=solid.getMesh(),vertices=[],triangles=[];
  for(let i=0;i<mesh.vertProperties.length;i+=mesh.numProp)vertices.push(Array.from(mesh.vertProperties.slice(i,i+3)));
  for(let i=0;i<mesh.triVerts.length;i+=3)triangles.push(Array.from(mesh.triVerts.slice(i,i+3)));
  return makeMesh(vertices,triangles);
}
export function combineSolids(left,right,operation){
  requireThat(['add','subtract'].includes(operation),'Solid operation must be add or subtract.');
  return operation==='add'?left.add(right):left.subtract(right);
}
