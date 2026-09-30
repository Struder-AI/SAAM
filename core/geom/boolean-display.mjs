// Triangles for a solid, for display and for solid modifiers (text, heat-set
// bores). A boolean's operands are tessellated and combined by the Manifold
// kernel; slicing never uses this, and combines the operands' native sections
// layer by layer instead (boolean-solid.mjs).
import {solidKernel,solidFromMesh,preciseSolidMesh,combineSolids} from './solid.mjs';
import {tessellateShell} from './tessellate.mjs';
import {requireThat} from './tolerance.mjs';

const KERNEL_OPERATION={union:'add',difference:'subtract',intersection:'intersect'};

export async function booleanDisplayMesh(shell,{toleranceMm=0.05}={}){
  const kernel=await solidKernel(),owned=[];
  const solidOf=node=>{
    if(node.kind!=='boolean'){const solid=solidFromMesh(kernel,tessellateShell(node,{toleranceMm}));owned.push(solid);return solid;}
    const [first,...rest]=node.operands.map(solidOf);
    return rest.reduce((result,next)=>{const combined=combineSolids(result,next,KERNEL_OPERATION[node.operation]);owned.push(combined);return combined;},first);
  };
  try{
    const solid=solidOf(shell);
    requireThat(solid.status()==='NoError'&&!solid.isEmpty(),'The boolean leaves no material; check the operands overlap as intended.');
    return preciseSolidMesh(solid);
  }finally{for(const solid of owned)solid.delete();}
}

export async function tessellateSolid(shell,{toleranceMm=0.02}={}){
  return shell.kind==='boolean'?booleanDisplayMesh(shell,{toleranceMm}):tessellateShell(shell,{toleranceMm});
}
