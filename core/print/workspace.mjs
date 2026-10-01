// Bundle-owned one-way workspace handoff. Workspaces submit values, never
// write manifests or invoke machine export through this interface.
import {proposedPlan,initBundle} from './bundle.mjs';
import {curveAssignment} from './curves.mjs';
import {workspaceConstructionIdentity} from './plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

export function workspacePrinter(machineId='ultimaker-s5'){
  const machine=loadMachine(machineId);
  if(machine.kinematics!=='cartesian-fixed-vertical-nozzle')throw Error('This workspace needs a fixed vertical nozzle and Cartesian XYZ motion.');
  return {id:machine.id,name:machine.name,maxSectionHeightMm:machine.bounds.max[2]-machine.bounds.min[2]-3,
    maxChordMm:machine.bounds.max[0]-machine.bounds.min[0]-20};
}

export async function createFromWorkspace(directory,handoff,{machineId='ultimaker-s5'}={}){
  if(!handoff?.source||!handoff?.requirements||!handoff?.geometry||!handoff?.curves?.length)throw Error('Workspace handoff needs geometry, construction curves, source parameters and requirements.');
  const base=await proposedPlan(machineId),min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(const p of handoff.geometry.vertices)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const local=p=>[p[0]-min[0],p[1]-min[1],p[2]],geometry={...handoff.geometry,vertices:handoff.geometry.vertices.map(local)},curves=handoff.curves.map(c=>({...c,points:c.points.map(local)}));
  const plan={...base,geometry,
    placement:{xMm:base.placement.xMm-(max[0]-min[0])/2,yMm:base.placement.yMm-(max[1]-min[1])/2},
    process:{...base.process,...handoff.process},
    slices:{...base.slices,assignments:[curveAssignment({id:handoff.id,...handoff.trace,curves})]}};
  const workspace={schema:'saam-workspace-source/1',source:{...handoff.source,originMm:[...min,0]},requirements:handoff.requirements,constructionIdentity:workspaceConstructionIdentity(plan)};
  return initBundle(directory,{...plan,workspace},{machineId});
}
