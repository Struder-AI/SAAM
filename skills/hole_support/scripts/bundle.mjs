import {loadBundle,updatePlan} from '../../../core/print/bundle.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {detectHoles} from './detect.mjs';
import {compileHoleSupport} from './geometry.mjs';
import {STRATEGIES,holeFeature} from './record.mjs';

export async function inspectHoleSupport(directory){
  const state=await loadBundle(directory,{program:false}),r=await rhino();
  const parts=state.plan.geometry.shape==='assembly'?state.plan.geometry.parts:[{id:null,geometry:state.plan.geometry,zMm:0}];
  const features=[];
  for(const part of parts){
    if((part.zMm??0)!==0)continue;
    const geometry=part.geometry.shape==='hole_support'?part.geometry.base:part.geometry;
    for(const f of detectHoles(buildShell(r,geometry),state.plan.process))features.push({...f,part:part.id,applied:part.geometry.shape==='hole_support'?part.geometry.features.find(a=>Math.hypot(a.centerMm[0]-f.centerMm[0],a.centerMm[1]-f.centerMm[1],a.centerMm[2]-f.centerMm[2])<0.05)??null:null});
  }
  return {revision:state.revision,features,strategies:STRATEGIES};
}
export async function applyHoleSupport(directory,request,{expectedRevision}={}){
  requireThat(request&&Object.keys(request).every(k=>['feature','remove','part','process','holeLineWidthMm'].includes(k))&&Boolean(request.feature)!==Boolean(request.remove),'Supply a hole_support feature or remove id, with optional part and process.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing hole support.');
  const plan=structuredClone(state.plan),owner=request.part?plan.geometry.parts?.find(p=>p.id===request.part):plan;
  if(request.process){
    requireThat(Object.keys(request.process).every(k=>['layerMm','firstLayerMm','lineWidthMm'].includes(k))&&Object.values(request.process).every(v=>Number.isFinite(v)&&v>0),'Only positive layerMm, firstLayerMm and lineWidthMm may be rebuilt with hole_support.');
    Object.assign(plan.process,request.process);
  }
  if(Object.hasOwn(request,'holeLineWidthMm')){
    requireThat(request.holeLineWidthMm===null||Number.isFinite(request.holeLineWidthMm)&&request.holeLineWidthMm>0,'holeLineWidthMm must be positive or null for the body bead width.');
    plan.skills['full-fill'].holeLineWidthMm=request.holeLineWidthMm;
  }
  requireThat(owner&&owner.geometry.shape!=='assembly','Select one existing assembly component.');
  const old=owner.geometry.shape==='hole_support'?owner.geometry:null,base=old?.base??owner.geometry,features=structuredClone(old?.features??[]);
  if(request.remove){const i=features.findIndex(f=>f.id===request.remove);requireThat(i>=0,'hole_support feature not found.');features.splice(i,1);}
  else{const i=features.findIndex(f=>f.id===(request.feature.id??'hole')),f=holeFeature({...features[i],...request.feature});if(i<0)features.push(f);else features[i]=f;}
  const process={layerMm:plan.process.layerMm,firstLayerMm:plan.process.firstLayerMm,lineWidthMm:plan.process.lineWidthMm,holeLineWidthMm:plan.skills['full-fill'].holeLineWidthMm??plan.process.lineWidthMm};
  const r=await rhino();owner.geometry=features.length?await compileHoleSupport(base,features,process,{buildGeometry:g=>buildShell(r,g)}):base;
  return updatePlan(directory,plan,state.revision);
}
