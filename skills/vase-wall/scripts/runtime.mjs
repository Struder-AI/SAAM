// Standard continuous wall composition over public Toolpath operations.
export function prepareSleeveGeometry({shell,assignment,process,zStartMm=null,zEndMm=null,onProgress},{prepareContourSleeve}){
  const base=zStartMm??shell.bounds.min[2]+assignment.zStartMm;
  const firstHeight=Math.abs(base-shell.bounds.min[2])<1e-9?process.firstLayerMm:process.layerMm;
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
  const {joinSliceFamily,maximumPathAngle,strokeRange,publishFinishedBoundary,depositedBeadSegments}=Toolpath;

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

function vaseFoundationSegments({node,samePart,substrateAdaptation}){
  const context=node.context??node.record.context,assignment=node.context?.assignment??node.record.spec.settings;
  const foundations=samePart.filter(item=>item.node.nominalRank<=context.startMm+1e-8);
  if(assignment.zStartMm>0){
    const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
    requireThat(Math.abs(grid-Math.round(grid))<1e-8,'A raised sleeve must start on its resolved process layer grid.');
    requireThat(foundations.some(item=>item.result.operations.length),'A raised sleeve needs supporting deposition below its start.');
  }
  return substrateAdaptation&&assignment.zStartMm>0?depositedBeadSegments(foundations.flatMap(item=>item.result.operations),{widthMm:context.process.lineWidthMm}):[];
}

function vaseDependencies(node,nodes){
  const needs=new Set();
  for(const other of nodes){
    if(other===node)continue;
    if(node.construction==='sleeve'&&other.part===node.part){
      if(other.kind==='slice'&&!other.record.reference&&other.nominalRank<=(node.context??node.record.context).startMm+1e-8||other.construction==='sleeve'&&(other.context??other.record.context).endMm<=(node.context??node.record.context).startMm+1e-8)needs.add(other.key);
    }
    if(node.kind==='slice'&&!node.record.reference&&other.construction==='sleeve'&&other.part===node.part&&node.nominalRank>(other.context??other.record.context).endMm+1e-8){
      requireThat((other.context?.assignment??other.record.spec.settings).endTransition==='level','Slices above a sleeve need its ending transition to be level.');needs.add(other.key);
    }
  }
  return [...needs];
}

  return {standardVaseResult,standardVaseContexts,vaseFoundationSegments,vaseDependencies,
    prepareSleeveGeometry:input=>prepareSleeveGeometry(input,Geometry)};
}
