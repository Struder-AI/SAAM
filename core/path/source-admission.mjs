import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareCurvePath} from './curve-path.mjs';
import {validatePose} from './pose.mjs';

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
  prepareCurvePath(source);
  for(const layer of Object.values(source.layers))requireThat(id(layer.stackId)&&Number.isInteger(layer.index)&&Object.hasOwn(source.surfaces,layer.surfaceId),'Layer must retain a native stack, index and surface.');
  const courses=new Set();
  for(const [key,operation] of Object.entries(source.operations)){
    requireThat(operation.id===key&&Array.isArray(operation.after)&&operation.after.every(previous=>previous!==key&&Object.hasOwn(source.operations,previous)),
      'Operation needs its source identity and existing predecessors.');
    requireThat(Object.hasOwn(source.processes,operation.processId)&&(operation.layerId===null||Object.hasOwn(source.layers,operation.layerId))&&typeof operation.interruptible==='boolean',
      'Operation needs process, native layer or null, and interruptibility.');
    if(operation.kind==='deposit'){
      requireThat(Array.isArray(operation.courses)&&operation.courses.length>0,'Moving operation needs courses.');
      for(const course of operation.courses){
        requireThat(id(course.id)&&!courses.has(course.id)&&Object.hasOwn(source.curves,course.curveId)&&interval(course.from,course.to)&&typeof course.interruptible==='boolean',
          'Invalid or duplicated source course.');courses.add(course.id);
        requireThat(source.curves[course.curveId].geometry.kind!=='point'&&source.curves[course.curveId].profiles.material,'Moving deposition needs material on a moving curve.');
      }
    }else{
      const injection=operation.injection;
      requireThat(operation.kind==='inject'&&!operation.courses&&operation.interruptible===false&&point(injection?.at)&&
        Number.isFinite(injection.volumeMm3)&&injection.volumeMm3>0&&Number.isFinite(injection.flowMm3S)&&injection.flowMm3S>0&&Number.isFinite(injection.holdSeconds)&&injection.holdSeconds>=0,
        'Inject needs an atomic finite metered stationary operation.');validatePose(injection.pose);
    }
  }
  const visited=new Set(),active=new Set();
  function visit(key){
    if(visited.has(key))return;requireThat(!active.has(key),'Source dependencies contain a cycle.');active.add(key);
    for(const previous of source.operations[key].after)visit(previous);
    active.delete(key);visited.add(key);
  }
  for(const key of Object.keys(source.operations))visit(key);
  requireThat(table(source.planning)&&table(source.summary),'Source needs planning and summary records.');
  return source;
}
export function admitSchedule(schedule){
  requireThat(id(schedule.sourcePathId)&&point(schedule.initialPosition)&&table(schedule.motionCurves)&&Array.isArray(schedule.execution),
    'Schedule needs exact source identity, initial position, motion curves and execution.');
  validatePose(schedule.initialPose);prepareCurvePath({curves:schedule.motionCurves});
  for(const entry of schedule.execution){
    if(entry.kind==='deposit')requireThat(id(entry.courseId)&&interval(entry.from,entry.to),'Invalid execution source range.');
    else if(entry.kind==='travel')requireThat(Object.hasOwn(schedule.motionCurves,entry.curveId)&&interval(entry.from,entry.to)&&
      (entry.durationSeconds===undefined||Number.isFinite(entry.durationSeconds)&&entry.durationSeconds>0),'Invalid execution travel.');
    else if(entry.kind==='inject')requireThat(id(entry.operationId),'Invalid execution injection.');
    else requireThat(['fan','temperature','toolChange','retract','recover','dwell','context'].includes(entry.kind),'Invalid execution event.');
  }
  return schedule;
}
export function validateExecutionSource(source,schedule){
  const courses=new Map(),coverage=new Map(),injections=new Set(),operationIndices=new Map();
  for(const operation of Object.values(source.operations))for(const course of operation.courses??[])courses.set(course.id,{course,operation});
  for(const [index,entry] of schedule.execution.entries()){
    if(entry.kind==='deposit'){
      const found=courses.get(entry.courseId);requireThat(found&&entry.from>=found.course.from&&entry.to<=found.course.to,'Execution references an unknown course or leaves its range.');
      const pieces=coverage.get(entry.courseId)??[];pieces.push({from:entry.from,to:entry.to,index});coverage.set(entry.courseId,pieces);
      const indices=operationIndices.get(found.operation.id)??[];indices.push(index);operationIndices.set(found.operation.id,indices);
    }else if(entry.kind==='inject'){
      requireThat(source.operations[entry.operationId]?.kind==='inject'&&!injections.has(entry.operationId),'Injection must execute once.');
      injections.add(entry.operationId);operationIndices.set(entry.operationId,[index]);
    }
  }
  for(const {course} of courses.values()){
    const pieces=coverage.get(course.id)??[];pieces.sort((a,b)=>a.from-b.from);
    requireThat(pieces.length>0&&pieces[0].from===course.from&&pieces.at(-1).to===course.to&&pieces.every((piece,i)=>!i||piece.from===pieces[i-1].to),
      'Execution must cover each course exactly once without gaps.');
    if(!course.interruptible)requireThat(pieces.length===1,'An atomic course cannot be split.');
  }
  for(const operation of Object.values(source.operations)){
    const indices=operationIndices.get(operation.id);requireThat(indices?.length>0,'Source operation is missing from execution.');
    for(const predecessor of operation.after){const previous=operationIndices.get(predecessor);requireThat(previous?.at(-1)<indices[0],'Execution violates an explicit source dependency.');}
    if(!operation.interruptible){
      const first=indices[0],last=indices.at(-1);
      for(const [other,found] of operationIndices)if(other!==operation.id)requireThat(found.every(index=>index<first||index>last),'An atomic operation cannot interleave.');
    }
  }
}
