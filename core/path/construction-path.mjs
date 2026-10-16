// Finalized construction publishes one immutable curve/profile authority.
import {saamPath} from './saampath.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {strokeRange} from './deposition.mjs';
import {uprightPose} from './pose.mjs';
import {surfaceReferenceRecord} from '../geom/surface-record.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function channel(values,parameters,interpolation){
  if(values.every(value=>same(value,values[0])))return values[0];
  return {interpolation,knots:values.map((value,i)=>[parameters[i],value])};
}
function stepChannel(values,parameters){
  if(values.every(value=>same(value,values[0])))return values[0];
  return {interpolation:'step',knots:[...values.flatMap((value,i)=>!i||!same(value,values[i-1])?[[parameters[i],value]]:[]),[1,values.at(-1)]]};
}
function cumulative(volumes,parameters){
  const state={total:0},knots=[[0,0]];
  for(const [i,volume] of volumes.entries()){state.total+=volume;knots.push([parameters[i+1],state.total]);}
  return {kind:'cumulative',knots};
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
  return stroke.provenance||segments.length?{...(stroke.provenance?{source:stroke.provenance}:{}),...(segments.length?{segments}:{})}:undefined;
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
    widthMm:smoothChannel(stroke,'beadWidthMm',parameters,stepChannel(widths,parameters)),
    speedMmS:smoothChannel(stroke,'speedMmS',parameters,stepChannel(speeds,parameters)),
    materialNormal:channel(normals,parameters,'slerp'),pose:channel(poses,parameters,'frame'),material}},provenance:sourceProvenance(stroke,metadata,parameters)};
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
    const stackId=result.stackId??result.id,index=operation.ownershipIndex??operation.layer;
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
    const courses=strokes.map((stroke,i)=>{
      const id=operation.id+':course:'+i,curveId='curve:'+id;
      const published=publishedCurve(stroke,process);curves[curveId]=published.curve;
      return {id,curveId,from:0,to:1,interruptible:stroke.interruptible??interruptible,role:stroke.role,
        ...(published.provenance?{provenance:published.provenance}:{})};
    });
    operations[operation.id]={...shared,kind:'deposit',courses};
  }
  return saamPath({schema:'saampath/2',generatorVersion,units:'mm',materialUnits:'mm3',curves,layers,surfaces,processes,
    operations,planning:{process:planning.process,selection:planning.selection,selections:planning.selections,
      ...(planning.start?{start:planning.start}:{}),...(planning.motion?{motion:planning.motion}:{})},composition,summary});
}
