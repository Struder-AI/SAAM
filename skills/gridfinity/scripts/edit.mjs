import {requireThat} from '../../../core/private/extensions/numeric.mjs';

import {compileText} from '../../text/scripts/text.mjs';
import {compileGridfinity} from './gridfinity.mjs';

export async function gridfinityPlan(source,parameters){
  return {geometry:await compileGridfinity(parameters),placement:{xMm:20,yMm:20}};
}

export async function editGridfinity(source,parameters,{part,buildGeometry}){
  const plan=structuredClone(source);
  const owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  requireThat(owner,'Unknown gridfinity part.');
  const text=owner.geometry.shape==='text'?owner.geometry:null;
  const original=text?text.base:owner.geometry;
  requireThat(original?.shape==='gridfinity','Select an existing gridfinity part.');
  requireThat(parameters&&typeof parameters==='object'&&!Array.isArray(parameters),'Gridfinity parameters must be an object.');
  requireThat(parameters.kind===undefined||parameters.kind===original.parameters.kind,'Create another print to change gridfinity kind.');
  const geometry=await compileGridfinity({...original.parameters,...parameters});
  if(text){
    owner.geometry=await compileText(geometry,text.features,{buildGeometry,toleranceMm:text.toleranceMm,maxEdgeMm:text.maxEdgeMm});
  }else owner.geometry=geometry;
  return {geometry:plan.geometry};
}
