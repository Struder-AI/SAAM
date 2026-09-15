import {createHash} from 'node:crypto';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {INSERT_CATALOG} from './catalog.mjs';
import {geometrySelections} from '../../../core/geom/selections.mjs';

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

export function validateHeatSetAssignments(plan){
  const parts=plan.geometry.shape==='assembly'?plan.geometry.parts:[{id:null,geometry:plan.geometry,zMm:0}];
  for(const part of parts)for(const f of heatSetFeatures(part.geometry)){
    const end=f.positionMm[2],start=end-dimensions(f).depthMm;
    if(!plan.composition.regions.length){
      const selected=name=>{const s=plan.skills[name];return s.enabled&&(part.id===null||!s.parts.length||s.parts.includes(part.id));};
      requireThat(selected('full-fill')||selected('planar-infill'),`Heat-set ${f.id} needs a planar fill/infill owner for its bore layers.`);
    }else{
      // Region heights are relative to component bounds; compiled hosts can
      // have nonzero native Z, so use their actual vertex minimum.
      const selections=geometrySelections(plan.geometry);
      const spans=plan.composition.regions.filter(r=>{
        const selection=selections.get(r.part);
        return selection?.owner===part.id&&(selection.material===null||selection.material==='base')&&('full-fill' in r.skills||'planar-infill' in r.skills);
      }).map(r=>{
        const geometry=selections.get(r.part).geometry;
        const origin=geometry.vertices?Math.min(...geometry.vertices.map(p=>p[2])):0;
        return [origin+r.zStartMm,r.zEndMm===null?Infinity:origin+r.zEndMm];
      }).sort((a,b)=>a[0]-b[0]);
      let covered=start;for(const [a,b] of spans)if(a<=covered+1e-7)covered=Math.max(covered,b);
      requireThat(covered>=end-1e-7,`Heat-set ${f.id} needs planar material regions covering its entire bore depth.`);
    }
  }
}
