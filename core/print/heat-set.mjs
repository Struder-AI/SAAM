import {loadBundle,updatePlan} from './bundle.mjs';
import {rhino} from './geometry.mjs';
import {buildShell} from './generate.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {compileHeatSet} from '../../skills/heat-set-inserts/scripts/geometry.mjs';
import {compileText} from '../../skills/text/scripts/text.mjs';

export async function applyHeatSet(directory,request,{expectedRevision}={}){
  requireThat(request&&Object.keys(request).every(k=>['feature','remove','part','toleranceMm'].includes(k)),'Unknown heat-set request field.');
  requireThat(Boolean(request.feature)!==Boolean(request.remove),'Supply one heat-set feature or remove id.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing inserts.');
  const plan=structuredClone(state.plan),owner=request.part?plan.geometry.parts?.find(p=>p.id===request.part):plan;
  requireThat(owner&&owner.geometry.shape!=='assembly','Select an existing assembly part before applying heat-set inserts.');
  const wrappers=[];let geometry=owner.geometry;
  while(geometry.shape==='text'&&geometry.base){wrappers.push(geometry);geometry=geometry.base;}
  const old=geometry.shape==='heat-set'?geometry:null,base=old?old.base:geometry;
  const features=structuredClone(old?.features??[]);
  if(request.remove){const index=features.findIndex(f=>f.id===request.remove);requireThat(index>=0,'Heat-set feature not found.');features.splice(index,1);}
  else{
    const feature=request.feature,index=features.findIndex(f=>f.id===(feature.id??'insert'));
    // Same-print values are the actual last-used feature settings. New named
    // holes inherit dimensions and fin choices, but never copy placement silently.
    const previous=index>=0?features[index]:features.at(-1);
    const reusable=previous?Object.fromEntries(Object.entries(previous).filter(([k])=>!['id','positionMm'].includes(k))):{};
    const next={...reusable,...(index>=0?features[index]:{}),...feature};
    if(index>=0)features[index]=next;else features.push(next);
  }
  const r=await rhino(),buildGeometry=g=>buildShell(r,g);
  let rebuilt=features.length?await compileHeatSet(base,features,{buildGeometry,toleranceMm:request.toleranceMm??old?.toleranceMm??0.01}):base;
  for(const wrapper of wrappers.reverse())rebuilt=await compileText(rebuilt,wrapper.features,{buildGeometry,toleranceMm:wrapper.toleranceMm,maxEdgeMm:wrapper.maxEdgeMm});
  owner.geometry=rebuilt;
  return updatePlan(directory,plan,state.revision);
}
