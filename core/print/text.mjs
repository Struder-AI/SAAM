// Public geometry preparation entry; writes only through the existing lifecycle.
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {loadBundle,updatePlan} from './bundle.mjs';
import {rhino} from './geometry.mjs';
import {buildShell} from './generate.mjs';
import {compileText} from '../../skills/text/scripts/text.mjs';
import {requireThat} from '../geom/tolerance.mjs';

export function unwrapTextGeometry(geometry){
  const layers=[];
  let base=geometry;
  while(base.shape==='text'&&base.base&&!base.standalone){layers.push(base);base=base.base;}
  return {base,layers};
}

export async function rebuildTextGeometry(base,layers,{buildGeometry}){
  let rebuilt=base;
  for(let i=layers.length-1;i>=0;i--){
    const layer=layers[i];
    rebuilt=await compileText(rebuilt,layer.features,{buildGeometry,toleranceMm:layer.toleranceMm,maxEdgeMm:layer.maxEdgeMm});
  }
  return rebuilt;
}

export async function applyText(directory,request,{expectedRevision}={}){
  requireThat(request&&Object.keys(request).every(k=>['feature','remove','part','standalone','regions','toleranceMm','maxEdgeMm'].includes(k)),'Unknown text request field.');
  requireThat(Boolean(request.feature)!==Boolean(request.remove),'Supply one feature to add/update, or remove its id.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing text.');
  const plan=structuredClone(state.plan);
  const owner=request.part?plan.geometry.parts?.find(p=>p.id===request.part):plan;
  requireThat(owner,'Unknown text target part.');
  const geometry=owner.geometry;
  requireThat(geometry.shape!=='assembly','Select an assembly part with part before applying text.');
  requireThat(request.standalone===undefined||typeof request.standalone==='boolean','standalone must be a boolean.');
  requireThat(!request.standalone||!request.remove,'Cannot remove a feature while replacing the target with standalone text.');
  const old=geometry.shape==='text'&&!request.standalone?geometry:null;
  const standalone=request.standalone??old?.standalone??false;
  // Standalone removes the substrate from material, not from the reference.
  // Preserve a native/mesh top so callers never have to copy its control net.
  const base=old?old.base:geometry.shape==='text'?(geometry.base??geometry):geometry;
  const features=structuredClone(old?.features??[]);
  if(request.remove){
    const index=features.findIndex(f=>f.id===request.remove);requireThat(index>=0,'Text feature id not found.');features.splice(index,1);
  }else{
    const feature=structuredClone(request.feature),index=features.findIndex(f=>f.id===(feature.id??'text'));
    // Updates merge feature settings; replace the complete reference/baseline.
    if(feature.fontPath){
      requireThat(isAbsolute(feature.fontPath),'Choose an absolute fontPath.');
      const info=await stat(feature.fontPath);requireThat(info.isFile()&&info.size<=32*1024*1024,'Font must be a regular file no larger than 32 MiB.');
      const bytes=await readFile(feature.fontPath);
      feature.font={data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),postscriptName:feature.postscriptName??null};
      delete feature.fontPath;delete feature.postscriptName;
    }
    const next={...(index>=0?features[index]:{}),...feature};
    if(index>=0)features[index]=next;else features.push(next);
  }
  if(!features.length){requireThat(base&&!standalone,'Removing the last standalone text feature would leave no geometry.');owner.geometry=base;}
  else {
    const r=await rhino();
    owner.geometry=await compileText(base,features,{buildGeometry:g=>buildShell(r,g),standalone,toleranceMm:request.toleranceMm??old?.toleranceMm??0.02,maxEdgeMm:request.maxEdgeMm??old?.maxEdgeMm??1});
  }
  // A removed/changed feature may invalidate a region selector. Let the caller
  // replace those assignments in the same validated edit, without an invalid
  // intermediate bundle or silently deleting dependent printing operations.
  if(request.regions!==undefined){
    requireThat(Array.isArray(request.regions),'Text regions must be an array of material assignments.');
    plan.composition.regions=structuredClone(request.regions);
  }
  return updatePlan(directory,plan,state.revision);
}
