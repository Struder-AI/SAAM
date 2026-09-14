import {proposedPlan,initBundle,loadBundle,updatePlan} from '../../../core/print/bundle.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {compileText} from '../../text/scripts/text.mjs';
import {compileGridfinity} from './gridfinity.mjs';

export async function createGridfinityBundle(directory,parameters,options={}){
  const geometry=await compileGridfinity(parameters);
  const plan=await proposedPlan(options.machineId,options);
  plan.geometry=geometry;
  plan.placement={xMm:20,yMm:20};
  plan.skills['draped-skin'].enabled=false;
  plan.skills['planar-infill'].enabled=true;
  plan.skills['full-fill'].mode='solid-surfaces';
  await initBundle(directory,plan,options);
  return loadBundle(directory,{program:false});
}

export async function updateGridfinityBundle(directory,parameters,{expectedRevision,part}={}){
  requireThat(typeof expectedRevision==='string'&&expectedRevision.length>0,'Gridfinity edits require expectedRevision from the current print.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This review is stale. Reload before changing gridfinity.');
  const plan=structuredClone(state.plan);
  const owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  requireThat(owner,'Unknown gridfinity part.');
  const text=owner.geometry.shape==='text'?owner.geometry:null;
  const original=text?text.base:owner.geometry;
  requireThat(original?.shape==='gridfinity','Select an existing gridfinity part.');
  requireThat(parameters&&typeof parameters==='object'&&!Array.isArray(parameters),'Gridfinity parameters must be an object.');
  requireThat(parameters.kind===undefined||parameters.kind===original.parameters.kind,'Create another print to change gridfinity kind.');
  const geometry=await compileGridfinity({...original.parameters,...parameters});
  if(text){
    const r=await rhino();
    owner.geometry=await compileText(geometry,text.features,{buildGeometry:g=>buildShell(r,g),toleranceMm:text.toleranceMm,maxEdgeMm:text.maxEdgeMm});
  }else owner.geometry=geometry;
  return updatePlan(directory,plan,state.revision);
}
