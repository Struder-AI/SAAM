import {createHash} from 'node:crypto';
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const STRATEGIES=Object.freeze([
  {id:'membrane',name:'Membrane',icon:'/hole-support-icons/membrane.svg',finish:'Drill through the single solid layer.'},
  {id:'stepped-reduction',name:'Stepped reduction',icon:'/hole-support-icons/stepped-reduction.svg',finish:'Three tangent bridge layers, then the round bore.'},
  {id:'bore-support',name:'Bore support',icon:'/hole-support-icons/bore-support.svg',finish:'Remove the breakaway sleeve from the counterbore.'}
]);
export const holeSupportTemplate=()=>({shape:'hole_support',base:null,features:[],process:null,toleranceMm:0.02,vertices:[],triangles:[],compiledHash:''});
export function holeSupportDigest({compiledHash,...record}){
  return createHash('sha256').update(JSON.stringify(record,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
}
export function holeFeature(input){
  const f={id:'hole',strategy:'membrane',overlap:0.5,angleDeg:0,bridgeSpeedMmS:20,...input};
  requireThat(Object.keys(f).every(k=>['id','strategy','overlap','angleDeg','bridgeSpeedMmS','centerMm','boreRadiusMm','counterboreRadiusMm'].includes(k)),'Unknown hole_support feature setting.');
  requireThat(typeof f.id==='string'&&/^[\w-]{1,64}$/.test(f.id)&&STRATEGIES.some(s=>s.id===f.strategy),'Choose a named hole and a hole_support strategy.');
  requireThat(Array.isArray(f.centerMm)&&f.centerMm.length===3&&f.centerMm.every(Number.isFinite)&&f.centerMm[2]>0,'centerMm must be [x,y,shoulder Z] above the bed.');
  requireThat(Number.isFinite(f.boreRadiusMm)&&f.boreRadiusMm>0&&Number.isFinite(f.counterboreRadiusMm)&&f.counterboreRadiusMm>f.boreRadiusMm,'Counterbore radius must exceed bore radius.');
  requireThat([0.5,0.75].includes(f.overlap),'Choose 50% or 75% bead overlap.');
  requireThat(Number.isFinite(f.angleDeg)&&Number.isFinite(f.bridgeSpeedMmS)&&f.bridgeSpeedMmS>0,'Bridge angle and positive speed are required.');
  return f;
}
export function validateHoleSupportRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(holeSupportTemplate()).sort().join(),'Unexpected hole_support geometry fields.');
  requireThat(record.base&&Array.isArray(record.features)&&record.features.length>0&&record.features.length<=40,'hole_support requires a base and 1-40 features.');
  record.features.forEach(holeFeature);
  requireThat(new Set(record.features.map(f=>f.id)).size===record.features.length,'Duplicate hole_support feature id.');
  requireThat(record.process&&Object.keys(record.process).sort().join()==='firstLayerMm,holeLineWidthMm,layerMm,lineWidthMm'&&Object.values(record.process).every(v=>Number.isFinite(v)&&v>0),'Invalid hole_support layer and bead settings.');
  requireThat(Number.isFinite(record.toleranceMm)&&record.toleranceMm>0&&record.toleranceMm<=0.05,'hole_support tolerance must be positive and at most 0.05 mm.');
  requireThat(record.compiledHash===holeSupportDigest(record),'hole_support recipe or mesh changed; rebuild with apply_hole_support.');
}
export function holeSupportRecords(geometry){
  return [...(geometry?.shape==='hole_support'?[geometry]:[]),...(geometry?.base&&!geometry.standalone?holeSupportRecords(geometry.base):[])];
}
export function validateHoleSupportPlan(plan){
  const parts=plan.geometry.shape==='assembly'?plan.geometry.parts:[{id:null,geometry:plan.geometry,zMm:0}];
  for(const part of parts)for(const record of holeSupportRecords(part.geometry)){
    const selected=name=>{const s=plan.skills[name];return s.enabled&&(part.id===null||!s.parts.length||s.parts.includes(part.id));};
    requireThat(!plan.composition.regions.length&&(selected('full-fill')||selected('planar-infill'))&&!plan.skills['vase-wall'].enabled&&!plan.skills['draped-skin'].enabled,'hole_support currently requires whole-component planar fill/infill; disable vase/drape and regional assignments.');
    requireThat((part.zMm??0)===0,'hole_support components must start on the bed.');
    const walls=selected('planar-infill')?plan.skills['planar-infill']:plan.skills['full-fill'];
    requireThat(walls.perimeters>=1&&walls.perimeterScope==='all'&&walls.spacingFactor===1,'hole_support needs contiguous walls around holes.');
    requireThat(record.process.layerMm===plan.process.layerMm&&record.process.firstLayerMm===plan.process.firstLayerMm&&record.process.lineWidthMm===plan.process.lineWidthMm&&record.process.holeLineWidthMm===(plan.skills['full-fill'].holeLineWidthMm??plan.process.lineWidthMm),'Layer/bead settings changed; rebuild hole_support for the new process.');
    for(const f of record.features){
      requireThat(Math.abs((f.centerMm[2]-plan.process.firstLayerMm)/plan.process.layerMm-Math.round((f.centerMm[2]-plan.process.firstLayerMm)/plan.process.layerMm))<1e-5,'Align the counterbore shoulder with the layer grid before applying hole_support.');
    }
  }
}
