// One numerical reader for compact source, execution and older saved actions.
// Handles prepare geometry only; local queries and streaming retain source u.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareNumericalCurve,numericalCurveAt,numericalCurveRange,numericalCurveHasLength,numericalCurveParameterAtLength,numericalCurveClosestParameter,normalCone,frameCone} from '../geom/curve-query.mjs';
import {validateProfile,validateKeys,keyed,profileAt,profileValues,scalarRange,interiorKeys,interpolateScalar,prepareMaterialProfile,materialProfileDensity,materialProfileRange,materialProfileVolume,materialProfileDeviation} from './curve-profiles.mjs';
import {PRINT_RESOLUTION_MM,BUILD_SCALE_MM} from '../dimensions.mjs';

// Display/program local views share explicit tolerances, independent of the
// saved identity. A caller can request a different bounded view.
export const PATH_VIEW_TOLERANCES=Object.freeze({positionToleranceMm:PRINT_RESOLUTION_MM,
  orientationToleranceRad:PRINT_RESOLUTION_MM/BUILD_SCALE_MM,
  // Process volume: moving a one-mm2 material section by print resolution.
  volumeToleranceMm3:PRINT_RESOLUTION_MM});
export function pathSummary(view){
  const summary=view?.summary??(view?.schedule?{...view.deposition.summary,...view.schedule.summary}:undefined);
  const dx=view?.placement?.xMm??0,dy=view?.placement?.yMm??0,bounds=summary?.boundsMm;
  if(!bounds||(!dx&&!dy))return summary;
  return {...summary,boundsMm:{min:[bounds.min[0]+dx,bounds.min[1]+dy,bounds.min[2]],max:[bounds.max[0]+dx,bounds.max[1]+dy,bounds.max[2]]}};
}
export function pathInitialPosition(view){
  const position=view?.initialPosition??view?.schedule?.initialPosition,dx=view?.placement?.xMm??0,dy=view?.placement?.yMm??0;
  return position&&(dx||dy)?[position[0]+dx,position[1]+dy,position[2]]:position;
}
export const pathInitialPose=view=>view?.initialPose??view?.schedule?.initialPose;
export const pathCompletion=view=>view?.completion??view?.schedule?.completion;
export function* pathActions(view,options=PATH_VIEW_TOLERANCES){
  const dx=view?.placement?.xMm??0,dy=view?.placement?.yMm??0;
  for(const action of linearizePath(view,options))yield (dx||dy)&&action.kind==='move'?{...action,to:[action.to[0]+dx,action.to[1]+dy,action.to[2]]}:action;
}

const positive=value=>Number.isFinite(value)&&value>0;
const preparedTables=new WeakMap();
const preparedCurves=new WeakMap();
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
    requireThat(scalarRange(profiles.widthMm,0,1,{endSide:'right'})[0]>0,'Deposition width must be positive.');
    if(material.kind==='area'){
      validateProfile(material.areaMm2,'areaMm2');requireThat(scalarRange(material.areaMm2,0,1,{endSide:'right'})[0]>=0,'Material area must be nonnegative.');
    }else{
      requireThat(material.kind==='cumulative','Unknown material representation.');validateKeys(material.knots,finiteNonnegative);
      requireThat(material.knots[0][1]===0&&material.knots.every(([,v],i)=>!i||v>=material.knots[i-1][1]),'Cumulative material must start at zero and increase.');
    }
    requireThat(!(curve.geometry.kind==='point'&&(material.kind==='area'?scalarRange(material.areaMm2,0,1,{endSide:'right'})[1]>0:material.knots.at(-1)[1]>0)),
      'A point curve cannot deposit material.');
  }
  const breaks=[...new Set([...geometry.breaks,...Object.values(profiles).flatMap(p=>keyed(p)?p.knots.map(([u])=>u):[]),
    ...(material?.kind==='area'&&keyed(material.areaMm2)?material.areaMm2.knots.map(([u])=>u):material?.kind==='cumulative'?material.knots.map(([u])=>u):[])])]
    .filter(u=>u>0&&u<1).sort((a,b)=>a-b);
  const priorities=new Map(geometry.breaks.map(u=>[u,1]));
  // View boundaries belong to the prepared curve. Execution can visit a short
  // interval thousands of times; do not rescan its entire vertex/profile table.
  for(const profile of [profiles.widthMm,profiles.speedMmS])if(keyed(profile)&&profile.interpolation==='step')
    for(const [i,[u,value]] of profile.knots.entries())if(i&&value!==profile.knots[i-1][1])priorities.set(u,2);
  const viewCuts=[...priorities].sort(([a],[b])=>a-b);
  const prepared={geometry,profiles,breaks,viewCuts,material:prepareMaterialProfile(material)};
  if(material?.kind==='cumulative'){
    const range=materialRange(prepared,0,1,numericalCurveRange(geometry,0,1),{});
    requireThat(range.areaMm2.every(Number.isFinite)&&range.volumeMm3.every(Number.isFinite),'Material density and volume must be bounded and finite.');
  }
  return prepared;
}
export function prepareCurvePath({curves}){
  requireThat(curves&&typeof curves==='object'&&!Array.isArray(curves),'Curve table must be an ID keyed object.');
  if(Object.isFrozen(curves)&&preparedTables.has(curves))return preparedTables.get(curves);
  const prepared=new Map();
  for(const [id,curve] of Object.entries(curves)){requireThat(id.length>0,'Empty curve ID.');prepared.set(id,prepareCurve(curve));}
  const handle=Object.freeze({});preparedCurves.set(handle,prepared);
  if(Object.isFrozen(curves))preparedTables.set(curves,handle);return handle;
}
function selected(handle,id){const curve=preparedCurves.get(handle)?.get(id);requireThat(curve,'Unknown curve: '+id);return curve;}
function density(curve,u,side,speed){
  const material=curve.material;if(!material)return undefined;
  const value=materialProfileDensity(material,u,side);
  if(material.measure==='length')return value;
  requireThat(value===0||speed>0,'Positive material has unbounded density at a curve singularity.');
  return value===0?0:value/speed;
}
export function curveAt(handle,curveId,u,{side='right'}={}){
  requireThat(Number.isFinite(u)&&u>=0&&u<=1&&['right','left'].includes(side),'Invalid source parameter or limit side.');
  const curve=selected(handle,curveId),at=numericalCurveAt(curve.geometry,u,side),result={point:at.point,tangent:at.tangent};
  for(const channel of ['pose','widthMm','speedMmS','materialNormal'])if(curve.profiles[channel]!==undefined)result[channel]=profileAt(curve.profiles[channel],u,side);
  const areaMm2=density(curve,u,side,at.speed);if(areaMm2!==undefined)result.areaMm2=areaMm2;
  return result;
}
function materialRange(curve,from,to,geometric,options){
  const material=curve.material;if(!material)return {};
  if(material.measure==='parameter'){
    const volume=materialProfileVolume(material,from,to),rates=materialProfileRange(material,from,to);
    if(rates[1]>0&&geometric.speed[0]===0){
      const cuts=interiorKeys(material.knots,from,to),mid=cuts.length?cuts[Math.floor(cuts.length/2)][0]:(from+to)/2;
      const endpoints=[numericalCurveAt(curve.geometry,from),numericalCurveAt(curve.geometry,to,'left')];
      requireThat(endpoints.every((at,i)=>at.speed>0||materialProfileDensity(material,i?to:from,i?'left':'right')===0),
        'Positive cumulative material has unbounded density at a singularity.');
      if(!(mid>from&&mid<to))throw Object.assign(Error('Material density bounds are unresolved at numerical precision.'),{code:'MATERIAL_DENSITY_UNRESOLVED'});
      const a=localRange(curve,from,mid,options),b=localRange(curve,mid,to,options);
      return {volumeMm3:[volume,volume],areaMm2:[Math.min(a.areaMm2[0],b.areaMm2[0]),Math.max(a.areaMm2[1],b.areaMm2[1])]};
    }
    return {volumeMm3:[volume,volume],areaMm2:rates[1]===0?[0,0]:[rates[0]/geometric.speed[1],rates[1]/geometric.speed[0]]};
  }
  const areaMm2=scalarRange(material.density,from,to);
  const interior=keyed(material.density)?interiorKeys(material.density.knots,from,to):[];
  if(interior.length){
    const cuts=[from,...interior.map(([u])=>u),to],volumeMm3=[0,0];
    for(const [i,end] of cuts.slice(1).entries()){
      const child={...options,...(options.volumeToleranceMm3?{volumeToleranceMm3:options.volumeToleranceMm3*(end-cuts[i])/(to-from)}:{})};
      const range=localRange(curve,cuts[i],end,child);volumeMm3[0]+=range.volumeMm3[0];volumeMm3[1]+=range.volumeMm3[1];
    }
    return {volumeMm3,areaMm2};
  }
  const inward=[profileAt(material.density,from),profileAt(material.density,to,'left')];
  const densityRange=[Math.min(...inward),Math.max(...inward)];
  if(densityRange[1]===0)return {volumeMm3:[0,0],areaMm2};
  // A linear scalar field has an exact parameter mean. Intersect both valid
  // integral enclosures; constant-speed curves need no artificial refinement.
  const mean=interpolateScalar(...inward,.5)*(to-from);
  const volumeMm3=[Math.max(densityRange[0]*geometric.lengthMm[0],mean*geometric.speed[0]),
    Math.min(densityRange[1]*geometric.lengthMm[1],mean*geometric.speed[1])];
  if(!options.volumeToleranceMm3||volumeMm3[1]-volumeMm3[0]<=options.volumeToleranceMm3)return {volumeMm3,areaMm2};
  const mid=(from+to)/2;requireThat(mid>from&&mid<to,'Material integral cannot reach requested precision.');
  const child={...options,volumeToleranceMm3:options.volumeToleranceMm3/2};
  const a=localRange(curve,from,mid,child),b=localRange(curve,mid,to,child);
  return {volumeMm3:[a.volumeMm3[0]+b.volumeMm3[0],a.volumeMm3[1]+b.volumeMm3[1]],areaMm2};
}
function localRange(curve,from,to,options){
  const geometry=numericalCurveRange(curve.geometry,from,to,options),profiles=curve.profiles;
  const result={bounds:geometry.bounds,lengthMm:geometry.lengthMm,tangentCone:geometry.tangentCone,chordErrorMm:geometry.chordErrorMm,...materialRange(curve,from,to,geometry,options),
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
export function curveHasLength(handle,curveId,from,to,minimumMm){
  requireThat(rangeValid(from,to),'Invalid curve interval.');
  return numericalCurveHasLength(selected(handle,curveId).geometry,from,to,minimumMm);
}
export function curveParameterAtLength(handle,curveId,from,to,distanceMm,options={}){
  requireThat(rangeValid(from,to),'Invalid curve interval.');
  return numericalCurveParameterAtLength(selected(handle,curveId).geometry,from,to,distanceMm,options);
}
export function curveClosestParameter(handle,curveId,from,to,point,options={}){
  requireThat(rangeValid(from,to),'Invalid curve interval.');
  return numericalCurveClosestParameter(selected(handle,curveId).geometry,from,to,point,options);
}
function tolerances(options){
  for(const key of ['positionToleranceMm','orientationToleranceRad','volumeToleranceMm3'])requireThat(positive(options?.[key]),'Local views need positive '+key+'.');
}
export function* curveSpans(handle,curveId,from,to,options){
  yield* querySpans(handle,curveId,from,to,options);
}
function* querySpans(handle,curveId,from,to,options,labels=[]){
  tolerances(options);requireThat(rangeValid(from,to),'Invalid curve interval.');
  const curve=selected(handle,curveId),state={start:from};
  // Geometry and labels are useful view candidates. Profile/material keys are
  // query information, not an instruction to emit one move between every key.
  const priorities=new Map(labels.filter(u=>u>from&&u<to).map(u=>[u,0]));
  // Older explicit scalar steps retain their meaning. When a step and a
  // geometry vertex are physically coincident, use the step once and certify
  // the geometry across it; do not emit the microscopic interval between them.
  const search={lo:0,hi:curve.viewCuts.length};
  while(search.lo<search.hi){const mid=Math.floor((search.lo+search.hi)/2);if(curve.viewCuts[mid][0]<=from)search.lo=mid+1;else search.hi=mid;}
  for(let i=search.lo;i<curve.viewCuts.length&&curve.viewCuts[i][0]<to;i++){
    const [u,priority]=curve.viewCuts[i];priorities.set(u,priority);
  }
  const candidates=[...priorities].sort(([a],[b])=>a-b),groups=[];
  for(const candidate of candidates){
    const group=groups.at(-1);
    if(group&&numericalCurveRange(curve.geometry,group[0][0],candidate[0]).lengthMm[1]<=options.positionToleranceMm)group.push(candidate);
    else groups.push([candidate]);
  }
  const cuts=groups.flatMap(group=>{
    const required=group.filter(([,priority])=>priority===2);
    return required.length?required:[group.reduce((chosen,candidate)=>candidate[1]>chosen[1]?candidate:chosen)];
  });
  const boundaries=[from];
  for(const [end,priority] of cuts){
    const remaining=curve.geometry.kind==='polyline'?curve.geometry.length*(to-end):
      numericalCurveRange(curve.geometry,end,to).lengthMm[1];
    if(priority<2&&(numericalCurveRange(curve.geometry,state.start,end).lengthMm[1]<=options.positionToleranceMm||
      remaining<=options.positionToleranceMm))continue;
    boundaries.push(end);state.start=end;
  }
  boundaries.push(to);
  for(let i=0;i<boundaries.length-1;i++){
    const at=options.reverse?boundaries.length-2-i:i;
    yield* boundedSpans(handle,curveId,curve,boundaries[at],boundaries[at+1],from,to,options);
  }
}
function* boundedSpans(handle,id,curve,from,to,rangeFrom,rangeTo,options){
  const allocated=options.volumeToleranceMm3*(to-from)/(rangeTo-rangeFrom);
  const settings={lengthToleranceMm:options.positionToleranceMm*(to-from)/(rangeTo-rangeFrom),volumeToleranceMm3:allocated};
  const geometry=numericalCurveRange(curve.geometry,from,to,settings),range=localRange(curve,from,to,settings);
  const start=curveAt(handle,id,from),end=curveAt(handle,id,to,{side:'left'});
  const moves=start.point.some((value,i)=>value!==end.point[i]);
  // A single frame segment is exact. A span crossing frame keys needs an
  // enclosure certificate; agreeing endpoints alone can hide an entire turn.
  const pose=curve.profiles.pose;
  const frameExact=!keyed(pose)||!interiorKeys(pose.knots,from,to).length;
  if(geometry.interpolationErrorMm<=options.positionToleranceMm&&(frameExact||4*range.poseCone.halfAngleRad<=options.orientationToleranceRad)&&
    (moves||!(range.volumeMm3?.[1]>0))){
    yield {from,to,start,end,range,positionErrorMm:geometry.interpolationErrorMm};return;
  }
  const mid=(from+to)/2;requireThat(mid>from&&mid<to,'Curve subdivision cannot reach requested precision.');
  const halves=[[from,mid],[mid,to]];
  for(const [a,b] of options.reverse?halves.toReversed():halves)yield* boundedSpans(handle,id,curve,a,b,rangeFrom,rangeTo,options);
}
function sourceCourses(deposition){
  const courses=new Map();
  for(const operation of Object.values(deposition.operations))for(const course of operation.courses??[])courses.set(course.id,{course,operation});
  return courses;
}
export function* linearizePath(view,options){
  tolerances(options);
  if((view?.schema==='saampath/1'||view?.schema==='saam-export-prepared/1')&&view.actions){yield* view.actions;return;}
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
      const segments=course.provenance?.segments??[],labelCuts=segments.flatMap(segment=>[segment.from,segment.to]),state={context:null};
      for(const span of attributeSpans(source,course.curveId,entry.from,entry.to,{...resolution,reverse:entry.reverse},labelCuts)){
        const labels=courseLabels(source,course.curveId,segments,span,options.positionToleranceMm);
        const context={kind:'context',phase:operation.phase??'deposit',layer:labels.layer??operation.layer??0,layerId:operation.layerId,
          operation:labels.operation??operation.id,role:labels.role??course.role??null,travel:null,connector:labels.connector??null,region:operation.regionId??null};
        if(!state.context||Object.keys(context).some(key=>context[key]!==state.context[key])){yield context;state.context=context;}
        yield {...spanMove(span,entry.reverse),sourceRange:{curveId:course.curveId,from:span.from,to:span.to,...(entry.reverse?{reverse:true}:{})}};
      }
    }else if(entry.kind==='travel'){
      for(const span of attributeSpans(motion,entry.curveId,entry.from,entry.to,resolution))yield {...spanMove(span),
        ...(entry.durationSeconds?{durationSeconds:entry.durationSeconds*(span.to-span.from)/(entry.to-entry.from)}:{})};
    }else if(entry.kind==='inject'){
      const operation=deposition.operations[entry.operationId];requireThat(operation?.kind==='inject','Unknown execution injection.');
      yield {kind:'context',phase:operation.phase??'inject',layer:operation.layer??0,layerId:operation.layerId,operation:operation.id,role:null,travel:null,connector:null,region:operation.regionId??null};
      yield {kind:'extrude',volumeMm3:operation.injection.volumeMm3,flowMm3S:operation.injection.flowMm3S,pose:operation.injection.pose};
    }else yield entry;
  }
}
function courseLabels(handle,id,segments,span,tolerance){
  const state={lo:0,hi:segments.length};
  while(state.lo<state.hi){const mid=Math.floor((state.lo+state.hi)/2);if(segments[mid].to<=span.from)state.lo=mid+1;else state.hi=mid;}
  const curve=selected(handle,id),segment=segments[state.lo],next=segments[state.lo+1];
  // A nearby label can align to the view boundary without becoming material
  // tessellation. Original exact label ranges remain in source provenance.
  for(const candidate of [next,segment])if(candidate&&candidate.from>span.from&&candidate.from<span.to&&
    numericalCurveRange(curve.geometry,span.from,candidate.from).lengthMm[1]<=tolerance)return candidate.labels;
  return segment&&segment.from<=span.from&&segment.to>span.from?segment.labels:{};
}
function* attributeSpans(handle,id,from,to,options,labels=[]){
  const integral={...options,volumeToleranceMm3:options.volumeToleranceMm3/2};
  const speedScale=Math.max(...scalarRange(selected(handle,id).profiles.speedMmS,from,to).map(Math.abs));
  for(const span of querySpans(handle,id,from,to,integral,labels))yield* linearAttributeSpans(handle,id,span,from,to,options,speedScale);
}
function materialInterpolationError(handle,id,span){
  const curve=selected(handle,id),material=curve.material;
  if(!material)return 0;
  if(material.measure==='parameter'){
    return materialProfileDeviation(material,span.from,span.to);
  }
  const geometry=numericalCurveRange(curve.geometry,span.from,span.to),area=scalarRange(material.density,span.from,span.to);
  const low=area[0]*geometry.speed[0],high=area[1]*geometry.speed[1];
  return (high-low)*(span.to-span.from)/4;
}
function* linearAttributeSpans(handle,id,span,from,to,options,speedScale){
  const {start,end,range}=span,widthMm=range.widthMm?.[1]??1,scale=options.positionToleranceMm/widthMm;
  const speed=scalarRange(selected(handle,id).profiles.speedMmS,span.from,span.to);
  const sectionExtent=range.widthMm?widthMm/2+(range.areaMm2?.[1]??0)/range.widthMm[0]:0;
  const volume=range.volumeMm3?interpolateScalar(...range.volumeMm3,.5):0;
  // Exact interval volume fixes total material. Prefix variation only moves
  // that material along this chord: its transported distance is bounded by
  // chord length times the primitive's fractional deviation. Use physical
  // resolution for placement instead of a per-key microscopic volume budget.
  const materialShift=volume>0?Math.min(1,materialInterpolationError(handle,id,span)/volume)*range.lengthMm[1]:0;
  // A range-wide scale stays finite when an admitted speed reaches zero.
  const smooth=(!range.widthMm||range.widthMm[1]-range.widthMm[0]<=options.positionToleranceMm)&&
    (speedScale===0||(speed[1]-speed[0])/speedScale<=Math.sqrt(scale))&&
    (!range.normalCone||2*Math.sin(range.normalCone.halfAngleRad/2)*sectionExtent<=options.positionToleranceMm)&&
    materialShift<=Math.max(0,options.positionToleranceMm-span.positionErrorMm);
  if(smooth){yield span;return;}
  const mid=(span.from+span.to)/2;requireThat(mid>span.from&&mid<span.to,'Attribute view cannot reach requested precision.');
  const halves=[[span.from,mid],[mid,span.to]];
  for(const [a,b] of options.reverse?halves.toReversed():halves){
    const childOptions={...options,volumeToleranceMm3:options.volumeToleranceMm3*(b-a)/(to-from)/2};
    for(const child of curveSpans(handle,id,a,b,childOptions))yield* linearAttributeSpans(handle,id,child,from,to,options,speedScale);
  }
}
function spanMove(span,reverse=false){
  const {range}=span,start=reverse?span.end:span.start,end=reverse?span.start:span.end;
  const volumeMm3=range.volumeMm3?interpolateScalar(...range.volumeMm3,.5):0;
  const width=start.widthMm===undefined?undefined:interpolateScalar(start.widthMm,end.widthMm,.5);
  return {kind:'move',to:end.point,pose:end.pose,speedMmS:interpolateScalar(start.speedMmS,end.speedMmS,.5),volumeMm3,
    speedFromMmS:start.speedMmS,speedToMmS:end.speedMmS,
    ...(width!==undefined?{beadWidthMm:width}:{}),...(start.materialNormal?{surfaceNormal:start.materialNormal}:{}),
    ...(width&&range.lengthMm[1]>0?{beadHeightMm:volumeMm3/interpolateScalar(...range.lengthMm,.5)/width}:{}),
    sourceRange:{from:span.from,to:span.to}};
}
