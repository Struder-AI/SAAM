// Public geometry preparation entry; writes only through the existing lifecycle.
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {loadBundle,updatePlan} from './bundle.mjs';
import {rhino} from './geometry.mjs';
import {buildShell} from './generate.mjs';
import {compileText} from '../../skills/text/scripts/text.mjs';
import {requireThat} from '../geom/tolerance.mjs';

export async function applyText(directory,request,{expectedRevision}={}){
  requireThat(request&&Object.keys(request).every(k=>['feature','remove','part','standalone','toleranceMm','maxEdgeMm'].includes(k)),'Unknown text request field.');
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
  const base=request.standalone?null:old?old.base:geometry;
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
  if(!features.length){requireThat(base,'Removing the last standalone text feature would leave no geometry.');owner.geometry=base;}
  else {
    const r=await rhino();
    owner.geometry=await compileText(base,features,{buildGeometry:g=>buildShell(r,g),toleranceMm:request.toleranceMm??old?.toleranceMm??0.02,maxEdgeMm:request.maxEdgeMm??old?.maxEdgeMm??1});
  }
  return updatePlan(directory,plan,state.revision);
}
