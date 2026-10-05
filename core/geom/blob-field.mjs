// A field of freely placed points. Each point adds strength * K(distance/reach)
// where K is the cubic B-spline falloff: 1 at the point, smooth (C2) and zero
// from one reach outward. Material is where the sum exceeds the threshold.
import {requireThat} from './tolerance.mjs';

export const BLOB_FIELD_SCHEMA='saam-blob-field/1';
// At this threshold a lone point of strength 1 is a ball of radius reach/2,
// because K(1/2) is exactly 1/4.
export const BLOB_FIELD_THRESHOLD=0.25;
const POINT_FIELDS='positionMm,reachMm,strength';

// K and dK/dt for t = distance/reach.
function blobFalloff(t){
  const u=2*t;
  if(u>=2)return {value:0,slope:0};
  if(u>=1)return {value:(2-u)**3/4,slope:-1.5*(2-u)**2};
  return {value:(4-6*u*u+3*u**3)/4,slope:2*(-12*u+9*u*u)/4};
}

export function validateBlobField(field){
  requireThat(field&&typeof field==='object'&&Object.keys(field).sort().join()==='points,schema,threshold','A blob field has schema, threshold and points.');
  requireThat(field.schema===BLOB_FIELD_SCHEMA,'Unsupported blob field schema.');
  requireThat(Number.isFinite(field.threshold)&&field.threshold>0,'Blob field threshold must be a positive number.');
  requireThat(Array.isArray(field.points)&&field.points.length>0,'A blob field needs at least one point.');
  field.points.forEach((p,i)=>{
    requireThat(p&&typeof p==='object'&&Object.keys(p).sort().join()===POINT_FIELDS,`Blob point ${i} has positionMm, reachMm and strength.`);
    requireThat(Array.isArray(p.positionMm)&&p.positionMm.length===3&&p.positionMm.every(Number.isFinite),`Blob point ${i} positionMm needs three finite millimetre values.`);
    requireThat(Number.isFinite(p.reachMm)&&p.reachMm>0,`Blob point ${i} reachMm must be positive.`);
    requireThat(Number.isFinite(p.strength)&&p.strength!==0,`Blob point ${i} strength must be a nonzero number; negative strength removes material.`);
  });
  requireThat(field.points.some(p=>p.strength>0),'A blob field needs at least one point of positive strength to make material.');
  return field;
}

// Material can only lie within reach of a positive point, and never below the
// bed plane Z = 0, which cuts the field flat.
export function blobFieldBounds(field){
  const positive=validateBlobField(field).points.filter(p=>p.strength>0);
  const min=[0,1,2].map(a=>Math.min(...positive.map(p=>p.positionMm[a]-p.reachMm)));
  const max=[0,1,2].map(a=>Math.max(...positive.map(p=>p.positionMm[a]+p.reachMm)));
  min[2]=Math.max(0,min[2]);
  requireThat(max[2]>0,'Every positive blob point lies below the bed plane Z = 0.');
  return {min,max};
}

export function validateBumpsField(input){
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite),positive=n=>Number.isFinite(n)&&n>0;
  requireThat(Object.keys(input).sort().join()==='kind,originMm,periodMm,radiusMm'&&vector(input.periodMm)&&input.periodMm.every(positive)&&positive(input.radiusMm)&&vector(input.originMm),
    'Bumps field needs positive XYZ periodMm, radiusMm and originMm.');
  return input;
}

// Prepare finite point sources or a repeating bump lattice as a plain record
// that evaluateBlobField samples. Finite sources use spatial buckets when their
// integer coordinates are exactly representable.
export function prepareBlobField(input){
  if(input?.kind==='bumps')return {kind:'bumps',field:structuredClone(validateBumpsField(input))};
  const field=structuredClone(validateBlobField(input)),cell=field.points.reduce((reach,p)=>Math.max(reach,p.reachMm),0);
  const spans=field.points.map(p=>({lo:p.positionMm.map(v=>Math.floor((v-p.reachMm)/cell)),hi:p.positionMm.map(v=>Math.floor((v+p.reachMm)/cell))}));
  const buckets=spans.every(({lo,hi})=>[...lo,...hi].every(Number.isSafeInteger))?new Map():null;
  if(buckets)spans.forEach(({lo,hi},index)=>{
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
      const k=bucketKey(x,y,z);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(index);
    }
  });
  return {kind:'points',field,cell,buckets};
}

const bucketKey=(x,y,z)=>x+','+y+','+z;

export function evaluateBlobField(prepared,point,{derivatives=false}={}){
  const {field}=prepared;
  if(prepared.kind==='bumps'){
    let value=0;
    const ranges=point.map((v,i)=>[Math.ceil((v-field.radiusMm-field.originMm[i])/field.periodMm[i]),Math.floor((v+field.radiusMm-field.originMm[i])/field.periodMm[i])]);
    requireThat(ranges.flat().every(Number.isSafeInteger),'Bump lattice indices exceed exact integer representation; increase lattice spacing or move its origin closer.');
    for(let x=ranges[0][0];x<=ranges[0][1];x++)for(let y=ranges[1][0];y<=ranges[1][1];y++)for(let z=ranges[2][0];z<=ranges[2][1];z++){
      const center=[x,y,z].map((v,i)=>field.originMm[i]+v*field.periodMm[i]);
      value+=blobFalloff(Math.hypot(...point.map((v,i)=>v-center[i]))/field.radiusMm).value;
    }
    return {value};
  }
  requireThat(Array.isArray(point)&&point.length===3&&point.every(Number.isFinite),'Blob field evaluation needs finite XYZ millimetres.');
  const {cell,buckets}=prepared;
  let value=0;const gradient=[0,0,0];
  for(const index of buckets?(buckets.get(bucketKey(...point.map(v=>Math.floor(v/cell))))??[]):field.points.keys()){
    const p=field.points[index],d=point.map((v,a)=>v-p.positionMm[a]),distance=Math.hypot(...d);
    if(distance>=p.reachMm)continue;
    const k=blobFalloff(distance/p.reachMm);value+=p.strength*k.value;
    if(derivatives&&distance>0)for(let a=0;a<3;a++)gradient[a]+=p.strength*k.slope*d[a]/(distance*p.reachMm);
  }
  return derivatives?{value,gradient}:{value};
}
