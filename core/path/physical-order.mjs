// Scheduling interprets conservative curve bounds and actual contact witnesses.
// Geometry owns numerical section, convex-volume and continuous-sweep operations.
import {prepareCurvePath,curveRange,curveAt} from './curve-path.mjs';
import {convexSupport,convexIntersects,convexSpatialIndex,DEFAULT_NOZZLE_GEOMETRY,NOZZLE_FORGIVENESS_MM,nozzleSideOffsetMm,nozzleReferenceFloorMm,
  convexBounds,convexBox,boundsOverlap,prepareConvexBoundsQuery,nozzleBoundsClear,rectangularSection,rectangularSweepEnvelope,nozzleCurveEnvelope,nozzleAt,nozzleSweepReach,
  nozzleIntervalIntersects,translationContactInterval,referenceHeightGraph,sectionNormalProjectionBound,sectionNormalConeProjectionBound,movingAxisSupportBound,movingSectionBounds} from '../geom/convex-clearance.mjs';
import {add,scale,dot,cross,subtract,length,requireThat} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {frameCone,prepareNumericalCurve,numericalCurveTangentProjection} from '../geom/curve-query.mjs';

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
  const curves=new Map(),frames=new Map(),projections=new Map(),courses=new Map(),slices=new Map(),producers=new Map(),metric=Math.hypot(1,graph.slope);
  function frameFloor(curveId,from=0,to=1){
    if(!frames.has(curveId)){
      const curve=source.curves[curveId],geometry=prepareNumericalCurve(curve.geometry);
      if(geometry.kind==='point'){frames.set(curveId,null);return -1;}
      const cuts=[...new Set([...geometry.parameters,...(curve.profiles.materialNormal.knots??[]).map(([u])=>u)])].sort((a,b)=>a-b);
      const normal=constantVector(curve.profiles.materialNormal),size=2**Math.ceil(Math.log2(cuts.length-1)),tree=new Float64Array(size*2).fill(1);
      for(let i=1;i<cuts.length;i++){
        if(geometry.kind==='polyline'){
          const a=curveAt(reader,curveId,cuts[i-1]),b=curveAt(reader,curveId,cuts[i],{side:'left'});
          tree[size+i-1]=a.tangent?sectionNormalProjectionBound(a.tangent,a.materialNormal,b.materialNormal,graph.axis):-1;
        }else if(normal){
          const projection=numericalCurveTangentProjection(geometry,cuts[i-1],cuts[i],normal);
          const deviation=Math.asin(projection)+Math.acos(Math.max(-1,Math.min(1,dot(normal,graph.axis))));
          tree[size+i-1]=Math.cos(Math.min(Math.PI,deviation));
        }else{
          const range=curveRange(reader,curveId,cuts[i-1],cuts[i]);
          tree[size+i-1]=sectionNormalConeProjectionBound(range.tangentCone,range.normalCone,graph.axis);
        }
      }
      for(let i=size-1;i;i--)tree[i]=Math.min(tree[i*2],tree[i*2+1]);
      frames.set(curveId,{cuts,size,tree});
    }
    const frame=frames.get(curveId);if(!frame)return -1;
    const {cuts,size,tree}=frame;
    const locate=(value,upper)=>{
      let low=0,high=cuts.length;
      while(low<high){const mid=(low+high)>>1;if(cuts[mid]<value||upper&&cuts[mid]===value)low=mid+1;else high=mid;}
      return low;
    };
    let low=size+Math.max(0,locate(from,true)-1),high=size+Math.min(cuts.length-1,locate(to,false)),cosine=1;
    while(low<high){if(low&1)cosine=Math.min(cosine,tree[low++]);if(high&1)cosine=Math.min(cosine,tree[--high]);low>>=1;high>>=1;}
    return cosine;
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
      const materialLift=side-Math.min(0,inward*depth[1]),high=residual[1]+materialLift;
      const underHigh=residual[1]+side-(inward>=0?depth[0]:depth[1])*inward+PRINT_RESOLUTION_MM*metric;
      const reference=scale(range.poseCone.reference.toolAxis,-1),deviation=Math.acos(Math.max(-1,Math.min(1,dot(reference,graph.axis))))+range.poseCone.halfAngleRad;
      const tipLift=nozzleReferenceFloorMm(Math.cos(Math.min(Math.PI,deviation)),graph.slope,includedAngleDeg,NOZZLE_FORGIVENESS_MM,tipDiameterMm),tip=residual[0]+tipLift;
      const value={min:low,max:high,topMin:residual[0]-side,underHigh,tip,cosine,curveId:course.curveId};courses.set(course.id,value);
      const id=operation.layerId??operation.id;
      if(!slices.has(id))slices.set(id,{min:Infinity,max:-Infinity,tip:Infinity});
      const slice=slices.get(id);slice.min=Math.min(slice.min,value.min);slice.max=Math.max(slice.max,value.max);slice.tip=Math.min(slice.tip,value.tip);
      const producer=source.layers[operation.layerId]?.stackId??operation.construction??operation.id;
      if(!producers.has(producer))producers.set(producer,{max:-Infinity,tip:Infinity});
      const whole=producers.get(producer);whole.max=Math.max(whole.max,value.max);whole.tip=Math.min(whole.tip,value.tip);
    }
  }
  // Atomic occupied solids and unsupported curves cannot inherit a proof from
  // another moving course in the same source layer.
  for(const op of Object.values(source.operations))if(op.kind!=='deposit'||op.occupied||op.courses.some(c=>!courses.has(c.id))){
    slices.delete(op.layerId??op.id);producers.delete(source.layers[op.layerId]?.stackId??op.construction??op.id);
  }
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
  return {slope:graph.slope,courses:courses.size,rangeClear(a,b){
      // Local cones avoid a single steep section pessimizing an entire
      // continuous curve. These remain interval bounds, never contact probes.
      if(graph.slope!==0||!a.range.poseCone||!b.range.widthMm||!b.range.areaMm2)return false;
      const cosine=Math.max(sectionNormalConeProjectionBound(b.tangentCone,b.normalCone,graph.axis),frameFloor(b.ref.curveId,b.ref.from,b.ref.to));
      const sine=cosine>=0?Math.sqrt(Math.max(0,1-cosine*cosine)):1;
      const depth=b.range.areaMm2[1]/b.range.widthMm[0],materialLift=b.range.widthMm[1]/2*sine-Math.min(0,cosine*depth);
      const reference=scale(a.range.poseCone.reference.toolAxis,-1),deviation=Math.acos(Math.max(-1,Math.min(1,dot(reference,graph.axis))))+a.range.poseCone.halfAngleRad;
      const tipLift=nozzleReferenceFloorMm(Math.cos(Math.min(Math.PI,deviation)),0,includedAngleDeg,NOZZLE_FORGIVENESS_MM,tipDiameterMm);
      const project=(bounds,high)=>graph.axis.reduce((sum,v,k)=>sum+v*bounds[(v>=0)===high?'max':'min'][k],0);
      return project(a.range.bounds,false)+tipLift>project(b.range.bounds,true)+materialLift+ROUNDING_MM;
    },frameBounds(id){
      const course=courses.get(id);if(!course)return null;
      if(!projections.has(course.curveId)){
        const vertices=controlVertices(source.curves[course.curveId].geometry);let lo=Infinity,hi=-Infinity;
        for(const point of vertices){const value=dot(point,graph.axis);lo=Math.min(lo,value);hi=Math.max(hi,value);}
        projections.set(course.curveId,[lo-ROUNDING_MM*4,hi+ROUNDING_MM*4]);
      }
      return {axis:graph.axis,halfAngleRad:Math.acos(Math.max(-1,Math.min(1,course.cosine))),projection:projections.get(course.curveId)};
    },
    sweepClear:(sweep,unit)=>unit.operation.kind==='deposit'&&!unit.operation.occupied&&unit.ranges.every(ref=>{const material=courses.get(ref.id);return material&&sweepTip(sweep)>material.max+ROUNDING_MM;}),
    clear:(a,b)=>clear(slices.get(a),slices.get(b)),producerClear:(a,b)=>clear(producers.get(a),producers.get(b)),
    orderedClear(ids){
      const prefix={max:-Infinity};
      for(const id of ids){const row=slices.get(id);if(!row||!(row.tip>Math.max(prefix.max,row.max)+ROUNDING_MM))return false;prefix.max=Math.max(prefix.max,row.max);}
      return true;
    },
    unitClear:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&
      a.ranges.every(x=>b.ranges.every(y=>clear(courses.get(x.id),courses.get(y.id))))};
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
  return {courses:courses.size,unitClear:(a,b)=>a.operation.kind==='deposit'&&b.operation.kind==='deposit'&&!b.operation.occupied&&a.ranges.every(x=>b.ranges.every(y=>{
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
  const oldestClearPair={iterator:clearPairs.keys(),hits:0};
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
  function boundsClear(a,b,groups=slices){
    const receiver=groups.get(a),material=groups.get(b);if(!receiver?.bounded||!material?.bounded)return false;
    const key=receiver.ordinal+':'+material.ordinal,known=clearPairs.get(key);
    if(known!==undefined){
      clearPairs.delete(key);clearPairs.set(key,known);
      if(++oldestClearPair.hits>=clearPairs.size){oldestClearPair.iterator=clearPairs.keys();oldestClearPair.hits=0;}
      return known;
    }
    const clear=nozzleBoundsClear(receiver.positions,receiver.poseCone,material.material,NOZZLE_FORGIVENESS_MM,tipDiameterMm,includedAngleDeg);
    while(clearPairs.size>=clearPairLimit)clearPairs.delete(oldestClearPair.iterator.next().value);
    clearPairs.set(key,clear);return clear;
  }
  function rangeOf(course){
    if(!queries.reader)queries.reader=prepareCurvePath(source);
    if(!ranges.has(course.id))ranges.set(course.id,curveRange(queries.reader,course.curveId,course.from,course.to));
    return ranges.get(course.id);
  }
  for(const operation of Object.values(source.operations)){
    const id=operation.layerId??operation.id;
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
  const producerGroups=new Map(),members=new Map();
  for(const operation of Object.values(source.operations)){
    const producer=source.layers[operation.layerId]?.stackId??operation.construction??operation.id,id=operation.layerId??operation.id;
    if(!members.has(producer))members.set(producer,new Set());members.get(producer).add(id);
  }
  for(const [producer,ids] of members){
    const rows=[...ids].map(id=>slices.get(id)),first=rows[0];
    const whole={ordinal:slices.size+producerGroups.size,bounded:rows.every(row=>row.bounded),eligible:rows.every(row=>row.eligible&&equalVector(row.normal??[],first.normal??[])),
      normal:first.normal,courses:rows.reduce((sum,row)=>sum+row.courses,0),minTip:Infinity,maxMaterial:-Infinity,positions:emptyBounds(),material:emptyBounds(),poseCone:null};
    for(const row of rows){
      whole.minTip=Math.min(whole.minTip,row.minTip);whole.maxMaterial=Math.max(whole.maxMaterial,row.maxMaterial);
      include(whole.positions,row.positions);include(whole.material,row.material);
      if(!row.poseCone)continue;
      if(!whole.poseCone)whole.poseCone={...row.poseCone};
      else whole.poseCone.halfAngleRad=Math.min(Math.PI,Math.max(whole.poseCone.halfAngleRad,
        frameCone([whole.poseCone.reference,row.poseCone.reference]).halfAngleRad+row.poseCone.halfAngleRad));
    }
    producerGroups.set(producer,whole);
  }
  if(!queries.reader)queries.reader=prepareCurvePath(source);
  const graph=graphNozzleProofs(source,queries.reader,rangeOf,nozzleGeometry),sphere=sphereNozzleProofs(source,queries.reader,rangeOf,nozzleGeometry);
  function stationaryClear(point,pose,layerId){
    const material=slices.get(layerId);if(!material)return false;
    const outward=scale(pose.toolAxis,-1/length(pose.toolAxis));
    if(material.eligible&&material.courses){
      const tip=dot(point,material.normal)+nozzleReferenceFloorMm(dot(outward,material.normal),0,includedAngleDeg,0,tipDiameterMm);
      if(tip>material.maxMaterial+ROUNDING_MM)return true;
    }
    if(!material.bounded)return false;
    const p=local(point),reference={toolAxis:local(pose.toolAxis),toolUp:local(pose.toolUp)};
    return nozzleBoundsClear({min:p,max:p},{reference,halfAngleRad:0},material.material,0,tipDiameterMm,includedAngleDeg);
  }
  return {slices,stationaryClear,summary:{slices:slices.size,producerGroups:producerGroups.size,certifiableSlices:eligible.length,referenceGraph:graph?{slope:graph.slope,courses:graph.courses}:null,sphereCourses:sphere?.courses??0},
    rangeClear:(a,b)=>graph?.rangeClear(a,b)??false,frameBounds:id=>graph?.frameBounds(id)??null,unitClear:(a,b)=>(graph?.unitClear(a,b)??false)||(sphere?.unitClear(a,b)??false),sweepClear:(sweep,unit)=>graph?.sweepClear(sweep,unit)??false,
    producerClear(a,b){
      if(graph?.producerClear(a,b)||boundsClear(a,b,producerGroups))return true;
      const x=producerGroups.get(a),y=producerGroups.get(b);
      return Boolean(x?.eligible&&y?.eligible&&x.courses&&y.courses&&equalVector(x.normal,y.normal)&&x.minTip>y.maxMaterial+ROUNDING_MM);
    },
    orderedClear(ids){
      if(graph?.orderedClear(ids))return true;
      const prefix={material:emptyBounds()};
      for(const id of ids){
        const row=slices.get(id);if(!row?.bounded)return false;include(prefix.material,row.material);
        if(!nozzleBoundsClear(row.positions,row.poseCone,prefix.material,NOZZLE_FORGIVENESS_MM,tipDiameterMm,includedAngleDeg))return false;
      }
      return true;
    },
    clear(depositingLayer,materialLayer){
    if(graph?.clear(depositingLayer,materialLayer)||boundsClear(depositingLayer,materialLayer))return true;
    const a=slices.get(depositingLayer),b=slices.get(materialLayer);
    return Boolean(a?.eligible&&b?.eligible&&a.courses&&b.courses&&equalVector(a.normal,b.normal)&&a.minTip>b.maxMaterial+ROUNDING_MM);
  }};
}

// Compact source intervals remain the scene's leaves. Only unresolved queries
// open children; the cache may evict numerical work without changing the scene.
export function prepareRangeScene(source,reader,units,{onProgress,nozzleGeometry=DEFAULT_NOZZLE_GEOMETRY,nozzleGeometries=null,selfProofs={entries:new Map(),bytes:0}}={}){
  const courseModels=new Map();
  function geometryForFilament(filament){return nozzleGeometries?.filaments?.[filament]??nozzleGeometries?.default??nozzleGeometry;}
  const baselineGeometry=geometryForFilament(source.planning.selection?.filament);
  if(nozzleGeometries)for(const operation of Object.values(source.operations)){
    const geometry=geometryForFilament(operation.filament??source.planning.selection?.filament);
    if(geometry.includedAngleDeg!==baselineGeometry.includedAngleDeg||geometry.tipDiameterMm!==baselineGeometry.tipDiameterMm)
      for(const course of operation.courses??[])courseModels.set(course.id,geometry);
  }
  function geometryFor(ref){return courseModels.get(ref.id)??baselineGeometry;}
  const pairResults=selfProofs.pairs??={entries:new Map(),bytes:0},pairCacheLimit=16*1024*1024;
  // Retain the eviction cursor: restarting Map iteration repeatedly scans
  // deleted entries. Live cache entries keep this cursor from exhausting.
  pairResults.oldest??=pairResults.entries.keys();
  const stats={rootBytes:0,rootHits:0,rangeQueries:0,rangeCacheHits:0,rangeSubdivisions:0,nozzlePairs:0,substratePairs:0,cacheBytes:0,peakCacheBytes:0,materialRegionQueries:0,materialRegionCells:0};
  const roots=new Map(),cache=new Map(),directions=new Map(),cacheLimit=16*1024*1024,byId=new Map(),bodies=[],boxes=[],deposited=new Map(),occupiedIds=new Set();
  const depositedBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  const oldestRange=cache.keys(),sampleSections=new WeakMap(),sampleCones=new WeakMap();
  selfProofs.oldest??=selfProofs.entries.keys();
  const stock={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  function remember(key,record){
    const bytes=2048+record.range.breaks.length*8;
    if(bytes>cacheLimit)return record;
    while(stats.cacheBytes+bytes>cacheLimit&&cache.size){const first=oldestRange.next().value;stats.cacheBytes-=cache.get(first).bytes;cache.delete(first);}
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
  function materialBounds(record){
    // Every section lies within half-width + depth of its actual curve.
    // This enclosure stays tight when a chord/frame sweep is very loose.
    if(!record.materialBounds){
      const extent=record.range.widthMm[1]/2+record.depth[1];
      record.materialBounds={min:record.range.bounds.min.map(v=>v-extent),max:record.range.bounds.max.map(v=>v+extent)};
    }
    return record.materialBounds;
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
      chordErrorMm:record.chordErrorMm,poseCone:record.poseCone},stock,geometryFor(record.ref));
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
    for(const record of records)if(record.depth[1]>0)addBounds(materialBounds(record));
    for(const solid of solids)addBounds(convexBounds(solid));
    const body={unit,records,solids,bounds:local};byId.set(unit.id,body);
    if(Number.isFinite(local.min[0])){include(local);bodies.push(body);boxes.push(convexBox(local));}
    if(i%256===0)onProgress?.({stage:'Preparing curve bounds',completed:i,total:units.length});
  }
  onProgress?.({stage:'Preparing curve bounds',completed:units.length,total:units.length});
  const proxy=convexSpatialIndex(boxes,{groups:bodies.map(body=>body.unit.id),partitions:bodies.map(body=>body.unit.layerId??body.unit.operation)});
  const originalCourses=new Map(Object.values(source.operations).flatMap(op=>(op.courses??[]).map(course=>[course.id,course])));
  // A clear whole-course pair also clears every contained pair of intervals.
  // Sparse bit rows retain those proofs without allocating strings per pair.
  const courseFacts=selfProofs.courseFacts??={rows:new Map(),bytes:0,index:new Map([...originalCourses.keys()].map((id,i)=>[id,i]))};
  courseFacts.oldest??=courseFacts.rows.keys();
  function knownCourseClear(a,b){
    const x=originalCourses.get(a.id),y=originalCourses.get(b.id);
    if(!x||!y||a.from<x.from||a.to>x.to||b.from<y.from||b.to>y.to)return false;
    const row=courseFacts.rows.get(a.id),i=courseFacts.index.get(b.id);
    return Boolean(row&&(row[i>>>5]&(1<<(i&31))));
  }
  function rememberCourseClear(a,b){
    const x=originalCourses.get(a.id),y=originalCourses.get(b.id);
    if(!x||!y||a.from!==x.from||a.to!==x.to||b.from!==y.from||b.to!==y.to)return false;
    const words=Math.ceil(originalCourses.size/32),bytes=words*4+128;
    if(bytes>cacheLimit)return false;
    if(!courseFacts.rows.has(a.id)){
      while(courseFacts.bytes+bytes>cacheLimit){const first=courseFacts.oldest.next().value;courseFacts.rows.delete(first);courseFacts.bytes-=bytes;}
      courseFacts.rows.set(a.id,new Uint32Array(words));courseFacts.bytes+=bytes;
    }
    const row=courseFacts.rows.get(a.id),i=courseFacts.index.get(b.id);row[i>>>5]|=1<<(i&31);return true;
  }
  const fullRanges=new Map([...byId.values()].flatMap(body=>body.records.filter(record=>{
    const original=originalCourses.get(record.ref.id);return original.from===record.ref.from&&original.to===record.ref.to;
  }).map(record=>[record.ref.id,record.range])));
  const proofs=sliceNozzleProofs(source,{reader,ranges:fullRanges,nozzleGeometry});
  function candidates(shape,acceptGroup,boundsTest=null){
    return proxy.query(shape,ROUNDING_MM,{acceptGroup,firstPerGroup:true,boundsTest,boundsOnly:true}).map(index=>bodies[index]);
  }
  function sectionScale(record){return Math.max(PRINT_RESOLUTION_MM,record.range.widthMm[0]/4,record.depth[1]);}
  function regionalMaterial(body,shape){
    const region=prepareConvexBoundsQuery(shape,ROUNDING_MM),pending=[...body.records],found=[];
    stats.materialRegionQueries++;
    while(pending.length){
      const record=pending.pop();if(record.depth[1]===0)continue;
      // Reject using the actual curve's conservative position/section bounds
      // before refining. A whole-course index can exceed its cache budget and
      // rebuild tens of thousands of remote cells for every local query.
      if(!region.mayIntersect(materialBounds(record)))continue;
      const envelope=material(record);if(!envelope)continue;
      if(envelope.errorMm>sectionScale(record)){const children=divide(record);if(children){pending.push(...children);continue;}}
      stats.materialRegionCells++;
      if(region.mayIntersect(convexBounds(envelope.shape)))found.push(record);
    }
    return found;
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
    if(sampleSections.has(at))return sampleSections.get(at);
    if(!at.tangent||!(at.areaMm2>0))return null;
    const projected=subtract(at.materialNormal,scale(at.tangent,dot(at.materialNormal,at.tangent)));
    if(length(projected)<=ROUNDING_RELATIVE)return null;
    const shape=rectangularSection(at.point,at.tangent,at.materialNormal,at.widthMm/2,at.areaMm2/at.widthMm);
    sampleSections.set(at,shape);return shape;
  }
  function cone(at,forgivenessMm=NOZZLE_FORGIVENESS_MM,geometry=nozzleGeometry){
    const key=JSON.stringify([geometry.includedAngleDeg,geometry.tipDiameterMm,forgivenessMm]),known=sampleCones.get(at)?.get(key);
    if(known)return known;
    const shape=nozzleAt(at.point,scale(at.pose.toolAxis,-1),nozzleSweepReach(stock,at.point,at.point,at.pose,at.pose),geometry.includedAngleDeg,forgivenessMm,geometry.tipDiameterMm);
    if(!sampleCones.has(at))sampleCones.set(at,new Map());sampleCones.get(at).set(key,shape);return shape;
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
  function pairKey(receiver,materialRecord,{localize=false}={}){
    // Actual contact proofs are independent of traversal direction.
    return JSON.stringify([localize,...[receiver,materialRecord].map(record=>[record.ref.id,record.ref.from,record.ref.to])]);
  }
  function knownPair(key){
    const known=pairResults.entries.get(key);
    if(known){
      pairResults.entries.delete(key);pairResults.entries.set(key,known);
      pairResults.hits=(pairResults.hits??0)+1;
      if(pairResults.hits>=pairResults.entries.size){pairResults.oldest=pairResults.entries.keys();pairResults.hits=0;}
    }
    return known;
  }
  function rememberPair(key,witness){
    const bytes=2*(key.length+JSON.stringify(witness).length)+128;
    if(bytes<=pairCacheLimit){
      const previous=pairResults.entries.get(key);
      if(previous){pairResults.bytes-=previous.bytes;pairResults.entries.delete(key);}
      while(pairResults.bytes+bytes>pairCacheLimit){const first=pairResults.oldest.next().value;pairResults.bytes-=pairResults.entries.get(first).bytes;pairResults.entries.delete(first);}
      pairResults.entries.set(key,{witness,bytes});pairResults.bytes+=bytes;
    }
  }
  function pair(receiver,materialRecord,solid=null,{localize=false,cacheClear=true}={}){
    if(!solid&&knownCourseClear(receiver.ref,materialRecord.ref))return null;
    const key=solid?null:pairKey(receiver,materialRecord,{localize}),known=key&&knownPair(key);
    if(known)return known.witness;
    const witness=queryPair(receiver,materialRecord,solid,{localize});
    if(!witness&&!solid&&rememberCourseClear(receiver.ref,materialRecord.ref))return null;
    if(key&&(witness||cacheClear))rememberPair(key,witness);
    return witness;
  }
  function queryPair(receiver,materialRecord,solid,{localize}){
    if(!solid&&proofs.rangeClear(receiver,materialRecord))return null;
    const pending=[[receiver,materialRecord]];
    while(pending.length){
      const [a,b]=pending.pop();if(!solid&&proofs.rangeClear(a,b))continue;
      const mb=solid?{shape:solid,exact:true,errorMm:0}:material(b);if(!mb)continue;
      // Only nozzle points within this candidate's enclosing bounds can hit.
      // The same cone needs less reach here than in the whole-scene index.
      const nb=nozzleCurveEnvelope({from:a.start.point,to:a.end.point,bounds:a.range.bounds,
        chordErrorMm:a.chordErrorMm,poseCone:a.poseCone},mb.bounds??=convexBounds(mb.shape),geometryFor(a.ref));
      stats.nozzlePairs++;
      if(!convexIntersects(nb.shape,mb.shape,ROUNDING_MM))continue;
      if(nb.exact&&mb.exact&&!localize)return {receiver:a.ref,material:b?.ref??null};
      for(const [u,at] of samples(a)){
        const tool=cone(at,NOZZLE_FORGIVENESS_MM,geometryFor(a.ref));
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
  // Refine loose positional enclosures only after aggregate admission. A
  // closed curve's convex sweep can otherwise fill its empty interior and
  // repeat full-curve refinement for every remote material section. Rotation
  // uncertainty retains material-local pair refinement; these numerical
  // regions never become scheduling units or alter source coverage.
  function* queryRegions(root,acceptGroup){
    const pending=[root];
    while(pending.length){
      const record=pending.pop(),body=nozzle(record);if(!body)continue;
      const others=candidates(body.shape,acceptGroup);if(!others.length)continue;
      if(record.chordErrorMm>sectionScale(record)){
        const children=divide(record);if(children){pending.push(...children);continue;}
      }
      yield {record,others};
    }
  }
  function* nozzleHits(unit,acceptGroup){
    const body=byId.get(unit.id),hits=[],seen=new Set();
    if(!bodies.length)return hits;
    if(unit.operation.kind==='inject'){
      const injection=unit.operation.injection,point=injection.at;
      const tool=nozzleCurveEnvelope({from:point,to:point,bounds:{min:point,max:point},chordErrorMm:0,
        poseCone:{reference:injection.pose,halfAngleRad:0}},stock,{...geometryForFilament(unit.operation.filament??source.planning.selection?.filament),forgivenessMm:0}).shape;
      for(const other of candidates(tool,acceptGroup)){
        const solid=other.solids.some(shape=>convexIntersects(tool,shape,ROUNDING_MM));
        if(solid){yield {unit:other.unit,witness:{receiver:null,material:null,stationaryTool:tool}};continue;}
        for(const record of other.records){const witness=travelMaterial(tool,record,ROUNDING_MM);if(witness)
          yield {unit:other.unit,witness:{receiver:null,material:witness.material,stationaryTool:tool}};}
      }
      return hits;
    }
    for(const root of body.records)for(const {record,others} of queryRegions(root,id=>!seen.has(id)&&acceptGroup(id)&&!proofs.unitClear(unit,byId.get(id).unit)))for(const other of others.sort((a,b)=>{
      const x=source.layers[a.unit.layerId],y=source.layers[b.unit.layerId];return x&&y&&x.stackId===y.stackId?x.index-y.index:0;
    })){
      if(seen.has(other.unit.id)||!acceptGroup(other.unit.id))continue;
      const state={witness:null};
      for(const solid of other.solids){state.witness=pair(record,null,solid);if(state.witness)break;}
      if(!state.witness){
        const remaining=other.records.filter(candidate=>!knownCourseClear(record.ref,candidate.ref)).map(candidate=>({candidate,key:pairKey(record,candidate)})).filter(query=>knownPair(query.key)?.witness!==null);
        if(!remaining.length)continue;
        const courses=new Map();for(const query of remaining){
          const id=query.candidate.ref.id;if(!courses.has(id))courses.set(id,{queries:[],pending:0});courses.get(id).queries.push(query);
        }
        const cells=regionalMaterial(other,nozzle(record).shape).filter(candidate=>courses.has(candidate.ref.id));
        for(const candidate of cells)courses.get(candidate.ref.id).pending++;
        // Keep each completed course proof even when a later course blocks.
        function remember(group){for(const query of group.queries)if(!rememberCourseClear(record.ref,query.candidate.ref))rememberPair(query.key,null);}
        for(const group of courses.values())if(!group.pending)remember(group);
        for(const candidate of cells){
          state.witness=pair(record,candidate,null,{cacheClear:false});if(state.witness)break;
          const group=courses.get(candidate.ref.id);if(!--group.pending)remember(group);
        }
      }
      if(state.witness){seen.add(other.unit.id);yield {unit:other.unit,witness:state.witness};}
    }
    return hits;
  }
  // Unbound work is placed from actual deposited sections. A chart is neither
  // solid material nor evidence that a producer has finished.
  function underside(record){
    const body=material(record);if(!body)return null;if(!body.frame)return body.shape;
    const depth=(record.depth[0]+record.depth[1])/2,n=body.frame.normal,slack=Math.min(PRINT_RESOLUTION_MM,record.depth[1]/4);
    const shape={a:add(record.start.point,scale(n,-depth+slack)),b:add(record.end.point,scale(n,-depth+slack)),normal:n,
      side:body.frame.side,radius:Math.max(record.range.widthMm[1]/4,record.range.widthMm[1]/2-PRINT_RESOLUTION_MM),depth:PRINT_RESOLUTION_MM+slack};
    const margin=(body.sphericalErrorMm??body.errorMm)+(record.depth[1]-record.depth[0])/2+PRINT_RESOLUTION_MM*body.normalError,radialMargin=body.planarErrorMm??0;
    return margin||radialMargin?{parts:[shape],margin,...(radialMargin?{radialMargin,radialNormal:n}:{})}:shape;
  }
  function sectionBody(at){
    const face=section(at);if(!face)return null;
    return {a:at.point,b:at.point,normal:face.frame.normal,side:face.frame.side,radius:at.widthMm/2,depth:at.areaMm2/at.widthMm};
  }
  function exposedSupport(shape,candidate){
    if(!shape||!candidate)return false;
    const n=shape.normal,delta=subtract(shape.b,shape.a),size=length(delta),along=size>ROUNDING_MM?scale(delta,1/size):[0,0,0];
    const inset=Math.min(PRINT_RESOLUTION_MM,size/4),slack=Math.min(PRINT_RESOLUTION_MM,shape.depth/4),base=add(shape.a,scale(n,-shape.depth)),level=dot(base,n);
    const under={a:add(add(base,scale(n,slack)),scale(along,inset)),b:add(add(shape.b,scale(n,-shape.depth+slack)),scale(along,-inset)),
      normal:n,side:shape.side,radius:Math.max(shape.radius/2,shape.radius-PRINT_RESOLUTION_MM),depth:PRINT_RESOLUTION_MM+slack};
    if(!convexIntersects(under,candidate,ROUNDING_MM))return false;
    if(dot(candidate.normal,n)>ROUNDING_RELATIVE&&convexIntersects(under,{...candidate,depth:0},ROUNDING_MM)&&
      !convexIntersects({...shape,depth:shape.depth/2},candidate,ROUNDING_MM))return true;
    const gap=dot(convexSupport(candidate,n),n)-level,backDepth=-Math.min(0,dot(candidate.normal,n))*candidate.depth;
    return gap>=-PRINT_RESOLUTION_MM*2&&gap<=Math.min(PRINT_RESOLUTION_MM*2,shape.depth/2)&&
      (backDepth<=ROUNDING_MM||gap-backDepth>=-Math.min(PRINT_RESOLUTION_MM*2,backDepth/2));
  }
  // A candidate's side or bottom can intersect the receiver's underside while
  // its exposed top is elsewhere. Reject that case before fine subdivision.
  function possibleSupport(a,b,am,under){
    if(!am.frame)return true;
    const n=am.frame.normal,cosine=Math.max(-1,1-am.normalError**2/2);
    const projection=(bounds,high)=>n.reduce((sum,v,k)=>sum+v*bounds[(v>=0)===high?'max':'min'][k],0);
    const levelHi=projection(a.range.bounds,true)-(cosine>=0?a.depth[0]:a.depth[1])*cosine+a.range.widthMm[1]/2*am.normalError;
    if(projection(b.range.bounds,false)-levelHi<=Math.min(PRINT_RESOLUTION_MM*2,a.depth[1]/2)+ROUNDING_MM)return true;
    b.top??=rectangularSweepEnvelope({from:b.start.point,to:b.end.point,bounds:b.range.bounds,
      chordErrorMm:b.chordErrorMm,tangentCone:b.tangentCone,normalCone:b.normalCone,
      radius:b.range.widthMm.map(width=>width/2),depth:[0,0]});
    return convexIntersects(under,b.top.shape,ROUNDING_MM);
  }
  function substratePair(receiver,candidate){
    const pending=[[receiver,candidate]];
    while(pending.length){
      const [a,b]=pending.pop();if(a.depth[1]===0||b.depth[1]===0)continue;
      stats.substratePairs++;
      // The contact band reaches at most print resolution below a section;
      // retain the existing two-resolution support allowance plus rounding.
      if(!boundsOverlap(materialBounds(a),materialBounds(b),PRINT_RESOLUTION_MM*2+ROUNDING_MM))continue;
      const am=material(a),bm=material(b);if(!am||!bm)continue;
      const under=underside(a);
      if(!convexIntersects(under,bm.shape,ROUNDING_MM)||!possibleSupport(a,b,am,under))continue;
      if(am.exact&&bm.exact){if(exposedSupport(am.shape,bm.shape))return {receiver:a.ref,material:b.ref,substrate:true};continue;}
      for(const [u,at] of samples(a)){
        const face=sectionBody(at);if(!face)continue;
        if(bm.exact&&exposedSupport(face,bm.shape))return {receiver:localWitness(a,u),material:b.ref,substrate:true};
        for(const [v,value] of samples(b))if(exposedSupport(face,sectionBody(value)))
          return {receiver:localWitness(a,u),material:localWitness(b,v),substrate:true};
      }
      let splitA=a.range.breaks.length>0||!b.range.breaks.length&&!am.exact&&(bm.exact||am.errorMm>=bm.errorMm),chosen=splitA?a:b;
      let children=divide(chosen);
      if(!children){splitA=!splitA;chosen=splitA?a:b;children=divide(chosen);}
      if(!children)throw unresolved(a,b);requireTangent(chosen);
      for(const child of children)pending.push(splitA?[child,b]:[a,child]);
    }
    return null;
  }
  function* substrateHits(unit,acceptGroup){
    const body=byId.get(unit.id),seen=new Set();
    if(!Number.isFinite(body.bounds.min[0])||!candidates(convexBox(body.bounds),acceptGroup).length)return;
    for(const root of body.records){
      const under=underside(root);if(!under)continue;
      for(const other of candidates(under,acceptGroup))for(const candidate of regionalMaterial(other,under)){
        const key=JSON.stringify([root.ref.id,root.ref.from,root.ref.to,candidate.ref.id,candidate.ref.from,candidate.ref.to]);
        if(seen.has(key))continue;
        const witness=substratePair(root,candidate);if(!witness)continue;
        seen.add(key);yield {unit:other.unit,witness};
      }
    }
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
      else for(const record of body.records){const witness=volumeHit(record,requirement.volume);if(witness)hits.push({unit:body.unit,witness});}
      if(state.witness)hits.push({unit:body.unit,witness:state.witness});
    }
    return hits;
  }
  function selfProofKey(kind,ranges){return JSON.stringify([kind,...ranges.map(ref=>[ref.id,ref.from,ref.to,Boolean(ref.reverse)])]);}
  function knownSelf(key){
    const bytes=selfProofs.entries.get(key);if(bytes===undefined)return false;
    selfProofs.entries.delete(key);selfProofs.entries.set(key,bytes);
    selfProofs.hits=(selfProofs.hits??0)+1;
    if(selfProofs.hits>=selfProofs.entries.size){selfProofs.oldest=selfProofs.entries.keys();selfProofs.hits=0;}
    return true;
  }
  function rememberSelf(key){
    const bytes=key.length*2+128;
    if(bytes<=cacheLimit){
      while(selfProofs.bytes+bytes>cacheLimit){const first=selfProofs.oldest.next().value;selfProofs.bytes-=selfProofs.entries.get(first);selfProofs.entries.delete(first);}
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
        const next=pending.pop(),body=material(next);if(!body||proofs.rangeClear(next,next)||!convexIntersects(nozzle(next).shape,body.shape,ROUNDING_MM))continue;
        requireTangent(next);const children=divide(next);if(!children)throw unresolved(next,next);
        const first=next.ref.reverse?children[1]:children[0],last=next.ref.reverse?children[0]:children[1];
        const hit=pair(last,first);if(hit)conflict(hit);pending.push(...children);
      }
      rememberSelf(courseKey);
    }
    rememberSelf(key);
  }
  function materialAccessConflict(required,blocked){
    const a=required?.material,b=blocked?.material;
    if(!required?.requiredVolume||!blocked?.stationaryTool||!a||!b||a.id!==b.id)return null;
    const from=Math.max(a.from,b.from),to=Math.min(a.to,b.to);if(from>=to)return null;
    const record=interval({...a,from,to}),body=material(record);
    if(record.affine&&body?.exact){
      const face=section(record.start),delta=subtract(record.end.point,record.start.point);
      const support=face&&translationContactInterval(face,delta,required.requiredVolume),access=face&&translationContactInterval(face,delta,blocked.stationaryTool);
      if(support&&access&&Math.max(support.from,access.from)<=Math.min(support.to,access.to))
        return {material:localWitness(record,parameterAt(record.ref,(Math.max(support.from,access.from)+Math.min(support.to,access.to))/2))};
    }
    for(const at of [a.at,b.at,(from+to)/2]){
      if(!Number.isFinite(at)||at<from||at>to)continue;
      const face=section(curveAt(reader,a.curveId,at));
      if(face&&convexIntersects(face,required.requiredVolume,ROUNDING_MM)&&convexIntersects(face,blocked.stationaryTool,ROUNDING_MM))
        return {material:localWitness(record,at)};
    }
    return null;
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
    if(witness?.stationaryTool&&witness.material){
      const b=interval(witness.material),bm=material(b);
      if(b.affine&&bm?.exact){
        const face=section(b.start),contact=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),witness.stationaryTool);
        if(contact)result.push({courseId:b.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(b.ref,u))});
      }
      return result;
    }
    if(!witness?.receiver||!witness.material)return result;
    if(witness.substrate){
      const a=interval(witness.receiver),b=interval(witness.material),am=material(a),bm=material(b);
      if(!am?.exact||!bm?.exact)return result;
      if(a.affine){
        const band=underside({...a,end:a.start}),contact=translationContactInterval(band,subtract(a.end.point,a.start.point),bm.shape);
        if(contact)result.push({courseId:a.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(a.ref,u))});
      }
      if(b.affine){
        const face=section(b.start),contact=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),underside(a));
        if(contact)result.push({courseId:b.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(b.ref,u))});
      }
      return result;
    }
    const a=interval(witness.receiver),b=interval(witness.material),am=nozzle(a),bm=material(b);
    if(!am.exact||!bm?.exact)return result;
    if(a.affine){
      const tool=cone(a.start,NOZZLE_FORGIVENESS_MM,geometryFor(a.ref)),contact=translationContactInterval(tool,subtract(a.end.point,a.start.point),bm.shape);
      if(contact)result.push({courseId:a.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(a.ref,u))});
    }
    if(b.affine){
      const face=section(b.start),contact=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),am.shape);
      if(contact)result.push({courseId:b.ref.id,parameters:[contact.from,contact.to].map(u=>parameterAt(b.ref,u))});
    }
    return result;
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
      if(af&&bf&&convexIntersects(cone(at,forgiveness,geometryFor(first)),bf,ROUNDING_MM)&&convexIntersects(cone(bt,forgiveness,geometryFor(second)),af,ROUNDING_MM))
        return {receiver:first,material:second};
    }
    const a=interval(first),b=interval(second),am=material(a),bm=material(b);
    if(!a.affine||!b.affine||!am?.exact||!bm?.exact)return null;
    const contact=translationContactInterval(cone(a.start,NOZZLE_FORGIVENESS_MM,geometryFor(a.ref)),subtract(a.end.point,a.start.point),bm.shape);
    if(!contact)return null;
    for(const t of [contact.at,(contact.from+contact.to)/2]){
      const u=parameterAt(a.ref,t),at=curveAt(reader,a.ref.curveId,u);
      const tool=cone(at,NOZZLE_FORGIVENESS_MM+ROUNDING_MM*4,geometryFor(a.ref)),face=section(b.start);
      const other=face&&translationContactInterval(face,subtract(b.end.point,b.start.point),tool);
      if(!other)continue;
      const v=parameterAt(b.ref,other.at);
      if(a.ref.id===b.ref.id&&u===v)continue;
      const bt=curveAt(reader,b.ref.curveId,v),af=section(at);
      if(af&&convexIntersects(cone(bt,NOZZLE_FORGIVENESS_MM+ROUNDING_MM*4,geometryFor(b.ref)),af,ROUNDING_MM))
        return {receiver:{...a.ref,at:u},material:{...b.ref,at:v}};
    }
    return null;
  }
  function recordDeposit(id,count){
    const body=byId.get(id),previous=deposited.get(id)??0;
    function includeDeposit(bounds){for(let k=0;k<3;k++){depositedBounds.min[k]=Math.min(depositedBounds.min[k],bounds.min[k]);depositedBounds.max[k]=Math.max(depositedBounds.max[k],bounds.max[k]);}}
    for(let i=previous;i<count;i++){
      const record=body.records[i];if(record.depth[1]===0)continue;
      includeDeposit(materialBounds(record));
    }
    if(!occupiedIds.has(id))for(const solid of body.solids)includeDeposit(convexBounds(solid));
    occupiedIds.add(id);deposited.set(id,count);
  }
  return {source,reader,index,byId,stats,proofs,nozzleGeometry,geometryForFilament,nozzleHits,substrateHits,requiredHits,verifySelf,cutsForWitness,materialAccessConflict,mutualConflict,
    interval,pair,deposited,occupied:occupiedIds,depositedBounds,recordDeposit,withinGroups:null,groupPrefixes:null,
    operationOf:id=>byId.get(id)?.unit.sourceOperation??id};
}
