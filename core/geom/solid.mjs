// Shared Manifold C++/WASM boundary. Callers own and delete returned solids.
import Module from 'manifold-3d';
import {makeMesh} from './mesh.mjs';
import {requireThat} from './tolerance.mjs';
let runtime;
export const solidKernel=()=>runtime??=Module().then(module=>{module.setup();return module;});
// The kernel addresses 32-bit WebAssembly memory, so the largest mesh it can
// hold is a capacity of the kernel rather than a chosen budget. Triangle cost
// covers its indices, vertex properties and halfedge structures.
export const KERNEL_TRIANGLE_CAPACITY=Math.floor(4*1024**3/64);
// An aborted instance stays unusable, so discard it after a kernel failure and
// let the next caller build a fresh one.
export function discardSolidKernel(){runtime=undefined;}

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
