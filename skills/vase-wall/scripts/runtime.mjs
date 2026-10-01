// Standard continuous wall composition over public Toolpath operations.
export function vaseWallRuntime({Toolpath}) {
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
  const {joinSliceFamily,maximumPathAngle,strokeRange,publishFinishedBoundary}=Toolpath;

function standardVaseResult(record,{foundationSegments=[],substrateAdaptation=false}={}){
  const {process,shell,geometry,maxBeadHeightMm}=record.context,settings=record.spec.settings;
  const joined=joinSliceFamily({id:record.spec.id,family:record.family,process,filament:record.spec.filament,
    firstHeightMm:geometry.firstHeight,levelEnd:settings.endTransition==='level',sampleStepMm:settings.sampleStepMm,toleranceMm:settings.toleranceMm,
    speedMmS:Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS),minimumTurnSeconds:process.minimumLayerSeconds,
    course:{key:'wall',join:{mode:'ordered'},layerId:record.spec.id+':continuous',phase:'vase-wall',layer:0,rank:geometry.start,fanPercent:process.fanPercent,trimEnd:settings.endTransition==='level',travel:{kind:'clearance',clearanceZ:geometry.end+process.liftMm}},
    role:'vase-wall',foundationSegments:substrateAdaptation?foundationSegments:[],maxBeadHeightMm});
  const strokes=joined.operations.flatMap(operation=>operation.strokes),curve=joined.curve;
  const terminal=strokes.flatMap(stroke=>stroke.segmentMetadata.flatMap((metadata,index)=>metadata.boundaryRole==='rim'?[index]:[]))[0];
  const levelBoundary=settings.endTransition==='level'?{zMm:geometry.end,widthMm:process.lineWidthMm,
    strokes:[strokeRange(strokes[0],terminal)]}:null;
  const report={...record.context.report,depositionFamily:'slice',startMm:geometry.start,endMm:geometry.end,baseTopMm:geometry.base,
    turns:curve.profile.turns,spiralTurns:curve.profile.risingTurns,endTransition:settings.endTransition,levelRimMm:levelBoundary?geometry.end:null,
    points:curve.points.length,speedMmS:curve.speedMmS,maximumAngleDeg:maximumPathAngle(curve.points),...geometry.report(),
    volumeMm3:strokes.reduce((sum,stroke)=>sum+stroke.volumesMm3.reduce((a,b)=>a+b,0),0),
    scope:'One outer section with arc-length correspondence from a fixed projected seam; concavity is supported while the inset remains one loop. Sampled topology and boundary checks; no physical validation.'};
  const result={id:record.spec.id,operations:joined.operations,family:record.family,familyId:record.familyId,report,...(levelBoundary?{levelBoundary}:{})};
  return settings.meshSleeve?result:publishFinishedBoundary(result,{shell,boundary:'side',startMm:geometry.base,endMm:geometry.end-(settings.endTransition==='level'?0:process.layerMm),toleranceMm:settings.boundaryToleranceMm});
}

function standardVaseContexts(boundaryAssignments){
  const contexts=[];
  for(const {assignment,shell,process,geometry} of boundaryAssignments){
    requireThat(geometry,'A boundary family needs prepared geometry from its producer.');
    const id=assignment.id;
    const family={...geometry.family(),constructTogether:true};
    contexts.push({spec:{id,settings:assignment,layers:family.layers,filament:assignment.filament},
      context:{shell,process,geometry,startMm:geometry.base,endMm:geometry.end,
        maxBeadHeightMm:Infinity,
        report:{owner:id,part:assignment.part,construction:'sleeve'}},
      owner:{id,assignment,part:assignment.part},familyId:id,family,
      layerOrder:[{index:null,rank:geometry.end}]});
  }

  return contexts;
}

  return {standardVaseResult,standardVaseContexts};
}