// Standard continuous wall composition over public Toolpath operations.
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
// Heights (the part bottom, a layer rank, a sleeve start or end, the layer grid)
// coincide to print resolution.
export function prepareSleeveGeometry({shell,assignment,process,zStartMm=null,zEndMm=null,onProgress},{prepareContourSleeve}){
  const base=zStartMm??shell.bounds.min[2]+assignment.zStartMm;
  const firstHeight=Math.abs(base-shell.bounds.min[2])<PRINT_RESOLUTION_MM?process.firstLayerMm:process.layerMm;
  const start=base+firstHeight,end=zEndMm??(assignment.zEndMm===null?shell.bounds.max[2]:shell.bounds.min[2]+assignment.zEndMm);
  const fitMode=assignment.meshSleeve?'mesh':assignment.pattern===null&&assignment.sleeveToleranceMm>0?'automatic':'none';
  const centerlineOffsetMm=(assignment.meshSleeve?.contactSide==='outside'?1:-1)*process.lineWidthMm/2;
  return prepareContourSleeve({shell,baseMm:base,startMm:start,endMm:end,pitchMm:process.layerMm,firstHeightMm:firstHeight,
    centerlineOffsetMm,standoffMm:process.lineWidthMm/2,sampleStepMm:assignment.sampleStepMm,
    toleranceMm:assignment.toleranceMm,boundaryToleranceMm:assignment.boundaryToleranceMm,
    minFeatureMm:assignment.minFeatureMm,sleeveToleranceMm:assignment.sleeveToleranceMm,
    meshSleeve:assignment.meshSleeve,fitMode,phaseStableContours:assignment.pattern!==null,onProgress});
}

export function vaseWallRuntime({Geometry,Toolpath}) {
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
  const {spiralStackCurve,traceResult,contactCurveGaps,contactSpanNote,maximumPathAngle,strokeRange,publishFinishedBoundary,depositedBeadSegments}=Toolpath;

function standardVaseResult({assignment:settings,process,shell,geometry,after=settings.after},{foundationSegments=[],substrateAdaptation=false}={}){
  const referenceStack=geometry.referenceStack();
  const curve=spiralStackCurve({referenceStack,firstHeightMm:geometry.firstHeight,widthMm:process.lineWidthMm,
    levelEnd:settings.endTransition==='level',sampleStepMm:settings.sampleStepMm,toleranceMm:settings.toleranceMm,
    speedMmS:geometry.speedMmS??Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS),minimumTurnSeconds:geometry.minimumTurnSeconds??process.minimumLayerSeconds,role:geometry.role??'vase-wall'});
  const {profile,...centerline}=curve;
  const {curves,spans}=substrateAdaptation&&foundationSegments.length?contactCurveGaps([centerline],{segments:foundationSegments}):{curves:[centerline],spans:[]};
  const traced=traceResult({id:settings.id,filament:settings.filament,after},{process,batches:[{
    key:'wall',curves,join:{mode:'ordered'},layerId:settings.id+':continuous',phase:'vase-wall',layer:0,rank:geometry.start,
    ...(geometry.batch??{}),fanPercent:process.fanPercent,trimEnd:settings.endTransition==='level',travel:{kind:'clearance',clearanceZ:geometry.end+process.liftMm}}]});
  const operations=traced.operations.map(operation=>({...operation,layerIndex:0,layerCount:referenceStack.layers.length,stackDirection:referenceStack.direction??[0,0,1]}));
  const strokes=operations.flatMap(operation=>operation.strokes);
  const terminal=strokes.flatMap(stroke=>stroke.segmentMetadata.flatMap((metadata,index)=>metadata.boundaryRole==='rim'?[index]:[]))[0];
  const levelBoundary=settings.endTransition==='level'&&geometry.terminalBoundary!==false?{zMm:geometry.end,widthMm:process.lineWidthMm,strokes:[strokeRange(strokes[0],terminal)]}:null;
  const result={...traced,operations,referenceStack,stackId:settings.id,...(levelBoundary?{levelBoundary}:{}),report:{...traced.report,
    owner:settings.id,part:settings.part,construction:'sleeve',depositionFamily:'trace',extension:'vase-wall',startMm:geometry.start,endMm:geometry.end,baseTopMm:geometry.base,
    turns:profile.turns,spiralTurns:profile.risingTurns,endTransition:settings.endTransition,levelRimMm:levelBoundary?geometry.end:null,
    points:curve.points.length,speedMmS:curve.speedMmS,maximumAngleDeg:maximumPathAngle(curve.points),...geometry.report(),
    ...(spans.length?{notes:spans.map(span=>contactSpanNote(`Vase wall ${settings.id}`,span))}:{})}};
  return settings.meshSleeve?result:publishFinishedBoundary(result,{shell,boundary:'side',startMm:geometry.base,
    endMm:geometry.end-(settings.endTransition==='level'?0:process.layerMm),toleranceMm:settings.boundaryToleranceMm});
}

function vaseFoundationSegments({node,samePart,substrateAdaptation}){
  const context=node.context??node.record.context,assignment=node.context?.assignment??node.record.spec.settings;
  const foundations=samePart.filter(item=>item.node.nominalRank<=context.startMm+PRINT_RESOLUTION_MM);
  if(assignment.zStartMm>0){
    const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
    requireThat(Math.abs(grid-Math.round(grid))*context.process.layerMm<PRINT_RESOLUTION_MM,'A raised sleeve must start on its resolved process layer grid.');
    requireThat(foundations.some(item=>item.result.operations.length),'A raised sleeve needs supporting deposition below its start.');
  }
  return substrateAdaptation&&assignment.zStartMm>0?depositedBeadSegments(foundations.flatMap(item=>item.result.operations),{widthMm:context.process.lineWidthMm}):[];
}

function vaseDependencies(node,nodes){
  const needs=new Set();
  for(const other of nodes){
    if(other===node)continue;
    if(node.construction==='sleeve'&&other.part===node.part){
      if(other.kind==='slice'&&!other.record.reference&&other.nominalRank<=(node.context??node.record.context).startMm+PRINT_RESOLUTION_MM||other.construction==='sleeve'&&(other.context??other.record.context).endMm<=(node.context??node.record.context).startMm+PRINT_RESOLUTION_MM)needs.add(other.key);
    }
    if(node.kind==='slice'&&!node.record.reference&&other.construction==='sleeve'&&other.part===node.part&&node.nominalRank>(other.context??other.record.context).endMm+PRINT_RESOLUTION_MM){
      requireThat((other.context?.assignment??other.record.spec.settings).endTransition==='level','Slices above a sleeve need its ending transition to be level.');needs.add(other.key);
    }
  }
  return [...needs];
}

  return {standardVaseResult,vaseFoundationSegments,vaseDependencies,
    prepareSleeveGeometry:input=>prepareSleeveGeometry(input,Geometry)};
}
