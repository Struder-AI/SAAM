import {requireThat,distance} from '../geom/tolerance.mjs';
import {attachmentCurves,placeCenterlines,curveLength} from '../path/curve-construction.mjs';
import {depositCurves} from '../path/deposition.mjs';
import {depositedCurveSegments,curveSupportsPoint} from '../path/deposited-curves.mjs';
import {planarPolicy} from '../path/builder.mjs';
import {requireMachine,toolBounds} from '../machine/profile.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {finalizeDepositionResult} from './finalize.mjs';

// Authored deposition joins the ordinary assignment list without inventing an
// enclosing solid. A repeat is its own XYZ grid; it need not share other grids.
export function curveAssignment({id,construction='curves',...options}) {
  return structuredClone({id,construction,filament:null,process:null,after:[],
    ...(construction==='curves'?{curves:[],repeat:null}:{bridges:[],maxExcursionMm:10}),...options});
}

export function validateCurveAssignment(a) {
  const expected=a.construction==='curves'?'after,construction,curves,filament,id,process,repeat':'after,bridges,construction,filament,id,maxExcursionMm,process';
  requireThat(['curves','bridges'].includes(a.construction)&&Object.keys(a).sort().join()===expected,`Invalid ${a.construction} assignment fields.`);
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid curve assignment id.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Curve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Curve after must list operation ids.');
  if(a.construction==='bridges'){validateBridgeConstruction(a);return;}
  requireThat(a.repeat===null||a.repeat&&Object.keys(a.repeat).sort().join()==='count,translation'&&Number.isInteger(a.repeat.count)&&a.repeat.count>0&&point(a.repeat.translation),
    'Curve repeat must be null or {count,translation:XYZ}.');
  const count=a.repeat?.count??1;
  requireThat(Array.isArray(a.curves)&&a.curves.length>0,'Curve assignment needs explicit centerlines.');
  for(const curve of a.curves){
    requireThat(curve&&Object.keys(curve).every(k=>['points','closed','role','beadWidthMm','heightMm','speedMmS','flowMultiplier','courses'].includes(k))&&
      typeof curve.closed==='boolean'&&Array.isArray(curve.points)&&curve.points.length>=(curve.closed?3:2)&&curve.points.every(point),'Invalid authored curve.');
    requireThat(curve.role===undefined||typeof curve.role==='string'&&curve.role.length>0,'Curve role must be a nonempty string.');
    for(const field of ['beadWidthMm','heightMm','speedMmS','flowMultiplier'])requireThat(curve[field]===undefined||Number.isFinite(curve[field])&&curve[field]>0,`Curve ${field} must be positive.`);
    requireThat(curve.courses===undefined||Array.isArray(curve.courses)&&curve.courses.length>0&&new Set(curve.courses).size===curve.courses.length&&curve.courses.every(n=>Number.isInteger(n)&&n>=0&&n<count),
      'Curve courses must select distinct indices within its repeat count.');
    requireThat(curve.points.some(p=>distance(p,curve.points[0])>1e-9),'An authored curve needs nonzero length.');
  }
}

export function authoredCurveResult(assignment,{plan,process=plan.process,bounds=null}) {
  const operations=[],count=assignment.repeat?.count??1,translation=assignment.repeat?.translation??[0,0,0];
  let lengthMm=0,strokeCount=0;
  for(let course=0;course<count;course++){
    const active=assignment.curves.filter(curve=>!curve.courses||curve.courses.includes(course));
    if(!active.length)continue;
    const curves=placeCenterlines(active,{offset:[plan.placement.xMm+course*translation[0],plan.placement.yMm+course*translation[1],course*translation[2]]});
    const heightMm=course===0?process.firstLayerMm:process.layerMm,speedMmS=course===0?process.firstLayerSpeedMmS:process.planarSpeedMmS;
    const strokes=depositCurves(curves,{widthMm:process.lineWidthMm,heightMm,speedMmS});
    for(const stroke of strokes){
      const width=stroke.beadWidthMm??process.lineWidthMm;
      if(bounds)requireThat(stroke.points.every(p=>p.every((v,i)=>v>=(i===2?bounds.min[i]:bounds.min[i]+width/2)-1e-8&&v<=(i===2?bounds.max[i]:bounds.max[i]-width/2)+1e-8)),
        `Curve assignment ${assignment.id} exceeds selected tool bounds on course ${course}.`);
      lengthMm+=curveLength(stroke.points);strokeCount++;
    }
    const all=strokes.flatMap(stroke=>stroke.points),low=Math.min(...all.map(p=>p[2])),high=Math.max(...all.map(p=>p[2]));
    const width=Math.max(...strokes.map(stroke=>stroke.beadWidthMm??process.lineWidthMm));
    const min=[Math.min(...all.map(p=>p[0]))-width/2,Math.min(...all.map(p=>p[1]))-width/2];
    const max=[Math.max(...all.map(p=>p[0]))+width/2,Math.max(...all.map(p=>p[1]))+width/2];
    const region=[[[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]]]],planar=high-low<1e-9;
    const travelPolicy=planar?planarPolicy(region,{layerZ:high,liftMm:process.liftMm,maxCombMm:0,lineWidthMm:width})
      :{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>high+process.liftMm};
    operations.push({id:`${assignment.id}:${course}`,layerId:planar?`planar:${high}`:`${assignment.id}:${course}`,phase:planar?'planar':'curves',layer:course,rank:course,
      after:[...assignment.after],order:'given',regionId:assignment.id,region,strokes,travelPolicy,clearanceZ:high+process.liftMm,
      ...(assignment.filament===null?{}:{filament:assignment.filament})});
  }
  return {id:assignment.id,operations,report:{construction:'curves',courses:count,strokes:strokeCount,lengthMm}};
}

// Model deposition is finalized before this boundary. Authored centerlines
// join it first; bridges then consume those actual strands and prior bridges.
export function curveAssignmentResults({plan,machine,modelResults,bounds=null}) {
  const assignments=plan.slices.assignments.filter(a=>['curves','bridges'].includes(a.construction)),results=[];
  for(const assignment of assignments.filter(a=>a.construction==='curves')){
    validateCurveAssignment(assignment);
    const nonplanar=assignment.curves.some(curve=>curve.points.some(p=>Math.abs(p[2]-curve.points[0][2])>1e-9));
    requireMachine(machine,['xyz-extrusion',nonplanar?'nonplanar':'planar'],'authored curves');
    const selected=assignmentPlan(plan,machine,assignment);
    const selectedBounds=bounds===null?null:toolBounds(machine,selected.setup.tool);
    results.push(finalizeDepositionResult(authoredCurveResult(assignment,{plan,process:selected.process,bounds:selectedBounds}),plan,machine));
  }
  for(const assignment of assignments.filter(a=>a.construction==='bridges')){
    validateCurveAssignment(assignment);
    requireMachine(machine,['xyz-extrusion','nonplanar'],'bridge construction');
    const selected=assignmentPlan(plan,machine,assignment);
    const selectedBounds=bounds===null?null:toolBounds(machine,selected.setup.tool);
    results.push(bridgeAssignmentResult(assignment,{plan,machine,process:selected.process,modelResults:[...modelResults,...results],bounds:selectedBounds}));
  }
  return results;
}
const fields='attachmentSpeedMmS,flowMultiplier,id,jogMm,leadInMm,mode,overlapMm,pressMm,rails,speedMmS';
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

export function validateBridgeConstruction(settings){
  requireThat(Number.isFinite(settings.maxExcursionMm)&&settings.maxExcursionMm>0&&Array.isArray(settings.bridges),'Invalid bridging settings.');
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

// Gap edges and process controls are the recipe. Support walls are supplied by
// other producers; this skill never slices geometry or emits support loops.
export function bridgeAssignmentResult(assignment,{plan,machine,process=plan.process,modelResults,bounds=null}){
  const settings=assignment,width=process.lineWidthMm,height=process.layerMm;
  validateBridgeConstruction(settings);
  const supportSegments=depositedCurveSegments(modelResults.flatMap(result=>result.operations),{widthMm:width});
  const operations=[],reports=[],modulations=[];
  let after=[...modelResults.flatMap(r=>r.operations.map(op=>op.id)),...assignment.after];
  for(const [index,b] of settings.bridges.entries()){
    const end=b.endAttachment??{overlapMm:b.overlapMm,pressMm:b.pressMm,jogMm:0,speedMmS:b.attachmentSpeedMmS,flowMultiplier:1};
    const rails=b.rails.map(r=>r.map(([x,y,z])=>[x+plan.placement.xMm,y+plan.placement.yMm,z]));
    const {curves}=attachmentCurves({...b,rails});
    const strokes=depositCurves(curves,{widthMm:width,heightMm:height,speedMmS:b.attachmentSpeedMmS});
    const all=strokes.flatMap(s=>s.points),low=Math.min(...all.map(p=>p[2])),high=Math.max(...all.map(p=>p[2]));
    requireThat(high-low<=settings.maxExcursionMm+1e-8,`Bridge ${b.id} exceeds its total Z excursion limit.`);
    requireThat(Math.max(b.pressMm,end.pressMm)<height,`Bridge ${b.id} press must remain within the attachment layer.`);
    if(bounds)requireThat(all.every(p=>p.every((v,i)=>v>=(i===2?bounds.min[i]:bounds.min[i]+width/2)-1e-8&&v<=(i===2?bounds.max[i]:bounds.max[i]-width/2)+1e-8)),`Bridge ${b.id} exceeds selected tool bounds.`);
    for(const s of strokes)if(s.role!=='bridge-span'){
      for(let i=1;i<s.points.length;i++){
        const a=s.points[i-1],z=s.points[i],n=Math.max(1,Math.ceil(distance(a,z)/.1));
        for(let j=0;j<=n;j++){
          const p=a.map((v,k)=>v+(z[k]-v)*j/n),nominalZ=s.role==='bridge-press'?Math.max(...s.points.map(p=>p[2])):p[2];
          requireThat(curveSupportsPoint(supportSegments,p,nominalZ-height,{source:b.supportBridge??null}),`Bridge ${b.id} ${s.role} leaves the emitted supporting wall or named bridge.`);
        }
      }
    }
    if(b.mode==='alternating')for(let i=1;i<strokes.length;i++)requireThat(distance(strokes[i-1].points.at(-1),strokes[i].points[0])<1e-9,`Bridge ${b.id} contains a disconnected continuous path.`);
    const id=assignment.id+':'+b.id;
    operations.push({id,layerId:id,layer:Math.round(high/height),rank:index,phase:'bridging',order:'given',continuous:true,
      after,strokes,...(assignment.filament===null?{}:{filament:assignment.filament}),travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>high+process.liftMm}});
    const finalized=finalizeDepositionResult({id:assignment.id,operations:[operations.at(-1)],report:{}},plan,machine);
    operations[operations.length-1]=finalized.operations[0];
    if(finalized.report.modulation)modulations.push(finalized.report.modulation);
    after=[id];
    supportSegments.push(...depositedCurveSegments([operations.at(-1)],{widthMm:width,source:b.id,excludedRoles:['bridge-press']}));
    reports.push({id:b.id,mode:b.mode,spans:rails[0].length,minZMm:low,maxZMm:high,excursionMm:high-low});
  }
  return {id:assignment.id,operations,report:{bridges:reports,physicalValidation:'not performed',...(modulations.length?{modulation:{
    changed:true,maxExcursionMm:Math.max(...modulations.map(m=>m.maxExcursionMm)),
    changedOperations:modulations.flatMap(m=>m.changedOperations),modifiers:[...new Set(modulations.flatMap(m=>m.modifiers))]
  }}:{})}};
}

