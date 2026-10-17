// Scheduling interprets conservative curve bounds and actual contact witnesses.
// Geometry owns numerical section, convex-volume and continuous-sweep operations.
import {prepareCurvePath,curveRange,curveAt} from './curve-path.mjs';
import {convexSupport,convexIntersects,convexSpatialIndex,DEFAULT_NOZZLE_GEOMETRY,NOZZLE_FORGIVENESS_MM,nozzleSideOffsetMm,nozzleReferenceFloorMm,
  convexBounds,convexBox,nozzleBoundsClear,rectangularSection,rectangularSweepEnvelope,nozzleCurveEnvelope,nozzleAt,nozzleSweepReach,
  nozzleIntervalIntersects,translationContactInterval,referenceHeightGraph,sectionNormalProjectionBound,movingAxisSupportBound,movingSectionBounds} from '../geom/convex-clearance.mjs';
import {add,scale,dot,cross,subtract,length,requireThat} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {frameCone} from '../geom/curve-query.mjs';

const equalVector=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function constantVector(profile,select=value=>value){
  if(!profile?.knots)return select(profile);
  const first=select(profile.knots[0][1]);
  return profile.knots.every(([,value])=>equalVector(first,select(value)))?first:null;
}

// Positive rational weights keep NURBS within their control hull. We use that
// hull only as a bound, never as deposited material or a collision witness.
function controlVertices(geometry){
  if(geometry.kind==='polyline')return geometry.points;
  if(geometry.kind==='nurbs')return geometry.controlPoints;
  return null;
}

function graphNozzleProofs(source,reader,rangeOf,nozzleGeometry){
  const {includedAngleDeg,tipDiameterMm}=nozzleGeometry;
  const first=Object.values(source.operations).find(op=>op.kind==='deposit'),course=first?.courses[0];
  if(!course)return null;
  const firstAxis=scale(curveAt(reader,course.curveId,course.from).pose.toolAxis,-1),average=[0,0,0];
  for(const operation of Object.values(source.operations))for(const curve of operation.courses??[]){
    const outward=curveAt(reader,curve.curveId,(curve.from+curve.to)/2).pose.toolAxis;
    for(let k=0;k<3;k++)average[k]-=outward[k];
  }
  const axis=length(average)>ROUNDING_RELATIVE?scale(average,1/length(average)):firstAxis;
  let graph=null;
  for(const surface of Object.values(source.surfaces)){graph=referenceHeightGraph(surface.referencePatch??surface.patch,axis);if(graph)break;}
  // A linear projection is a numerical reference field even without native
  // surfaces. Actual source controls bound it; it assigns no slice identity.
  if(!graph||!Number.isFinite(graph.slope)||graph.slope>=1/Math.tan(includedAngleDeg*Math.PI/360))
    graph=referenceHeightGraph({kind:'linear'},axis);
  const curves=new Map(),frames=new Map(),projections=new Map(),courses=new Map(),slices=new Map(),metric=Math.hypot(1,graph.slope);
  function frameFloor(curveId){
    if(frames.has(curveId))return frames.get(curveId);
    const curve=source.curves[curveId];if(curve.geometry.kind!=='polyline'){frames.set(curveId,-1);return -1;}
    const points=curve.geometry.points,lengths=[0];
    for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+length(subtract(points[i],points[i-1])));
    const cuts=[...new Set([...lengths.map(v=>v/lengths.at(-1)),...(curve.profiles.materialNormal.knots??[]).map(([u])=>u)])].sort((a,b)=>a-b);
    let cosine=1;
    for(let i=1;i<cuts.length;i++){
      const a=curveAt(reader,curveId,cuts[i-1]),b=curveAt(reader,curveId,cuts[i],{side:'left'});
      if(!a.tangent){cosine=-1;break;}
      cosine=Math.min(cosine,sectionNormalProjectionBound(a.tangent,a.materialNormal,b.materialNormal,graph.axis));
    }
    frames.set(curveId,cosine);return cosine;
  }
  for(const operation of Object.values(source.operations)){
    if(operation.kind!=='deposit')continue;
    for(const course of operation.courses){
      if(!curves.has(course.curveId))curves.set(course.curveId,graph.curveBounds(source.curves[course.curveId].geometry));
      const residual=curves.get(course.curveId);if(!residual)continue;
      const range=rangeOf(course);if(!range.widthMm||!range.areaMm2)continue;
      const cosine=frameFloor(course.curveId),sine=cosine>=0?Math.sqrt(Math.max(0,1-cosine*cosine)):1;
      const side=range.widthMm[1]/2*Math.min(metric,sine+graph.slope);
      const inward=cosine-graph.slope*sine,depth=[range.areaMm2[0]/range.widthMm[1],range.areaMm2[1]/range.widthMm[0]];
      const low=residual[0]-side-depth[1]*metric;
      const high=residual[1]+side-Math.min(0,inward*depth[1]);
      const underHigh=residual[1]+side-(inward>=0?depth[0]:depth[1])*inward+PRINT_RESOLUTION_MM*metric;
      const reference=scale(range.poseCone.reference.toolAxis,-1),deviation=Math.acos(Math.max(-1,Math.min(1,dot(reference,graph.axis))))+range.poseCone.halfAngleRad;
      const tip=residual[0]+nozzleReferenceFloorMm(Math.cos(Math.min(Math.PI,deviation)),graph.slope,includedAngleDeg,NOZZLE_FORGIVENESS_MM,tipDiameterMm);
      const value={min:low,max:high,topMin:residual[0]-side,underHigh,tip,cosine,curveId:course.curveId};courses.set(course.id,value);
      if(operation.layerId!==null){
        if(!slices.has(operation.layerId))slices.set(operation.layerId,{min:Infinity,max:-Infinity,tip:Infinity});
        const slice=slices.get(operation.layerId);slice.min=Math.min(slice.min,value.min);slice.max=Math.max(slice.max,value.max);slice.tip=Math.min(slice.tip,value.tip);
      }
    }
  }
  // Atomic occupied solids and unsupported curves cannot inherit a proof from
  // another moving course in the same source layer.
  for(const op of Object.values(source.operations))if(op.layerId!==null&&(op.kind!=='deposit'||op.occupied||op.courses.some(c=>!courses.has(c.id))))slices.delete(op.layerId);
  const clear=(a,b)=>Boolean(a&&b&&a.tip>b.max+ROUNDING_MM),sweepTips=new WeakMap();
  function sweepTip(sweep){
    if(sweepTips.has(sweep))return sweepTips.get(sweep);
    let tip=-Infinity;
    if(sweep.fixed&&sweep.motion&&!(sweep.margin>0)){
      const motion=sweep.motion,at=t=>motion.from.map((v,k)=>v+(motion.to[k]-v)*t);
      const bounds=graph.curveBounds({kind:'polyline',points:[at(sweep.t0??0),at(sweep.t1??1)]});
      tip=bounds[0]+nozzleReferenceFloorMm(dot(sweep.body.normal,graph.axis),graph.slope,motion.includedAngleDeg,motion.forgivenessMm,motion.tipDiameterMm);
    }
    sweepTips.set(sweep,tip);return tip;
  }
  return {slope:graph.slope,courses:courses.size,frameBounds(id){
      const course=courses.get(id);if(!course)return null;
      if(!projections.has(course.curveId)){
        const vertices=controlVertices(source.curves[course.curveId].geometry);let lo=Infinity,hi=-Infinity;
        for(const point of vertices){const value=dot(point,graph.axis);lo=Math.min(lo,value);hi=Math.max(hi,value);}
        projections.set(course.curveId,[lo-ROUNDING_MM*4,hi+ROUNDING_MM*4]);
      }
      return {axis:graph.axis,halfAngleRad:Math.acos(Math.max(-1,Math.min(1,course.cosine))),projection:projections.get(course.curveId)};
    },
    sweepClear:(sweep,unit)=>unit.operation.kind==='deposit'&&!unit.operation.occupied&&unit.ranges.every(ref=>{const material=courses.get(ref.id);return material&&sweepTip(sweep)>material.max+ROUNDING_MM;}),
    clear:(a,b)=>clear(slices.get(a),slices.get(b)),
    unitClear:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&
      a.ranges.every(x=>b.ranges.every(y=>clear(courses.get(x.id),courses.get(y.id)))),
    topApart:(a,b)=>{const p=courses.get(a),q=courses.get(b);return Boolean(p&&q&&q.topMin>p.underHigh+PRINT_RESOLUTION_MM*metric*2);},
    // If material touches the underside but its top is D higher in this
    // Lipschitz field, the contact lies at least D/metric inward from that
    // top. Coherent section normals therefore put the candidate's highest
    // projection above the near-level support band as well. This excludes
    // both support alternatives; lower-body overlap alone is not substrate.
    supportApart:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&a.ranges.every(x=>b.ranges.every(y=>{
      const p=courses.get(x.id),q=courses.get(y.id);if(!p||!q||p.cosine<=0||q.cosine<=0)return false;
      const mutual=p.cosine*q.cosine-Math.sqrt(Math.max(0,1-p.cosine*p.cosine))*Math.sqrt(Math.max(0,1-q.cosine*q.cosine));
      return mutual>0&&q.topMin-p.underHigh>PRINT_RESOLUTION_MM*8*metric/mutual;
    })),
    materialApart:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&a.ranges.every(x=>b.ranges.every(y=>{
      const p=courses.get(x.id),q=courses.get(y.id);return p&&q&&(p.max+PRINT_RESOLUTION_MM*metric<q.min||q.max+PRINT_RESOLUTION_MM*metric<p.min);
    }))};
}

function sphereNozzleProofs(source,reader,rangeOf,nozzleGeometry){
  const {includedAngleDeg,tipDiameterMm}=nozzleGeometry;
  const axes=Object.values(source.curves).map(curve=>constantVector(curve.profiles.pose,p=>p.toolAxis));
  if(axes.length&&axes[0]&&axes.every(axis=>axis&&equalVector(axis,axes[0])))return null;
  const vertices=Object.values(source.curves).flatMap(curve=>controlVertices(curve.geometry)??[]);
  if(!vertices.length)return null;
  const bounds=convexBounds({vertices}),center=bounds.min.map((v,k)=>(v+bounds.max[k])/2),courses=new Map();
  const halfAngle=includedAngleDeg*Math.PI/360,retreat=nozzleReferenceFloorMm(1,0,includedAngleDeg,NOZZLE_FORGIVENESS_MM,tipDiameterMm);
  const first=Object.values(source.operations).find(op=>op.kind==='deposit')?.courses[0];
  const up=first?curveAt(reader,first.curveId,first.from).pose.toolUp:null,unitUp=up?scale(up,1/length(up)):null;
  for(const operation of Object.values(source.operations))for(const course of operation.courses??[]){
    const curve=source.curves[course.curveId];if(curve.geometry.kind!=='polyline')continue;
    const points=curve.geometry.points,lengths=[0];let radius=0;
    for(let i=0;i<points.length;i++){radius=Math.max(radius,length(subtract(points[i],center)));if(i)lengths.push(lengths.at(-1)+length(subtract(points[i],points[i-1])));}
    const cuts=[...new Set([...lengths.map(v=>v/lengths.at(-1)),...(curve.profiles.pose.knots??[]).map(([u])=>u),...(curve.profiles.materialNormal.knots??[]).map(([u])=>u)])].sort((a,b)=>a-b);
    const range=rangeOf(course);if(!range.areaMm2)continue;
    const width=range.widthMm[1]/2,depth=range.areaMm2[1]/range.widthMm[0],fixedUp=constantVector(curve.profiles.pose,p=>p.toolUp);
    const planar=unitUp&&fixedUp&&(equalVector(fixedUp,up)||equalVector(fixedUp,scale(up,-1)));
    let support=Infinity,materialRadius=0,lo=Infinity,hi=-Infinity,tipLo=Infinity,tipHi=-Infinity,positionMin=Infinity,topMin=Infinity,underMax=0,cosine=1;
    for(let i=1;i<cuts.length;i++){
      const a=curveAt(reader,course.curveId,cuts[i-1]),b=curveAt(reader,course.curveId,cuts[i],{side:'left'}),angle=frameCone([a.pose,b.pose]).halfAngleRad;
      support=Math.min(support,movingAxisSupportBound(a.point,b.point,a.pose,b.pose,angle,center));
      const section=a.tangent&&movingSectionBounds(a.point,b.point,a.tangent,a.materialNormal,b.materialNormal,width,[range.areaMm2[0]/range.widthMm[1],depth],center,unitUp);
      materialRadius=Math.max(materialRadius,section?.radius??radius+width+depth);
      positionMin=Math.min(positionMin,section?.positionRadiusMin??0);topMin=Math.min(topMin,section?.topRadiusMin??-Infinity);
      underMax=Math.max(underMax,section?.underRadiusMax??Infinity);cosine=Math.min(cosine,section?.normalCosine??-1);
      lo=Math.min(lo,section?.projection[0]??-Infinity);hi=Math.max(hi,section?.projection[1]??Infinity);
      tipLo=Math.min(tipLo,dot(a.point,unitUp),dot(b.point,unitUp));tipHi=Math.max(tipHi,dot(a.point,unitUp),dot(b.point,unitUp));
    }
    courses.set(course.id,{tip:support+retreat,support,material:materialRadius,projection:[lo,hi],tipProjection:[tipLo,tipHi],planar,positionMin,topMin,underMax,cosine,extent:width+depth});
  }
  return {courses:courses.size,supportApart:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&a.ranges.every(x=>b.ranges.every(y=>{
    const p=courses.get(x.id),q=courses.get(y.id);if(!p||!q||p.cosine<=0||q.cosine<=0)return false;
    const minimum=Math.min(p.positionMin,q.positionMin);if(!(minimum>0))return false;
    const angle=Math.acos(p.cosine)+Math.acos(q.cosine)+2*Math.asin(Math.min(1,(p.extent+q.extent+PRINT_RESOLUTION_MM*2)/minimum));
    return angle<Math.PI/2&&q.topMin-p.underMax>PRINT_RESOLUTION_MM*8/Math.cos(angle);
  })),unitClear:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&a.ranges.every(x=>b.ranges.every(y=>{
    const p=courses.get(x.id),q=courses.get(y.id);if(!p||!q)return false;
    if(p.tip>q.material+ROUNDING_MM)return true;
    if(!p.planar)return false;
    const gap=Math.max(0,p.tipProjection[0]-q.projection[1],q.projection[0]-p.tipProjection[1]);
    return Math.cos(halfAngle)*gap-Math.sin(halfAngle)*(q.material-p.support)+nozzleSideOffsetMm(includedAngleDeg,NOZZLE_FORGIVENESS_MM,tipDiameterMm)>ROUNDING_MM*8;
  }))};
}

export function sliceNozzleProofs(source,{reader=null,ranges=new Map(),nozzleGeometry=DEFAULT_NOZZLE_GEOMETRY}={}){
  const {includedAngleDeg,tipDiameterMm}=nozzleGeometry;
  const slices=new Map(),queries={reader},halfAngle=includedAngleDeg*Math.PI/360;
  const sine=Math.sin(halfAngle),clearPairs=new Map(),positionBounds=new Map();
  const clearPairLimit=4*1024*1024/128;
  const first=Object.values(source.operations).find(op=>op.kind==='deposit')?.courses[0];
  if(!queries.reader)queries.reader=prepareCurvePath(source);
  const pose=first?curveAt(queries.reader,first.curveId,first.from).pose:null;
  const axis=pose?scale(pose.toolAxis,-1/length(pose.toolAxis)):[0,0,1],up=pose?.toolUp??[0,1,0];
  const lateral=cross(up,axis),side=scale(lateral,1/length(lateral));
  const basis=[side,cross(axis,side),axis],local=vector=>basis.map(direction=>dot(vector,direction));
  const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
  function include(target,bounds,margin=0){for(let k=0;k<3;k++){
    target.min[k]=Math.min(target.min[k],bounds.min[k]-margin);target.max[k]=Math.max(target.max[k],bounds.max[k]+margin);
  }}
  function boundsClear(a,b){
    const receiver=slices.get(a),material=slices.get(b);if(!receiver?.bounded||!material?.bounded)return false;
    const key=receiver.ordinal+':'+material.ordinal,known=clearPairs.get(key);
    if(known!==undefined){clearPairs.delete(key);clearPairs.set(key,known);return known;}
    const clear=nozzleBoundsClear(receiver.positions,receiver.poseCone,material.material,NOZZLE_FORGIVENESS_MM,tipDiameterMm,includedAngleDeg);
    while(clearPairs.size>=clearPairLimit)clearPairs.delete(clearPairs.keys().next().value);
    clearPairs.set(key,clear);return clear;
  }
  function rangeOf(course){
    if(!queries.reader)queries.reader=prepareCurvePath(source);
    if(!ranges.has(course.id))ranges.set(course.id,curveRange(queries.reader,course.curveId,course.from,course.to));
    return ranges.get(course.id);
  }
  for(const operation of Object.values(source.operations)){
    if(operation.layerId===null)continue;
    const id=operation.layerId;
    if(!slices.has(id))slices.set(id,{id,ordinal:slices.size,normal:null,minTip:Infinity,maxMaterial:-Infinity,eligible:true,courses:0,bounded:true,positions:emptyBounds(),material:emptyBounds(),poseCone:null});
    const slice=slices.get(id);
    // Stationary occupied geometry is a separate authored record. Do not
    // accidentally certify it from the absence of moving deposition curves.
    if(operation.kind!=='deposit'||operation.occupied){slice.eligible=false;slice.bounded=false;continue;}
    for(const course of operation.courses){
      slice.courses++;
      if(slice.bounded){
        const range=rangeOf(course);
        if(!range.widthMm||!range.areaMm2)slice.bounded=false;
        else {
          if(!positionBounds.has(course.curveId)){
            const vertices=controlVertices(source.curves[course.curveId].geometry);
            if(vertices){const bounds=emptyBounds();for(const point of vertices){const value=local(point);include(bounds,{min:value,max:value},ROUNDING_MM*4);}positionBounds.set(course.curveId,bounds);}
          }
          const bounds=positionBounds.get(course.curveId);
          if(!bounds){slice.bounded=false;slice.eligible=false;continue;}
          include(slice.positions,bounds);include(slice.material,bounds,range.widthMm[1]/2+range.areaMm2[1]/range.widthMm[0]);
          const cone={...range.poseCone,reference:{toolAxis:local(range.poseCone.reference.toolAxis),toolUp:local(range.poseCone.reference.toolUp)}};
          if(!slice.poseCone)slice.poseCone={...cone};
          else slice.poseCone.halfAngleRad=Math.min(Math.PI,Math.max(slice.poseCone.halfAngleRad,
            frameCone([slice.poseCone.reference,cone.reference]).halfAngleRad+cone.halfAngleRad));
        }
      }
      if(!slice.eligible)continue;
      const curve=source.curves[course.curveId],vertices=controlVertices(curve.geometry);
      const normal=constantVector(curve.profiles.materialNormal),toolAxis=constantVector(curve.profiles.pose,value=>value.toolAxis);
      if(!vertices?.length){slice.eligible=false;continue;}
      const poseRange=toolAxis?null:rangeOf(course).poseCone;
      const axis=toolAxis??poseRange.reference.toolAxis,outward=scale(axis,-1/length(axis));
      const unit=slice.normal??(normal?scale(normal,1/length(normal)):outward);
      slice.normal=unit;
      const cosine=toolAxis?dot(unit,outward):Math.cos(Math.min(Math.PI,
        Math.acos(Math.max(-1,Math.min(1,dot(unit,outward))))+poseRange.halfAngleRad));
      // Every generator of every enclosed cone stays in the clear half-space.
      // Full rigid-frame bounds cover changing axes; pure roll stays exact.
      if(cosine<=sine+ROUNDING_RELATIVE){slice.eligible=false;continue;}
      const high=dot(convexSupport({vertices},unit),unit);
      const low=dot(convexSupport({vertices},scale(unit,-1)),unit);
      // The bead side lies perpendicular to this reference normal and its
      // depth is inward, even when the path tangent requires projection of
      // that normal. Thus its whole body is below its centerline hull's high.
      const aligned=normal&&equalVector(scale(normal,1/length(normal)),unit);
      // Other reference normals need an enclosure, not a fabricated sheet.
      // A side offset is at most half width and inward depth is area/width.
      // The broader bound still proves distant whole slices clear, including
      // curved layers with changing bead normals and a fixed nozzle direction.
      const range=aligned?null:rangeOf(course);
      const margin=aligned?0:range.widthMm[1]/2+(range.areaMm2?.[1]??0)/range.widthMm[0];
      slice.maxMaterial=Math.max(slice.maxMaterial,high+margin+ROUNDING_MM);
      slice.minTip=Math.min(slice.minTip,low+nozzleReferenceFloorMm(cosine,0,includedAngleDeg,NOZZLE_FORGIVENESS_MM,tipDiameterMm)-ROUNDING_MM);
    }
  }
  const eligible=[...slices.values()].filter(slice=>slice.eligible&&slice.courses);
  if(!queries.reader)queries.reader=prepareCurvePath(source);
  const graph=graphNozzleProofs(source,queries.reader,rangeOf,nozzleGeometry),sphere=sphereNozzleProofs(source,queries.reader,rangeOf,nozzleGeometry);
  return {slices,summary:{slices:slices.size,certifiableSlices:eligible.length,referenceGraph:graph?{slope:graph.slope,courses:graph.courses}:null,sphereCourses:sphere?.courses??0},
    frameBounds:id=>graph?.frameBounds(id)??null,unitClear:(a,b)=>(graph?.unitClear(a,b)??false)||(sphere?.unitClear(a,b)??false),sweepClear:(sweep,unit)=>graph?.sweepClear(sweep,unit)??false,topApart:(a,b)=>graph?.topApart(a,b)??false,supportApart:(a,b)=>(graph?.supportApart(a,b)??false)||(sphere?.supportApart(a,b)??false),materialApart:(a,b)=>graph?.materialApart(a,b)??false,
    layersApart(a,b){
      const x=slices.get(a),y=slices.get(b);return Boolean(x?.bounded&&y?.bounded&&x.material.min.some((v,k)=>
        v>y.material.max[k]+PRINT_RESOLUTION_MM*2+ROUNDING_MM||y.material.min[k]>x.material.max[k]+PRINT_RESOLUTION_MM*2+ROUNDING_MM));
    },
    clear(depositingLayer,materialLayer){
    if(graph?.clear(depositingLayer,materialLayer)||boundsClear(depositingLayer,materialLayer))return true;
    const a=slices.get(depositingLayer),b=slices.get(materialLayer);
    return Boolean(a?.eligible&&b?.eligible&&a.courses&&b.courses&&equalVector(a.normal,b.normal)&&a.minTip>b.maxMaterial+ROUNDING_MM);
  }};
}

// Compact source intervals remain the scene's leaves. Only unresolved queries
// open children; the cache may evict numerical work without changing the scene.
export function prepareRangeScene(source,reader,units,{onProgress,supportPrecision=null,nozzleGeometry=DEFAULT_NOZZLE_GEOMETRY,selfProofs={entries:new Map(),bytes:0}}={}){
  const pairResults=selfProofs.pairs??={entries:new Map(),bytes:0};
  // Retain the eviction cursor: restarting Map iteration repeatedly scans
  // deleted entries. Live cache entries keep this cursor from exhausting.
  pairResults.oldest??=pairResults.entries.keys();
  const stats={rootBytes:0,rootHits:0,rangeQueries:0,rangeCacheHits:0,rangeSubdivisions:0,nozzlePairs:0,supportPairs:0,cacheBytes:0,peakCacheBytes:0,materialIndexBuilds:0,materialIndexCells:0,materialIndexBytes:0,peakMaterialIndexBytes:0};
  const roots=new Map(),cache=new Map(),directions=new Map(),cacheLimit=16*1024*1024,byId=new Map(),bodies=[],boxes=[],deposited=new Map();
  const stock={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  function remember(key,record){
    const bytes=2048+record.range.breaks.length*8;
    if(bytes>cacheLimit)return record;
    while(stats.cacheBytes+bytes>cacheLimit&&cache.size){const first=cache.keys().next().value;stats.cacheBytes-=cache.get(first).bytes;cache.delete(first);}
    cache.set(key,{record,bytes});stats.cacheBytes+=bytes;stats.peakCacheBytes=Math.max(stats.peakCacheBytes,stats.cacheBytes);return record;
  }
  function interval(ref){
    const key=JSON.stringify([ref.id,ref.curveId,ref.from,ref.to,...(ref.reverse?[true]:[])]);
    const root=roots.get(key);if(root){stats.rootHits++;return root;}
    const known=cache.get(key);
    if(known){cache.delete(key);cache.set(key,known);stats.rangeCacheHits++;return known.record;}
    stats.rangeQueries++;
    const curve=source.curves[ref.curveId],range=curveRange(reader,ref.curveId,ref.from,ref.to);
    const start=curveAt(reader,ref.curveId,ref.from),end=curveAt(reader,ref.curveId,ref.to,{side:'left'});
    const chord=length(subtract(end.point,start.point));
    const linear=curve.geometry.kind==='polyline'&&range.breaks.length===0;
    const tangentCone=linear?{axis:start.tangent,halfAngleRad:0}:range.tangentCone??{axis:start.tangent??end.tangent??[1,0,0],halfAngleRad:Math.PI};
    if(!directions.has(ref.curveId))directions.set(ref.curveId,{
      normal:constantVector(curve.profiles.materialNormal),axis:constantVector(curve.profiles.pose,value=>value.toolAxis)});
    const {normal,axis}=directions.get(ref.curveId);
    const normalCone=normal?{axis:normal,halfAngleRad:0}:range.normalCone;
    const poseCone=axis?{reference:start.pose,halfAngleRad:0}:range.poseCone;
    // Arc length also bounds an ellipse containing every curve point. This
    // remains conservative while the shared reader's chord bound is migrating.
    const chordErrorMm=tangentCone.halfAngleRad===0?0:range.chordErrorMm??(linear?0:Math.sqrt(Math.max(0,range.lengthMm[1]**2-chord**2))/2);
    const depth=range.areaMm2?[range.areaMm2[0]/range.widthMm[1],range.areaMm2[1]/range.widthMm[0]]:[0,0];
    const record={ref,range,start,end,tangentCone,normalCone,poseCone,chordErrorMm,depth,
      material:null,nozzle:null,mid:null,affine:curve.geometry.kind==='polyline'&&chordErrorMm===0&&tangentCone.halfAngleRad===0};
    return remember(key,record);
  }
  function midpoint(record){
    if(!record.mid)record.mid=curveAt(reader,record.ref.curveId,(record.ref.from+record.ref.to)/2);
    return record.mid;
  }
  function material(record){
    if(record.depth[1]===0)return null;
    if(!record.material)record.material=rectangularSweepEnvelope({from:record.start.point,to:record.end.point,bounds:record.range.bounds,
      chordErrorMm:record.chordErrorMm,tangentCone:record.tangentCone,normalCone:record.normalCone,
      radius:record.range.widthMm.map(width=>width/2),depth:record.depth,sectionFrameBounds:proofs.frameBounds(record.ref.id)});
    return record.material;
  }
  function nozzle(record){
    if(!record.nozzle)record.nozzle=nozzleCurveEnvelope({from:record.start.point,to:record.end.point,bounds:record.range.bounds,
      chordErrorMm:record.chordErrorMm,poseCone:record.poseCone},stock,nozzleGeometry);
    return record.nozzle;
  }
  function divide(record){
    const ref=record.ref,mid=(ref.from+ref.to)/2;
    const cut=record.range.breaks.length?record.range.breaks.reduce((best,u)=>Math.abs(u-mid)<Math.abs(best-mid)?u:best,record.range.breaks[0]):mid;
    if(!(cut>ref.from&&cut<ref.to))return null;
    stats.rangeSubdivisions++;
    return [interval({...ref,to:cut}),interval({...ref,from:cut})];
  }
  function include(bounds){for(let k=0;k<3;k++){stock.min[k]=Math.min(stock.min[k],bounds.min[k]);stock.max[k]=Math.max(stock.max[k],bounds.max[k]);}}
  function occupied(operation){
    const value=operation.occupied;
    // Earlier saved bounds were travel-height metadata, not a spatial volume.
    if(!value||value.kind==='bounds')return [];
    const shapes=Array.isArray(value)?value:value.volumes??[value];
    requireThat(shapes.every(shape=>shape.vertices||shape.a||shape.parts||shape.body),'Stationary occupancy needs numerical convex volumes.');
    return shapes;
  }
  for(const [i,unit] of units.entries()){
    const records=unit.ranges.map(interval),solids=occupied(unit.operation),local={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    // Unit roots are already retained by the scene. Reuse that same record
    // directly instead of re-querying it after a numerical cache eviction.
    for(const record of records){
      const ref=record.ref,key=JSON.stringify([ref.id,ref.curveId,ref.from,ref.to,...(ref.reverse?[true]:[])]);
      if(!roots.has(key)){roots.set(key,record);stats.rootBytes+=2048+record.range.breaks.length*8;}
      const held=cache.get(key);if(held){stats.cacheBytes-=held.bytes;cache.delete(key);}
    }
    function addBounds(bounds){for(let k=0;k<3;k++){local.min[k]=Math.min(local.min[k],bounds.min[k]);local.max[k]=Math.max(local.max[k],bounds.max[k]);}}
    for(const record of records)if(record.depth[1]>0){
      const expansion=record.range.widthMm[1]/2+record.depth[1];
      addBounds({min:record.range.bounds.min.map(v=>v-expansion),max:record.range.bounds.max.map(v=>v+expansion)});
    }
    for(const solid of solids)addBounds(convexBounds(solid));
    const body={unit,records,solids};byId.set(unit.id,body);
    if(Number.isFinite(local.min[0])){include(local);bodies.push(body);boxes.push(convexBox(local));}
    if(i%256===0)onProgress?.({stage:'Preparing curve bounds',completed:i,total:units.length});
  }
  const proxy=convexSpatialIndex(boxes,{groups:bodies.map(body=>body.unit.id),partitions:bodies.map(body=>body.unit.layerId??body.unit.operation)});
  const originalCourses=new Map(Object.values(source.operations).flatMap(op=>(op.courses??[]).map(course=>[course.id,course])));
  const fullRanges=new Map([...byId.values()].flatMap(body=>body.records.filter(record=>{
    const original=originalCourses.get(record.ref.id);return original.from===record.ref.from&&original.to===record.ref.to;
  }).map(record=>[record.ref.id,record.range])));
  const proofs=sliceNozzleProofs(source,{reader,ranges:fullRanges,nozzleGeometry});
  function candidates(shape,acceptGroup,boundsTest=null){
    return proxy.query(shape,ROUNDING_MM,{acceptGroup,firstPerGroup:true,boundsTest,boundsOnly:true}).map(index=>bodies[index]);
  }
  const regionalIndexes=new Map(),regionalLimit=16*1024*1024;
  function sectionScale(record){return Math.max(PRINT_RESOLUTION_MM,record.range.widthMm[0]/4,record.depth[1]);}
  function regionalMaterial(body,shape){
    let local=regionalIndexes.get(body.unit.id);
    if(local){regionalIndexes.delete(body.unit.id);regionalIndexes.set(body.unit.id,local);}
    else{
      const pending=[...body.records],cells=[];
      while(pending.length){
        const record=pending.pop(),envelope=material(record);if(!envelope)continue;
        if(envelope.errorMm>sectionScale(record)){const children=divide(record);if(children){pending.push(...children);continue;}}
        cells.push({ref:record.ref,shape:envelope.shape});
      }
      local={cells,index:cells.length?convexSpatialIndex(cells.map(cell=>cell.shape)):null,bytes:cells.length*1024};
      stats.materialIndexBuilds++;stats.materialIndexCells+=cells.length;
      if(local.bytes<=regionalLimit){
        while(stats.materialIndexBytes+local.bytes>regionalLimit&&regionalIndexes.size){
          const first=regionalIndexes.keys().next().value;stats.materialIndexBytes-=regionalIndexes.get(first).bytes;regionalIndexes.delete(first);
        }
        regionalIndexes.set(body.unit.id,local);stats.materialIndexBytes+=local.bytes;
        stats.peakMaterialIndexBytes=Math.max(stats.peakMaterialIndexBytes,stats.materialIndexBytes);
      }
    }
    return (local.index?.query(shape,ROUNDING_MM,{boundsOnly:true})??[]).map(i=>interval(local.cells[i].ref));
  }
  function parameterAt(ref,u){return u===0?ref.from:u===1?ref.to:ref.from+u*(ref.to-ref.from);}
  function localWitness(record,at){
    const bounds={from:record.ref.from,to:record.ref.to};
    for(const u of record.range.breaks){
      if(u<=at&&u<record.ref.to)bounds.from=u;
      if(u>at){bounds.to=u;break;}
    }
    return {...record.ref,...bounds,at};
  }
  function samples(record){return [[record.ref.from,record.start],[(record.ref.from+record.ref.to)/2,midpoint(record)],[record.ref.to,record.end]];}
  function section(at){
    if(!at.tangent||!(at.areaMm2>0))return null;
    const projected=subtract(at.materialNormal,scale(at.tangent,dot(at.materialNormal,at.tangent)));
    if(length(projected)<=ROUNDING_RELATIVE)return null;
    return rectangularSection(at.point,at.tangent,at.materialNormal,at.widthMm/2,at.areaMm2/at.widthMm);
  }
  function cone(at,forgivenessMm=NOZZLE_FORGIVENESS_MM){
    return nozzleAt(at.point,scale(at.pose.toolAxis,-1),nozzleSweepReach(stock,at.point,at.point,at.pose,at.pose),nozzleGeometry.includedAngleDeg,forgivenessMm,nozzleGeometry.tipDiameterMm);
  }
  function unresolved(a,b){return Object.assign(Error('Curve clearance is unresolved at numerical precision.'),
    {code:'CURVE_CLEARANCE_UNRESOLVED',receiver:a?.ref,material:b?.ref});}
  function requireTangent(record){
    if(source.curves[record.ref.curveId].geometry.kind==='nurbs'&&!record.range.tangentCone)
      throw Object.assign(Error('Native curve clearance requires the SP2 tangentCone bound.'),{code:'CURVE_TANGENT_BOUND_REQUIRED',curveId:record.ref.curveId});
  }
  function travelMaterial(sweep,root,toleranceMm,confirm){
    const pending=[root];
    while(pending.length){
      const record=pending.pop(),body=material(record);if(!body)continue;
      if(!convexIntersects(sweep,body.shape,toleranceMm)||confirm&&!confirm(body.shape))continue;
      if(body.exact)return {material:record.ref};
      for(const [at,value] of samples(record)){
        const face=section(value);
        if(face&&convexIntersects(sweep,face,toleranceMm)&&(!confirm||confirm(face)))return {material:localWitness(record,at)};
      }
      requireTangent(record);
      const children=divide(record);if(!children)throw unresolved(null,record);pending.push(...children);
    }
    return null;
  }
  const index={empty:bodies.length===0,bounds:stock,query(sweep,toleranceMm=ROUNDING_MM,filters={}){
    const acceptGroup=id=>(!filters.withinGroups||filters.withinGroups.has(id))&&(!filters.acceptGroup||filters.acceptGroup(id))&&(!filters.accept||filters.accept(id))&&!proofs.sweepClear(sweep,byId.get(id).unit);
    const found=[];
    for(const body of candidates(sweep,acceptGroup,filters.boundsTest)){
      const solid=body.solids.some(shape=>convexIntersects(sweep,shape,toleranceMm)&&(!filters.confirm||filters.confirm(shape)));
      const records=deposited.has(body.unit.id)?body.records.slice(0,deposited.get(body.unit.id)):body.records;
      if(solid||records.some(record=>travelMaterial(sweep,record,toleranceMm,filters.confirm)))found.push(body.unit.id);
    }
    return found;
  }};
  // This is the initial accuracy of a possible ORDER choice, not a clearance
  // tolerance. Conservative envelopes remain enclosing; an uncertain cycle
  // tightens the involved pair before any source cut or impossibility finding.
  function contactPrecision(a,b,nozzleAccess=false){
    if(typeof supportPrecision==='number')return supportPrecision;
    const key=JSON.stringify([...(nozzleAccess?['nozzle-access']:[]),a.ref.id,b?.ref.id??null]);
    return supportPrecision?.get(key)??Math.max(PRINT_RESOLUTION_MM/8,
      Math.min(NOZZLE_FORGIVENESS_MM,a.range.widthMm[0],b?.range.widthMm[0]??Infinity)/2);
  }
  function pairKey(receiver,materialRecord,{localize=false,allowChoice=false}={}){
    // External interval geometry is independent of traversal direction.
    // Possible contact is reusable only at the same requested precision;
    // tightening a cyclic choice changes its key and performs a fresh query.
    return JSON.stringify([localize,allowChoice,allowChoice?contactPrecision(receiver,materialRecord,true):null,
      ...[receiver,materialRecord].map(record=>[record.ref.id,record.ref.from,record.ref.to])]);
  }
  function knownPair(key){
    const known=pairResults.entries.get(key);
    if(known){pairResults.entries.delete(key);pairResults.entries.set(key,known);}
    return known;
  }
  function rememberPair(key,witness){
    const bytes=2*(key.length+JSON.stringify(witness).length)+128;
    if(bytes<=cacheLimit){
      const previous=pairResults.entries.get(key);
      if(previous){pairResults.bytes-=previous.bytes;pairResults.entries.delete(key);}
      while(pairResults.bytes+bytes>cacheLimit){const first=pairResults.oldest.next().value;pairResults.bytes-=pairResults.entries.get(first).bytes;pairResults.entries.delete(first);}
      pairResults.entries.set(key,{witness,bytes});pairResults.bytes+=bytes;
    }
  }
  function pair(receiver,materialRecord,solid=null,{localize=false,allowChoice=false,cacheClear=true}={}){
    const key=solid?null:pairKey(receiver,materialRecord,{localize,allowChoice}),known=key&&knownPair(key);
    if(known)return known.witness;
    const witness=queryPair(receiver,materialRecord,solid,{localize,allowChoice});
    if(key&&(witness||cacheClear))rememberPair(key,witness);
    return witness;
  }
  function queryPair(receiver,materialRecord,solid,{localize,allowChoice}){
    const pending=[[receiver,materialRecord]];
    while(pending.length){
      const [a,b]=pending.pop(),mb=solid?{shape:solid,exact:true,errorMm:0}:material(b);if(!mb)continue;
      // Only nozzle points within this candidate's enclosing bounds can hit.
      // The same cone needs less reach here than in the whole-scene index.
      const nb=nozzleCurveEnvelope({from:a.start.point,to:a.end.point,bounds:a.range.bounds,
        chordErrorMm:a.chordErrorMm,poseCone:a.poseCone},mb.bounds??=convexBounds(mb.shape),nozzleGeometry);
      stats.nozzlePairs++;
      if(!convexIntersects(nb.shape,mb.shape,ROUNDING_MM))continue;
      if(nb.exact&&mb.exact&&!localize)return {receiver:a.ref,material:b?.ref??null};
      for(const [u,at] of samples(a)){
        const tool=cone(at);
        if(mb.exact&&convexIntersects(tool,mb.shape,ROUNDING_MM))return {receiver:localWitness(a,u),material:b?.ref??null};
        if(!solid)for(const [v,value] of samples(b)){
          const face=section(value);
          if(face&&convexIntersects(tool,face,ROUNDING_MM))return {receiver:localWitness(a,u),material:localWitness(b,v)};
        }
      }
      if(nb.exact&&!localize&&!solid)for(const [v,value] of samples(b)){
        const face=section(value);
        if(face&&nozzleIntervalIntersects(nb.shape,face,ROUNDING_MM))return {receiver:a.ref,material:localWitness(b,v)};
      }
      const precision=contactPrecision(a,b,true);
      // A bounded possible obstruction may constrain order without claiming
      // a collision. If that conservative choice creates a cycle, the solver
      // tightens this pair; it never reports impossibility from this envelope.
      if(allowChoice&&!localize&&nb.errorMm+mb.errorMm<=precision&&!a.range.breaks.length&&(!b||!b.range.breaks.length))
        return {receiver:a.ref,material:b?.ref??null,provisional:true,precision};
      // Open piecewise boundaries before comparing smooth envelope errors.
      // Otherwise a smaller-error material with breaks can keep the receiver
      // refining below its rounding floor while order-choice admission waits.
      let splitA=mb.exact||a.range.breaks.length>0||!b.range.breaks.length&&!nb.exact&&nb.errorMm>=mb.errorMm,chosen=splitA?a:b;
      requireTangent(chosen);let children=divide(chosen);
      if(!children&&!solid){splitA=!splitA;chosen=splitA?a:b;requireTangent(chosen);children=divide(chosen);}
      if(!children)throw unresolved(a,b);
      for(const child of children)pending.push(splitA?[child,b]:[a,child]);
    }
    return null;
  }
  // Keep nozzle filtering coarse: pair refinement uses material-local reach.
  // A stock-sized rotating cone needlessly refines far-away uncertainty at
  // bead scale here. The thin substrate band retains local subdivision.
  // These numerical regions never become scheduling units.
  function* queryRegions(root,kind,acceptGroup){
    const pending=[root];
    while(pending.length){
      const record=pending.pop(),body=kind==='support'?material(record):nozzle(record);
      if(!body)continue;
      const shape=kind==='support'?underside(record):body.shape,others=candidates(shape,acceptGroup);
      if(!others.length)continue;
      const scale=sectionScale(record);
      if(kind==='support'&&body.errorMm>scale){const children=divide(record);if(children){pending.push(...children);continue;}}
      yield {record,others};
    }
  }
  function* nozzleHits(unit,acceptGroup){
    const body=byId.get(unit.id),hits=[],seen=new Set();
    if(!bodies.length)return hits;
    if(unit.operation.kind==='inject'){
      const injection=unit.operation.injection,point=injection.at;
      const tool=nozzleCurveEnvelope({from:point,to:point,bounds:{min:point,max:point},chordErrorMm:0,
        poseCone:{reference:injection.pose,halfAngleRad:0}},stock,{...nozzleGeometry,forgivenessMm:0}).shape;
      for(const id of index.query(tool,ROUNDING_MM,{acceptGroup}))if(acceptGroup(id))yield {unit:byId.get(id).unit,witness:{receiver:null,material:null}};
      return hits;
    }
    for(const root of body.records)for(const {record,others} of queryRegions(root,'nozzle',id=>!seen.has(id)&&acceptGroup(id)&&!proofs.unitClear(unit,byId.get(id).unit)))for(const other of others.sort((a,b)=>{
      const x=source.layers[a.unit.layerId],y=source.layers[b.unit.layerId];return x&&y&&x.stackId===y.stackId?x.index-y.index:0;
    })){
      if(seen.has(other.unit.id)||!acceptGroup(other.unit.id))continue;
      const state={witness:null};
      for(const solid of other.solids){state.witness=pair(record,null,solid,{allowChoice:true});if(state.witness)break;}
      if(!state.witness){
        const remaining=other.records.map(candidate=>({candidate,key:pairKey(record,candidate,{allowChoice:true})})).filter(query=>knownPair(query.key)?.witness!==null);
        if(!remaining.length)continue;
        const ids=new Set(remaining.map(query=>query.candidate.ref.id));
        for(const candidate of regionalMaterial(other,nozzle(record).shape))if(ids.has(candidate.ref.id)){
          state.witness=pair(record,candidate,null,{allowChoice:true,cacheClear:false});if(state.witness)break;
        }
        // The enclosing nozzle and material index excluded every other cell.
        // Keep the completed course proofs, rather than transient cell misses.
        if(!state.witness)for(const query of remaining)rememberPair(query.key,null);
      }
      if(state.witness){seen.add(other.unit.id);yield {unit:other.unit,witness:state.witness};}
    }
    return hits;
  }
  function underside(record){
    const body=material(record);if(!body)return null;
    if(!body.frame)return body.shape;
    const depth=(record.depth[0]+record.depth[1])/2,n=body.frame.normal,slack=Math.min(PRINT_RESOLUTION_MM,record.depth[1]/4);
    const shape={a:add(record.start.point,scale(n,-depth+slack)),b:add(record.end.point,scale(n,-depth+slack)),normal:n,
      side:body.frame.side,radius:record.range.widthMm[1]/2,depth:PRINT_RESOLUTION_MM+slack};
    // The support band extends at most one print-resolution below the
    // deepest bead surface. Bound that extra frame displacement; fixed
    // padding would survive refinement and create fictitious substrates.
    const margin=(body.sphericalErrorMm??body.errorMm)+(record.depth[1]-record.depth[0])/2+PRINT_RESOLUTION_MM*body.normalError;
    const radialMargin=body.planarErrorMm??0;
    return margin||radialMargin?{parts:[shape],margin,...(radialMargin?{radialMargin,radialNormal:n}:{})}:shape;
  }
  function exactSupport(a,b){
    const shape=material(a).shape,candidate=material(b).shape,n=shape.normal,delta=subtract(shape.b,shape.a),size=length(delta);
    if(size<=ROUNDING_MM)return false;
    const along=scale(delta,1/size),inset=Math.min(PRINT_RESOLUTION_MM,size/4),slack=Math.min(PRINT_RESOLUTION_MM,shape.depth/4);
    const base=add(shape.a,scale(n,-shape.depth)),level=dot(base,n),underside={a:add(add(base,scale(n,slack)),scale(along,inset)),
      b:add(add(shape.b,scale(n,-shape.depth+slack)),scale(along,-inset)),normal:n,side:shape.side,
      radius:Math.max(shape.radius/2,shape.radius-PRINT_RESOLUTION_MM),depth:PRINT_RESOLUTION_MM+slack};
    if(!convexIntersects(underside,candidate,ROUNDING_MM))return false;
    if(dot(candidate.normal,n)>ROUNDING_RELATIVE&&convexIntersects(underside,{...candidate,depth:0},ROUNDING_MM)&&
      !convexIntersects({...shape,depth:shape.depth/2},candidate,ROUNDING_MM))return true;
    const gap=dot(convexSupport(candidate,n),n)-level,backDepth=-Math.min(0,dot(candidate.normal,n))*candidate.depth;
    return gap>=-PRINT_RESOLUTION_MM*2&&gap<=Math.min(PRINT_RESOLUTION_MM*2,shape.depth/2)&&
      (backDepth<=ROUNDING_MM||gap-backDepth>=-Math.min(PRINT_RESOLUTION_MM*2,backDepth/2));
  }
  // Both straight-support alternatives need an exposed candidate top: either
  // it actually reaches the underside band, or its highest material lies near
  // that band. Contact with a candidate's side/bottom alone cannot establish
  // substrate. These necessary tests stay conservative for varying frames.
  function possibleSupport(a,b,am,under){
    if(!am.frame)return true;
    const n=am.frame.normal,cosine=Math.max(-1,1-am.normalError**2/2);
    const projection=(bounds,high)=>n.reduce((sum,v,k)=>sum+v*bounds[(v>=0)===high?'max':'min'][k],0);
    const levelHi=projection(a.range.bounds,true)-(cosine>=0?a.depth[0]:a.depth[1])*cosine;
    const gapLo=projection(b.range.bounds,false)-levelHi;
    if(gapLo<=Math.min(PRINT_RESOLUTION_MM*2,a.depth[1]/2)+ROUNDING_MM)return true;
    if(proofs.topApart(a.ref.id,b.ref.id))return false;
    if(!b.top)b.top=rectangularSweepEnvelope({from:b.start.point,to:b.end.point,bounds:b.range.bounds,
      chordErrorMm:b.chordErrorMm,tangentCone:b.tangentCone,normalCone:b.normalCone,
      radius:b.range.widthMm.map(width=>width/2),depth:[0,0]});
    return convexIntersects(under,b.top.shape,ROUNDING_MM);
  }
  function supportPair(receiver,candidate){
    const pending=[[receiver,candidate]];
    while(pending.length){
      const [a,b]=pending.pop(),am=material(a),bm=material(b);if(!am||!bm)continue;
      stats.supportPairs++;
      if(am.exact&&bm.exact){if(exactSupport(a,b))return {receiver:a.ref,material:b.ref,provisional:false};continue;}
      const under=underside(a);
      if(!convexIntersects(under,bm.shape,ROUNDING_MM)||!possibleSupport(a,b,am,under))continue;
      const precision=contactPrecision(a,b);
      if(am.errorMm<=precision&&bm.errorMm<=precision&&!a.range.breaks.length&&!b.range.breaks.length)
        return {receiver:a.ref,material:b.ref,provisional:true,precision};
      const splitA=a.range.breaks.length>0||!b.range.breaks.length&&!am.exact&&(bm.exact||am.errorMm>=bm.errorMm),chosen=splitA?a:b;requireTangent(chosen);
      const children=divide(chosen);if(!children)throw unresolved(a,b);
      for(const child of children)pending.push(splitA?[child,b]:[a,child]);
    }
    return null;
  }
  function* supportHits(unit,acceptGroup){
    const hits=[],seen=new Set();
    for(const root of byId.get(unit.id).records)for(const {record,others} of queryRegions(root,'support',id=>!seen.has(id)&&acceptGroup(id)&&!proofs.materialApart(unit,byId.get(id).unit)&&!proofs.supportApart(unit,byId.get(id).unit))){
      for(const other of others){
        if(seen.has(other.unit.id)||!acceptGroup(other.unit.id))continue;
        const state={witness:null};
        for(const candidate of regionalMaterial(other,underside(record))){state.witness=supportPair(record,candidate);if(state.witness)break;}
        // Stationary occupied solids contribute through explicit material
        // requirements; a convex envelope is not a fabricated substrate face.
        if(state.witness){seen.add(other.unit.id);yield {unit:other.unit,witness:state.witness};}
      }
    }
    return hits;
  }
  function volumeHit(root,volume){
    const pending=[root];
    while(pending.length){
      const record=pending.pop(),body=material(record);if(!body||!convexIntersects(body.shape,volume,ROUNDING_MM))continue;
      if(body.exact)return {material:record.ref,requiredVolume:volume};
      for(const [u,at] of samples(record)){const face=section(at);if(face&&convexIntersects(face,volume,ROUNDING_MM))return {material:localWitness(record,u),requiredVolume:volume};}
      requireTangent(record);const children=divide(record);if(!children)throw unresolved(null,record);pending.push(...children);
    }
    return false;
  }
  function requiredHits(requirement,acceptGroup){
    const hits=[];
    for(const body of candidates(requirement.volume,acceptGroup)){
      const state={witness:null};
      if(body.solids.some(shape=>convexIntersects(shape,requirement.volume,ROUNDING_MM)))state.witness={requiredVolume:requirement.volume};
      else for(const record of body.records){state.witness=volumeHit(record,requirement.volume);if(state.witness)break;}
      if(state.witness)hits.push({unit:body.unit,witness:state.witness});
    }
    return hits;
  }
  function selfProofKey(kind,ranges){return JSON.stringify([kind,...ranges.map(ref=>[ref.id,ref.from,ref.to,Boolean(ref.reverse)])]);}
  function knownSelf(key){
    const bytes=selfProofs.entries.get(key);if(bytes===undefined)return false;
    selfProofs.entries.delete(key);selfProofs.entries.set(key,bytes);return true;
  }
  function rememberSelf(key){
    const bytes=key.length*2+128;
    if(bytes<=cacheLimit){
      while(selfProofs.bytes+bytes>cacheLimit){const first=selfProofs.entries.keys().next().value;selfProofs.bytes-=selfProofs.entries.get(first);selfProofs.entries.delete(first);}
      selfProofs.entries.set(key,bytes);selfProofs.bytes+=bytes;
    }
  }
  function verifySelf(unit){
    if(unit.operation.kind==='inject'||proofs.clear(unit.layerId,unit.layerId)||proofs.unitClear(unit,unit))return;
    // The solve retains one immutable source and nozzle. Every scene reach
    // covers this material. Keep course/pair proofs when a chunk is split.
    const key=selfProofKey('unit',unit.ranges);if(knownSelf(key))return;
    const records=byId.get(unit.id).records;
    function conflict(witness){throw Object.assign(Error('A continuous source course blocks its own nozzle access: '+unit.operation.id),
      {code:'CONTINUOUS_NOZZLE_CONFLICT',operation:unit.id,refinementCourses:[unit.id],witness});}
    for(const [i,record] of records.entries()){
      for(const previous of records.slice(0,i)){
        const hit=pair(record,previous);if(hit)conflict(hit);
      }
      const courseKey=selfProofKey('course',[record.ref]);if(knownSelf(courseKey))continue;
      if(!material(record)){rememberSelf(courseKey);continue;}
      const pending=[record];
      while(pending.length){
        const next=pending.pop();if(!convexIntersects(nozzle(next).shape,material(next).shape,ROUNDING_MM))continue;
        requireTangent(next);const children=divide(next);if(!children)throw unresolved(next,next);
        const first=next.ref.reverse?children[1]:children[0],last=next.ref.reverse?children[0]:children[1];
        const hit=pair(last,first);if(hit)conflict(hit);pending.push(...children);
      }
      rememberSelf(courseKey);
    }
    rememberSelf(key);
  }
  function cutsForWitness(witness){
    const result=[];
    if(witness?.requiredVolume&&witness.material){
      const b=interval(witness.material),bm=material(b);
      if(b.affine&&bm?.exact){
        const face=section(b.start),contact=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),witness.requiredVolume);
        if(contact)result.push({courseId:b.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(b.ref,u))});
      }
      return result;
    }
    if(!witness?.receiver||!witness.material)return result;
    const a=interval(witness.receiver),b=interval(witness.material),am=nozzle(a),bm=material(b);
    if(!am.exact||!bm?.exact)return result;
    if(a.affine){
      const tool=cone(a.start),contact=translationContactInterval(tool,subtract(a.end.point,a.start.point),bm.shape);
      if(contact)result.push({courseId:a.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(a.ref,u))});
    }
    if(b.affine){
      const face=section(b.start),contact=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),am.shape);
      if(contact)result.push({courseId:b.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(b.ref,u))});
    }
    return result;
  }
  function atomicSupportConflict(nozzleWitness,supportWitness){
    if(!nozzleWitness?.receiver||!nozzleWitness.material||!supportWitness?.receiver||!supportWitness.material||
      nozzleWitness.receiver.id!==supportWitness.receiver.id)return null;
    const from=Math.max(nozzleWitness.receiver.from,supportWitness.receiver.from),to=Math.min(nozzleWitness.receiver.to,supportWitness.receiver.to);
    if(!(from<to))return null;
    const a=interval({...nozzleWitness.receiver,from,to}),parent=interval(supportWitness.material),blocker=interval(nozzleWitness.material);
    const body=material(a),floor=material(parent),roof=material(blocker);
    if(!a.affine||!body?.exact||!floor?.exact||!roof?.exact)return null;
    const at=a.start,normal=body.frame.normal,depth=a.depth[0],slack=Math.min(PRINT_RESOLUTION_MM,depth/4);
    const base=add(at.point,scale(normal,-depth+slack)),radius=Math.max(at.widthMm/4,at.widthMm/2-PRINT_RESOLUTION_MM);
    const under=rectangularSection(base,at.tangent,at.materialNormal,radius,PRINT_RESOLUTION_MM+slack),translation=subtract(a.end.point,at.point);
    const required=translationContactInterval(under,translation,floor.shape),blocked=translationContactInterval(cone(at),translation,roof.shape);
    if(!required||!blocked)return null;
    const left=Math.max(required.from,blocked.from),right=Math.min(required.to,blocked.to);if(!(left<right))return null;
    const u=from+(left+right)/2*(to-from),value=curveAt(reader,a.ref.curveId,u);
    const underAt=rectangularSection(add(value.point,scale(normal,-depth+slack)),value.tangent,value.materialNormal,radius,PRINT_RESOLUTION_MM+slack);
    const upper=rectangularSection(value.point,value.tangent,value.materialNormal,value.widthMm/2,depth/2);
    if(convexIntersects(underAt,floor.shape,ROUNDING_MM)&&!convexIntersects(upper,floor.shape,ROUNDING_MM)&&
      convexIntersects(cone(value,NOZZLE_FORGIVENESS_MM+ROUNDING_MM*4),roof.shape,ROUNDING_MM))
      return {receiver:{...a.ref,at:u},substrate:parent.ref,blocker:blocker.ref};
    return null;
  }
  // Two actual deposited sections that obstruct each other's deposition are
  // an irreducible event cycle. Splitting their unchanged curves cannot help.
  function mutualConflict(first,second){
    if(!first||!second)return null;
    if(Number.isFinite(first.at)&&Number.isFinite(second.at)&&(first.id!==second.id||first.at!==second.at)){
      const at=curveAt(reader,first.curveId,first.at,{side:first.at===first.to?'left':'right'});
      const bt=curveAt(reader,second.curveId,second.at,{side:second.at===second.to?'left':'right'}),af=section(at),bf=section(bt);
      // Strict contact survives in a neighborhood on each admitted span;
      // neither traversal changes nor subdivision can order these events.
      const forgiveness=NOZZLE_FORGIVENESS_MM+ROUNDING_MM*4;
      if(af&&bf&&convexIntersects(cone(at,forgiveness),bf,ROUNDING_MM)&&convexIntersects(cone(bt,forgiveness),af,ROUNDING_MM))
        return {receiver:first,material:second};
    }
    const a=interval(first),b=interval(second),am=material(a),bm=material(b);
    if(!a.affine||!b.affine||!am?.exact||!bm?.exact)return null;
    const contact=translationContactInterval(cone(a.start),subtract(a.end.point,a.start.point),bm.shape);
    if(!contact)return null;
    for(const t of [contact.at,(contact.from+contact.to)/2]){
      const u=parameterAt(a.ref,t),at=curveAt(reader,a.ref.curveId,u);
      const tool=cone(at,NOZZLE_FORGIVENESS_MM+ROUNDING_MM*4),face=section(b.start);
      const other=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),tool);
      if(!other)continue;
      const v=parameterAt(b.ref,other.at);
      if(a.ref.id===b.ref.id&&u===v)continue;
      const bt=curveAt(reader,b.ref.curveId,v),af=section(at);
      if(af&&convexIntersects(cone(bt,NOZZLE_FORGIVENESS_MM+ROUNDING_MM*4),af,ROUNDING_MM))
        return {receiver:{...a.ref,at:u},material:{...b.ref,at:v}};
    }
    return null;
  }
  return {source,reader,index,byId,stats,proofs,nozzleGeometry,nozzleHits,supportHits,requiredHits,verifySelf,cutsForWitness,mutualConflict,atomicSupportConflict,
    interval,pair,deposited,occupied:new Set(),withinGroups:null,groupPrefixes:null,
    operationOf:id=>byId.get(id)?.unit.sourceOperation??id};
}
