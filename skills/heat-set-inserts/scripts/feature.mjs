const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

import {INSERT_CATALOG} from './catalog.mjs';

export const HEAT_SET_DEFAULTS={id:'insert',insertId:'spirol-29-m3-long',positionMm:[15,15,12],depthMm:null,diameterAdjustmentMm:0,finCount:null,finLengthMm:4,finWidthMm:null,finAngleDeg:0,axis:[0,0,-1],throughHole:false,chamferDepthMm:0,chamferAngleDeg:45};
export function heatSetFeature(input){
  requireThat(input&&Object.keys(input).every(k=>Object.hasOwn(HEAT_SET_DEFAULTS,k)),'Unknown heat-set feature setting.');
  const f={...structuredClone(HEAT_SET_DEFAULTS),...structuredClone(input)};
  requireThat(typeof f.id==='string'&&/^[\w-]+$/.test(f.id),'Invalid heat-set feature id.');
  const insert=INSERT_CATALOG.find(i=>i.id===f.insertId);
  requireThat(insert,'Unknown heat-set insertId; choose an entry from the catalog.');
  requireThat(Array.isArray(f.positionMm)&&f.positionMm.length===3&&f.positionMm.every(Number.isFinite),'positionMm must be [x,y,z], the mouth centre on the insertion face.');
  requireThat(Array.isArray(f.axis)&&f.axis.length===3&&f.axis.every(Number.isFinite)&&Math.hypot(...f.axis)>0,'axis must be a nonzero [x,y,z] direction the bore points into the part.');
  requireThat(Number.isFinite(f.diameterAdjustmentMm)&&insert.holeDiameterMm+f.diameterAdjustmentMm>0,'Adjusted insert bore diameter must be positive.');
  requireThat(f.depthMm===null||Number.isFinite(f.depthMm)&&f.depthMm>=insert.lengthMm,'depthMm must accommodate the selected insert length, or be null for the catalog recommendation.');
  requireThat(f.finCount===null||Number.isSafeInteger(f.finCount)&&f.finCount>=0,'finCount must be null for automatic count or a nonnegative safe integer.');
  requireThat(Number.isFinite(f.finLengthMm)&&f.finLengthMm>0,'finLengthMm must be positive.');
  requireThat(f.finWidthMm===null||Number.isFinite(f.finWidthMm)&&f.finWidthMm>0,'Legacy finWidthMm must be null or positive.');
  requireThat(Number.isFinite(f.finAngleDeg),'finAngleDeg must be finite.');
  requireThat(typeof f.throughHole==='boolean','throughHole must be true or false.');
  requireThat(Number.isFinite(f.chamferDepthMm)&&f.chamferDepthMm>=0,'chamferDepthMm must be nonnegative.');
  requireThat(Number.isFinite(f.chamferAngleDeg)&&f.chamferAngleDeg>0&&f.chamferAngleDeg<90,'chamferAngleDeg must be between 0 and 90 degrees, measured from the bore axis.');
  requireThat(f.chamferDepthMm<dimensions(f).depthMm,'The chamfer must leave a straight insert seat; reduce chamferDepthMm or increase depthMm.');
  return f;
}
export function dimensions(f){
  const insert=INSERT_CATALOG.find(i=>i.id===f.insertId);
  requireThat(insert,'Unknown heat-set catalog entry.');
  return {diameterMm:insert.holeDiameterMm+f.diameterAdjustmentMm,depthMm:f.depthMm??insert.lengthMm+(f.throughHole?0:insert.bottomClearanceMm),lengthMm:insert.lengthMm};
}
// A point of the bore's frame: radius r at angle a about its axis, s outward
// from the mouth. Outward d, with u along the world axis least aligned with it
// and v = d x u, is right-handed, so increasing a runs counterclockwise about d;
// a bore pointing down Z has u = X and v = Y.
export function borePoint(f,r,a,s){
  const n=Math.hypot(...f.axis),d=f.axis.map(c=>-c/n),k=d.map(Math.abs).reduce((best,c,i,all)=>c<all[best]?i:best,0);
  const raw=d.map((c,i)=>(i===k)-c*d[k]),m=Math.hypot(...raw),u=raw.map(c=>c/m);
  const v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];
  return f.positionMm.map((c,i)=>c+s*d[i]+r*(Math.cos(a)*u[i]+Math.sin(a)*v[i]));
}
export const heatSetTemplate=()=>({shape:'heat-set',base:null,features:[],toleranceMm:0.01,vertices:[],triangles:[]});
export function validateHeatSetRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(heatSetTemplate()).sort().join(),'Unexpected heat-set geometry fields.');
  requireThat(record.base&&Array.isArray(record.features)&&record.features.length>0,'Heat-set geometry needs a base and nonempty feature list.');
  record.features.forEach(heatSetFeature);
  requireThat(new Set(record.features.map(f=>f.id)).size===record.features.length,'Duplicate heat-set feature id.');
  requireThat(Number.isFinite(record.toleranceMm)&&record.toleranceMm>0,'Heat-set toleranceMm must be positive.');
}
// Reversible readable identifiers keep component and editable feature identity.
// Escapes never contain '--', which separates owner, feature and fin identities.
const encodeId=id=>[...id].map(c=>c==='-'?'-h':c==='_'?'-u':/[A-Z]/.test(c)?'-c'+c.toLowerCase():c).join('');
export const heatSetAssignmentId=(feature,part=null)=>'heat-set-'+(part===null?'':encodeId(part)+'--')+encodeId(feature.id);
export const legacyHeatSetAssignmentId=feature=>'heat-set-'+feature.id.toLowerCase().replace(/[^a-z0-9-]/g,'-');

export const heatSetRecordRuntime=()=>({validate:validateHeatSetRecord});
