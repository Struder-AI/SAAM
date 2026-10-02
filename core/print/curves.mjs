import {requireThat,distance} from '../private/toolpath/numeric.mjs';

import {curveLength} from '../path/curve-construction.mjs';
import {authoredNurbs,validateCurveProfiles,constructAuthoredCurves} from '../path/authored-curves.mjs';
import {beadWidthRule} from '../path/parallel-curves.mjs';
import {depositedCurveSegments,curveSupportsPoint} from '../path/deposited-curves.mjs';
import {depositCurveCourses} from '../path/curve-courses.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {finalizeDepositionResult,combineFinalizedResults} from './finalize.mjs';

// Authored deposition joins the ordinary assignment list without inventing an
// enclosing solid. A repeat is its own XYZ grid; it need not share other grids.
export function curveAssignment({id,construction='curves',...options}) {
  requireThat(construction==='curves','Trace uses explicit curves; retired technique records require migration.');
  return structuredClone({id,construction,part:null,filament:null,process:null,after:[],curves:[],repeat:null,sequence:false,courseIds:null,maxExcursionMm:null,...options});
}

export function validateCurveAssignment(a,{parts=null}={}) {
  const expected=Object.keys(curveAssignment({construction:a.construction})).sort().join();
  requireThat(a.construction==='curves'&&Object.keys(a).sort().join()===expected,`Invalid ${a.construction} assignment fields.`);
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid curve assignment id.');
  requireThat(a.part===null||typeof a.part==='string'&&(parts===null||parts.includes(a.part)),'Curve assignment names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Curve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Curve after must list operation ids.');
  const translationRepeat=a.repeat&&Object.keys(a.repeat).sort().join()==='count,translation'&&Number.isInteger(a.repeat.count)&&a.repeat.count>0&&point(a.repeat.translation);
  const familyRepeat=a.repeat&&Object.keys(a.repeat).sort().join()==='family,indices'&&typeof a.repeat.family==='string'&&a.repeat.family.length&&(a.repeat.indices===null||Array.isArray(a.repeat.indices)&&a.repeat.indices.length&&new Set(a.repeat.indices).size===a.repeat.indices.length&&a.repeat.indices.every(n=>Number.isInteger(n)&&n>=0));
  requireThat(a.repeat===null||translationRepeat||familyRepeat,'Curve repeat needs {count,translation:XYZ} or {family,indices:null|layer indices}.');
  requireThat(a.maxExcursionMm===null||Number.isFinite(a.maxExcursionMm)&&a.maxExcursionMm>0,'Trace excursion limit must be null or a positive authored bound.');
  const count=a.repeat?.count??1;
  requireThat(typeof a.sequence==='boolean'&&(a.courseIds===null||Array.isArray(a.courseIds)&&a.courseIds.length===count&&new Set(a.courseIds).size===count&&a.courseIds.every(id=>typeof id==='string'&&id.length)),'Trace sequence is boolean; courseIds are null or unique names for each repeated course.');
  requireThat(Array.isArray(a.curves)&&a.curves.length>0,'Curve assignment needs explicit centerlines.');
  for(const curve of a.curves){
    if(familyRepeat)requireThat(curve.uv?.reference?.kind==='slice'&&curve.uv.reference.assignment===a.repeat.family&&curve.uv.reference.index===undefined,'Family repeats need UV curves on that slice family without a fixed layer index.');
    requireThat(curve&&Object.keys(curve).every(k=>['points','nurbs','uv','closed','role','beadWidthMm','heightMm','speedMmS','flowMultiplier','courses','vary','widthRule','sampleStepMm','toleranceMm','contact','depositionAction','segmentMetadata'].includes(k))&&typeof curve.closed==='boolean','Invalid authored curve.');
    requireThat(['points','nurbs','uv'].filter(k=>curve[k]!==undefined).length===1,'Curve needs exactly one of points, nurbs or uv.');
    const input=curve.uv??curve,dimensions=curve.uv?2:3;
    if(input.nurbs)authoredNurbs(input.nurbs,dimensions);
    else requireThat(Array.isArray(input.points)&&input.points.length>=(curve.closed?3:2)&&input.points.every(p=>Array.isArray(p)&&p.length===dimensions&&p.every(Number.isFinite))&&input.points.some(p=>p.some((v,i)=>v!==input.points[0][i])),'Curve needs distinct finite points.');
    if(input.points)requireThat(input.points.every((p,i)=>!i||p.some((v,k)=>v!==input.points[i-1][k]))&&(!curve.closed||input.points[0].some((v,k)=>v!==input.points.at(-1)[k])),'Polyline points must not repeat consecutive vertices or the implicit closed endpoint.');
    if(curve.uv){
      requireThat(Object.keys(curve.uv).every(k=>['reference','points','nurbs','normalMm'].includes(k))&&['points','nurbs'].filter(k=>curve.uv[k]!==undefined).length===1,'UV curve needs exactly one points or nurbs source.');
      const r=curve.uv.reference;requireThat(r&&['patch','slice','sleeve'].includes(r.kind),'UV curve needs a named patch, slice or sleeve reference.');
      const allowed=r.kind==='patch'?['kind','name','part']:r.kind==='slice'?['kind','assignment','index']:['kind','assignment'];
      requireThat(Object.keys(r).every(k=>allowed.includes(k))&&(r.kind==='patch'?typeof r.name==='string'&&r.name.length&&(r.part===undefined||r.part===null||typeof r.part==='string'):typeof r.assignment==='string'&&r.assignment.length),'Invalid named curve reference.');
      requireThat(r.index===undefined||Number.isInteger(r.index)&&r.index>=0,'Slice reference index must be nonnegative.');
      requireThat(curve.uv.normalMm===undefined||Number.isFinite(curve.uv.normalMm),'UV normal distance must be finite.');
    }
    if(curve.segmentMetadata)requireThat(input.points&&Array.isArray(curve.segmentMetadata)&&curve.segmentMetadata.length===input.points.length-(curve.closed?0:1)&&curve.segmentMetadata.every(m=>m&&typeof m==='object'&&!Array.isArray(m)),'Segment metadata needs one object per polyline segment.');
    if(curve.contact){const c=curve.contact;requireThat(Object.keys(c).sort().join()==='gapMm,referenceZMm,sampleStepMm,source'&&(c.source===null||typeof c.source==='string')&&(c.gapMm===null||Number.isFinite(c.gapMm)&&c.gapMm>=0)&&(c.referenceZMm===null||Number.isFinite(c.referenceZMm))&&Number.isFinite(c.sampleStepMm)&&c.sampleStepMm>0,'Curve contact needs source, gapMm, referenceZMm and positive sampleStepMm.');}
    if(curve.depositionAction)requireThat(curve.depositionAction.kind==='press'&&Object.keys(curve.depositionAction).sort().join()==='depthMm,kind'&&Number.isFinite(curve.depositionAction.depthMm)&&curve.depositionAction.depthMm>0,'Curve press action needs positive depthMm.');
    validateCurveProfiles(curve.vary);
    if(curve.widthRule)beadWidthRule(curve.widthRule);
    for(const key of ['sampleStepMm','toleranceMm'])requireThat(curve[key]===undefined||Number.isFinite(curve[key])&&curve[key]>0,`Curve ${key} must be positive.`);
    requireThat(curve.role===undefined||typeof curve.role==='string'&&curve.role.length>0,'Curve role must be a nonempty string.');
    for(const field of ['beadWidthMm','heightMm','speedMmS','flowMultiplier'])requireThat(curve[field]===undefined||Number.isFinite(curve[field])&&curve[field]>0,`Curve ${field} must be positive.`);
    requireThat(curve.courses===undefined||Array.isArray(curve.courses)&&curve.courses.length>0&&new Set(curve.courses).size===curve.courses.length&&curve.courses.every(n=>Number.isInteger(n)&&n>=0&&(a.repeat?.family||n<count)),
      'Curve courses must select distinct indices within its repeat count.');
  }
}

function requireCurveContact(curve,segments,heightMm,id){
  if(!curve.contact)return;
  const c=curve.contact;
  heightMm=curve.heightMm??heightMm;
  for(let i=1;i<curve.points.length;i++){
    const a=curve.points[i-1],b=curve.points[i],n=Math.max(1,Math.ceil(distance(a,b)/c.sampleStepMm));
    for(let j=0;j<=n;j++){
      const p=a.map((v,k)=>v+(b[k]-v)*j/n);
      requireThat(curveSupportsPoint(segments,p,(c.referenceZMm??p[2])-(c.gapMm??heightMm),{source:c.source}),`Trace ${id} leaves its declared supporting material.`);
    }
  }
}

export function authoredCurveResult(assignment,{plan,process=plan.process,bounds=null,references={},modelResults=[]}) {
  const family=assignment.repeat?.family?references[`slice:${assignment.repeat.family}`]:null;
  requireThat(!assignment.repeat?.family||family?.layers?.length,'Curve repeat needs an available named slice family.');
  const indices=family?(assignment.repeat.indices??family.layers.map(l=>l.index)):null;
  const finalizeInside=assignment.sequence||assignment.curves.some(c=>c.contact);
  const courses=[],parts=[],supportSegments=modelResults.flatMap(r=>depositedCurveSegments(r.operations,{widthMm:process.lineWidthMm,source:r.id})),count=indices?.length??assignment.repeat?.count??1,translation=assignment.repeat?.translation??[0,0,0];
  for(let course=0;course<count;course++){
    const index=indices?.[course]??course;
    const active=assignment.curves.filter(curve=>!curve.courses||curve.courses.includes(index));
    if(!active.length)continue;
    const curves=active.flatMap(curve=>constructAuthoredCurves(curve,{references,course:index,offset:[(curve.uv?0:plan.placement.xMm)+course*translation[0],(curve.uv?0:plan.placement.yMm)+course*translation[1],course*translation[2]]}));
    const heightMm=course===0?process.firstLayerMm:process.layerMm,speedMmS=course===0?process.firstLayerSpeedMmS:process.planarSpeedMmS;
    if(family){const layer=family.layers.find(l=>l.index===(indices?.[course]??course));
      for(const curve of curves)if(curve.heightMm===undefined&&!curve.heightsMm&&curve.frameSamples)curve.heightsMm=curve.points.slice(1).map((_,i)=>{
        const n=curve.frameSamples[i].normal,d=family.direction??n;return (layer.heightMm??heightMm)*Math.abs(n.reduce((sum,x,k)=>sum+x*d[k],0));
      });
    }

    const ready=curves.map(curve=>{
      const actualHeightMm=curve.heightMm??heightMm;
      if(curve.depositionAction)requireThat(curve.depositionAction.depthMm<actualHeightMm,'Press depth must remain within its deposition layer.');
      requireCurveContact(curve,supportSegments,heightMm,assignment.id);
      return {...curve,...(curve.depositionAction?{depositionAction:{...curve.depositionAction,layerHeightMm:actualHeightMm}}:{})};
    });
    if(assignment.maxExcursionMm!==null){const heights=ready.flatMap(c=>c.points.map(p=>p[2]));requireThat(Math.max(...heights)-Math.min(...heights)<=assignment.maxExcursionMm+1e-8,'Trace course exceeds its authored Z excursion limit.');}
    const spec={key:assignment.courseIds?.[course]??course,curves:ready,heightMm,speedMmS,layer:course,layerIndex:course,layerCount:count,rank:course,
      regionId:assignment.id,travel:{kind:'auto'},...(Object.hasOwn(assignment.process??{},'fanPercent')||course===1?{fanPercent:process.fanPercent}:{}),...(assignment.sequence?{join:{mode:'ordered'}}:{})};
    courses.push(spec);
    if(finalizeInside){const previous=(assignment.sequence?parts.at(-1)?.operations.map(o=>o.id):null)??assignment.after;
      const raw=traceResult({...assignment,after:previous},{courses:[spec],process,bounds,report:{construction:'curves'}}),result=finalizeDepositionResult(raw,plan);
      for(const op of result.operations)for(const stroke of op.strokes)requireCurveContact(stroke,supportSegments,heightMm,assignment.id);
      if(assignment.maxExcursionMm!==null){const heights=result.operations.flatMap(o=>o.strokes.flatMap(c=>c.points.map(p=>p[2])));requireThat(Math.max(...heights)-Math.min(...heights)<=assignment.maxExcursionMm+1e-8,'Final Trace course exceeds its authored Z excursion limit.');}
      parts.push(result);for(const op of result.operations)for(const segment of depositedCurveSegments([{...op,strokes:op.strokes.filter(s=>!s.depositionAction)}],{widthMm:process.lineWidthMm,source:op.id}))supportSegments.push(segment);
    }
  }
  if(finalizeInside)return combineFinalizedResults({id:assignment.id,report:{construction:'curves',depositionFamily:'trace',courses:count}},parts);
  return traceResult(assignment,{courses,process,bounds,sequential:false,report:{construction:'curves',courses:count}});
}

// Authored and skill-mapped centerlines share bead calculation, joining,
// travel packaging, bounds and aggregate measures. Extensions supply geometry
// and course data; they do not assemble a separate deposition result.
export function traceResult(assignment,{courses,process,bounds=null,sequential=true,report={}}){
  const operations=depositCurveCourses({id:assignment.id,courses,process,after:assignment.after,filament:assignment.filament,sequential});
  let lengthMm=0,strokeCount=0,volumeMm3=0;
  for(const operation of operations)for(const stroke of operation.strokes){
    const width=(stroke.segmentMetadata??[]).reduce((width,m)=>Math.max(width,m.beadWidthMm??0),stroke.beadWidthMm??process.lineWidthMm);
    if(bounds)requireThat(stroke.points.every(p=>p.every((v,i)=>v>=(i===2?bounds.min[i]:bounds.min[i]+width/2)-1e-8&&v<=(i===2?bounds.max[i]:bounds.max[i]-width/2)+1e-8)),
      `Curve assignment ${assignment.id} exceeds selected tool bounds on course ${operation.layer}.`);
    const length=curveLength(stroke.points);lengthMm+=length;strokeCount++;
    const closing=stroke.closed?distance(stroke.points.at(-1),stroke.points[0]):0;
    volumeMm3+=stroke.volumesMm3?stroke.volumesMm3.reduce((sum,v)=>sum+v,0):(length+closing)*stroke.beadAreaMm2;
  }
  return {id:assignment.id,operations,report:{...report,depositionFamily:'trace',strokes:strokeCount,lengthMm,volumeMm3}};
}

// Construct a selected trace from finalized predecessors. Dependent courses
// finalize their internal sequence before subsequent contact checks.
export function curveAssignmentResult(assignment,{plan,modelResults,bounds=null,references={}}) {
  validateCurveAssignment(assignment);
  const selected=assignmentPlan(plan,assignment);
  return authoredCurveResult(assignment,{plan,process:selected.process,references,modelResults});
}

// References carry evaluated data in placed world coordinates. A shared-owner
// result keeps its own family identity instead of replacing the owner's base.
export function depositionReferences(shells,results){
  const references={};
  for(const [part,shell] of shells)for(const patch of shell.patches??[])references[`patch:${part??''}:${patch.name}`]={patch};
  const families=new Map();
  for(const result of results){
    const family=result.family??(result.familyLayers?{layers:result.familyLayers}:null);
    if(!family?.layers?.length)continue;
    const owner=result.report?.owner??result.id;
    const existing=references[`slice:${result.id}`];
    const combined=existing?{...family,layers:[...existing.layers,...family.layers]}:family;
    references[`slice:${result.id}`]=combined;
    references[`sleeve:${result.id}`]=combined;
    if(!result.familyId||result.familyId===owner){
      const key=`slice:${owner}`;
      (families.get(key)??families.set(key,new Map()).get(key)).set(result.id,combined);
    }
  }
  for(const [key,byResult] of families){
    const found=[...byResult.values()];
    const sleeveKey=key.replace(/^slice:/,'sleeve:');
    if(found.length===1){references[key]=found[0];references[sleeveKey]=found[0];}
    else {delete references[key];delete references[sleeveKey];}
  }
  return references;
}

const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
