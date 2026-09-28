import {createHash} from 'node:crypto';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {INSERT_CATALOG} from './catalog.mjs';

export const HEAT_SET_DEFAULTS={id:'insert',insertId:'spirol-29-m3-long',positionMm:[15,15,12],depthMm:null,diameterAdjustmentMm:0,finCount:6,finLengthMm:4,finWidthMm:0.8,finAngleDeg:0};
export function heatSetFeature(input){
  requireThat(input&&Object.keys(input).every(k=>Object.hasOwn(HEAT_SET_DEFAULTS,k)),'Unknown heat-set feature setting.');
  const f={...structuredClone(HEAT_SET_DEFAULTS),...structuredClone(input)};
  requireThat(typeof f.id==='string'&&/^[\w-]{1,64}$/.test(f.id),'Invalid heat-set feature id.');
  const insert=INSERT_CATALOG.find(i=>i.id===f.insertId);
  requireThat(insert,'Unknown heat-set insertId; choose an entry from the catalog.');
  requireThat(Array.isArray(f.positionMm)&&f.positionMm.length===3&&f.positionMm.every(Number.isFinite),'positionMm must be [x,y,z] at the insertion face; the bore points down Z.');
  requireThat(Number.isFinite(f.diameterAdjustmentMm)&&Math.abs(f.diameterAdjustmentMm)<=1,'diameterAdjustmentMm must be between -1 and 1.');
  requireThat(f.depthMm===null||Number.isFinite(f.depthMm)&&f.depthMm>=insert.lengthMm,'depthMm must accommodate the selected insert length, or be null for the catalog recommendation.');
  requireThat(Number.isInteger(f.finCount)&&f.finCount>=2&&f.finCount<=24,'finCount must be 2–24.');
  for(const k of ['finLengthMm','finWidthMm'])requireThat(Number.isFinite(f[k])&&f[k]>0&&f[k]<=50,k+' must be positive and at most 50 mm.');
  requireThat(Number.isFinite(f.finAngleDeg),'finAngleDeg must be finite.');
  return f;
}
export function dimensions(f){
  const insert=INSERT_CATALOG.find(i=>i.id===f.insertId);
  requireThat(insert,'Unknown heat-set catalog entry.');
  return {diameterMm:insert.holeDiameterMm+f.diameterAdjustmentMm,depthMm:f.depthMm??insert.lengthMm+insert.bottomClearanceMm};
}
export const heatSetTemplate=()=>({shape:'heat-set',base:null,features:[],toleranceMm:0.01,vertices:[],triangles:[],compiledHash:''});
export function heatSetDigest(record){
  const {compiledHash,...content}=record;
  return createHash('sha256').update(JSON.stringify(content,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
}
export function validateHeatSetRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(heatSetTemplate()).sort().join(),'Unexpected heat-set geometry fields.');
  requireThat(record.base&&Array.isArray(record.features)&&record.features.length>0&&record.features.length<=40,'Heat-set geometry needs a base and 1–40 features.');
  record.features.forEach(heatSetFeature);
  requireThat(new Set(record.features.map(f=>f.id)).size===record.features.length,'Duplicate heat-set feature id.');
  requireThat(Number.isFinite(record.toleranceMm)&&record.toleranceMm>0&&record.toleranceMm<=0.1,'Heat-set toleranceMm must be positive and at most 0.1.');
  requireThat(record.compiledHash===heatSetDigest(record),'Heat-set recipe or mesh changed; rebuild with apply_heat_set / shell heat-set.');
}
// Text keeps its editable base, allowing insertion details to survive lettering.
export function heatSetFeatures(geometry){
  return [...(geometry?.shape==='heat-set'?geometry.features:[]),...(geometry?.base&&!geometry.standalone?heatSetFeatures(geometry.base):[])];
}

// Each insert's reinforcement is slice data apply_heat_set wrote; a recipe
// edited around it must still carry those owners.
export function validateHeatSetAssignments(plan){
  const parts=plan.geometry.shape==='assembly'?plan.geometry.parts:[{id:null,geometry:plan.geometry}];
  for(const part of parts)for(const f of heatSetFeatures(part.geometry)){
    const name='heat-set-'+f.id.toLowerCase().replace(/[^a-z0-9-]/g,'-');
    requireThat(plan.slices.assignments.some(a=>a.id===name&&a.part===part.id),`Heat-set ${f.id} has no reinforcement slices; apply it again with apply_heat_set.`);
  }
}
