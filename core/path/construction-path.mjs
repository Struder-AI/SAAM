// Finalized construction publishes one immutable curve/profile authority.
import {saamPath} from './saampath.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {strokeRange} from './deposition.mjs';
import {uprightPose,interpolatePose} from './pose.mjs';
import {surfaceReferenceRecord} from '../geom/surface-record.mjs';
import {prepareNumericalCurve,numericalCurveAt,numericalCurveRange,numericalCurveParameterAtLength} from '../geom/curve-query.mjs';
import {keyed,profileAt,interpolateScalar} from './curve-profiles.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function channel(values,parameters,interpolation){
  if(values.every(value=>same(value,values[0])))return values[0];
  return {interpolation,knots:values.map((value,i)=>[parameters[i],value])};
}
function segmentChannel(values,parameters){
  if(values.every(value=>same(value,values[0])))return values[0];
  // Segment samples describe a moving field. Connect their centres instead of
  // turning every sampled value into an instantaneous change at a vertex.
  const knots=[[0,values[0]]];
  for(const [i,value] of values.entries()){
    const u=(parameters[i]+parameters[i+1])/2;
    if(u>knots.at(-1)[0]&&u<1)knots.push([u,value]);
  }
  knots.push([1,values.at(-1)]);return {interpolation:'linear',knots};
}
function cumulative(volumes,parameters){
  const state={total:0},knots=[[0,0]];
  for(const [i,volume] of volumes.entries()){state.total+=volume;knots.push([parameters[i+1],state.total]);}
  return {kind:'cumulative',interpolation:'monotone',knots};
}
function smoothChannel(stroke,key,parameters,fallback){
  const witness=stroke.profilePath,keys=witness?.vary?.[key];
  if(!keys||stroke.curveParameters?.length!==parameters.length)return fallback;
  const original=stroke.curveParameters;
  if(original[0]!==0||original.at(-1)!==1||!original.every((u,i)=>!i||u>original[i-1]))return fallback;
  for(let i=0;i<original.length-1;i++){
    const u=(original[i]+original[i+1])/2,state={lo:0,hi:witness.parameters.length-1};
    while(state.hi-state.lo>1){const mid=Math.floor((state.lo+state.hi)/2);if(witness.parameters[mid]<=u)state.lo=mid;else state.hi=mid;}
    const expected=key==='speedMmS'?witness.speedsMmS?.[state.lo]:witness.widthsMm?.[state.lo];
    const actual=key==='speedMmS'?stroke.segmentMetadata?.[i]?.speedMmS:stroke.segmentMetadata?.[i]?.beadWidthMm;
    if(expected!==actual)return fallback;
  }
  const converted=keys.map(([u,value])=>{
    const state={i:1};while(state.i<original.length-1&&original[state.i]<u)state.i++;
    const i=state.i,t=(u-original[i-1])/(original[i]-original[i-1]);
    return [parameters[i-1]+t*(parameters[i]-parameters[i-1]),value];
  });
  return {interpolation:'linear',knots:converted};
}
function sourceProvenance(stroke,metadata,parameters){
  const segments=[];
  for(const [i,record] of metadata.entries()){
    const {surfaceNormal,beadWidthMm,speedMmS,beadHeightMm,normalHeightMm,normalGapMm,gapMm,beadAreaMm2,flowMultiplier,slopeDeg,volumeMm3,...labels}=record;
    if(!Object.keys(labels).length)continue;
    const previous=segments.at(-1);
    if(previous&&previous.to===parameters[i]&&same(previous.labels,labels))previous.to=parameters[i+1];
    else segments.push({from:parameters[i],to:parameters[i+1],labels});
  }
  return stroke.provenance||segments.length||stroke.scanlineCell!==undefined?{...(stroke.provenance?{source:stroke.provenance}:{}),
    ...(stroke.scanlineCell===undefined?{}:{cell:stroke.scanlineCell}),...(segments.length?{segments}:{})}:undefined;
}
function publishedCurve(original,process){
  const stroke=original.closed?strokeRange(original):original,points=stroke.points,lengths=[0];
  for(const [i,p] of points.slice(1).entries())lengths.push(lengths.at(-1)+distance(points[i],p));
  requireThat(lengths.at(-1)>0,'Moving deposition needs nonzero curve length.');
  const native=stroke.nativePath&&same(points,stroke.nativePath.points)?stroke.nativePath:null;
  const parameters=native?native.parameters:lengths.map(length=>length/lengths.at(-1));
  requireThat(parameters.every((u,i)=>!i||u>parameters[i-1]),'Finalized curves need distinct increasing parameters.');
  const metadata=points.slice(1).map((_,i)=>stroke.segmentMetadata?.[i]??{});
  const widths=metadata.map(m=>m.beadWidthMm??stroke.beadWidthMm??process.lineWidthMm);
  const speeds=metadata.map(m=>m.speedMmS??stroke.speedMmS);
  const normals=points.map((_,i)=>stroke.normals?.[i]??stroke.frameSamples?.[i]?.normal??metadata[Math.min(i,metadata.length-1)].surfaceNormal);
  requireThat(normals.every(Boolean),'Finalized deposition needs explicit material normals.');
  const poses=stroke.poses??points.map(()=>uprightPose());
  const material=stroke.volumesMm3?cumulative(stroke.volumesMm3,parameters):{kind:'area',areaMm2:stroke.beadAreaMm2};
  return {curve:{geometry:native?native.geometry:{kind:'polyline',points},profiles:{
    widthMm:smoothChannel(stroke,'beadWidthMm',parameters,segmentChannel(widths,parameters)),
    speedMmS:smoothChannel(stroke,'speedMmS',parameters,segmentChannel(speeds,parameters)),
    materialNormal:channel(normals,parameters,'slerp'),pose:channel(poses,parameters,'frame'),material}},provenance:sourceProvenance(stroke,metadata,parameters)};
}
// A continuous operation has an authored traversal across its course seams.
// Publish that transition once, over one bead width (at most half each course),
// rather than asking execution readers to invent an instantaneous field change.
function continuousProfiles(curves,courses){
  const prepared=new Map();
  const geometry=id=>{if(!prepared.has(id))prepared.set(id,prepareNumericalCurve(curves[id].geometry));return prepared.get(id);};
  function endProfile(curve,key,u,value,start){
    const profile=curve.profiles[key],anchor=[u,profileAt(profile,u)],keys=keyed(profile)?profile.knots:[[0,profile],[1,profile]];
    curve.profiles[key]={interpolation:key==='pose'?'frame':'linear',knots:start
      ?[[0,value],anchor,...keys.filter(([at])=>at>u)]
      :[...keys.filter(([at])=>at<u),anchor,[1,value]]};
  }
  for(let i=1;i<courses.length;i++){
    const left=curves[courses[i-1].curveId],right=curves[courses[i].curveId];
    const changes=['widthMm','speedMmS','pose'].filter(key=>!same(profileAt(left.profiles[key],1),profileAt(right.profiles[key],0)));
    if(!changes.length)continue;
    const a=geometry(courses[i-1].curveId),b=geometry(courses[i].curveId);
    if(distance(numericalCurveAt(a,1).point,numericalCurveAt(b,0).point)>ROUNDING_MM)continue;
    const width=Math.max(profileAt(left.profiles.widthMm,1),profileAt(right.profiles.widthMm,0));
    const window=shape=>Math.min(width,numericalCurveRange(shape,0,1,{lengthToleranceMm:ROUNDING_MM}).lengthMm[0]/2);
    const from=numericalCurveParameterAtLength(a,0,1,window(a),{fromEnd:true});
    const to=numericalCurveParameterAtLength(b,0,1,window(b));
    requireThat(from>0&&from<1&&to>0&&to<1,'Continuous fields need a representable transition window.');
    for(const key of changes){
      const x=profileAt(left.profiles[key],1),y=profileAt(right.profiles[key],0);
      const value=key==='pose'?interpolatePose(x,y,.5):interpolateScalar(x,y,.5);
      endProfile(left,key,from,value,false);endProfile(right,key,to,value,true);
    }
  }
}
export function constructionPath({results,planning,composition,summary,generatorVersion}){
  const curves={},layers={},surfaces={},processes={},operations={},surfaceIds=new Map(),processIds=new Map();
  function processId(process){
    const key=JSON.stringify(process);
    if(processIds.has(key))return processIds.get(key);
    const id='process:'+processIds.size;processIds.set(key,id);processes[id]=process;return id;
  }
  function layerId(result,operation){
    if(!operation.slice)return null;
    const stackId=operation.stackId??result.stackId??result.id,index=operation.ownershipIndex??operation.layer;
    const reference=surfaceReferenceRecord(operation.slice),id=stackId+':layer:'+index,key=JSON.stringify(reference);
    const surfaceId=surfaceIds.get(key)??'surface:'+surfaceIds.size;
    if(!surfaceIds.has(key)){surfaceIds.set(key,surfaceId);surfaces[surfaceId]=reference;}
    if(layers[id])requireThat(layers[id].surfaceId===surfaceId,'Native layer identity refers to different surfaces.');
    else layers[id]={stackId,index,surfaceId};
    return id;
  }
  for(const [resultIndex,result] of results.entries())for(const operation of result.operations){
    requireThat(operation.order==='given'&&!operation.connectNearby,'Deposition must be finalized before publication.');
    const {strokes,process,materialGeometry}=operation;
    const metadata=Object.fromEntries(['phase','layer','layerIndex','layerCount','rank','nominalRank','filament','fanPercent',
      'nozzleC','restoreNozzleC','continuous','regionId','part','stackDirection','requiredMaterial','provenance'].filter(key=>operation[key]!==undefined).map(key=>[key,operation[key]]));
    const interruptible=operation.interruptible??!operation.continuous;
    const shared={...metadata,...(operation.part===undefined&&result.report?.part!==undefined?{part:result.report.part}:{}),
      id:operation.id,layerId:layerId(result,operation),processId:processId(process),
      after:operation.after??[],interruptible,construction:result.id,constructionRank:resultIndex};
    requireThat(!Object.hasOwn(operations,operation.id),'Duplicate source operation.');
    const injections=strokes.filter(stroke=>stroke.stationaryExtrusion);
    if(injections.length){
      requireThat(injections.length===1&&strokes.every(stroke=>stroke.stationaryExtrusion||stroke.volumesMm3?.every(v=>v===0)),
        'An Inject operation cannot also contain moving deposition.');
      const stroke=injections[0];
      operations[operation.id]={...shared,kind:'inject',interruptible:false,
        injection:{at:stroke.points[0],pose:stroke.poses?.[0]??uprightPose(),...stroke.stationaryExtrusion},
        ...(operation.occupied||materialGeometry?{occupied:operation.occupied??materialGeometry}:{})};
      continue;
    }
    const localCourses=new Map();
    const courses=strokes.map((stroke,i)=>{
      const id=operation.id+':course:'+i,curveId='curve:'+id;
      if(stroke.id!==undefined){
        requireThat(typeof stroke.id==='string'&&stroke.id.length>0,'A local curve id must be a nonempty string.');
        if(!localCourses.has(stroke.id))localCourses.set(stroke.id,[]);
        localCourses.get(stroke.id).push(id);
      }
      const published=publishedCurve(stroke,process);curves[curveId]=published.curve;
      return {id,curveId,from:0,to:1,interruptible:stroke.interruptible??interruptible,role:stroke.role,
        ...(published.provenance?{provenance:published.provenance}:{})};
    });
    // Mapping and parallel bead construction may expand one named curve into
    // several courses. Its dependents need all of them, regardless of order.
    for(const [i,stroke] of strokes.entries())if(stroke.after!==undefined){
      requireThat(Array.isArray(stroke.after)&&stroke.after.every(id=>localCourses.has(id)&&id!==stroke.id),
        'A required curve predecessor must be present in the same deposition batch.');
      courses[i].after=[...new Set(stroke.after.flatMap(id=>localCourses.get(id)))];
    }
    if(!interruptible)continuousProfiles(curves,courses);
    operations[operation.id]={...shared,kind:'deposit',courses};
  }
  return saamPath({schema:'saampath/2',generatorVersion,units:'mm',materialUnits:'mm3',curves,layers,surfaces,processes,
    operations,planning:{process:planning.process,selection:planning.selection,selections:planning.selections,
      ...(planning.start?{start:planning.start}:{}),...(planning.motion?{motion:planning.motion}:{})},composition,summary});
}
