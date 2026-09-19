import {createHash} from 'node:crypto';
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {INSERT_CATALOG} from './catalog.mjs';
import {geometrySelections} from '../../../core/geom/selections.mjs';

// Dedicated loops around every bore, and the largest arc spacing between the
// ribs that tie those loops to the surrounding infill.
export const SLEEVE_LOOPS=4,RIB_SPACING_MM=2;
export const HEAT_SET_DEFAULTS={id:'insert',insertId:'spirol-29-m3-long',positionMm:[15,15,12],depthMm:null,diameterAdjustmentMm:0,finCount:null,finLengthMm:10,finAngleDeg:0,throughHole:false,insertionSide:'top',chamferDepthMm:0,chamferAngleDeg:45};
export function heatSetFeature(input){
  requireThat(input&&Object.keys(input).every(k=>Object.hasOwn(HEAT_SET_DEFAULTS,k)),'Unknown heat-set feature setting.');
  const f={...structuredClone(HEAT_SET_DEFAULTS),...structuredClone(input)};
  requireThat(typeof f.id==='string'&&/^[\w-]{1,64}$/.test(f.id),'Invalid heat-set feature id.');
  const insert=INSERT_CATALOG.find(i=>i.id===f.insertId);
  requireThat(insert,'Unknown heat-set insertId; choose an entry from the catalog.');
  requireThat(Array.isArray(f.positionMm)&&f.positionMm.length===3&&f.positionMm.every(Number.isFinite),'positionMm must be [x,y,z] at the insertion face; the bore points into the host from there.');
  requireThat(Number.isFinite(f.diameterAdjustmentMm)&&Math.abs(f.diameterAdjustmentMm)<=1,'diameterAdjustmentMm must be between -1 and 1.');
  requireThat(f.depthMm===null||Number.isFinite(f.depthMm)&&f.depthMm>=insert.lengthMm,'depthMm must accommodate the selected insert length, or be null for the catalog recommendation.');
  requireThat(f.finCount===null||Number.isInteger(f.finCount)&&f.finCount>=2&&f.finCount<=64,'finCount must be null (one rib per 2 mm of bore perimeter) or an integer 2–64.');
  requireThat(Number.isFinite(f.finLengthMm)&&f.finLengthMm>0&&f.finLengthMm<=50,'finLengthMm must be positive and at most 50 mm.');
  requireThat(Number.isFinite(f.finAngleDeg),'finAngleDeg must be finite.');
  requireThat(typeof f.throughHole==='boolean','throughHole must be true or false.');
  requireThat(f.insertionSide==='top'||f.insertionSide==='bottom','insertionSide must be "top" (bore points down Z, the default) or "bottom" (bore points up Z from the host\'s flat lowest face).');
  requireThat(Number.isFinite(f.chamferDepthMm)&&f.chamferDepthMm>=0&&f.chamferDepthMm<=5,'chamferDepthMm must be between 0 and 5 mm.');
  requireThat(Number.isFinite(f.chamferAngleDeg)&&f.chamferAngleDeg>0&&f.chamferAngleDeg<90,'chamferAngleDeg must be between 0 and 90 degrees.');
  return f;
}
export function dimensions(f){
  const insert=INSERT_CATALOG.find(i=>i.id===f.insertId);
  requireThat(insert,'Unknown heat-set catalog entry.');
  const depthMm=f.depthMm??(f.throughHole?insert.lengthMm:insert.lengthMm+insert.bottomClearanceMm);
  requireThat(f.chamferDepthMm<depthMm-0.05,'chamferDepthMm must leave a straight section below it; reduce the chamfer or increase depth.');
  const diameterMm=insert.holeDiameterMm+f.diameterAdjustmentMm;
  return {diameterMm,depthMm,ribCount:f.finCount??Math.ceil(Math.PI*diameterMm/RIB_SPACING_MM),chamferDepthMm:f.chamferDepthMm,chamferAngleDeg:f.chamferAngleDeg,minWallThicknessMm:insert.minWallThicknessMm??null};
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
    const mouth=f.positionMm[2],sign=f.insertionSide==='bottom'?1:-1,depthMm=dimensions(f).depthMm;
    const start=sign<0?mouth-depthMm:mouth,end=sign<0?mouth:mouth+depthMm;
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
