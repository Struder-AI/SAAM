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
  const {spiralStackCurve,traceResult,maximumPathAngle,strokeRange,publishFinishedBoundary}=Toolpath;

function standardVaseResult({assignment:settings,process,shell,geometry,after=settings.after}){
  const referenceStack=geometry.referenceStack();
  const curve=spiralStackCurve({referenceStack,firstHeightMm:geometry.firstHeight,widthMm:process.lineWidthMm,
    levelEnd:settings.endTransition==='level',sampleStepMm:settings.sampleStepMm,toleranceMm:settings.toleranceMm,
    speedMmS:geometry.speedMmS??Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS),role:geometry.role??'vase-wall'});
  const {profile,notes:stackNotes,...centerline}=curve,levelTop=settings.endTransition==='level';
  const traced=traceResult({id:settings.id,filament:settings.filament,after},{process,sequential:false,batches:[{
    ...geometry.batch,key:geometry.batch?.key??'wall',curves:[centerline],phase:geometry.batch?.phase??'vase-wall',layer:0,rank:geometry.start,
    fanPercent:process.fanPercent,trimEnd:levelTop,travel:{kind:'auto'}}]});
  const operations=traced.operations.map(operation=>({...operation,
    layerIndex:0,layerCount:referenceStack.layers.length,stackDirection:referenceStack.direction??[0,0,1]}));
  const strokes=operations.flatMap(operation=>operation.strokes);
  const rim=strokes.find(stroke=>stroke.segmentMetadata?.some(metadata=>metadata.boundaryRole==='rim'));
  const terminal=rim?.segmentMetadata.findIndex(metadata=>metadata.boundaryRole==='rim');
  const levelBoundary=levelTop&&geometry.terminalBoundary!==false?{zMm:geometry.end,widthMm:process.lineWidthMm,strokes:[strokeRange(rim??strokes[0],terminal)]}:null;
  const notes=[...(traced.report.notes??[]),...stackNotes];
  const result={...traced,operations,referenceStack,stackId:settings.id,...(levelBoundary?{levelBoundary}:{}),report:{...traced.report,
    owner:settings.id,part:settings.part,construction:'sleeve',depositionFamily:'trace',extension:'vase-wall',startMm:geometry.start,endMm:geometry.end,baseTopMm:geometry.base,
    turns:profile?.turns??0,spiralTurns:profile?.risingTurns??0,endTransition:settings.endTransition,levelRimMm:levelBoundary?geometry.end:null,
    points:centerline.points.length,speedMmS:curve.speedMmS??null,maximumAngleDeg:maximumPathAngle(centerline.points),...geometry.report(),
    ...(notes.length?{notes}:{})}};
  return settings.meshSleeve?result:publishFinishedBoundary(result,{shell,boundary:'side',startMm:geometry.base,
    endMm:geometry.end-(settings.endTransition==='level'?0:process.layerMm),toleranceMm:settings.boundaryToleranceMm});
}

  return {standardVaseResult,
    prepareSleeveGeometry:input=>prepareSleeveGeometry(input,Geometry)};
}
