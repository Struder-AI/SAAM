import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareCurvePath,curveAt} from './curve-path.mjs';
import {validatePose,samePose} from './pose.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {validateManufacturing,CONSTRUCTION_CONTRACT} from './manufacturing.mjs';

const table=value=>value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0;
const interval=(from,to)=>Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&from<to&&to<=1;
const point=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
export function serializableSource(value){
  if(typeof value==='number'){requireThat(Number.isFinite(value),'SAAMpath contains non-finite numerical data.');return value+0;}
  if(Array.isArray(value)||ArrayBuffer.isView(value))return Array.from(value,serializableSource);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,serializableSource(v)]));
  requireThat(value===null||['string','boolean'].includes(typeof value),'SAAMpath contains non-serializable data.');return value;
}
export function admitSource(source){
  for(const key of ['curves','layers','surfaces','processes','operations'])requireThat(table(source[key])&&Object.keys(source[key]).every(id),'Source needs ID keyed '+key+'.');
  const reader=prepareCurvePath(source);
  const nativeLayers=new Set();
  for(const layer of Object.values(source.layers))requireThat(id(layer.stackId)&&Number.isSafeInteger(layer.index)&&layer.index>=0&&(layer.surfaceId===null||Object.hasOwn(source.surfaces,layer.surfaceId)),'Layer must retain a construction stack, index and optional reference surface.');
  for(const layer of Object.values(source.layers)){
    const key=JSON.stringify([layer.stackId,layer.index]);requireThat(!nativeLayers.has(key),'A native stack position has one slice identity.');nativeLayers.add(key);
    if(source.manufacturing)requireThat(source.completions?.[layer.completionId]?.kind==='slice','A manufactured native slice needs its completion record.');
  }
  const courses=new Set();
  for(const [key,operation] of Object.entries(source.operations)){
    for(const requirement of operation.requiredMaterial??[])requireThat(requirement.layerIds===undefined||Array.isArray(requirement.layerIds)&&new Set(requirement.layerIds).size===requirement.layerIds.length&&requirement.layerIds.every(value=>value===null||Object.hasOwn(source.layers,value)),
      'Scoped material readiness must select existing native slices or unlayered producers.');
    for(const field of ['discoverSubstrate','resolveSubstrate','resolveInternalSubstrate','suppliesSubstrate'])requireThat(operation[field]===undefined||operation[field]===true,'Invalid substrate-contact declaration.');
    requireThat(operation.id===key&&Array.isArray(operation.after)&&operation.after.every(previous=>previous!==key&&(Object.hasOwn(source.operations,previous)||Object.hasOwn(source.completions??{},previous))),
      'Operation needs its source identity and existing predecessors.');
    requireThat(Object.hasOwn(source.processes,operation.processId)&&(operation.layerId===null||Object.hasOwn(source.layers,operation.layerId))&&typeof operation.interruptible==='boolean',
      'Operation needs process, native layer or null, and interruptibility.');
    if(operation.kind==='deposit'){
      requireThat(Array.isArray(operation.courses)&&operation.courses.length>0,'Moving operation needs courses.');
      for(const course of operation.courses){
        requireThat(course.directionRequired===undefined||typeof course.directionRequired==='boolean','Course directionRequired must be boolean.');
        requireThat(course.seamRequired===undefined||typeof course.seamRequired==='boolean','Course seamRequired must be boolean.');
        requireThat(course.orderGroup===undefined||id(course.orderGroup),'Course orderGroup must be a nonempty local name.');
        requireThat(id(course.id)&&!courses.has(course.id)&&Object.hasOwn(source.curves,course.curveId)&&interval(course.from,course.to)&&typeof course.interruptible==='boolean',
          'Invalid or duplicated source course.');courses.add(course.id);
        requireThat(source.curves[course.curveId].geometry.kind!=='point'&&source.curves[course.curveId].profiles.material,'Moving deposition needs material on a moving curve.');
        if(course.seamRequired===true){
          const start=curveAt(reader,course.curveId,course.from).point,end=curveAt(reader,course.curveId,course.to,{side:'left'}).point;
          requireThat(start.every((v,i)=>Math.abs(v-end[i])<=ROUNDING_MM),'A required seam belongs to a closed course.');
        }
      }
    }else{
      const injection=operation.injection;
      requireThat(operation.kind==='inject'&&!operation.courses&&operation.interruptible===false&&point(injection?.at)&&
        Number.isFinite(injection.volumeMm3)&&injection.volumeMm3>0&&Number.isFinite(injection.flowMm3S)&&injection.flowMm3S>0&&Number.isFinite(injection.holdSeconds)&&injection.holdSeconds>=0,
        'Inject needs an atomic finite metered stationary operation.');validatePose(injection.pose);
    }
  }
  for(const operation of Object.values(source.operations))for(const [index,course] of (operation.courses??[]).entries()){
    requireThat(course.after===undefined||Array.isArray(course.after)&&course.after.every(previous=>previous!==course.id&&courses.has(previous)),
      'Course dependencies must name existing distinct predecessor courses.');
    if(!operation.interruptible)for(const previous of course.after??[]){
      const local=operation.courses.findIndex(candidate=>candidate.id===previous);
      requireThat(local<0||local<index,'An atomic operation must retain its required course sequence.');
    }
  }
  validateManufacturing(source);
  if(source.manufacturing){
    const validity=source.manufacturing;
    requireThat([CONSTRUCTION_CONTRACT,'saam-construction-access/1','saam-construction-access/2'].includes(validity.contract)&&table(validity.accessGeometry)&&table(validity.courseTraversal),
      'Manufacturing validity needs its access model and permitted traversal exceptions.');
    requireThat(Number.isFinite(validity.accessGeometry.includedAngleDeg)&&validity.accessGeometry.includedAngleDeg>0&&validity.accessGeometry.includedAngleDeg<180&&
      Number.isFinite(validity.accessGeometry.tipDiameterMm)&&validity.accessGeometry.tipDiameterMm>=0,'Invalid construction access geometry.');
    requireThat(Object.values(source.operations).every(operation=>id(operation.construction)),'Certified work must retain its producer identity.');
    for(const [key,policy] of Object.entries(validity.courseTraversal))requireThat(courses.has(key)&&Array.isArray(policy.directions)&&policy.directions.length>0&&
      policy.directions.every(direction=>typeof direction==='boolean')&&typeof policy.seamFree==='boolean','Invalid construction traversal permission.');
  }
  requireThat(table(source.planning)&&table(source.summary),'Source needs planning and summary records.');
  return source;
}
export function admitSchedule(schedule){
  requireThat(id(schedule.sourcePathId)&&point(schedule.initialPosition)&&table(schedule.motionCurves)&&Array.isArray(schedule.execution),
    'Schedule needs exact source identity, initial position, motion curves and execution.');
  validatePose(schedule.initialPose);prepareCurvePath({curves:schedule.motionCurves});
  requireThat(table(schedule.summary)&&table(schedule.completion),'Schedule needs summary and completion records.');
  for(const curve of Object.values(schedule.motionCurves)){
    const material=curve.profiles.material;
    if(material)requireThat(material.kind==='cumulative'?material.knots.at(-1)[1]===0:
      typeof material.areaMm2==='number'?material.areaMm2===0:material.areaMm2.knots.every(([,value])=>value===0),'Travel cannot deposit material.');
  }
  for(const entry of schedule.execution){
    if(entry.kind==='deposit')requireThat(id(entry.courseId)&&interval(entry.from,entry.to)&&(entry.reverse===undefined||typeof entry.reverse==='boolean'),'Invalid execution source range.');
    else if(entry.kind==='travel')requireThat(Object.hasOwn(schedule.motionCurves,entry.curveId)&&interval(entry.from,entry.to)&&
      (entry.durationSeconds===undefined||Number.isFinite(entry.durationSeconds)&&entry.durationSeconds>0),'Invalid execution travel.');
    else if(entry.kind==='inject')requireThat(id(entry.operationId),'Invalid execution injection.');
    else validateEvent(entry);
  }
  return schedule;
}
function validateEvent(entry){
  if(entry.kind==='temperature')requireThat(Number.isFinite(entry.targetC)&&entry.targetC>0,'Invalid execution temperature.');
  else if(entry.kind==='fan')requireThat(Number.isFinite(entry.percent),'Invalid execution fan.');
  else if(entry.kind==='toolChange')requireThat(Number.isInteger(entry.filament)&&entry.filament>=0&&!Object.hasOwn(entry,'tool'),'Execution selects logical material.');
  else if(entry.kind==='retract'||entry.kind==='recover')requireThat(Number.isFinite(entry.filamentMm)&&entry.filamentMm>=0&&Number.isFinite(entry.speedMmS),'Invalid execution filament action.');
  else if(entry.kind==='dwell')requireThat(Number.isFinite(entry.seconds)&&entry.seconds>=0,'Invalid execution dwell.');
  else if(entry.kind==='context')requireThat(!['pose','materialNormal','widthMm','speedMmS','material','volumeMm3'].some(key=>Object.hasOwn(entry,key)),
    'Context cannot override physical profiles.');
  else throw Error('Invalid execution event: '+entry.kind);
}
export function validateExecutionSource(source,schedule){
  const courses=new Map(),coverage=new Map(),injections=new Set(),operationIndices=new Map(),courseIndices=new Map();
  const reader=prepareCurvePath(source),motion=prepareCurvePath({curves:schedule.motionCurves}),cursor={point:schedule.initialPosition,pose:schedule.initialPose};
  for(const operation of Object.values(source.operations))for(const course of operation.courses??[])courses.set(course.id,{course,operation});
  for(const [index,entry] of schedule.execution.entries()){
    if(entry.kind==='deposit'){
      const found=courses.get(entry.courseId);requireThat(found&&entry.from>=found.course.from&&entry.to<=found.course.to,'Execution references an unknown course or leaves its range.');
      requireThat(!entry.reverse||found.course.directionRequired===false&&found.operation.interruptible&&!found.operation.continuous,'Execution cannot reverse required deposition direction.');
      const policy=source.manufacturing?.courseTraversal?.[entry.courseId];
      requireThat(!policy||policy.directions.includes(Boolean(entry.reverse)),'Execution leaves the producer-certified traversal directions.');
      const low=curveAt(reader,found.course.curveId,entry.from),high=curveAt(reader,found.course.curveId,entry.to,{side:'left'});
      const start=entry.reverse?high:low,end=entry.reverse?low:high;
      requireContinuation(cursor,start.point,start.pose);cursor.point=end.point;cursor.pose=end.pose;
      const pieces=coverage.get(entry.courseId)??[];pieces.push({from:entry.from,to:entry.to,reverse:entry.reverse,index});coverage.set(entry.courseId,pieces);
      const chronology=courseIndices.get(entry.courseId);
      if(chronology)chronology.last=index;else courseIndices.set(entry.courseId,{first:index,last:index});
      const indices=operationIndices.get(found.operation.id)??[];indices.push(index);operationIndices.set(found.operation.id,indices);
    }else if(entry.kind==='inject'){
      requireThat(source.operations[entry.operationId]?.kind==='inject'&&!injections.has(entry.operationId),'Injection must execute once.');
      const injection=source.operations[entry.operationId].injection;requireContinuation(cursor,injection.at,injection.pose);
      injections.add(entry.operationId);operationIndices.set(entry.operationId,[index]);
    }else if(entry.kind==='travel'){
      const start=curveAt(motion,entry.curveId,entry.from),end=curveAt(motion,entry.curveId,entry.to,{side:'left'});
      requireContinuation(cursor,start.point,start.pose);cursor.point=end.point;cursor.pose=end.pose;
    }
  }
  for(const {course} of courses.values()){
    const pieces=coverage.get(course.id)??[],first=pieces[0];
    if(course.seamRequired===true||course.seamRequired===false&&source.manufacturing?.courseTraversal?.[course.id]?.seamFree===false)
      requireThat(first&&(first.reverse?first.to===course.to:first.from===course.from),'Execution violates a required or producer-certified course seam.');
    if(course.directionRequired!==false)requireThat(pieces.every((piece,i)=>!i||pieces[i-1].to===piece.from),'Execution violates required forward curve progression.');
    pieces.sort((a,b)=>a.from-b.from);
    requireThat(pieces.length>0&&pieces[0].from===course.from&&pieces.at(-1).to===course.to&&pieces.every((piece,i)=>!i||piece.from===pieces[i-1].to),
      'Execution must cover each course exactly once without gaps.');
    if(!course.interruptible)requireThat(pieces.length===1,'An atomic course cannot be split.');
    for(const previous of course.after??[])requireThat(courseIndices.get(previous)?.last<courseIndices.get(course.id).first,
      'Execution violates a required course dependency.');
  }
  const completionIndices=new Map();
  function completionRange(id){
    if(completionIndices.has(id))return completionIndices.get(id);
    const operation=operationIndices.get(id);
    if(operation)return [operation[0],operation.at(-1)];
    const course=courseIndices.get(id);if(course)return [course.first,course.last];
    const completion=source.completions?.[id];requireThat(completion,'Execution prerequisite names absent work.');
    const range=[Infinity,-Infinity];
    for(const member of completion.members){const bounds=completionRange(member);range[0]=Math.min(range[0],bounds[0]);range[1]=Math.max(range[1],bounds[1]);}
    completionIndices.set(id,range);return range;
  }
  for(const [id,completion] of Object.entries(source.completions??{})){
    const range=completionRange(id);
    for(const previous of completion.after)requireThat(completionRange(previous)[1]<range[0],'Execution violates a required completion dependency.');
  }
  for(const operation of Object.values(source.operations)){
    const indices=operationIndices.get(operation.id);requireThat(indices?.length>0,'Source operation is missing from execution.');
    for(const predecessor of operation.after)requireThat(completionRange(predecessor)[1]<indices[0],'Execution violates an explicit source dependency.');
    if(!operation.interruptible){
      const first=indices[0],last=indices.at(-1);
      for(const [other,found] of operationIndices)if(other!==operation.id)requireThat(found.every(index=>index<first||index>last),'An atomic operation cannot interleave.');
    }
    if(operation.continuous){
      const ordered=(operation.courses??[]).map(course=>coverage.get(course.id));
      requireThat(ordered.every((pieces,i)=>pieces.length===1&&(!i||ordered[i-1][0].index<pieces[0].index)),
        'Execution cannot split or reorder an authored continuous chain.');
    }
  }
}
function requireContinuation(cursor,point,pose){
  requireThat(point.every((value,i)=>Math.abs(value-cursor.point[i])<=ROUNDING_MM)&&samePose(cursor.pose,pose),
    'Execution ranges need explicit continuous position and pose transfers.');
}
