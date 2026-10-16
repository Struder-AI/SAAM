// Mesh conversion is an output operation. Native surface Booleans tessellate
// their completed boundary; mixed inputs retain mesh display composition.
import {solidKernel,solidFromMesh,preciseSolidMesh,combineSolids} from './solid.mjs';
import {tessellateShell} from './tessellate.mjs';
import {tessellateSurfaceSolid} from './surface-tessellate.mjs';
import {requireThat} from './tolerance.mjs';

const KERNEL_OPERATION={union:'add',difference:'subtract',intersection:'intersect'};

// -> {vertices, triangles, notes}: no material is an empty mesh with a note.
export async function booleanDisplayMesh(shell,{toleranceMm=0.05}={}){
  if(shell.kind==='surface-solid')return tessellateSurfaceSolid(shell,{toleranceMm});
  if(shell.empty)return {vertices:[],triangles:[],notes:[...(shell.notes??[]),`The ${shell.operation} leaves no material; check the operands overlap as intended.`]};
  const kernel=await solidKernel(),owned=[],notes=[...(shell.notes??[])];
  const solidOf=async node=>{
    if(node.kind!=='boolean'){const mesh=await tessellateSolid(node,{toleranceMm});notes.push(...mesh.notes??[]);const solid=solidFromMesh(kernel,mesh);owned.push(solid);return solid;}
    const operands=[];
    for(const operand of node.operands)operands.push(await solidOf(operand));
    const [first,...rest]=operands;
    return rest.reduce((result,next)=>{const combined=combineSolids(result,next,KERNEL_OPERATION[node.operation]);owned.push(combined);return combined;},first);
  };
  try{
    const solid=await solidOf(shell);
    requireThat(solid.status()==='NoError',`The solid kernel could not combine the Boolean operands (${solid.status()}).`);
    if(solid.isEmpty())return {vertices:[],triangles:[],notes:[...notes,`The ${shell.operation} leaves no material; check the operands overlap as intended.`]};
    return {...preciseSolidMesh(solid),notes};
  }finally{for(const solid of owned)solid.delete();}
}

export async function tessellateSolid(shell,{toleranceMm=0.02}={}){
  if(shell.kind==='surface-solid')return tessellateSurfaceSolid(shell,{toleranceMm});
  return shell.kind==='boolean'?booleanDisplayMesh(shell,{toleranceMm}):tessellateShell(shell,{toleranceMm});
}
