// Guidance authors explicit Trace centerlines; attachment checking is general Trace contact.
import {attachmentCurves} from '../../../core/path/curve-construction.mjs';
import {curveAssignment} from '../../../core/print/curves.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';
const fields='attachmentSpeedMmS,flowMultiplier,id,jogMm,leadInMm,mode,overlapMm,pressMm,rails,speedMmS';
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

export function validateBridgeConstruction(settings){
  requireThat((settings.maxExcursionMm===null||Number.isFinite(settings.maxExcursionMm)&&settings.maxExcursionMm>0)&&Array.isArray(settings.bridges),'Invalid bridging settings.');
  const ids=new Set();
  for(const b of settings.bridges){
    requireThat(b&&Object.keys(b).filter(k=>!['endAttachment','supportBridge','maxSegmentMm'].includes(k)).sort().join()===fields&&/^[a-z][a-z0-9-]*$/.test(b.id)&&!ids.has(b.id),'Invalid or duplicate bridge record.');
    if(b.maxSegmentMm!==undefined)requireThat(Number.isFinite(b.maxSegmentMm)&&b.maxSegmentMm>0,'Bridge maxSegmentMm must be positive.');
    if(b.supportBridge!==undefined)requireThat(typeof b.supportBridge==='string'&&ids.has(b.supportBridge),'Bridge support must name an earlier bridge in the recipe.');
    ids.add(b.id);
    if(b.endAttachment!==undefined){
      const end=b.endAttachment;
      requireThat(end&&Object.keys(end).sort().join()==='flowMultiplier,jogMm,overlapMm,pressMm,speedMmS','Invalid end attachment settings.');
      for(const k of ['flowMultiplier','overlapMm','speedMmS'])requireThat(Number.isFinite(end[k])&&end[k]>0,`End ${k} must be positive.`);
      for(const k of ['jogMm','pressMm'])requireThat(Number.isFinite(end[k])&&end[k]>=0,`End ${k} must be nonnegative.`);
      requireThat(b.mode==='one-way','Independent end controls require one-way mode.');
    }
    requireThat(['alternating','one-way'].includes(b.mode),'Bridge mode must be alternating or one-way.');
    requireThat(Array.isArray(b.rails)&&b.rails.length===2&&b.rails.every(r=>Array.isArray(r)&&r.length>=2&&r.every(point))&&b.rails[0].length===b.rails[1].length,'Bridge rails need matching arrays of at least two XYZ gap-edge points.');
    for(const key of ['speedMmS','attachmentSpeedMmS','flowMultiplier','overlapMm'])requireThat(Number.isFinite(b[key])&&b[key]>0,`Bridge ${key} must be positive.`);
    for(const key of ['pressMm','jogMm','leadInMm'])requireThat(Number.isFinite(b[key])&&b[key]>=0,`Bridge ${key} must be nonnegative.`);
    b.rails[0].forEach((p,i)=>requireThat(Math.hypot(p[0]-b.rails[1][i][0],p[1]-b.rails[1][i][1])>0,'Bridge span needs nonzero XY length.'));
  }
}


export function bridgeAssignment({id,part=null,filament=null,process=null,after=[],bridges=[],maxExcursionMm=null}){
  validateBridgeConstruction({bridges,maxExcursionMm});
  const curves=bridges.flatMap((b,index)=>{
    const {curves}=attachmentCurves(b),zs=curves.flatMap(c=>c.points.map(p=>p[2]));
    requireThat(maxExcursionMm===null||Math.max(...zs)-Math.min(...zs)<=maxExcursionMm,'Authored attachment paths exceed the requested Z excursion.');
    return curves.map(curve=>({...curve,courses:[index],
      ...(curve.role==='bridge-span'?{}:{contact:{source:b.supportBridge?`${id}:${b.supportBridge}`:null,gapMm:null,sampleStepMm:.1,referenceZMm:curve.depositionAction?Math.max(...curve.points.map(p=>p[2])):null}})}));
  });
  return curveAssignment({id,part,filament,process,after,curves,maxExcursionMm,repeat:{count:bridges.length,translation:[0,0,0]},sequence:true,courseIds:bridges.map(b=>b.id)});
}
