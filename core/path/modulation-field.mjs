import {requireThat} from '../private/toolpath/numeric.mjs';

import {blobFalloff,validateBlobField} from '../geom/blob-field.mjs';
import {solidDistance} from '../geom/solid-distance.mjs';

const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const fields=(record,names)=>record&&Object.keys(record).sort().join()===names.split(',').sort().join();
const positive=n=>Number.isFinite(n)&&n>0;

export function modulationGeometrySources(record){
  const sources=[];
  const collect=(field,key)=>{
    if(field.kind==='solid-distance')sources.push({key,geometry:field.geometry,toleranceMm:field.toleranceMm});
    if(field.sources)field.sources.forEach((source,i)=>collect(source,`${key}.sources.${i}`));
    if(field.source)collect(field.source,`${key}.source`);
  };
  record.modifiers.forEach((modifier,i)=>collect(modifier.field,`modifiers.${i}.field`));
  return sources;
}

export function validateModulationField(field) {
  requireThat(field&&typeof field==='object','Modulation needs a scalar field.');
  if(field.kind==='solid-distance'){
    requireThat(fields(field,'kind,geometry,toleranceMm,signed')&&field.geometry&&typeof field.geometry==='object'&&positive(field.toleranceMm)&&typeof field.signed==='boolean',
      'Solid-distance field needs authored geometry, positive tessellation toleranceMm and signed boolean.');return field;
  }
  if(['add','multiply'].includes(field.kind)){
    requireThat(fields(field,'kind,sources')&&Array.isArray(field.sources)&&field.sources.length>0,'Composed field needs a nonempty sources list.');
    field.sources.forEach(validateModulationField);return field;
  }
  if(field.kind==='transfer'){
    requireThat(fields(field,'kind,source,input,output')&&[field.input,field.output].every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite))&&field.input[1]>field.input[0],
      'Transfer field needs source, increasing input range and finite output range.');
    validateModulationField(field.source);return field;
  }
  if(field.kind==='bumps'){
    requireThat(fields(field,'kind,periodMm,radiusMm,originMm')&&vector(field.periodMm)&&field.periodMm.every(positive)&&positive(field.radiusMm)&&vector(field.originMm),
      'Bumps field needs positive XYZ periodMm, radiusMm and originMm.');return field;
  }
  if(field.kind==='blob'){
    requireThat(fields(field,'kind,field'),'Blob modulation needs kind and field.');
    validateBlobField(field.field);return field;
  }
  if(field.kind==='noise'){
    requireThat(fields(field,'kind,cellMm,seed')&&positive(field.cellMm)&&Number.isSafeInteger(field.seed),
      'Noise field needs positive cellMm and a safe integer seed.');return field;
  }
  requireThat(vector(field.axis)&&Math.hypot(...field.axis)>0,'Field axis needs a nonzero XYZ direction.');
  if(field.kind==='periodic')requireThat(['kind','axis','periodMm','phaseRad'].every(k=>Object.hasOwn(field,k))&&Object.keys(field).every(k=>['kind','axis','periodMm','phaseRad','waveform','transitionFraction'].includes(k))&&positive(field.periodMm)&&Number.isFinite(field.phaseRad)&&['sine','triangle','square'].includes(field.waveform??'sine')&&(field.transitionFraction===undefined||Number.isFinite(field.transitionFraction)&&field.transitionFraction>=0&&field.transitionFraction<=.5),
    'Periodic field needs axis, positive periodMm and phaseRad.');
  else requireThat(field.kind==='ramp'&&fields(field,'kind,axis,fromMm,toMm')&&Number.isFinite(field.fromMm)&&Number.isFinite(field.toMm)&&field.toMm>field.fromMm,
    'Ramp field needs axis and increasing fromMm/toMm.');
  return field;
}

// Integer lattice hashing is deterministic across executions; no random state.
function latticeNoise(x,y,z,seed) {
  let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(z|0,2147483647)^(seed|0);
  h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295*2-1;
}
const smooth=t=>t*t*(3-2*t);

export function evaluateScalarField(field,point,{phaseRad=0,continuous=false,sideDirection=null}={}) {
  const options={phaseRad,continuous,sideDirection};
  if(field.kind==='solid-distance')return solidDistance(field.prepared,point,{signed:field.signed});
  if(field.kind==='add')return field.sources.reduce((v,source)=>v+evaluateScalarField(source,point,options),0);
  if(field.kind==='multiply')return field.sources.reduce((v,source)=>v*evaluateScalarField(source,point,options),1);
  if(field.kind==='transfer'){
    const value=evaluateScalarField(field.source,point,options);
    const t=Math.max(0,Math.min(1,(value-field.input[0])/(field.input[1]-field.input[0])));
    return field.output[0]+t*(field.output[1]-field.output[0]);
  }
  if(field.kind==='bumps'){
    let value=0;
    const ranges=point.map((v,i)=>[Math.ceil((v-field.radiusMm-field.originMm[i])/field.periodMm[i]),Math.floor((v+field.radiusMm-field.originMm[i])/field.periodMm[i])]);
    requireThat(ranges.flat().every(Number.isSafeInteger),'Bump lattice indices exceed exact integer representation; increase lattice spacing or move its origin closer.');
    for(let x=ranges[0][0];x<=ranges[0][1];x++)for(let y=ranges[1][0];y<=ranges[1][1];y++)for(let z=ranges[2][0];z<=ranges[2][1];z++){
      const center=[x,y,z].map((v,i)=>field.originMm[i]+v*field.periodMm[i]);
      value+=blobFalloff(Math.hypot(...point.map((v,i)=>v-center[i]))/field.radiusMm).value;
    }
    return value;
  }
  if(field.kind==='blob')return field.field.points.reduce((sum,p)=>sum+p.strength*blobFalloff(Math.hypot(...point.map((v,i)=>v-p.positionMm[i]))/p.reachMm).value,0);
  if(field.kind==='noise'){
    const grid=point.map(v=>v/field.cellMm),base=grid.map(Math.floor),fraction=grid.map((v,i)=>smooth(v-base[i]));
    let value=0;
    for(let i=0;i<8;i++){
      const bit=[i&1,(i>>1)&1,(i>>2)&1],weight=bit.reduce((w,b,a)=>w*(b?fraction[a]:1-fraction[a]),1);
      value+=weight*latticeNoise(base[0]+bit[0],base[1]+bit[1],base[2]+bit[2],field.seed);
    }
    return value;
  }
  const coordinate=point.reduce((sum,v,i)=>sum+v*field.axis[i],0)/Math.hypot(...field.axis);
  if(field.kind==='periodic'){
    const angle=coordinate/field.periodMm*2*Math.PI+field.phaseRad+phaseRad;
    requireThat(Number.isFinite(angle),'Periodic phase overflowed numeric representation.');
    if(field.waveform==='square'){
      const transition=field.transitionFraction??(continuous?.05:0);
      requireThat(!continuous||transition>0,'Position/orientation square fields need positive transitionFraction (default0.05 cycle).');
      if(transition){const t=Math.max(-1,Math.min(1,Math.sin(angle)/Math.sin(Math.PI*transition)));return t*(1.5-.5*t*t);}
      const sine=Math.sin(angle);
      if(Math.abs(sine)<1e-12&&sideDirection){const slope=field.axis.reduce((s,v,i)=>s+v*sideDirection[i],0);if(slope)return Math.cos(angle)*slope>=0?1:-1;}
      return sine>=0?1:-1;
    }
    return field.waveform==='triangle'?2/Math.PI*Math.asin(Math.sin(angle)):Math.sin(angle);
  }
  return Math.max(0,Math.min(1,(coordinate-field.fromMm)/(field.toMm-field.fromMm)));
}

export function scalarFieldBreakpoints(field,a,b,{phaseRad=0,continuous=false}={}){
  if(field.sources)return field.sources.flatMap(source=>scalarFieldBreakpoints(source,a,b,{phaseRad,continuous}));
  if(field.source)return scalarFieldBreakpoints(field.source,a,b,{phaseRad,continuous});
  if(field.kind!=='periodic'||field.waveform!=='square'||(field.transitionFraction??(continuous?.05:0))>0)return [];
  const coordinate=p=>p.reduce((s,v,i)=>s+v*field.axis[i],0)/Math.hypot(...field.axis)/field.periodMm*2+(field.phaseRad+phaseRad)/Math.PI;
  const first=coordinate(a),last=coordinate(b),out=[];
  if(first===last)return out;
  requireThat(Number.isSafeInteger(Math.ceil(Math.min(first,last)))&&Number.isSafeInteger(Math.floor(Math.max(first,last))),'Square phase indices exceed exact integer representation; increase period or reduce phase.');
  for(let k=Math.ceil(Math.min(first,last));k<=Math.floor(Math.max(first,last));k++){
    const t=(k-first)/(last-first);if(t>0&&t<1)out.push(t);
  }
  return out;
}

// Sample every feature before applying adaptive chord/process tolerances, so
// coincident periodic endpoints cannot hide an entire cycle.
export function fieldSampleStep(field) {
  if(field.kind==='solid-distance')return field.toleranceMm;
  if(['add','multiply'].includes(field.kind))return Math.min(...field.sources.map(fieldSampleStep));
  if(field.kind==='transfer')return fieldSampleStep(field.source);
  if(field.kind==='bumps')return Math.min(...field.periodMm,field.radiusMm)/8;
  if(field.kind==='periodic')return field.periodMm/8;
  if(field.kind==='noise')return field.cellMm/4;
  if(field.kind==='ramp')return (field.toMm-field.fromMm)/4;
  return field.field.points.reduce((step,p)=>Math.min(step,p.reachMm),Infinity)/4;
}

// Conservative analytic extrema support safety decisions before tessellation.
export function scalarFieldRange(field){
  if(field.kind==='transfer')return [Math.min(...field.output),Math.max(...field.output)];
  if(['periodic','noise'].includes(field.kind))return [-1,1];
  if(field.kind==='ramp')return [0,1];
  if(field.kind==='solid-distance')return field.signed?[-Infinity,Infinity]:[0,Infinity];
  if(field.kind==='blob')return [field.field.points.reduce((s,p)=>s+Math.min(0,p.strength),0),field.field.points.reduce((s,p)=>s+Math.max(0,p.strength),0)];
  if(field.kind==='bumps')return [0,field.periodMm.reduce((n,p)=>n*(Math.floor(2*field.radiusMm/p)+1),1)];
  const ranges=field.sources.map(scalarFieldRange);
  if(field.kind==='add')return ranges.reduce(([a,b],[c,d])=>[a+c,b+d],[0,0]);
  return ranges.reduce(([a,b],[c,d])=>{const products=[a*c,a*d,b*c,b*d];return products.some(Number.isNaN)?[-Infinity,Infinity]:[Math.min(...products),Math.max(...products)];},[1,1]);
}

export function scalarFieldInvariant(field,translation){
  if(field.kind==='transfer')return scalarFieldInvariant(field.source,translation);
  if(field.sources)return field.sources.every(source=>scalarFieldInvariant(source,translation));
  if(!['periodic','ramp'].includes(field.kind))return false;
  return Math.abs(field.axis.reduce((s,v,i)=>s+v*translation[i],0))<1e-10*Math.hypot(...field.axis)*Math.hypot(...translation);
}
