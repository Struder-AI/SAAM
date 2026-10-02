import {compileGridfinity} from './gridfinity.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

export async function editGridfinity(source,parameters,{part,buildGeometry,constructSolids,mappedTextMaterial,compileText}){
  const plan=structuredClone(source);
  const owner=part?plan.geometry.parts?.find(p=>p.id===part):plan;
  requireThat(owner,'Unknown gridfinity part.');
  const text=owner.geometry.shape==='text'?owner.geometry:null;
  const original=text?text.base:owner.geometry;
  requireThat(original?.shape==='gridfinity','Select an existing gridfinity part.');
  requireThat(parameters&&typeof parameters==='object'&&!Array.isArray(parameters),'Gridfinity parameters must be an object.');
  requireThat(parameters.kind===undefined||parameters.kind===original.parameters.kind,'Create another print to change gridfinity kind.');
  const geometry=await compileGridfinity({...original.parameters,...parameters},{constructSolids});
  if(text){
    requireThat(typeof compileText==='function','Gridfinity text needs the selected text extension compiler.');
    owner.geometry=await compileText(geometry,text.features,{buildGeometry,constructSolids,mappedTextMaterial,toleranceMm:text.toleranceMm,maxEdgeMm:text.maxEdgeMm});
  }else owner.geometry=geometry;
  return {geometry:plan.geometry};
}
