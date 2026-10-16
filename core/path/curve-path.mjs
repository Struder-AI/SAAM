// One numerical reader for compact source, execution and older saved actions.
// Handles prepare geometry only; local queries and streaming retain source u.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareNumericalCurve,numericalCurveAt,numericalCurveRange,normalCone,frameCone} from '../geom/curve-query.mjs';
import {validateProfile,validateKeys,keyed,profileAt,profileInterval,profileValues,scalarRange,interiorKeys} from './curve-profiles.mjs';
import {PRINT_RESOLUTION_MM,BUILD_SCALE_MM} from '../dimensions.mjs';

// Display/program local views share explicit tolerances, independent of the
// saved identity. A caller can request a different bounded view.
export const PATH_VIEW_TOLERANCES=Object.freeze({positionToleranceMm:PRINT_RESOLUTION_MM,
  orientationToleranceRad:PRINT_RESOLUTION_MM/BUILD_SCALE_MM,
  // Process volume: moving a one-mm2 material section by print resolution.
  volumeToleranceMm3:PRINT_RESOLUTION_MM});
export function pathSummary(view){
  const summary=view?.schedule?{...view.deposition.summary,...view.schedule.summary}:view?.summary;
  const dx=view?.placement?.xMm??0,dy=view?.placement?.yMm??0,bounds=summary?.boundsMm;
  if(!bounds||(!dx&&!dy))return summary;
  return {...summary,boundsMm:{min:[bounds.min[0]+dx,bounds.min[1]+dy,bounds.min[2]],max:[bounds.max[0]+dx,bounds.max[1]+dy,bounds.max[2]]}};
}
export function pathInitialPosition(view){
  const position=view?.schedule?.initialPosition??view?.initialPosition,dx=view?.placement?.xMm??0,dy=view?.placement?.yMm??0;
  return position&&(dx||dy)?[position[0]+dx,position[1]+dy,position[2]]:position;
}
export const pathInitialPose=view=>view?.schedule?.initialPose??view?.initialPose;
export const pathCompletion=view=>view?.schedule?.completion??view?.completion;
export function* pathActions(view,options=PATH_VIEW_TOLERANCES){
  const dx=view?.placement?.xMm??0,dy=view?.placement?.yMm??0;
  for(const action of linearizePath(view,options))yield (dx||dy)&&action.kind==='move'?{...action,to:[action.to[0]+dx,action.to[1]+dy,action.to[2]]}:action;
}

const positive=value=>Number.isFinite(value)&&value>0;
const preparedTables=new WeakMap();
const rangeValid=(from,to)=>Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to<=1&&from<to;
const finiteNonnegative=value=>requireThat(Number.isFinite(value)&&value>=0,'Material must be finite and nonnegative.');
function prepareCurve(curve){
  requireThat(curve&&curve.geometry&&curve.profiles,'A curve needs geometry and profiles.');
  const geometry=prepareNumericalCurve(curve.geometry),profiles=curve.profiles;
  validateProfile(profiles.pose,'pose');validateProfile(profiles.speedMmS,'speedMmS');
  for(const channel of ['widthMm','materialNormal'])if(profiles[channel]!==undefined)validateProfile(profiles[channel],channel);
  const material=profiles.material;
  if(material){
    requireThat(profiles.widthMm!==undefined&&profiles.materialNormal!==undefined,'Deposition needs width and material normal.');
    requireThat(scalarRange(profiles.widthMm,0,1)[0]>0,'Deposition width must be positive.');
    if(material.kind==='area'){
      validateProfile(material.areaMm2,'areaMm2');requireThat(scalarRange(material.areaMm2,0,1)[0]>=0,'Material area must be nonnegative.');
    }else{
      requireThat(material.kind==='cumulative','Unknown material representation.');validateKeys(material.knots,finiteNonnegative);
      requireThat(material.knots[0][1]===0&&material.knots.every(([,v],i)=>!i||v>=material.knots[i-1][1]),'Cumulative material must start at zero and increase.');
    }
    requireThat(!(curve.geometry.kind==='point'&&(material.kind==='area'?scalarRange(material.areaMm2,0,1)[1]>0:material.knots.at(-1)[1]>0)),
      'A point curve cannot deposit material.');
  }
  const breaks=[...new Set([...geometry.breaks,...Object.values(profiles).flatMap(p=>keyed(p)?p.knots.map(([u])=>u):[]),
    ...(material?.kind==='area'&&keyed(material.areaMm2)?material.areaMm2.knots.map(([u])=>u):material?.kind==='cumulative'?material.knots.map(([u])=>u):[])])]
    .filter(u=>u>0&&u<1).sort((a,b)=>a-b);
  return {geometry,profiles,breaks};
}
export function prepareCurvePath({curves}){
  requireThat(curves&&typeof curves==='object'&&!Array.isArray(curves),'Curve table must be an ID keyed object.');
  if(Object.isFrozen(curves)&&preparedTables.has(curves))return preparedTables.get(curves);
  const prepared=new Map();
  for(const [id,curve] of Object.entries(curves)){requireThat(id.length>0,'Empty curve ID.');prepared.set(id,prepareCurve(curve));}
  const handle={curves:prepared};if(Object.isFrozen(curves))preparedTables.set(curves,handle);return handle;
}
function selected(handle,id){const curve=handle.curves.get(id);requireThat(curve,'Unknown curve: '+id);return curve;}
function cumulativeAt(material,u,side='right'){return profileAt({interpolation:'linear',knots:material.knots},u,side);}
function density(curve,u,side,speed){
  const material=curve.profiles.material;if(!material)return undefined;
  if(material.kind==='area')return profileAt(material.areaMm2,u,side);
  const [[a,x],[b,y]]=profileInterval(material,u,side),slope=(y-x)/(b-a);
  requireThat(slope===0||speed>0,'Positive material has unbounded density at a curve singularity.');
  return slope===0?0:slope/speed;
}
export function curveAt(handle,curveId,u,{side='right'}={}){
  requireThat(Number.isFinite(u)&&u>=0&&u<=1&&['right','left'].includes(side),'Invalid source parameter or limit side.');
  const curve=selected(handle,curveId),at=numericalCurveAt(curve.geometry,u,side),result={point:at.point,tangent:at.tangent};
  for(const channel of ['pose','widthMm','speedMmS','materialNormal'])if(curve.profiles[channel]!==undefined)result[channel]=profileAt(curve.profiles[channel],u,side);
  const areaMm2=density(curve,u,side,at.speed);if(areaMm2!==undefined)result.areaMm2=areaMm2;
  return result;
}
function materialRange(curve,from,to,geometric,options){
  const material=curve.profiles.material;if(!material)return {};
  if(material.kind==='cumulative'){
    const volume=cumulativeAt(material,to)-cumulativeAt(material,from),slopes=[];
    const cuts=[from,...interiorKeys(material.knots,from,to).map(([u])=>u),to];
    if(cuts.length>2){
      const areas=cuts.slice(1).map((end,i)=>localRange(curve,cuts[i],end,options).areaMm2);
      return {volumeMm3:[volume,volume],areaMm2:areas.reduce(([lo,hi],area)=>[Math.min(lo,area[0]),Math.max(hi,area[1])],[Infinity,-Infinity])};
    }
    for(const [i,end] of cuts.slice(1).entries())slopes.push((cumulativeAt(material,end)-cumulativeAt(material,cuts[i]))/(end-cuts[i]));
    if(Math.max(...slopes)>0&&geometric.speed[0]===0){
      const mid=(from+to)/2;
      const endpoints=[numericalCurveAt(curve.geometry,from),numericalCurveAt(curve.geometry,to,'left')];
      requireThat(mid>from&&mid<to&&endpoints.every(at=>at.speed>0),'Positive cumulative material has unbounded density at a singularity.');
      const a=localRange(curve,from,mid,options),b=localRange(curve,mid,to,options);
      return {volumeMm3:[volume,volume],areaMm2:[Math.min(a.areaMm2[0],b.areaMm2[0]),Math.max(a.areaMm2[1],b.areaMm2[1])]};
    }
    return {volumeMm3:[volume,volume],areaMm2:Math.max(...slopes)===0?[0,0]:[Math.min(...slopes)/geometric.speed[1],Math.max(...slopes)/geometric.speed[0]]};
  }
  const areaMm2=scalarRange(material.areaMm2,from,to);
  if(areaMm2[1]===0)return {volumeMm3:[0,0],areaMm2};
  const volumeMm3=[areaMm2[0]*geometric.lengthMm[0],areaMm2[1]*geometric.lengthMm[1]];
  if(!options.volumeToleranceMm3||volumeMm3[1]-volumeMm3[0]<=options.volumeToleranceMm3)return {volumeMm3,areaMm2};
  const mid=(from+to)/2;requireThat(mid>from&&mid<to,'Material integral cannot reach requested precision.');
  const child={...options,volumeToleranceMm3:options.volumeToleranceMm3/2};
  const a=localRange(curve,from,mid,child),b=localRange(curve,mid,to,child);
  return {volumeMm3:[a.volumeMm3[0]+b.volumeMm3[0],a.volumeMm3[1]+b.volumeMm3[1]],areaMm2};
}
function localRange(curve,from,to,options){
  const geometry=numericalCurveRange(curve.geometry,from,to,options),profiles=curve.profiles;
  const result={bounds:geometry.bounds,lengthMm:geometry.lengthMm,...materialRange(curve,from,to,geometry,options),
    poseCone:frameCone(profileValues(profiles.pose,from,to)),breaks:interiorBreaks(curve.breaks,from,to)};
  if(profiles.widthMm!==undefined)result.widthMm=scalarRange(profiles.widthMm,from,to);
  if(profiles.materialNormal!==undefined)result.normalCone=normalCone(profileValues(profiles.materialNormal,from,to));
  return result;
}
function interiorBreaks(breaks,from,to){
  const state={lo:0,hi:breaks.length};
  while(state.lo<state.hi){const mid=Math.floor((state.lo+state.hi)/2);if(breaks[mid]<=from)state.lo=mid+1;else state.hi=mid;}
  const result=[];for(let i=state.lo;i<breaks.length&&breaks[i]<to;i++)result.push(breaks[i]);return result;
}
export function curveRange(handle,curveId,from,to,options={}){
  requireThat(rangeValid(from,to),'Invalid curve interval.');
  for(const key of ['lengthToleranceMm','volumeToleranceMm3'])if(options[key]!==undefined)requireThat(positive(options[key]),'Curve range tolerance must be positive.');
  return localRange(selected(handle,curveId),from,to,options);
}
function tolerances(options){
  for(const key of ['positionToleranceMm','orientationToleranceRad','volumeToleranceMm3'])requireThat(positive(options?.[key]),'Local views need positive '+key+'.');
}
export function* curveSpans(handle,curveId,from,to,options){
  tolerances(options);requireThat(rangeValid(from,to),'Invalid curve interval.');
  const curve=selected(handle,curveId),state={start:from};
  for(const end of curve.breaks)if(end>from&&end<to){
    yield* boundedSpans(handle,curveId,curve,state.start,end,from,to,options);state.start=end;
  }
  yield* boundedSpans(handle,curveId,curve,state.start,to,from,to,options);
}
function* boundedSpans(handle,id,curve,from,to,rangeFrom,rangeTo,options){
  const allocated=options.volumeToleranceMm3*(to-from)/(rangeTo-rangeFrom);
  const settings={lengthToleranceMm:options.positionToleranceMm*(to-from)/(rangeTo-rangeFrom),volumeToleranceMm3:allocated};
  const geometry=numericalCurveRange(curve.geometry,from,to,settings),range=localRange(curve,from,to,settings);
  // Within one profile span a rigid frame follows exactly the same shortest
  // geodesic as its endpoints. Profile breaks are always traversal boundaries.
  if(geometry.chordErrorMm<=options.positionToleranceMm){
    yield {from,to,start:curveAt(handle,id,from),end:curveAt(handle,id,to,{side:'left'}),range};return;
  }
  const mid=(from+to)/2;requireThat(mid>from&&mid<to,'Curve subdivision cannot reach requested precision.');
  yield* boundedSpans(handle,id,curve,from,mid,rangeFrom,rangeTo,options);
  yield* boundedSpans(handle,id,curve,mid,to,rangeFrom,rangeTo,options);
}
function sourceCourses(deposition){
  const courses=new Map();
  for(const operation of Object.values(deposition.operations))for(const course of operation.courses??[])courses.set(course.id,{course,operation});
  return courses;
}
export function* linearizePath(view,options){
  tolerances(options);
  if(view?.schema==='saampath/1'&&Array.isArray(view.actions)){yield* view.actions;return;}
  requireThat(view?.deposition?.schema==='saampath/2'&&view.schedule?.schema==='saam-schedule/1'&&view.sourcePathId===view.schedule.sourcePathId,
    'Compact path needs its exact source/schedule identity.');
  const {deposition,schedule}=view,source=prepareCurvePath(deposition),motion=prepareCurvePath({curves:schedule.motionCurves}),courses=sourceCourses(deposition);
  const ranges=schedule.execution.reduce((count,entry)=>count+(entry.kind==='deposit'||entry.kind==='travel'?1:0),0);
  const resolution={...options,volumeToleranceMm3:options.volumeToleranceMm3/Math.max(1,ranges)};
  for(const entry of schedule.execution){
    if(entry.kind==='deposit'){
      const found=courses.get(entry.courseId);requireThat(found,'Unknown execution course.');
      const {course,operation}=found;
      requireThat(entry.from>=course.from&&entry.to<=course.to,'Execution range leaves source course.');
      yield {kind:'context',phase:operation.phase??'deposit',layer:operation.layer??0,layerId:operation.layerId,
        operation:operation.id,role:course.role??null};
      for(const span of curveSpans(source,course.curveId,entry.from,entry.to,resolution))yield spanMove(span);
    }else if(entry.kind==='travel'){
      for(const span of curveSpans(motion,entry.curveId,entry.from,entry.to,resolution))yield {...spanMove(span),
        ...(entry.durationSeconds?{durationSeconds:entry.durationSeconds*(span.to-span.from)/(entry.to-entry.from)}:{})};
    }else if(entry.kind==='inject'){
      const operation=deposition.operations[entry.operationId];requireThat(operation?.kind==='inject','Unknown execution injection.');
      yield {kind:'context',phase:operation.phase??'inject',layer:operation.layer??0,layerId:operation.layerId,operation:operation.id};
      yield {kind:'extrude',volumeMm3:operation.injection.volumeMm3,flowMm3S:operation.injection.flowMm3S,pose:operation.injection.pose};
    }else yield entry;
  }
}
function spanMove(span){
  const {start,end,range}=span,volumeMm3=range.volumeMm3?(range.volumeMm3[0]+range.volumeMm3[1])/2:0;
  const width=start.widthMm;
  return {kind:'move',to:end.point,pose:end.pose,speedMmS:start.speedMmS,volumeMm3,
    ...(width!==undefined?{beadWidthMm:width}:{}),...(start.materialNormal?{surfaceNormal:start.materialNormal}:{}),
    ...(width&&range.lengthMm[1]>0?{beadHeightMm:volumeMm3/((range.lengthMm[0]+range.lengthMm[1])/2)/width}:{}),
    sourceRange:{from:span.from,to:span.to}};
}
