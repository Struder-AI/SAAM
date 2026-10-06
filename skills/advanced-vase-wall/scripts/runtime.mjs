// Authored sleeve pattern and Trace composition over named public operations.
// Numerical contour and fitted-reference construction belongs to Geometry.
export function advancedVaseRuntime({Geometry,Toolpath},vase){
  const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const {sampleCurveIntervals}=Geometry;
  const {maximumPathAngle,traceResult,contactCurveGaps}=Toolpath;
// A pattern is a stack of repeats in unwrapped strip coordinates [turns,
// height mm, depth mm]. A turns pattern repeats its tile by a fixed advance. A
// sized pattern makes each turn one repeat holding the whole number of tiles
// nearest its perimeter, spaced evenly from the seam: tiles keep their arc
// width to within half a tile per turn, and the turn where the count changes
// re-spaces its tiles, shifting them against the turn below by at most half a
// tile (most opposite the seam). Height above the rising turn is unchanged.
function patternStack(pattern,perimeterAt){
  const paths=pattern.paths.map(path=>({
    vertices:path.points.map((p,i)=>[...p,Array.isArray(path.offsetMm)?path.offsetMm[i]:path.offsetMm??0]),
    heights:Array.isArray(path.beadHeightMm)?path.beadHeightMm:path.points.map(()=>path.beadHeightMm)
  }));
  if(!Object.hasOwn(pattern,'tileWidthMm'))return {repeats:pattern.repeats,advance:pattern.advance,tiles:Array(pattern.repeats).fill(paths),turns:null};
  const {tileWidthMm:width,riseMm:rise}=pattern,byCount=new Map();
  const turns=Array.from({length:pattern.turns},(_,turn)=>{
    const {zMm,perimeterMm}=perimeterAt(turn,rise);
    return {turn,zMm,perimeterMm,courses:Math.max(1,Math.round(perimeterMm/width))};
  });
  for(const {courses:n} of turns)if(!byCount.has(n))byCount.set(n,Array.from({length:n},(_,j)=>paths.map(path=>({heights:path.heights,
    vertices:path.vertices.map(([x,h,d])=>{const u=(j+x/width)/n;return [u,h+rise*u,d];})}))).flat());
  return {repeats:pattern.turns,advance:[1,rise],tiles:turns.map(turn=>byCount.get(turn.courses)),turns};
}
// Start/end courses are built in the regular reference strip, before flow
// mapping. The caps retain the selected pattern's advance and transverse shape.
function* patternCourses({repeats:count,advance,tiles},{level=false,spanMm,firstHeightMm,referenceLengthMm}){
  const rise=advance[1];
  if(!level){
    for(let repeat=0;repeat<count;repeat++)yield {repeat,paths:tiles[repeat].map(p=>({heights:p.heights,
      vertices:p.vertices.map(([u,z,d])=>[u+repeat*advance[0],z+repeat*rise,d])}))};
    return;
  }
  requireThat([spanMm,firstHeightMm,referenceLengthMm].every(v=>Number.isFinite(v)&&v>0),
    'Level pattern courses require a positive sleeve span, first bead height and reference perimeter.');
  const progressed=new Map();
  const progressOf=paths=>{
    if(progressed.has(paths))return progressed.get(paths);
    let length=0;const progress=[];
    for(const path of paths){
      const at=[length];
      for(let i=1;i<path.vertices.length;i++){
        const a=path.vertices[i-1],b=path.vertices[i];
        length+=Math.hypot((b[0]-a[0])*referenceLengthMm,b[1]-a[1],b[2]-a[2]);at.push(length);
      }
      progress.push(at);
      for(const [,z] of path.vertices)requireThat(z>=-1e-9&&z+(count-1)*rise<=spanMm+1e-9,
        'Level pattern courses exceed the selected sleeve height interval; adjust explicit path coordinates, advance or repetition count. No course was trimmed.');
    }
    progressed.set(paths,{progress,length});return progressed.get(paths);
  };
  const height=(repeat,z,t)=>{
    if(repeat<0)return 0;
    if(repeat>=count)return spanMm;
    if(count===1)return spanMm*t;
    const raw=z+repeat*rise;
    if(repeat===0)return raw*t;
    if(repeat===count-1)return raw+(spanMm-raw)*t;
    return raw;
  };
  for(let repeat=-1;repeat<=count;repeat++){
    const paths=tiles[Math.min(count-1,Math.max(0,repeat))],{progress,length}=progressOf(paths);
    yield {repeat,paths:paths.map((path,p)=>{
      const heights=[];
      const vertices=path.vertices.map(([u,z,d],i)=>{
        const t=progress[p][i]/length,current=height(repeat,z,t);
        const gap=repeat<0?firstHeightMm:current-height(repeat-1,z,t);
        requireThat(gap>=-1e-9,'Level pattern transition reverses the nominal course stack; revise the tile heights.');
        heights.push(path.heights[i]*Math.max(0,gap)/rise);
        return [u+repeat*advance[0],current,d];
      });
      return {vertices,heights};
    })};
  }
}
function mappedSleevePatternCurves({settings,process,base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm=0,onProgress}) {
  const pattern=settings.pattern;
  // A sized turn counts its tiles on the smooth centerline at mid-turn height,
  // the reference whose normalized arc the mapper's phase follows.
  const perimeterAt=(turn,rise)=>{
    const zMm=Math.min(end,start+(turn+.5)*rise),samples=Math.max(16,Math.ceil(referenceLengthMm/settings.sampleStepMm));
    const at=u=>mapping.reference?mapping.reference.pointAt(u,zMm,0):mapping.contours.at(u,zMm,0);
    let perimeterMm=0;
    for(let i=0,a=at(0);i<samples;i++){const b=at((i+1)%samples/samples);perimeterMm+=Math.hypot(b[0]-a[0],b[1]-a[1]);a=b;}
    return {zMm,perimeterMm};
  };
  const stack=patternStack(pattern,perimeterAt);
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
    paths.push({closed:false,points,heightsMm:segmentHeights,speedMmS:null,role,segmentMetadata:segmentHeights.map((_,i)=>({layer,...(foundation?{contactRole:'foundation'}:{}),...(level&&Math.abs(points[i][2]-end)<1e-8&&Math.abs(points[i+1][2]-end)<1e-8?{boundaryRole:'rim'}:{})}))});
    return points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
  };
  const total=stack.repeats+(level?2:0);let completed=0;
  onProgress?.({stage:'Mapping vase pattern courses',completed:0,total});
  for(const course of patternCourses(stack,{level,spanMm:end-start,firstHeightMm:firstHeight,referenceLengthMm})){
    const first=paths.length;let length=0;
    for(const {vertices,heights} of course.paths)length+=emitPath(vertices,heights,course.repeat+(level?2:1),course.repeat===(level?-1:0));
    // The minimum layer time applies to each repeat: a whole turn of a sized pattern.
    const speed=Math.min(process.planarSpeedMmS,process.firstLayerSpeedMmS,process.minimumLayerSeconds>0?length/process.minimumLayerSeconds:Infinity);
    for(let i=first;i<paths.length;i++)paths[i].speedMmS=speed;
    onProgress?.({stage:'Mapping vase pattern courses',completed:++completed,total});
  }
  // Reported to the program resolution, 1e-3 mm.
  const micro=v=>Math.round(v*1e3)/1e3;
  const runs=stack.turns?.filter((turn,i,all)=>!i||turn.courses!==all[i-1].courses).map(({turn,zMm,perimeterMm,courses})=>({turn,zMm:micro(zMm),perimeterMm:micro(perimeterMm),courses}));
  const widths=stack.turns?.reduce(([low,high],turn)=>[Math.min(low,turn.perimeterMm/turn.courses),Math.max(high,turn.perimeterMm/turn.courses)],[Infinity,-Infinity]);
  return {courses:[{key:'wall',layerIdSuffix:':pattern',phase:continuous?'vase-wall':'segmented-paths',layer:0,rank:minZ,curves:paths,join:{mode:continuous?'continuous':'separate'},fanPercent:process.fanPercent,trimEnd:level,travel:{kind:'clearance',clearanceZ:maxZ+process.liftMm,constant:true}}],
    levelBoundary:level?{zMm:end,widthMm:process.lineWidthMm,tailCount:stack.tiles.at(-1).length}:null,
    report:{mode:continuous?'continuous-sleeve-pattern':'segmented-sleeve-pattern',startMm:minZ,endMm:maxZ,baseTopMm:base,paths:paths.length,repeats:stack.repeats,
      ...(stack.turns?{sizedCourses:{tileWidthMm:pattern.tileWidthMm,courses:stack.turns.reduce((sum,turn)=>sum+turn.courses,0),
        courseWidthRangeMm:widths.map(micro),countChanges:runs,
        transition:'Each listed turn holds that many evenly spaced tiles from the seam until the next; a changed turn shifts its tiles against the turn below by up to half a tile, most opposite the seam.'}}:{}),
      points:count,endTransition:settings.endTransition,levelRimMm:level?end:null,...(level?{flatStartMm:start,boundaryCourses:2}:{}),maximumAngleDeg,maximumBeadHeightMm,
      scope:'Repeated tiles mapped to actual inset sleeve sections. Only supplied pattern strokes deposit, with nominal bead heights; arbitrary crossing contact and strength are not inferred.'}};
}
// The extension owns pattern repetition and boundary transitions.
// Trace receives only resolved spatial curves and their deposition settings.


function advancedVaseResult({shell,assignment,process,geometry,after=assignment.after,zStartMm=null,zEndMm=null,foundationSegments=[],maxBeadHeightMm=Infinity,substrateAdaptation=false,onProgress}){
  requireThat(assignment.pattern!==null,'Advanced vase requires an authored repeated pattern.');
  const reference=geometry??vase.prepareSleeveGeometry({shell,assignment,process,zStartMm,zEndMm,onProgress});
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


  return {advancedVaseResult};
}
