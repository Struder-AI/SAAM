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
    speedMmS:geometry.speedMmS??Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS),minimumTurnSeconds:geometry.minimumTurnSeconds??process.minimumLayerSeconds,role:geometry.role??'vase-wall'});
  // Layers that cannot spiral-join print as plain closed layerCurves, in height
  // order around the spiral run; with no joinable run, profile is null. The
  // spiral's level end is the wall's top only when no plain layer lies above it.
  const {profile,layerCurves,notes:stackNotes,...centerline}=curve,first=profile?centerline.segmentMetadata[0].layer:Infinity;
  const below=layerCurves.filter(item=>item.segmentMetadata[0].layer<first),above=layerCurves.filter(item=>item.segmentMetadata[0].layer>=first);
  const planned=[...below,...(profile?[centerline]:[]),...above],levelTop=Boolean(profile)&&!above.length&&settings.endTransition==='level';
  const curves=planned;
  const traced=traceResult({id:settings.id,filament:settings.filament,after},{process,batches:[{
    key:'wall',curves,join:{mode:'ordered'},layerId:settings.id+':continuous',phase:'vase-wall',layer:0,rank:geometry.start,
    ...(geometry.batch??{}),fanPercent:process.fanPercent,trimEnd:levelTop,travel:{kind:'clearance',clearanceZ:geometry.end+process.liftMm}}]});
  const operations=traced.operations.map(operation=>({...operation,layerIndex:0,layerCount:referenceStack.layers.length,stackDirection:referenceStack.direction??[0,0,1]}));
  const strokes=operations.flatMap(operation=>operation.strokes);
  const rim=strokes.find(stroke=>stroke.segmentMetadata?.some(metadata=>metadata.boundaryRole==='rim'));
  const terminal=rim?.segmentMetadata.findIndex(metadata=>metadata.boundaryRole==='rim');
  const levelBoundary=levelTop&&geometry.terminalBoundary!==false?{zMm:geometry.end,widthMm:process.lineWidthMm,strokes:[strokeRange(rim??strokes[0],terminal)]}:null;
  // A rising end leaves the top one layer low toward its seam; material printed above rests on it.
  const risingEnd=profile&&settings.endTransition!=='level'&&above.length
    ?[`Vase wall ${settings.id}: plain layers above the spiral (${[...new Set(above.flatMap(item=>item.segmentMetadata.map(metadata=>metadata.layer)))].join(', ')}) rest on its rising end, up to one layer (${process.layerMm} mm) low toward the seam. A level end gives a flat top.`]:[];
  const notes=[...(traced.report.notes??[]),...stackNotes,...risingEnd];
  const result={...traced,operations,referenceStack,stackId:settings.id,...(levelBoundary?{levelBoundary}:{}),report:{...traced.report,
    owner:settings.id,part:settings.part,construction:'sleeve',depositionFamily:'trace',extension:'vase-wall',startMm:geometry.start,endMm:geometry.end,baseTopMm:geometry.base,
    turns:profile?.turns??0,spiralTurns:profile?.risingTurns??0,endTransition:settings.endTransition,levelRimMm:levelBoundary?geometry.end:null,
    points:planned.reduce((sum,item)=>sum+item.points.length,0),speedMmS:curve.speedMmS??null,maximumAngleDeg:Math.max(0,...planned.map(item=>maximumPathAngle(item.points))),...geometry.report(),
    ...(notes.length?{notes}:{})}};
  return settings.meshSleeve?result:publishFinishedBoundary(result,{shell,boundary:'side',startMm:geometry.base,
    endMm:geometry.end-(settings.endTransition==='level'?0:process.layerMm),toleranceMm:settings.boundaryToleranceMm});
}

function vaseDependencies(node,nodes){
  const needs=new Set(),notes=[];
  for(const other of nodes){
    if(other===node)continue;
    if(node.construction==='sleeve'&&other.part===node.part){
      if(other.kind==='slice'&&!other.reference&&other.rank<=node.startMm+PRINT_RESOLUTION_MM||other.construction==='sleeve'&&other.endMm<=node.startMm+PRINT_RESOLUTION_MM)needs.add(other.key);
    }
    // Slices above a sleeve print after it, on its level or rising end (the sleeve's result notes a rising one).
    if(node.kind==='slice'&&!node.reference&&other.construction==='sleeve'&&other.part===node.part&&node.rank>other.endMm+PRINT_RESOLUTION_MM){
      needs.add(other.key);
      const context=other;
      if(context.assignment.endTransition!=='level')notes.push(`Slice ${node.sourceId} layer ${node.index} prints above vase wall ${other.sourceId}'s rising end at Z ${context.endMm} mm, up to one layer (${context.process.layerMm} mm) low toward its seam. A level end gives a flat top.`);
    }
  }
  return {dependencies:[...needs],notes};
}

  return {standardVaseResult,vaseDependencies,
    prepareSleeveGeometry:input=>prepareSleeveGeometry(input,Geometry)};
}
