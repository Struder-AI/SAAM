import {curveAssignment} from '../../core/print/curves.mjs';
import {recipeDefaults,workspaceConstructionIdentity} from '../../core/print/plan.mjs';
import {createGeometry} from '../../core/print/geometry.mjs';

// The workspace constructs every supplied component. Bundle only stores them.
export async function prepareWingBundle(handoff){
  const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(const p of handoff.geometry.vertices)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const originMm=[(min[0]+max[0])/2,(min[1]+max[1])/2,0];
  const local=p=>p.map((v,i)=>v-originMm[i]);
  const geometry={...handoff.geometry,vertices:handoff.geometry.vertices.map(local)};
  const curves=handoff.curves.map(c=>({...c,points:c.points.map(local)}));
  const base=recipeDefaults(),plan={...base,geometry,process:handoff.process,
    slices:{...base.slices,assignments:[curveAssignment({id:handoff.id,...handoff.trace,curves})]}};
  const workspace={schema:'saam-workspace-source/1',source:{...handoff.source,originMm},
    requirements:handoff.requirements,constructionIdentity:workspaceConstructionIdentity(plan)};
  return {plan:{...plan,workspace},preparedGeometry:await createGeometry(geometry)};
}
