import {requireThat} from '../geom/tolerance.mjs';
import {blobFalloff,validateBlobField} from '../geom/blob-field.mjs';

const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const fields=(record,names)=>record&&Object.keys(record).sort().join()===names.split(',').sort().join();
const positive=n=>Number.isFinite(n)&&n>0;

export function validateModulationField(field) {
  requireThat(field&&typeof field==='object','Modulation needs a scalar field.');
  if(field.kind==='blob'){
    requireThat(fields(field,'kind,field'),'Blob modulation needs kind and field.');
    validateBlobField(field.field);return field;
  }
  if(field.kind==='noise'){
    requireThat(fields(field,'kind,cellMm,seed')&&positive(field.cellMm)&&Number.isSafeInteger(field.seed),
      'Noise field needs positive cellMm and a safe integer seed.');return field;
  }
  requireThat(vector(field.axis)&&Math.hypot(...field.axis)>0,'Field axis needs a nonzero XYZ direction.');
  if(field.kind==='periodic')requireThat(fields(field,'kind,axis,periodMm,phaseRad')&&positive(field.periodMm)&&Number.isFinite(field.phaseRad),
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

export function evaluateScalarField(field,point) {
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
  if(field.kind==='periodic')return Math.sin(coordinate/field.periodMm*2*Math.PI+field.phaseRad);
  return Math.max(0,Math.min(1,(coordinate-field.fromMm)/(field.toMm-field.fromMm)));
}

// Sample every feature before applying adaptive chord/process tolerances, so
// coincident periodic endpoints cannot hide an entire cycle.
export function fieldSampleStep(field) {
  if(field.kind==='periodic')return field.periodMm/8;
  if(field.kind==='noise')return field.cellMm/4;
  if(field.kind==='ramp')return (field.toMm-field.fromMm)/4;
  return field.field.points.reduce((step,p)=>Math.min(step,p.reachMm),Infinity)/4;
}
