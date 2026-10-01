// Authored sleeve pattern and Trace composition over named public operations.
// Numerical contour and fitted-reference construction belongs to Geometry.
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

export function advancedVaseRuntime({Geometry,Toolpath},vase){
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const {sampleCurveIntervals}=Geometry;
  const {maximumPathAngle,traceResult,contactCurveGaps,depositedBeadSegments}=Toolpath;
// Start/end courses are built in the regular reference strip, before flow
// mapping. The caps retain the selected pattern's advance and transverse shape.


function* patternCourses(pattern,{level=false,spanMm,firstHeightMm,referenceLengthMm}){
  const rise=pattern.advance[1],count=pattern.repeats;
  const paths=pattern.paths.map(path=>({
    vertices:path.points.map((p,i)=>[...p,Array.isArray(path.offsetMm)?path.offsetMm[i]:path.offsetMm??0]),
    heights:Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm)
  }));
  if(!level){
    for(let repeat=0;repeat<count;repeat++)yield {repeat,paths:paths.map(p=>({heights:p.heights,
      vertices:p.vertices.map(([u,z,d])=>[u+repeat*pattern.advance[0],z+repeat*rise,d])}))};
    return;
  }
  requireThat([spanMm,firstHeightMm,referenceLengthMm].every(v=>Number.isFinite(v)&&v>0),
    'Level pattern courses require a positive sleeve span, first bead height and reference perimeter.');
  let length=0;
  for(const path of paths){
    path.progress=[length];
    for(let i=1;i<path.vertices.length;i++){
      const a=path.vertices[i-1],b=path.vertices[i];
      length+=Math.hypot((b[0]-a[0])*referenceLengthMm,b[1]-a[1],b[2]-a[2]);path.progress.push(length);
    }
    for(const [,z] of path.vertices)requireThat(z>=-1e-9&&z+(count-1)*rise<=spanMm+1e-9,
      'Level pattern courses exceed the selected sleeve height interval; adjust explicit path coordinates, advance or repetition count. No course was trimmed.');
  }
  const height=(repeat,z,t)=>{
    if(repeat<0)return 0;
    if(repeat>=count)return spanMm;
    if(count===1)return spanMm*t;
    const raw=z+repeat*rise;
    if(repeat===0)return raw*t;
    if(repeat===count-1)return raw+(spanMm-raw)*t;
    return raw;
  };
  for(let repeat=-1;repeat<=count;repeat++)yield {repeat,paths:paths.map(path=>{
    const heights=[];
    const vertices=path.vertices.map(([u,z,d],i)=>{
      const t=path.progress[i]/length,current=height(repeat,z,t);
      const gap=repeat<0?firstHeightMm:current-height(repeat-1,z,t);
      requireThat(gap>=-1e-9,'Level pattern transition reverses the nominal course stack; revise the tile heights.');
      heights.push(path.heights[i]*Math.max(0,gap)/rise);
      return [u+repeat*pattern.advance[0],current,d];
    });
    return {vertices,heights};
  })};
}
function mappedSleevePatternCurves({settings,process,base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm=0,onProgress}) {
  const pattern=settings.pattern;
  const continuous=settings.pathMode==='continuous',role=continuous?'vase-wall':'segmented-path';
  // Every course is authored and finite, and each mapped interval subdivides
  // until its tolerance is met or its midpoint stops being distinct from its
  // ends, so the pattern takes the points its tolerances need.
  const level=settings.endTransition==='level',paths=[];let count=0,maximumAngleDeg=0,minZ=Infinity,maxZ=-Infinity,maximumBeadHeightMm=0;
  const emitPath=(vertices,heights,layer,foundation)=>{
    const at=(a,b,t)=>{
      const u=a[0]+(b[0]-a[0])*t,z=start+a[1]+(b[1]-a[1])*t;
      requireThat(z>=start-1e-9&&z<=end+1e-9,'Mapped pattern exceeds its selected sleeve height interval; adjust repeats, advance or tile heights.');
      const depth=(a[2]??0)+((b[2]??0)-(a[2]??0))*t;
      return mapping.reference?mapping.reference.map(mapping.reference.pointAt(u,z,depth)):[...mapping.contours.at(u,z,depth),z];
    };
    const points=[at(vertices[0],vertices[0],0)],segmentHeights=[];
    count++;
    for(let i=1;i<vertices.length;i++) {
      const a=vertices[i-1],b=vertices[i],ha=heights[i-1],hb=heights[i];
      // Bound angular progress before adaptive mapping; full turns must not alias.
      const pieces=Math.max(1,Math.ceil(Math.abs(b[0]-a[0])*16));
      const samples=sampleCurveIntervals({at:t=>({point:at(a,b,t),chart:a.map((v,k)=>v+(b[k]-v)*t)}),
        cuts:Array.from({length:pieces+1},(_,j)=>j/pieces),stepMm:settings.sampleStepMm,toleranceMm:settings.toleranceMm/2-2*mappingErrorMm,
        chartSteps:[1/16,settings.minFeatureMm/2]});
      for(let j=1;j<samples.length;j++){
        count++;points.push(samples[j].point);
        // Only the authored pattern deposits; the guide supplies no material.
        const h=ha+(hb-ha)*(samples[j-1].t+samples[j].t)/2;
        requireThat(level?h>=0:h>0,'Pattern segments must deposit material.');
        maximumBeadHeightMm=Math.max(maximumBeadHeightMm,h);segmentHeights.push(h);
      }
    }
    if(continuous&&paths.length)requireThat(distance(paths.at(-1).points.at(-1),points[0])<=1e-9,'Mapped vase endpoints do not meet; use segmented mode for travel.');
    maximumAngleDeg=Math.max(maximumAngleDeg,maximumPathAngle(points));
    for(const p of points){minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);}
    const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
    const speed=Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS,process.minimumLayerSeconds>0?length/process.minimumLayerSeconds:Infinity);
    paths.push({closed:false,points,heightsMm:segmentHeights,speedMmS:speed,role,segmentMetadata:segmentHeights.map((_,i)=>({layer,...(foundation?{contactRole:'foundation'}:{}),...(level&&Math.abs(points[i][2]-end)<1e-8&&Math.abs(points[i+1][2]-end)<1e-8?{boundaryRole:'rim'}:{})}))});
  };
  const total=pattern.repeats+(level?2:0);let completed=0;
  onProgress?.({stage:'Mapping vase pattern courses',completed:0,total});
  for(const course of patternCourses(pattern,{level,spanMm:end-start,firstHeightMm:firstHeight,referenceLengthMm})){
    for(const {vertices,heights} of course.paths)emitPath(vertices,heights,course.repeat+(level?2:1),course.repeat===(level?-1:0));
    onProgress?.({stage:'Mapping vase pattern courses',completed:++completed,total});
  }
  return {courses:[{key:'wall',layerIdSuffix:':pattern',phase:continuous?'vase-wall':'segmented-paths',layer:0,rank:minZ,curves:paths,join:{mode:continuous?'continuous':'separate'},fanPercent:process.fanPercent,trimEnd:level,travel:{kind:'clearance',clearanceZ:maxZ+process.liftMm,constant:true}}],
    levelBoundary:level?{zMm:end,widthMm:process.lineWidthMm,tailCount:pattern.paths.length}:null,
    report:{mode:continuous?'continuous-sleeve-pattern':'segmented-sleeve-pattern',startMm:minZ,endMm:maxZ,baseTopMm:base,paths:paths.length,repeats:pattern.repeats,
      points:count,endTransition:settings.endTransition,levelRimMm:level?end:null,...(level?{flatStartMm:start,boundaryCourses:2}:{}),maximumAngleDeg,maximumBeadHeightMm,
      scope:'Repeated tiles mapped to actual inset sleeve sections. Only supplied pattern strokes deposit, with nominal bead heights; arbitrary crossing contact and strength are not inferred.'}};
}
// The extension owns fitting, pattern repetition and boundary transitions.
// Trace receives only resolved spatial curves and their deposition settings.


function advancedVaseResult({shell,assignment,process,geometry,after=assignment.after,zStartMm=null,zEndMm=null,foundationSegments=[],maxBeadHeightMm=Infinity,substrateAdaptation=false,onProgress}){
  requireThat(assignment.pattern!==null,'Advanced vase requires an authored repeated pattern.');
  const reference=geometry??prepareSleeveGeometry({shell,assignment,process,zStartMm,zEndMm,onProgress},Geometry);
  const {base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm}=reference;
  const mapped=mappedSleevePatternCurves({settings:assignment,process,base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm,onProgress});
  const parts=[];
  for(const {layerIdSuffix,...source} of mapped.courses){
    const curves=substrateAdaptation&&foundationSegments.length?contactCurveGaps(source.curves,{segments:foundationSegments,maxHeightMm:maxBeadHeightMm}):source.curves;
    const course={...source,curves,layerId:assignment.id+layerIdSuffix};
    parts.push(traceResult({id:assignment.id,filament:assignment.filament,after:parts.at(-1)?.operations.map(op=>op.id)??after},{courses:[course],process}));
  }
  const operations=parts.flatMap(part=>part.operations),strokes=operations.flatMap(op=>op.strokes),level=mapped.levelBoundary;
  const measures=Object.fromEntries(['strokes','lengthMm','volumeMm3'].map(key=>[key,parts.reduce((sum,part)=>sum+part.report[key],0)]));
  return {id:assignment.id,operations,family:{...reference.family(),name:`${assignment.id} sleeve`},
    report:{...mapped.report,...reference.report(),construction:'sleeve',part:assignment.part,depositionFamily:'trace',extension:'advanced-vase-wall',...measures},
    ...(level?{levelBoundary:{zMm:level.zMm,widthMm:level.widthMm,strokes:strokes.slice(-level.tailCount)}}:{})};
}


function constructVaseWork({node,samePart,after,onProgress,substrateAdaptation,standardVaseResult}){
  const context=node.context??node.record.context,assignment=node.context?.assignment??node.record.spec.settings;
  const foundations=samePart.filter(item=>item.node.nominalRank<=context.startMm+1e-8);
  if(assignment.zStartMm>0){
    const grid=(assignment.zStartMm-context.process.firstLayerMm)/context.process.layerMm;
    requireThat(Math.abs(grid-Math.round(grid))<1e-8,'A raised sleeve must start on its resolved process layer grid.');
    requireThat(foundations.some(item=>item.result.operations.length),'A raised sleeve needs supporting deposition below its start.');
  }
  const foundationSegments=substrateAdaptation&&assignment.zStartMm>0?depositedBeadSegments(foundations.flatMap(item=>item.result.operations),{widthMm:context.process.lineWidthMm}):[];
  return node.kind==='slice'?standardVaseResult(node.record,{foundationSegments,substrateAdaptation}):advancedVaseResult({...context,after,onProgress,foundationSegments,substrateAdaptation});
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

  return {prepareSleeveGeometry:input=>prepareSleeveGeometry(input,Geometry),advancedVaseResult,
    constructVaseWork:args=>constructVaseWork({...args,standardVaseResult:vase.standardVaseResult}),vaseDependencies};
}
