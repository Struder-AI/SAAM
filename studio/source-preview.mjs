import {prepareCurvePath,curveAt,injectionAt} from '../core/path/curve-path.mjs';
import {prepareNumericalCurve,numericalCurveRange} from '../core/geom/curve-query.mjs';
import {pathViewPositionTolerance} from './path-view-quality.mjs';
import {VIEWER_POINT_CAP} from './toolpath-view.mjs';

const sourceViews=new WeakMap();
function* sourceEntities(source){
  for(const operationId in source.operations){
    const operation=source.operations[operationId];
    if(operation.kind==='inject')yield {kind:'stationary',operationId,operation};
    else for(const course of operation.courses)yield {kind:'curve',operationId,operation,courseId:course.id,course,curveId:course.curveId};
  }
}
function selectedCurve(view,id){
  const own=sourceViews.get(view);
  // Keep preparation local to the curve being read. Whole-source bounds and
  // successive display pages must not turn every visited curve into a cache.
  if(own.id!==id){own.id=id;own.geometry=null;own.reader=null;}
  return own;
}
function sourceGeometry(view,id){
  const own=selectedCurve(view,id);
  return own.geometry??=prepareNumericalCurve(view.source.curves[id].geometry);
}
function sourceReader(view,id){
  const own=selectedCurve(view,id);
  return own.reader??=prepareCurvePath({curves:{[id]:view.source.curves[id]}});
}
const sourceIdentity=(view,entity)=>({sourceIdentity:view.sourceIdentity,kind:entity.kind,operationId:entity.operationId,
  sectionReference:view.source.sectionReference,
  ...(entity.course?{courseId:entity.courseId,curveId:entity.curveId,from:entity.course.from,to:entity.course.to}:{}),
  toolIndex:entity.operation.toolIndex,layerId:entity.operation.layerId,role:entity.course?.role??entity.operation.phase??entity.operation.kind});

function sourceExtent(view){
  const own=sourceViews.get(view);if(own.extent)return own.extent;
  let bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};const counts={curves:0,stationary:0};
  const include=range=>{for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],range.min[k]);bounds.max[k]=Math.max(bounds.max[k],range.max[k]);}};
  for(const entity of sourceEntities(view.source)){
    if(entity.kind==='stationary'){counts.stationary++;const p=entity.operation.injection.at;include({min:p,max:p});}
    else{counts.curves++;include(numericalCurveRange(sourceGeometry(view,entity.curveId),entity.course.from,entity.course.to).bounds);}
  }
  if(!counts.curves&&!counts.stationary)bounds={min:[0,0,0],max:[1,1,1]};
  Object.freeze(bounds.min);Object.freeze(bounds.max);Object.freeze(bounds);Object.freeze(counts);
  return own.extent=Object.freeze({bounds,counts});
}
// Retain the exact supplied source; this view neither admits it again nor gives
// table enumeration a manufacturing order. A local query needs no whole-source
// extent pass. Drawing bounds, when requested, cover every entity independently
// of how many segments fit in a finite display frame.
export function buildSourcePathView(source,{sourceIdentity:identity=null,plan}={}){
  if(source?.schema!=='saampath/3')throw Error('Source review needs current immutable Paath.');
  const view={kind:'paath-source-view/1',sourceIdentity:identity,source,positionToleranceMm:pathViewPositionTolerance({plan,source}),
    get bounds(){return sourceExtent(view).bounds;},get counts(){return sourceExtent(view).counts;}};
  sourceViews.set(view,{id:null,geometry:null,reader:null,extent:null});return Object.freeze(view);
}
export function sourcePathEntity(view,{operationId,courseId}={}){
  const operation=view.source.operations[operationId];
  if(!operation)throw Error('Unknown source operation.');
  if(operation.kind==='inject'){
    if(courseId!==undefined)throw Error('A stationary operation has no moving course.');
    return {kind:'stationary',operationId,operation};
  }
  const course=operation.courses.find(course=>course.id===courseId);
  if(!course)throw Error('Unknown source course.');
  return {kind:'curve',operationId,operation,courseId,course,curveId:course.curveId,curve:view.source.curves[course.curveId]};
}
function selectionPage(items,{after=null,limit=100}={}){
  if(!Number.isSafeInteger(limit)||limit<1)throw Error('Source selection needs a positive page size.');
  const page=[];let waiting=after!==null,next=null;
  for(const item of items){
    if(waiting){if(item.id===after)waiting=false;continue;}
    if(page.length===limit){next=page.at(-1).id;break;}
    page.push(item);
  }
  if(waiting)throw Error('Unknown source selection continuation.');
  return {items:page,next};
}
export function sourcePathOperations(view,options){
  function* operations(){for(const id in view.source.operations)yield {id,kind:view.source.operations[id].kind};}
  return selectionPage(operations(),options);
}
export function sourcePathCourses(view,{operationId,...options}={}){
  const operation=view.source.operations[operationId];
  if(!operation)throw Error('Unknown source operation.');
  function* courses(){for(const {id,curveId,from,to} of operation.courses??[])yield {id,curveId,from,to};}
  return selectionPage(courses(),options);
}
// Complete selected geometry/profiles remain available through sourcePathEntity;
// this point query uses exactly the numerical meaning consumed downstream.
export function sampleSourcePath(view,selection){
  const entity=sourcePathEntity(view,selection),u=selection.u??(entity.course?.from??0),side=selection.side??'right';
  if(entity.course&&(u<entity.course.from||u>entity.course.to))throw Error('Source parameter leaves the selected course.');
  if(!['left','right'].includes(side))throw Error('Unknown source parameter limit side.');
  return {...sourceIdentity(view,entity),u,side,parameter:entity.kind==='stationary'?'normalized requested stationary time':'source curve parameter',
    sample:entity.kind==='stationary'?injectionAt(entity.operation,u):curveAt(sourceReader(view,entity.curveId),entity.curveId,u,{side})};
}
function* sourceIntervals(view,entity,from){
  const curve=view.source.curves[entity.curveId],streams=[{keys:sourceGeometry(view,entity.curveId).breaks,profile:false,index:0}];
  for(const name in curve.profiles){const profile=curve.profiles[name];if(profile?.knots)streams.push({keys:profile.knots,profile:true,index:0});}
  const at=(stream,index)=>stream.profile?stream.keys[index][0]:stream.keys[index];
  for(const stream of streams){let low=0,high=stream.keys.length;while(low<high){const mid=(low+high)>>1;if(at(stream,mid)<=from)low=mid+1;else high=mid;}stream.index=low;}
  let start=from;
  while(start<entity.course.to){
    let end=entity.course.to;
    for(const stream of streams){while(stream.index<stream.keys.length&&at(stream,stream.index)<=start)stream.index++;if(stream.index<stream.keys.length)end=Math.min(end,at(stream,stream.index));}
    yield [start,end];start=end;
  }
}
function* sourceSegments(view,entity,from){
  const geometry=sourceGeometry(view,entity.curveId),reader=sourceReader(view,entity.curveId);
  for(const interval of sourceIntervals(view,entity,from)){
    const pending=[interval];
    while(pending.length){
      const [a,b]=pending.pop(),range=numericalCurveRange(geometry,a,b);
      if(range.interpolationErrorMm>view.positionToleranceMm){const mid=(a+b)/2;if(!(mid>a&&mid<b))throw Error('Source display cannot reach requested precision.');pending.push([mid,b],[a,mid]);continue;}
      const start=curveAt(reader,entity.curveId,a),end=curveAt(reader,entity.curveId,b,{side:'left'});
      yield {...sourceIdentity(view,entity),fromU:a,toU:b,from:start.point,to:end.point,start,end,positionErrorMm:range.interpolationErrorMm};
    }
  }
}
// A display budget selects an explicitly labelled page of independent source
// ranges. The continuation is a source identity/parameter, never a playback index.
export function sourcePathFrame(view,{pointCap=VIEWER_POINT_CAP,cursor=null}={}){
  if(!Number.isSafeInteger(pointCap)||pointCap<2)throw Error('Source display needs a positive endpoint budget.');
  const segments=[],points=[],bounds=view.bounds;let used=0,waiting=Boolean(cursor),next=null,complete=true;
  outer:for(const entity of sourceEntities(view.source)){
    if(waiting){if(entity.operationId!==cursor.operationId||entity.courseId!==cursor.courseId)continue;waiting=false;}
    if(entity.kind==='stationary'){
      if(used+1>pointCap){next={operationId:entity.operationId};complete=false;break;}
      points.push({...sourceIdentity(view,entity),...sampleSourcePath(view,{operationId:entity.operationId,u:0})});used++;
    }else{
      const from=cursor?.operationId===entity.operationId&&cursor.courseId===entity.courseId?cursor.u:entity.course.from;
      if(!Number.isFinite(from)||from<entity.course.from||from>entity.course.to)throw Error('Source continuation leaves its course.');
      for(const segment of sourceSegments(view,entity,from)){
        if(used+2>pointCap){next={operationId:entity.operationId,courseId:entity.courseId,u:segment.fromU};complete=false;break outer;}
        segments.push(segment);used+=2;
      }
    }
  }
  if(waiting)throw Error('Unknown source continuation.');
  return {kind:'paath-source-frame/1',sourceIdentity:view.sourceIdentity,segments,points,bounds,
    coverage:{complete:complete&&!cursor,pageComplete:complete,sourceCounts:view.counts,displayedSegments:segments.length,displayedStationary:points.length,displayedPoints:used,pointCap,
      positionToleranceMm:view.positionToleranceMm,scope:cursor?'source continuation':'source overview',
      section:'local endpoint samples; selected cross-section uses the shared parameter query',orientation:'tool axis; numerical basis is not authored roll',ordering:'none',bounds:'all source entity centerlines and stationary points',next}};
}
