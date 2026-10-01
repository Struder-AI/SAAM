// Bundle-owned one-way workspace handoff. Workspaces submit values, never
// write manifests or invoke machine export through this interface.
import {proposedPlan,initBundle} from './bundle.mjs';
import {curveAssignment} from './curves.mjs';
import {workspaceConstructionIdentity} from './plan.mjs';

export async function createFromWorkspace(directory,handoff,{machineId='ultimaker-s5'}={}){
  if(!handoff?.source||!handoff?.requirements||!handoff?.geometry||!handoff?.curves?.length)throw Error('Workspace handoff needs geometry, construction curves, source parameters and requirements.');
  const base=await proposedPlan(machineId),min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(const p of handoff.geometry.vertices)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const plan={...base,geometry:handoff.geometry,
    placement:{xMm:base.placement.xMm-(min[0]+max[0])/2,yMm:base.placement.yMm-(min[1]+max[1])/2},
    process:{...base.process,...handoff.process},
    slices:{...base.slices,assignments:[curveAssignment({id:handoff.id,curves:handoff.curves})]}};
  const workspace={schema:'saam-workspace-source/1',source:handoff.source,requirements:handoff.requirements,constructionIdentity:workspaceConstructionIdentity(plan)};
  return initBundle(directory,{...plan,workspace},{machineId});
}
