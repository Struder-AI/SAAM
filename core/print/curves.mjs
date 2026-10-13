import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

import {curveLength} from '../path/curve-construction.mjs';
import {authoredNurbs,readCurveProfiles,distinctPolyline,constructAuthoredCurves} from '../path/authored-curves.mjs';
import {readWidthRule} from '../path/parallel-curves.mjs';
import {depositedCurveSegments,curveSupportsPoint} from '../path/deposited-curves.mjs';
import {contactSpans,contactSpanNote} from '../path/contact-curves.mjs';
import {depositCurveBatches} from '../path/curve-batches.mjs';
import {joinCurveSequence} from '../path/stack-curves.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {finalizeDepositionResult,combineFinalizedResults} from './finalize.mjs';

// Authored deposition joins the ordinary assignment list without inventing an
// enclosing solid. A repeat is its own XYZ grid; it need not share other grids.
export function curveAssignment({id,construction='curves',...options}) {
  requireThat(construction==='curves','Trace uses explicit curves; retired technique records require migration.');
  return structuredClone({id,construction,part:null,filament:null,process:null,after:[],curves:[],repeat:null,sequence:false,repetitionIds:null,maxExcursionMm:null,source:null,toolPose:null,...options});
}

export function validateCurveAssignment(a,{parts=null}={}) {
  requireThat(!Object.hasOwn(a,'courseIds')&&!a.curves?.some(c=>Object.hasOwn(c,'courses'))&&!Object.hasOwn(a.repeat??{},'family'),'Trace field names courseIds, courses and repeat.family are retired; keep only repetitionIds, repetitions and repeat.stack.');
  const expected=Object.keys(curveAssignment({construction:a.construction})).sort().join();
  requireThat(a.construction==='curves'&&Object.keys(a).sort().join()===expected,`Invalid ${a.construction} assignment fields.`);
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid curve assignment id.');
  requireThat(a.part===null||typeof a.part==='string'&&(parts===null||parts.includes(a.part)),'Curve assignment names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Curve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Curve after must list operation ids.');
  const translationRepeat=a.repeat&&Object.keys(a.repeat).sort().join()==='count,translation'&&Number.isInteger(a.repeat.count)&&a.repeat.count>0&&point(a.repeat.translation);
  const stackRepeat=a.repeat&&Object.keys(a.repeat).sort().join()==='indices,stack'&&typeof a.repeat.stack==='string'&&a.repeat.stack.length&&(a.repeat.indices===null||Array.isArray(a.repeat.indices)&&a.repeat.indices.length&&new Set(a.repeat.indices).size===a.repeat.indices.length&&a.repeat.indices.every(n=>Number.isInteger(n)&&n>=0));
  requireThat(a.repeat===null||translationRepeat||stackRepeat,'Curve repeat needs {count,translation:XYZ} or {stack,indices:null|slice indices}.');
  requireThat(a.maxExcursionMm===null||Number.isFinite(a.maxExcursionMm)&&a.maxExcursionMm>0,'Trace excursion limit must be null or a positive authored bound.');
  const count=a.repeat?.count??1;
  requireThat(typeof a.sequence==='boolean'&&(a.repetitionIds===null||Array.isArray(a.repetitionIds)&&a.repetitionIds.length===count&&new Set(a.repetitionIds).size===count&&a.repetitionIds.every(id=>typeof id==='string'&&id.length)),'Trace sequence is boolean; repetitionIds are null or unique names for each repetition.');
  const source=a.source;
  requireThat(source===null||source&&Object.keys(source).sort().join()==='assignment,extension,parameters'&&typeof source.extension==='string'&&/^[a-z][a-z0-9-]*$/.test(source.extension)&&typeof source.assignment==='string'&&source.assignment!==a.id&&source.assignment.length&&source.parameters&&typeof source.parameters==='object'&&!Array.isArray(source.parameters),'Trace source needs extension, distinct Slice assignment and parameters.');
  requireThat(a.toolPose===null||a.toolPose&&Object.keys(a.toolPose).join()==='alignToSliceNormal'&&typeof a.toolPose.alignToSliceNormal==='boolean','Trace toolPose is null or {alignToSliceNormal:boolean}.');
  requireThat(Array.isArray(a.curves)&&(source?a.curves.length===0&&a.repeat===null:a.curves.length>0),'Trace needs explicit centerlines or one generation-time source without curves or repeats.');
  for(const curve of a.curves){
    if(stackRepeat)requireThat(curve.uv?.reference?.kind==='slice'&&curve.uv.reference.assignment===a.repeat.stack&&curve.uv.reference.index===undefined,'Stack repeats need UV curves on that slice stack without a fixed slice index.');
    requireThat(curve&&typeof curve.closed==='boolean','Each authored curve needs closed true or false.');
    requireThat(['points','nurbs','uv'].filter(k=>curve[k]!==undefined).length===1,'Curve needs exactly one of points, nurbs or uv.');
    const input=curve.uv??curve,dimensions=curve.uv?2:3;
    if(input.nurbs)authoredNurbs(input.nurbs,dimensions);
    else requireThat(Array.isArray(input.points)&&input.points.length>=(curve.closed?3:2)&&input.points.every(p=>Array.isArray(p)&&p.length===dimensions&&p.every(Number.isFinite)),'Curve needs finite points.');
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
    requireThat(curve.repetitions===undefined||Array.isArray(curve.repetitions)&&curve.repetitions.length>0&&new Set(curve.repetitions).size===curve.repetitions.length&&curve.repetitions.every(n=>Number.isInteger(n)&&n>=0&&(a.repeat?.stack||n<count)),
      'Curve repetitions must select distinct indices within its repeat count.');
  }
}

// A curve as Trace reads it: fields it cannot read or use are left out and
// named in ignored, and repeated polyline vertices are dropped. A curve without
// two distinct vertices (three when closed) is null: it prints nothing. Speed
// and flow need only be finite: zero flow moves along the curve without
// depositing; a negative flow fails within its assignment's deposition boundary.
const CURVE_FIELDS=['points','nurbs','uv','closed','role','beadWidthMm','heightMm','speedMmS','flowMultiplier','repetitions','vary','widthRule','sampleStepMm','toleranceMm','contact','depositionAction','segmentMetadata'];
const POSITIVE_FIELDS=['beadWidthMm','heightMm','sampleStepMm','toleranceMm'];
export function readAuthoredCurve(source){
  const read=Object.fromEntries(Object.entries(source).filter(([key,value])=>CURVE_FIELDS.includes(key)&&(!POSITIVE_FIELDS.includes(key)||Number.isFinite(value)&&value>0)
    &&(key!=='speedMmS'&&key!=='flowMultiplier'||Number.isFinite(value))&&(key!=='role'||typeof value==='string'&&value.length>0)));
  const profiles=readCurveProfiles(read.vary),width=readWidthRule(read.widthRule);
  const ignored=[...Object.keys(source).filter(key=>!Object.hasOwn(read,key)),...profiles.ignored,...width.ignored];
  const curve={...read,vary:profiles.vary,widthRule:width.rule};
  for(const key of ['vary','widthRule'])if(curve[key]===undefined)delete curve[key];
  const input=curve.uv??curve;
  if(!input.points)return {curve,ignored};
  const distinct=distinctPolyline(input.points,curve.closed);
  if(distinct.points.length<(curve.closed?3:2))return {curve:null,ignored};
  const points=curve.uv?{uv:{...curve.uv,points:distinct.points}}:{points:distinct.points};
  return {curve:{...curve,...points,...(curve.segmentMetadata?{segmentMetadata:distinct.segments.map(j=>curve.segmentMetadata[j])}:{})},ignored};
}

// Spans of a curve declaring contact where its supporting material is absent;
// the curve prints there at its authored height with its bead (contactSpans).
function unsupportedCurveSpans(curve,segments,heightMm){
  if(!curve.contact)return [];
  const c=curve.contact,height=curve.heightMm??heightMm;
  return contactSpans(curve.points.slice(1).flatMap((b,i)=>{
    const a=curve.points[i],n=Math.max(1,Math.ceil(distance(a,b)/c.sampleStepMm));
    return Array.from({length:i?n:n+1},(_,j)=>{
      const p=a.map((v,k)=>v+(b[k]-v)*(i?j+1:j)/n);
      return {point:p,status:curveSupportsPoint(segments,p,(c.referenceZMm??p[2])-(c.gapMm??height),{source:c.source})?null:'unsupported'};
    });
  }));
}

export function authoredCurveResult(assignment,{plan,process=plan.process,references={},modelResults=[],sourceLayer=null}) {
  const referenceStack=sourceLayer?.referenceStack??(assignment.repeat?.stack?references[`slice:${assignment.repeat.stack}`]:null);
  requireThat(!assignment.repeat?.stack||referenceStack?.layers?.length,'Curve repeat needs an available named slice stack.');
  const indices=sourceLayer?[sourceLayer.index]:referenceStack?(assignment.repeat.indices??referenceStack.layers.map(l=>l.index)):null;
  const finalizeInside=!sourceLayer&&(assignment.sequence||assignment.curves.some(c=>c.contact));
  const read=assignment.curves.map(readAuthoredCurve),ignored=read.flatMap(({ignored},i)=>ignored.map(field=>`curves[${i}].${field}`)),authored=read.flatMap(({curve})=>curve?[curve]:[]);
  const batches=[],parts=[],notes=ignored.length?[`Trace ${assignment.id} fields ignored, not readable by this SAAM: ${ignored.join(', ')}.`]:[],supportSegments=authored.some(curve=>curve.contact)?modelResults.flatMap(r=>depositedCurveSegments(r.operations,{widthMm:process.lineWidthMm,source:r.id})):[],count=indices?.length??assignment.repeat?.count??1,translation=assignment.repeat?.translation??[0,0,0];
  for(let repetition=0;repetition<count;repetition++){
    const index=indices?.[repetition]??repetition;
    const active=authored.filter(curve=>!curve.repetitions||curve.repetitions.includes(index));
    if(!active.length)continue;
    const curves=active.flatMap(curve=>constructAuthoredCurves(curve,{references,repetition:index,offset:translation.map(v=>repetition*v)}));
    const heightMm=sourceLayer?.heightMm??(repetition===0?process.firstLayerMm:process.layerMm),speedMmS=sourceLayer?.speedMmS??(repetition===0?process.firstLayerSpeedMmS:process.planarSpeedMmS);
    if(referenceStack){const layer=referenceStack.layers.find(l=>l.index===(indices?.[repetition]??repetition));
      for(const curve of curves)if(curve.heightMm===undefined&&!curve.heightsMm&&curve.frameSamples)curve.heightsMm=curve.points.slice(1).map((_,i)=>{
        const n=curve.frameSamples[i].normal,d=referenceStack.direction??n;return (layer.heightMm??heightMm)*Math.abs(n.reduce((sum,x,k)=>sum+x*d[k],0));
      });
    }

    const ready=curves.map(curve=>{
      const actualHeightMm=curve.heightMm??heightMm;
      if(curve.depositionAction)requireThat(curve.depositionAction.depthMm<actualHeightMm,'Press depth must remain within its deposition layer.');
      notes.push(...unsupportedCurveSpans(curve,supportSegments,heightMm).map(span=>contactSpanNote(`Trace ${assignment.id}`,span)));
      return {...curve,...(curve.depositionAction?{depositionAction:{...curve.depositionAction,layerHeightMm:actualHeightMm}}:{})};
    });
    if(assignment.maxExcursionMm!==null){const heights=ready.flatMap(c=>c.points.map(p=>p[2]));requireThat(Math.max(...heights)-Math.min(...heights)<=assignment.maxExcursionMm+PRINT_RESOLUTION_MM,'Trace repetition exceeds its authored Z excursion limit.');}
    const spec={key:sourceLayer?.key??assignment.repetitionIds?.[repetition]??repetition,curves:ready,heightMm,speedMmS,layer:sourceLayer?.index??repetition,layerIndex:sourceLayer?.ordinal??repetition,layerCount:sourceLayer?.count??count,rank:sourceLayer?.rank??repetition,
      ...(sourceLayer?.layerId?{layerId:sourceLayer.layerId}:{}),
      regionId:assignment.id,travel:{kind:'auto'},...(Object.hasOwn(assignment.process??{},'fanPercent')||repetition===1?{fanPercent:process.fanPercent}:{}),...(assignment.sequence?{join:{mode:'ordered'}}:{})};
    batches.push(spec);
    if(finalizeInside){const previous=(assignment.sequence?parts.at(-1)?.operations.map(o=>o.id):null)??assignment.after;
      const raw=traceResult({...assignment,after:previous},{batches:[spec],process,report:{construction:'curves'}}),result=finalizeDepositionResult(raw,plan);
      if(assignment.maxExcursionMm!==null){const heights=result.operations.flatMap(o=>o.strokes.flatMap(c=>c.points.map(p=>p[2])));requireThat(Math.max(...heights)-Math.min(...heights)<=assignment.maxExcursionMm+PRINT_RESOLUTION_MM,'Final Trace repetition exceeds its authored Z excursion limit.');}
      parts.push(result);for(const op of result.operations)for(const segment of depositedCurveSegments([{...op,strokes:op.strokes.filter(s=>!s.depositionAction)}],{widthMm:process.lineWidthMm,source:op.id}))supportSegments.push(segment);
    }
  }
  const noted=notes.length?{notes}:{};
  if(finalizeInside)return combineFinalizedResults({id:assignment.id,report:{construction:'curves',depositionFamily:'trace',repetitions:count,...noted}},parts);
  return traceResult(assignment,{batches,process,sequential:false,report:{construction:'curves',repetitions:count,...noted}});
}

// Authored and skill-mapped centerlines share bead calculation, joining,
// travel packaging and aggregate measures. Extensions supply geometry
// and repetition data; they do not assemble a separate deposition result.
// Join notes: a join rule field it cannot read takes its default, and a gap in
// a continuous join without a depositing connector prints as travel.
export function traceResult(assignment,{batches,process,sequential=true,report={}}){
  const deposited=depositCurveBatches({id:assignment.id,batches,process,after:assignment.after,filament:assignment.filament,sequential});
  const operations=assignment.toolPose?deposited.map(operation=>({...operation,strokes:operation.strokes.map(stroke=>({...stroke,
    motionIntent:{kind:'derived-pose',alignToSliceNormal:assignment.toolPose.alignToSliceNormal}}))})):deposited;
  const joinNotes=batches.flatMap((batch,index)=>{
    if(!batch.join)return [];
    const {ignored,travelGaps}=joinCurveSequence(batch.curves,batch.join),name=`Trace ${assignment.id} batch ${batch.key??index}`;
    return [...(ignored.length?[`${name}: join ${ignored.join(', ')} unreadable; the default is used.`]:[]),...(travelGaps?[`${name}: ${travelGaps} gap(s) in its continuous join print as travel.`]:[])];
  });
  let lengthMm=0,strokeCount=0,volumeMm3=0;
  for(const operation of operations)for(const stroke of operation.strokes){
    const length=curveLength(stroke.points);lengthMm+=length;strokeCount++;
    const closing=stroke.closed?distance(stroke.points.at(-1),stroke.points[0]):0;
    volumeMm3+=stroke.volumesMm3?stroke.volumesMm3.reduce((sum,v)=>sum+v,0):(length+closing)*stroke.beadAreaMm2;
  }
  return {id:assignment.id,operations,report:{...report,...(joinNotes.length?{notes:[...(report.notes??[]),...joinNotes]}:{}),depositionFamily:'trace',strokes:strokeCount,lengthMm,volumeMm3}};
}

// Construct a selected trace from finalized predecessors. Dependent batches
// finalize their internal sequence before subsequent contact checks.
export function curveAssignmentResult(assignment,{plan,modelResults,references={}}) {
  validateCurveAssignment(assignment);
  const selected=assignmentPlan(plan,assignment);
  return authoredCurveResult(assignment,{plan,process:selected.process,references,modelResults});
}

// References carry evaluated data in placed world coordinates. A shared-owner
// result keeps its own stack identity instead of replacing the owner's base.
export function depositionReferences(shells,results){
  const references={};
  for(const [part,shell] of shells)for(const patch of shell.patches??[])references[`patch:${part??''}:${patch.name}`]={patch};
  const referenceStacks=new Map();
  for(const result of results){
    const referenceStack=result.referenceStack??(result.stackLayers?{layers:result.stackLayers}:null);
    if(!referenceStack?.layers?.length)continue;
    const owner=result.report?.owner??result.id;
    const existing=references[`slice:${result.id}`];
    const combined=existing?{...referenceStack,layers:[...existing.layers,...referenceStack.layers]}:referenceStack;
    references[`slice:${result.id}`]=combined;
    references[`sleeve:${result.id}`]=combined;
    if(!result.stackId||result.stackId===owner){
      const key=`slice:${owner}`;
      (referenceStacks.get(key)??referenceStacks.set(key,new Map()).get(key)).set(result.id,combined);
    }
  }
  for(const [key,byResult] of referenceStacks){
    const found=[...byResult.values()];
    const sleeveKey=key.replace(/^slice:/,'sleeve:');
    if(found.length===1){references[key]=found[0];references[sleeveKey]=found[0];}
    else {delete references[key];delete references[sleeveKey];}
  }
  return references;
}

const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
