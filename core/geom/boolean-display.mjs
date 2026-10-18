// Mesh conversion is an output operation. Native surface Booleans tessellate
// their completed boundary; mixed inputs retain mesh display composition.
import {solidKernel,solidFromMesh,preciseSolidMesh,combineSolids} from './solid.mjs';
import {tessellateShell} from './tessellate.mjs';
import {tessellateSurfaceSolid} from './surface-tessellate.mjs';
import {requireThat} from './tolerance.mjs';
import {sewSurfaceBoundary} from './surface-topology.mjs';
import {outwardSigns} from '../region/section.mjs';
import {PRINT_RESOLUTION_MM,CHORD_TOLERANCE_MM,COARSE_CHORD_TOLERANCE_MM} from '../dimensions.mjs';

const KERNEL_OPERATION={union:'add',difference:'subtract',intersection:'intersect'};

// -> {vertices, triangles, notes}: no material is an empty mesh with a note.
export async function booleanDisplayMesh(shell,{toleranceMm=COARSE_CHORD_TOLERANCE_MM}={}){
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

export async function tessellateSolid(shell,{toleranceMm=CHORD_TOLERANCE_MM}={}){
  if(shell.kind==='surface-solid')return tessellateSurfaceSolid(shell,{toleranceMm});
  if(shell.kind==='boolean')return booleanDisplayMesh(shell,{toleranceMm});
  if(shell.patches?.length&&!shell.closure?.unmatched.length){
    const signs=outwardSigns(shell),patches=shell.patches.map((patch,i)=>({...patch,normalSide:signs.get(patch),sourceFace:i}));
    const topology=sewSurfaceBoundary(patches,[],{toleranceMm:PRINT_RESOLUTION_MM});
    if(!topology.unmatched.length)return tessellateSurfaceSolid({...shell,kind:'surface-solid',patches,topology,construction:{toleranceMm:PRINT_RESOLUTION_MM}},{toleranceMm});
  }
  // Legacy shells can close geometrically with unmatched chart topology. Their
  // existing output converter retains that supported parameterization.
  return tessellateShell(shell,{toleranceMm});
}
