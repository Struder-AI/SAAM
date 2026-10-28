// Finalized construction publishes one immutable curve/profile authority.
import {saamPath} from './saampath.mjs';
import {serializableSource,sourceDepositionAdvisories} from './source-admission.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {strokeRange} from './deposition.mjs';
import {uprightPose} from './pose.mjs';
import {interpolateDirection} from '../geom/frame.mjs';
import {surfaceReferenceRecord} from '../geom/surface-record.mjs';
import {prepareNumericalCurve,numericalCurveAt,numericalCurveRange,numericalCurveParameterAtLength} from '../geom/curve-query.mjs';
import {keyed,profileAt,interpolateScalar,scalarRange} from './curve-profiles.mjs';
import {constructionScalarProfiles} from './construction-profiles.mjs';
import {constructionCurve} from './construction-curves.mjs';
import {compactCurveProfiles} from './compact-profiles.mjs';
import {ROUNDING_MM,PRINT_RESOLUTION_MM,FLOAT64_EPSILON} from '../dimensions.mjs';
import {publishManufacturing,CONSTRUCTION_CONTRACT} from './manufacturing.mjs';
import {bindMaterialSlices} from './material-readiness.mjs';
import {DEFAULT_NOZZLE_GEOMETRY} from '../geom/convex-clearance.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function channel(values,parameters,interpolation){
  if(values.every(value=>same(value,values[0])))return values[0];
  return {interpolation,knots:values.map((value,i)=>[parameters[i],value])};
}
function sourceProvenance(stroke,metadata,parameters){
  const segments=[];
  for(const [i,record] of metadata.entries()){
    const {surfaceNormal,beadWidthMm,speedMmS,beadHeightMm,normalHeightMm,normalGapMm,gapMm,beadAreaMm2,flowMultiplier,slopeDeg,volumeMm3,founded,...labels}=record;
    if(!Object.keys(labels).length)continue;
    const previous=segments.at(-1);
    if(previous&&previous.to===parameters[i]&&same(previous.labels,labels))previous.to=parameters[i+1];
    else segments.push({from:parameters[i],to:parameters[i+1],labels});
  }
  return stroke.provenance||segments.length?{...(stroke.provenance?{source:stroke.provenance}:{}),...(segments.length?{segments}:{})}:undefined;
}
function regeneratedSectionError(stroke,parameters,profiles,process){
  const authored=stroke.profilePath?.vary;
  const retained=authored?.rateMm3PerMm&&stroke.curveParameters?.length===parameters.length&&stroke.curveParameters.every((u,i)=>
    Math.abs(profileAt(profiles.rateMm3PerMm,parameters[i])-profileAt({interpolation:'linear',knots:authored.rateMm3PerMm},u))<=ROUNDING_MM&&
    Math.abs(profileAt(profiles.aspectRatio,parameters[i])-profileAt({interpolation:'linear',knots:authored.aspectRatio},u))<=ROUNDING_MM);
  if(retained)return stroke.anchorLowering?.sectionErrorMm??0;
  const state={error:0};
  for(let i=1;i<parameters.length;i++){
    const width=stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm??process.lineWidthMm;
    const rate=stroke.volumesMm3?stroke.volumesMm3[i-1]/distance(stroke.points[i-1],stroke.points[i]):stroke.beadAreaMm2;
    const r=scalarRange(profiles.rateMm3PerMm,parameters[i-1],parameters[i]),a=scalarRange(profiles.aspectRatio,parameters[i-1],parameters[i]);
    const widths=[Math.sqrt(r[0]*a[0]),Math.sqrt(r[1]*a[1])],heights=[Math.sqrt(r[0]/a[1]),Math.sqrt(r[1]/a[0])];
    const referenceWidth=rate===0?0:width,referenceHeight=rate===0?0:rate/width;
    state.error=Math.max(state.error,...widths.map(value=>Math.abs(value-referenceWidth)),...heights.map(value=>Math.abs(value-referenceHeight)));
  }
  return state.error;
}
function publishedCurve(original,process,surface){
  const stroke=original.closed?strokeRange(original):original,points=stroke.points,lengths=[0];
  for(const [i,p] of points.slice(1).entries())lengths.push(lengths.at(-1)+distance(points[i],p));
  requireThat(lengths.at(-1)>0,'Moving deposition needs nonzero curve length.');
  const native=constructionCurve(original,surface);
  const chordParameters=lengths.map(length=>length/lengths.at(-1));
  const parameters=native?native.parameters:chordParameters;
  requireThat(parameters.every((u,i)=>!i||u>parameters[i-1]),'Finalized curves need distinct increasing parameters.');
  const geometry=native?.geometry??{kind:'polyline',points};
  const metadata=points.slice(1).map((_,i)=>stroke.segmentMetadata?.[i]??{});
  const widths=metadata.map(m=>m.beadWidthMm??stroke.beadWidthMm??process.lineWidthMm);
  const normals=points.map((_,i)=>stroke.normals?.[i]??stroke.frameSamples?.[i]?.normal??metadata[Math.min(i,metadata.length-1)].surfaceNormal);
  requireThat(normals.every(Boolean),'Finalized deposition needs explicit material normals.');
  const poses=stroke.poses??points.map(()=>uprightPose());
  const shape=native?.geometry.kind==='nurbs'&&(stroke.volumesMm3||native.mapped||native.fitted)?prepareNumericalCurve(geometry):null;
  const lengthsMm=shape?parameters.slice(1).map((to,i)=>numericalCurveRange(shape,parameters[i],to,{lengthToleranceMm:ROUNDING_MM}).lengthMm):null;
  const scalars=constructionScalarProfiles(stroke,parameters,process,{physicalLengthsMm:lengthsMm?.map(([lo,hi])=>interpolateScalar(lo,hi,.5))});
  const materialError={volumeMm3:0};
  if(lengthsMm&&!scalars.canonicalMaterial)for(const [i,[lo,hi]] of lengthsMm.entries()){
    const rate=profileAt(scalars.profiles.rateMm3PerMm,(parameters[i]+parameters[i+1])/2);
    materialError.volumeMm3+=rate*(hi-lo)/2;
  }
  const inputVolume=stroke.volumesMm3?.reduce((sum,value)=>sum+value,0)??lengths.at(-1)*stroke.beadAreaMm2;
  materialError.volumeMm3+=FLOAT64_EPSILON*8*inputVolume;
  const profiles={
    ...scalars.profiles,
    materialNormal:channel(normals,parameters,'slerp'),toolAxis:channel(poses.map(pose=>pose.toolAxis),parameters,'slerp')};
  const extent=metadata.reduce((maximum,record)=>Math.max(maximum,record.beadHeightMm??record.normalGapMm??0),
    widths.reduce((maximum,width)=>Math.max(maximum,width),stroke.beadHeightMm??process.layerMm));
  const compacted=compactCurveProfiles(profiles,{normalToleranceRad:PRINT_RESOLUTION_MM/(4*extent)});
  return {curve:{geometry,profiles:compacted.profiles},provenance:sourceProvenance(stroke,metadata,parameters),
    founded:{flags:metadata.map(record=>record.founded),parameters},
    transitionWidthsMm:[widths[0],widths.at(-1)].map(width=>width>0?width:process.lineWidthMm),
    compaction:{mapped:Boolean(native?.mapped),fitted:Boolean(native?.fitted),positionErrorMm:native?.positionErrorMm??0,normalErrorRad:compacted.normalErrorRad,
      volumeErrorMm3:materialError.volumeMm3,sectionErrorMm:regeneratedSectionError(stroke,parameters,profiles,process),
      normalKeysBefore:keyed(profiles.materialNormal)?profiles.materialNormal.knots.length:0,normalKeysAfter:keyed(compacted.profiles.materialNormal)?compacted.profiles.materialNormal.knots.length:0,
      materialKeysBefore:profiles.rateMm3PerMm.knots?.length??0,materialKeysAfter:compacted.profiles.rateMm3PerMm.knots?.length??0}};
}
// Atomic operations and required consecutive courses retain authored transitions.
// Publish over one construction width (at most half each course). Zero material
// has no deposited section, but retains its geometric motion-transition scale.
function continuousProfiles(curves,courses,{requiredOnly=false,transitionWidthsMm}={}){
  const prepared=new Map();
  const geometry=id=>{if(!prepared.has(id))prepared.set(id,prepareNumericalCurve(curves[id].geometry));return prepared.get(id);};
  function endProfile(curve,key,u,value,start){
    const profile=curve.profiles[key],anchor=[u,profileAt(profile,u)],keys=keyed(profile)?profile.knots:[[0,profile],[1,profile]];
    curve.profiles[key]={interpolation:key==='toolAxis'?'slerp':'linear',knots:start
      ?[[0,value],anchor,...keys.filter(([at])=>at>u)]
      :[...keys.filter(([at])=>at<u),anchor,[1,value]]};
  }
  for(let i=1;i<courses.length;i++){
    if(requiredOnly&&!courses[i].after?.includes(courses[i-1].id))continue;
    const left=curves[courses[i-1].curveId],right=curves[courses[i].curveId];
    const changes=['speedMmS','toolAxis'].filter(key=>!same(profileAt(left.profiles[key],1),profileAt(right.profiles[key],0)));
    if(!changes.length)continue;
    const a=geometry(courses[i-1].curveId),b=geometry(courses[i].curveId);
    if(distance(numericalCurveAt(a,1).point,numericalCurveAt(b,0).point)>ROUNDING_MM)continue;
    const transitionWidth=(curve,u,nominal)=>{
      const rate=profileAt(curve.profiles.rateMm3PerMm,u);
      return rate>0?Math.sqrt(rate*profileAt(curve.profiles.aspectRatio,u)):nominal;
    };
    const width=Math.max(transitionWidth(left,1,transitionWidthsMm[i-1][1]),transitionWidth(right,0,transitionWidthsMm[i][0]));
    const window=shape=>Math.min(width,numericalCurveRange(shape,0,1,{lengthToleranceMm:ROUNDING_MM}).lengthMm[0]/2);
    const from=numericalCurveParameterAtLength(a,0,1,window(a),{fromEnd:true});
    const to=numericalCurveParameterAtLength(b,0,1,window(b));
    requireThat(from>0&&from<1&&to>0&&to<1,'Continuous fields need a representable transition window.');
    for(const key of changes){
      const x=profileAt(left.profiles[key],1),y=profileAt(right.profiles[key],0);
      const value=key==='toolAxis'?interpolateDirection(x,y,.5):interpolateScalar(x,y,.5);
      endProfile(left,key,from,value,false);endProfile(right,key,to,value,true);
    }
  }
}
function newCompaction(){
  return {mappedCurves:0,fittedCurves:0,positionErrorMm:0,normalErrorRad:0,volumeErrorMm3:0,sectionErrorMm:0,scalarLaw:'paired-limit finalized segment laws; authored canonical laws retained',normalKeysBefore:0,normalKeysAfter:0,materialKeysBefore:0,materialKeysAfter:0};
}
// Declared foundation scope: source intervals resting on work the producer
// declared. A segment its producer marks founded rests on its native
// predecessor or the course's own earlier material; an unmarked segment rests
// on the operation's declared prerequisites, if it names any. The Scheduler
// qualifies everything else against deposited material.
function foundedIntervals({flags,parameters},declared){
  const intervals=[];
  for(const [i,flag] of flags.entries()){
    if(!(flag===true||flag===undefined&&declared))continue;
    const last=intervals.at(-1);
    if(last&&last[1]===parameters[i])last[1]=parameters[i+1];else intervals.push([parameters[i],parameters[i+1]]);
  }
  return intervals.length?{founded:intervals}:{};
}
// One lowering owner, used at work completion and final publication.
function operationPayload(operation){
  const curves={},compaction=newCompaction(),volumeErrors=[],{strokes,process,materialGeometry}=operation;
  const interruptible=operation.interruptible??!operation.continuous;
  let answer;
    if(operation.canonicalEntity){
      const entity=operation.canonicalEntity;
      if(entity.stationary){
        answer={kind:'inject',interruptible:false,
          injection:{at:entity.geometry.point,toolAxis:entity.profiles.toolAxis,...entity.stationary}};
      }else{
        const curveId='curve:'+operation.id,courseId=operation.id+':course';
        curves[curveId]={geometry:entity.geometry,profiles:entity.profiles};
        answer={kind:'deposit',courses:[{id:courseId,curveId,from:0,to:1,interruptible,
          directionRequired:entity.directionRequired??true,...(entity.seamRequired===undefined?{}:{seamRequired:entity.seamRequired}),
          ...(entity.role===undefined?{}:{role:entity.role}),...(entity.provenance===undefined?{}:{provenance:entity.provenance}),
          ...(operation.after?.length?{founded:[[0,1]]}:{})}]};
      }
      return {curves,operation:answer,compaction,volumeErrors,authoredCanonical:!!operation.canonicalEntity};
    }
    const injections=strokes.filter(stroke=>stroke.stationaryExtrusion);
    if(injections.length){
      requireThat(injections.length===1&&strokes.every(stroke=>stroke.stationaryExtrusion||stroke.volumesMm3?.every(v=>v===0)),
        'An Inject operation cannot also contain moving deposition.');
      const stroke=injections[0];
      answer={kind:'inject',interruptible:false,
        injection:{at:stroke.points[0],toolAxis:stroke.poses?.[0]?.toolAxis??uprightPose().toolAxis,...stroke.stationaryExtrusion},
        ...(operation.occupied||materialGeometry?{occupied:operation.occupied??materialGeometry}:{})};
      return {curves,operation:answer,compaction,volumeErrors,authoredCanonical:!!operation.canonicalEntity};
    }
    const localCourses=new Map(),transitionWidthsMm=[];
    const courses=strokes.map((stroke,i)=>{
      const id=operation.id+':course:'+i,curveId='curve:'+id;
      if(stroke.id!==undefined){
        requireThat(typeof stroke.id==='string'&&stroke.id.length>0,'A local curve id must be a nonempty string.');
        if(!localCourses.has(stroke.id))localCourses.set(stroke.id,[]);
        localCourses.get(stroke.id).push(id);
      }
      const published=publishedCurve(stroke,process,operation.slice);curves[curveId]=published.curve;
      transitionWidthsMm.push(published.transitionWidthsMm);
      if(published.compaction.mapped)compaction.mappedCurves++;
      if(published.compaction.fitted)compaction.fittedCurves++;
      for(const key of ['positionErrorMm','normalErrorRad','sectionErrorMm'])compaction[key]=Math.max(compaction[key],published.compaction[key]);
      compaction.volumeErrorMm3+=published.compaction.volumeErrorMm3;
      volumeErrors.push(published.compaction.volumeErrorMm3);
      for(const key of ['normalKeysBefore','normalKeysAfter','materialKeysBefore','materialKeysAfter'])compaction[key]+=published.compaction[key];
      return {id,curveId,from:0,to:1,interruptible:stroke.interruptible??interruptible,directionRequired:stroke.directionRequired??true,role:stroke.role,
        sourceCurve:stroke.sourceCurve??stroke.id??i,...(stroke.edge?{edge:stroke.edge}:{}),
        ...((stroke.orderGroup??stroke.scanlineCell)===undefined?{}:{orderGroup:stroke.orderGroup??stroke.scanlineCell}),
        ...(stroke.closed||distance(stroke.points[0],stroke.points.at(-1))<=ROUNDING_MM?{seamRequired:stroke.seamRequired===true}:{}),
        ...(published.provenance?{provenance:published.provenance}:{}),...foundedIntervals(published.founded,Boolean(operation.after?.length))};
    });
    // Mapping and parallel bead construction may expand one named curve into
    // several courses. Its dependents need all of them, regardless of order.
    for(const [i,stroke] of strokes.entries())if(stroke.after!==undefined){
      requireThat(Array.isArray(stroke.after)&&stroke.after.every(id=>localCourses.has(id)&&id!==stroke.id),
        'A required curve predecessor must be present in the same deposition batch.');
      courses[i].after=[...new Set(stroke.after.flatMap(id=>localCourses.get(id)))];
    }
    continuousProfiles(curves,courses,{requiredOnly:interruptible,transitionWidthsMm});
    answer={kind:'deposit',courses};
    return {curves,operation:answer,compaction,volumeErrors,authoredCanonical:false};
}
export function appendConstructionResult(result){
  const advisories=[];
  const operations=result.operations.map(operation=>{
    const canonicalWork=operation.canonicalWork??serializableSource(operationPayload(operation));
    advisories.push(...sourceDepositionAdvisories({curves:canonicalWork.curves,operations:{[operation.id]:canonicalWork.operation}}));
    if(operation.canonicalWork)return operation;
    const {strokes,canonicalEntity,materialGeometry,occupied,...metadata}=operation;
    const publication={roles:[...new Set(canonicalEntity?[canonicalEntity.role??null]:strokes.map(stroke=>stroke.role))],
      layers:strokes.flatMap(stroke=>stroke.segmentMetadata?.map(segment=>segment.layer).filter(Number.isInteger)??[]),
      maxZ:strokes.reduce((top,stroke)=>stroke.points.reduce((top,p)=>Math.max(top,p[2]),top),-Infinity)};
    return {...metadata,strokes:[],canonicalWork,publication};
  });
  const compactLayer=layer=>{
    const {preparedStrokes,fillCurves,infillCurves,...reference}=layer;
    return reference;
  };
  return {...result,operations,report:withSectionAdvisories(result.report,advisories),
    ...(result.stackLayers?{stackLayers:result.stackLayers.map(compactLayer)}:{}),
    ...(result.referenceStack?{referenceStack:{...result.referenceStack,layers:result.referenceStack.layers.map(compactLayer)}}:{})};
}

function withSectionAdvisories(report={},advisories){
  const {advisories:prior=[],notes:priorNotes=[],...rest}=report,replaced=new Set(prior.filter(item=>item.code==='DEPOSITION_ASPECT_ADVISORY').map(item=>item.message));
  const retained=prior.filter(item=>item.code!=='DEPOSITION_ASPECT_ADVISORY'),notes=priorNotes.filter(note=>!replaced.has(note));
  return {...rest,...(advisories.length||retained.length?{advisories:[...retained,...advisories]}:{}),
    ...(notes.length||advisories.length?{notes:[...notes,...advisories.map(item=>item.message)]}:{})};
}

export function constructionPath({results,planning,composition,summary,generatorVersion,onProgress,consumeResults=false}){
  const curves={},layers={},surfaces={},processes={},operations={},surfaceIds=new Map(),processIds=new Map(),nativeMembers=[];
  const needsProducerValidity=!results.some(result=>result.operations.some(operation=>operation.canonicalEntity||operation.canonicalWork?.authoredCanonical));
  const publication={completed:0,total:results.reduce((sum,result)=>sum+result.operations.length,0)};
  function publishedOperation(result,index){
    // This ownership transfer is used only after all live Construction readers
    // and retries finish. Manufacturing below needs IDs, not deposited buffers.
    const id=result.operations[index].id;
    if(consumeResults)result.operations[index]={id};
    publication.completed++;
    onProgress?.({stage:'Publishing canonical work',assignment:result.id,operation:id,completed:publication.completed,total:publication.total});
  }
  const compaction=newCompaction();
  function processId(process){
    const key=JSON.stringify(process);
    if(processIds.has(key))return processIds.get(key);
    const id='process:'+processIds.size;processIds.set(key,id);processes[id]=process;return id;
  }
  function layerId(result,operation){
    if(operation.nativeLayer){
      const layer=operation.nativeLayer,surfaceId=layer.surface===undefined?null:'surface:'+layer.id;
      if(surfaceId!==null)surfaces[surfaceId]=layer.surface;
      const record={stackId:layer.stackId,index:layer.index,sequence:layer.sequence,surfaceId};
      if(layers[layer.id])requireThat(same(layers[layer.id],record),'Native Paath slice identity has conflicting declarations.');
      else layers[layer.id]=record;
      return layer.id;
    }
    if(typeof operation.layerId!=='string')return null;
    const stackId=operation.stackId??result.stackId??result.id,index=operation.ownershipIndex??operation.layer;
    requireThat(operation.slice||operation.stackId&&Number.isSafeInteger(operation.ownershipIndex),'Stack membership needs an explicit construction slice or native reference.');
    const id=operation.layerId;let surfaceId=null;
    if(operation.slice){
      const reference=surfaceReferenceRecord(operation.slice),key=JSON.stringify(reference);
      surfaceId=surfaceIds.get(key)??'surface:'+surfaceIds.size;
      if(!surfaceIds.has(key)){surfaceIds.set(key,surfaceId);surfaces[surfaceId]=reference;}
    }
    if(layers[id])requireThat(layers[id].surfaceId===surfaceId&&layers[id].stackId===stackId&&layers[id].index===index,'Native layer identity refers to different surfaces or stack positions.');
    else {
      const sequence=operation.layerIndex??result.referenceStack?.layers.findIndex(layer=>layer.index===index);
      requireThat(Number.isSafeInteger(sequence)&&sequence>=0,'Native layer needs its declared stack sequence position.');
      layers[id]={stackId,index,sequence,surfaceId};
    }
    return id;
  }
  for(const [resultIndex,result] of results.entries()){
  for(const member of result.nativeLayers??[]){
    const id=layerId(result,{nativeLayer:member});
    nativeMembers.push({id,owner:result.report?.owner??result.id,part:result.report?.part??null,after:result.logicalAfter??[]});
  }
  if(result.report?.depositionFamily==='slice')for(const [sequence,member] of (result.referenceStack?.layers??[]).entries()){
    const stackId=result.stackId??result.id,id=layerId(result,{layerId:stackId+':layer:'+member.index,stackId,
      ownershipIndex:member.index,slice:member.slice,layerIndex:sequence});
    nativeMembers.push({id,owner:result.report.owner??result.id,part:result.report.part??null,after:member.logicalAfter??[]});
  }
  for(const [operationIndex,operation] of result.operations.entries()){
    requireThat(operation.order==='given'&&!operation.connectNearby,'Deposition must be finalized before publication.');
    const {process}=operation;
    const metadata=Object.fromEntries(['phase','layer','layerIndex','layerCount','rank','nominalRank','fanPercent',
      'nozzleC','restoreNozzleC','continuous','regionId','part','stackDirection','referenceLayer','requiredMaterial','provenance','foundation'].filter(key=>operation[key]!==undefined).map(key=>[key,operation[key]]));
    const interruptible=operation.interruptible??!operation.continuous;
    const shared={...metadata,...(operation.part===undefined&&result.report?.part!==undefined?{part:result.report.part}:{}),
      id:operation.id,toolIndex:operation.toolIndex??operation.filament??planning.selection?.filament??0,layerId:layerId(result,operation),processId:processId(process),
      after:operation.after??[],interruptible,construction:result.id,constructionRank:resultIndex};
    requireThat(!Object.hasOwn(operations,operation.id),'Duplicate source operation.');
    const payload=operation.canonicalWork??operationPayload(operation);
    Object.assign(curves,payload.curves);
    for(const key of ['positionErrorMm','normalErrorRad','sectionErrorMm'])compaction[key]=Math.max(compaction[key],payload.compaction[key]);
    for(const key of ['mappedCurves','fittedCurves','normalKeysBefore','normalKeysAfter','materialKeysBefore','materialKeysAfter'])compaction[key]+=payload.compaction[key];
    for(const error of payload.volumeErrors)compaction.volumeErrorMm3+=error;
    operations[operation.id]={...shared,...payload.operation};
    publishedOperation(result,operationIndex);
  }
  if(consumeResults){
    delete result.referenceStack;delete result.stackLayers;delete result.nativeLayers;
  }
  }
  const published=publishManufacturing(results,operations,layers,nativeMembers);
  const source={schema:'saampath/3',generatorVersion,units:'mm',materialUnits:'mm3',sectionReference:'top',curves,layers,surfaces,processes,
    ...published,operations,planning:{process:planning.process,selection:planning.selection,selections:planning.selections,
      ...(planning.start?{start:planning.start}:{}),...(planning.motion?{motion:planning.motion}:{})},composition,summary:{...summary,integratedTotals:'estimates',compaction},
    ...(needsProducerValidity?
      {manufacturing:{contract:CONSTRUCTION_CONTRACT,accessGeometry:DEFAULT_NOZZLE_GEOMETRY,courseTraversal:{}}}:{})};
  // Producers own internal validity and traversal permissions. Enclosure
  // readiness is a material requirement, not a second scheduling lifecycle.
  bindMaterialSlices(source,results.flatMap(result=>result.materialReadiness??[]));
  source.summary=withSectionAdvisories(source.summary,sourceDepositionAdvisories(source));
  return saamPath(source);
}
