// Scheduling interprets material contacts and nozzle-access hits as precedence.
// Geometry owns all numerical volume and sweep predicates.
import {prepareCurvePath,curveRange,curveAt} from './curve-path.mjs';
import {depositedBeadSegments} from './deposited-curves.mjs';
import {convexSupport,convexIntersects,convexSpatialIndex,nozzleSweepHits,DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,NOZZLE_FORGIVENESS_MM,convexBounds,rectangularSection,rectangularSweepEnvelope,nozzleCurveEnvelope,nozzleAt,nozzleSweepReach,nozzleIntervalIntersects,translationContactInterval} from '../geom/convex-clearance.mjs';
import {add,scale,dot,subtract,length,cross,normalize,requireThat} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {uprightPose} from './pose.mjs';
import {precedenceLookup,prerequisiteProofs} from './precedence.mjs';
import {strokeRange} from './deposition.mjs';
import {interpolateDirectionPair} from '../geom/frame.mjs';

export function depositionCourses(operations,{splitConnectors=new Set(),splitStrokes=new Map()}={}){
  const groups=new Map(),courses=[],sequence=[],sources=new Map();
  for(const operation of operations){
    const chunks=[];
    if(operation.continuous||operation.strokes.some(s=>s.stationaryExtrusion))chunks.push(operation.strokes);
    else for(const original of operation.strokes)for(const stroke of splitStrokes.get(original)??[original]){
      if(splitStrokes.has(original))sources.set(stroke,original);
      const previous=chunks.at(-1),connector=stroke.segmentMetadata?.some(m=>m.connector);
      if(!sources.has(stroke)&&!sources.has(previous?.at(-1))&&!splitConnectors.has(operation.id)&&previous&&
        (connector||previous.at(-1).segmentMetadata?.some(m=>m.connector)))previous.push(stroke);
      else chunks.push([stroke]);
    }
    if(!chunks.length)chunks.push([]);
    const units=chunks.map((strokes,index)=>({...operation,id:chunks.length===1?operation.id:operation.id+'/course:'+index,
      sourceOperation:operation.id,strokes}));
    for(let i=1;i<units.length;i++){
      const a=chunks[i-1].at(-1),b=chunks[i][0];
      if([a,b].some(stroke=>stroke?.segmentMetadata?.some(m=>m.connector)))
        sequence.push({before:units[i-1].id,after:units[i].id,kind:'connector-order'});
    }
    groups.set(operation.id,units.map(unit=>unit.id));courses.push(...units);
  }
  return {courses,groups,sequence,sources};
}

// A straight depositing edge can cross both a prerequisite wall and a future
// cover. Split it without changing its line, deposited volume or surface normal.
function bisectEdge(stroke){
  const [a,b]=stroke.points,middle=a.map((v,k)=>v+(b[k]-v)/2);
  if(Math.min(length(subtract(middle,a)),length(subtract(b,middle)))<PRINT_RESOLUTION_MM+ROUNDING_MM)return null;
  const midpoint=(a,b)=>typeof a==='number'&&typeof b==='number'?a+(b-a)/2:Array.isArray(a)&&Array.isArray(b)?a.map((v,k)=>midpoint(v,b[k])):
    a&&b&&typeof a==='object'&&typeof b==='object'?Object.fromEntries(Object.keys(a).map(key=>[key,midpoint(a[key],b[key])])):a;
  const expanded={...stroke,points:[a,middle,b]};
  for(const key of ['normals','frameSamples','curveParameters','chartPoints','referenceAlong'])if(stroke[key])
    expanded[key]=[stroke[key][0],midpoint(stroke[key][0],stroke[key][1]),stroke[key][1]];
  if(stroke.poses){
    const [toolAxis,toolUp]=interpolateDirectionPair([stroke.poses[0].toolAxis,stroke.poses[0].toolUp],[stroke.poses[1].toolAxis,stroke.poses[1].toolUp],.5);
    expanded.poses=[stroke.poses[0],{toolAxis,toolUp},stroke.poses[1]];
  }
  for(const key of ['volumesMm3','segmentMetadata','heightsMm','widthsMm','flowMultipliers'])if(stroke[key])
    expanded[key]=[stroke[key][0],stroke[key][0]].map(value=>key==='volumesMm3'?value/2:value);
  const normal=stroke.segmentMetadata?.[0]?.surfaceNormal??stroke.frameSamples?.[0]?.normal??stroke.normals?.[0]??stroke.poses?.[0]?.toolAxis.map(v=>-v)??[0,0,1];
  expanded.segmentMetadata=[0,1].map(()=>({...stroke.segmentMetadata?.[0],surfaceNormal:normal}));
  return expanded;
}

export function refineCourseStrokes(partition,affected,splitStrokes){
  const cuts=[];
  for(const course of partition.courses){
    if(!affected.has(course.id)||course.continuous||course.strokes.some(stroke=>stroke.stationaryExtrusion))continue;
    for(const stroke of course.strokes){
      let full=stroke.closed?strokeRange(stroke):stroke;
      if(full.points.length===2){full=bisectEdge(full);if(!full)continue;}
      const last=full.points.length-1;if(last<2)continue;
      const middle=Math.floor(last/2),pieces=[strokeRange(full,0,middle),strokeRange(full,middle,last)];
      const original=partition.sources.get(stroke)??stroke,previous=splitStrokes.get(original)??[stroke],at=previous.indexOf(stroke);
      splitStrokes.set(original,[...previous.slice(0,at),...pieces,...previous.slice(at+1)]);cuts.push(original);
    }
  }
  return cuts.length;
}

export function physicalOrdering(courses,{onProgress,prerequisites=new Map()}={}){
  const beads=courses.flatMap(course=>depositedBeadSegments([course],{widthMm:course.process?.lineWidthMm??.4}));
  onProgress?.({stage:'Indexing deposited beads',completed:0,total:beads.length});
  const byStart=new Map();
  for(const [i,bead] of beads.entries()){if(!byStart.has(bead.a))byStart.set(bead.a,[]);byStart.get(bead.a).push(i);}
  // Segment bodies end at their authored vertices. Rounding every interior
  // sample overhangs a curved course and invents self-obstructions.
  const shapes=beads.map(bead=>({a:bead.a,b:bead.b,normal:bead.normal,side:normalize(cross(bead.normal,subtract(bead.b,bead.a))),radius:bead.radius,depth:bead.heightMm}));
  const layerOf=new Map(courses.map(course=>[course.id,course.layerId]));
  const index=convexSpatialIndex(shapes,{groups:beads.map(bead=>bead.operationId),partitions:beads.map(bead=>layerOf.get(bead.operationId))}),edges=[];
  const contacts=new Map(courses.map(course=>[course.id,new Set()])),blockers=new Map(courses.map(course=>[course.id,new Set()]));
  const supportProofs=prerequisiteProofs(courses.map(course=>course.id));
  for(const [after,parents] of prerequisites)for(const before of parents)supportProofs.record(before,after);
  const counts={substrateDependencies:0,nozzleDependencies:0,materialDependencies:0};
  function edge(before,after,kind){
    if(before===after)return;
    const material=kind!=='nozzle-access',seen=material?contacts.get(after):blockers.get(before),other=material?before:after;
    if(seen.has(other))return;seen.add(other);edges.push({before,after,kind});
    if(material){counts[kind==='substrate'?'substrateDependencies':'materialDependencies']++;supportProofs.record(before,after);}else counts.nozzleDependencies++;
  }
  const partOf=new Map(courses.map(course=>[course.id,course.part]));
  for(const course of courses)for(const requirement of course.requiredMaterial??[]){
    for(const hit of index.query(requirement.volume,ROUNDING_MM,{firstPerGroup:true,
      acceptGroup:group=>group!==course.id&&partOf.get(group)===requirement.part}))
      edge(beads[hit].operationId,course.id,'required-material');
  }
  for(const [i,bead] of beads.entries()){
    // Reporting cadence only; this does not bound the contact search.
    if(i%1024===0)onProgress?.({stage:'Resolving material support',completed:i,total:beads.length});
    const shape=shapes[i],base=add(bead.a,scale(bead.normal,-bead.heightMm)),level=dot(base,bead.normal);
    const along=normalize(subtract(bead.b,bead.a)),inset=Math.min(PRINT_RESOLUTION_MM,length(subtract(bead.b,bead.a))/4);
    // A shared lateral edge is not support underneath. Query the interior of
    // the underside footprint. Positive contact slack stops below the receiving
    // bead's midpoint so thin coincident tops cannot become mutual substrate.
    const slack=Math.min(PRINT_RESOLUTION_MM,bead.heightMm/4);
    const underside={a:add(add(base,scale(bead.normal,slack)),scale(along,inset)),
      b:add(add(bead.b,scale(bead.normal,-bead.heightMm+slack)),scale(along,-inset)),
      normal:bead.normal,side:shape.side,radius:Math.max(bead.radius/2,bead.radius-PRINT_RESOLUTION_MM),depth:PRINT_RESOLUTION_MM+slack};
    const upperHalf={...shape,depth:bead.heightMm/2};
    const contactHits=index.query(underside,ROUNDING_MM,{
      accept:j=>{const candidate=shapes[j];
        // The local deposited face can meet this underside while a distant
        // corner lies higher. Material reaching the receiver's upper half is
        // overlapping deposition, not a mandatory substrate relationship.
        if(dot(candidate.normal,bead.normal)>ROUNDING_RELATIVE&&convexIntersects(underside,{...candidate,depth:0},ROUNDING_MM)&&
          !convexIntersects(upperHalf,candidate,ROUNDING_MM))return true;
        const gap=dot(convexSupport(candidate,bead.normal),bead.normal)-level;
        const backDepth=-Math.min(0,dot(candidate.normal,bead.normal))*candidate.depth;
        return gap>=-PRINT_RESOLUTION_MM*2&&gap<=Math.min(PRINT_RESOLUTION_MM*2,bead.heightMm/2)&&
          (backDepth<=ROUNDING_MM||gap-backDepth>=-Math.min(PRINT_RESOLUTION_MM*2,backDepth/2));},
      acceptGroup:group=>group!==bead.operationId&&!supportProofs.proves(group,bead.operationId),firstPerGroup:true
    });
    for(const j of contactHits){
      if(beads[j].operationId===bead.operationId)continue;
      // Overlapping same-layer claims are not substrate relationships. The
      // candidate's upper boundary must actually meet this bead's underside.
      edge(beads[j].operationId,bead.operationId,'substrate');
    }
  }
  const known=[...edges,...[...prerequisites].flatMap(([after,parents])=>[...parents].map(before=>({before,after})))];
  const supportedBefore=precedenceLookup(courses.map(course=>course.id),known);
  // These constraints already prove failure; let composition report its cycle
  // without spending time deriving further, unnecessary nozzle relationships.
  if(supportedBefore.cyclic)return {beads,shapes,index,byStart,edges,...counts};
  for(const [completed,course] of courses.entries()){
    onProgress?.({stage:'Resolving physical print order',completed,total:courses.length});
    // Stationary deposition has no moving bead to justify surface overlap.
    // Keep its actual tip/opening clear, including a thin cover near the tip.
    const forgivenessMm=course.strokes.some(stroke=>stroke.stationaryExtrusion)?0:undefined;
    const laid=new Set(),groupPrefixes=new Map([[course.id,-1]]),blocked=blockers.get(course.id),withinGroups=new Set(courses.filter(other=>!supportedBefore.has(course.id,other.id)).map(other=>other.id));
    for(const stroke of course.strokes){
      const points=stroke.points;
      if(!points.length)continue;
      const intervals=points.length===1?[[0,0]]:points.slice(1).map((_,i)=>[i,i+1]);
      for(const [a,b] of intervals){
        const from=stroke.poses?.[a]??uprightPose(),to=stroke.poses?.[b]??uprightPose();
          for(const j of nozzleSweepHits(index,points[a],points[b],from,to,{
            accept:j=>beads[j].operationId!==course.id||laid.has(j),
            acceptGroup:group=>group===course.id?laid.size>0:!blocked.has(group),
            firstPerGroup:true,withinGroups,groupPrefixes,forgivenessMm
          })){
            if(laid.has(j))throw Object.assign(Error('Continuous course '+course.id+' blocks its own nozzle access; an interruptible boundary or different path is needed.'),
              {code:'CONTINUOUS_NOZZLE_CONFLICT',operation:course.id,segment:[points[a],points[b]],materialSegment:beads[j]});
            edge(course.id,beads[j].operationId,'nozzle-access');
          }
        for(const j of byStart.get(points[a])??[])if(beads[j].operationId===course.id&&beads[j].b===points[b]){laid.add(j);groupPrefixes.set(course.id,Math.max(groupPrefixes.get(course.id),j));}
      }
    }
  }
  return {beads,shapes,index,byStart,edges,...counts};
}

// Scheduling certificate: a complete native slice's nozzle stays on the clear
// side of a material slice. Failure to certify means query children, not collide.

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

export function sliceNozzleProofs(source,{reader=null,ranges=new Map()}={}){
  const slices=new Map(),queries={reader},halfAngle=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG*Math.PI/360;
  const sine=Math.sin(halfAngle),retreat=NOZZLE_FORGIVENESS_MM/sine;
  function rangeOf(course){
    if(!queries.reader)queries.reader=prepareCurvePath(source);
    if(!ranges.has(course.id))ranges.set(course.id,curveRange(queries.reader,course.curveId,course.from,course.to));
    return ranges.get(course.id);
  }
  for(const operation of Object.values(source.operations)){
    if(operation.layerId===null)continue;
    const id=operation.layerId;
    if(!slices.has(id))slices.set(id,{id,normal:null,minTip:Infinity,maxMaterial:-Infinity,eligible:true,courses:0});
    const slice=slices.get(id);
    // Stationary occupied geometry is a separate authored record. Do not
    // accidentally certify it from the absence of moving deposition curves.
    if(operation.kind!=='deposit'){slice.eligible=false;continue;}
    for(const course of operation.courses){
      slice.courses++;
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
      slice.minTip=Math.min(slice.minTip,low+retreat*cosine-ROUNDING_MM);
    }
  }
  const eligible=[...slices.values()].filter(slice=>slice.eligible&&slice.courses);
  return {slices,summary:{slices:slices.size,certifiableSlices:eligible.length},clear(depositingLayer,materialLayer){
    const a=slices.get(depositingLayer),b=slices.get(materialLayer);
    return Boolean(a?.eligible&&b?.eligible&&a.courses&&b.courses&&equalVector(a.normal,b.normal)&&a.minTip>b.maxMaterial+ROUNDING_MM);
  }};
}

// Compact source intervals remain the scene's leaves. Only unresolved queries
// open children; the cache may evict numerical work without changing the scene.
export function prepareRangeScene(source,reader,units,{onProgress,supportPrecision=PRINT_RESOLUTION_MM/8}={}){
  const stats={rangeQueries:0,rangeCacheHits:0,rangeSubdivisions:0,nozzlePairs:0,supportPairs:0,cacheBytes:0,peakCacheBytes:0};
  const cache=new Map(),cacheLimit=16*1024*1024,byId=new Map(),bodies=[],boxes=[],deposited=new Map();
  const stock={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  function remember(key,record){
    const bytes=2048+record.range.breaks.length*8;
    if(bytes>cacheLimit)return record;
    while(stats.cacheBytes+bytes>cacheLimit&&cache.size){const first=cache.keys().next().value;stats.cacheBytes-=cache.get(first).bytes;cache.delete(first);}
    cache.set(key,{record,bytes});stats.cacheBytes+=bytes;stats.peakCacheBytes=Math.max(stats.peakCacheBytes,stats.cacheBytes);return record;
  }
  function interval(ref){
    const key=JSON.stringify([ref.id,ref.curveId,ref.from,ref.to]),known=cache.get(key);
    if(known){cache.delete(key);cache.set(key,known);stats.rangeCacheHits++;return known.record;}
    stats.rangeQueries++;
    const curve=source.curves[ref.curveId],range=curveRange(reader,ref.curveId,ref.from,ref.to);
    const start=curveAt(reader,ref.curveId,ref.from),end=curveAt(reader,ref.curveId,ref.to,{side:'left'});
    const chord=length(subtract(end.point,start.point));
    const linear=curve.geometry.kind==='polyline'&&range.breaks.length===0;
    const tangentCone=range.tangentCone??{axis:start.tangent??end.tangent??[1,0,0],halfAngleRad:linear?0:Math.PI};
    const normal=constantVector(curve.profiles.materialNormal),axis=constantVector(curve.profiles.pose,value=>value.toolAxis);
    const normalCone=normal?{axis:normal,halfAngleRad:0}:range.normalCone;
    const poseCone=axis?{reference:start.pose,halfAngleRad:0}:range.poseCone;
    // Arc length also bounds an ellipse containing every curve point. This
    // remains conservative while the shared reader's chord bound is migrating.
    const chordErrorMm=range.chordErrorMm??(linear?0:Math.sqrt(Math.max(0,range.lengthMm[1]**2-chord**2))/2);
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
      radius:record.range.widthMm.map(width=>width/2),depth:record.depth});
    return record.material;
  }
  function nozzle(record){
    if(!record.nozzle)record.nozzle=nozzleCurveEnvelope({from:record.start.point,to:record.end.point,bounds:record.range.bounds,
      chordErrorMm:record.chordErrorMm,poseCone:record.poseCone},stock);
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
    function addBounds(bounds){for(let k=0;k<3;k++){local.min[k]=Math.min(local.min[k],bounds.min[k]);local.max[k]=Math.max(local.max[k],bounds.max[k]);}}
    for(const record of records)if(record.depth[1]>0){
      const expansion=record.range.widthMm[1]/2+record.depth[1];
      addBounds({min:record.range.bounds.min.map(v=>v-expansion),max:record.range.bounds.max.map(v=>v+expansion)});
    }
    for(const solid of solids)addBounds(convexBounds(solid));
    const body={unit,records,solids};byId.set(unit.id,body);
    if(Number.isFinite(local.min[0])){include(local);bodies.push(body);boxes.push({vertices:boxCorners(local)});}
    if(i%256===0)onProgress?.({stage:'Preparing curve bounds',completed:i,total:units.length});
  }
  const proxy=convexSpatialIndex(boxes,{groups:bodies.map(body=>body.unit.id),partitions:bodies.map(body=>body.unit.layerId??body.unit.operation)});
  const proofs=sliceNozzleProofs(source,{reader});
  function candidates(shape,acceptGroup,boundsTest=null){
    return proxy.query(shape,ROUNDING_MM,{acceptGroup,firstPerGroup:true,boundsTest}).map(index=>bodies[index]);
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
    return nozzleAt(at.point,scale(at.pose.toolAxis,-1),nozzleSweepReach(stock,at.point,at.point,at.pose,at.pose),DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm);
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
  const index={bounds:stock,query(sweep,toleranceMm=ROUNDING_MM,filters={}){
    const acceptGroup=id=>(!filters.withinGroups||filters.withinGroups.has(id))&&(!filters.acceptGroup||filters.acceptGroup(id))&&(!filters.accept||filters.accept(id));
    const found=[];
    for(const body of candidates(sweep,acceptGroup,filters.boundsTest)){
      const solid=body.solids.some(shape=>convexIntersects(sweep,shape,toleranceMm)&&(!filters.confirm||filters.confirm(shape)));
      const records=deposited.has(body.unit.id)?body.records.slice(0,deposited.get(body.unit.id)):body.records;
      if(solid||records.some(record=>travelMaterial(sweep,record,toleranceMm,filters.confirm)))found.push(body.unit.id);
    }
    return found;
  }};
  function pair(receiver,materialRecord,solid=null,{localize=false}={}){
    const pending=[[receiver,materialRecord]];
    while(pending.length){
      const [a,b]=pending.pop(),nb=nozzle(a),mb=solid?{shape:solid,exact:true,errorMm:0}:material(b);if(!mb)continue;
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
      const splitA=mb.exact||!nb.exact&&nb.errorMm>=mb.errorMm;
      const chosen=splitA?a:b;requireTangent(chosen);
      const children=divide(chosen);if(!children)throw unresolved(a,b);
      for(const child of children)pending.push(splitA?[child,b]:[a,child]);
    }
    return null;
  }
  function nozzleHits(unit,acceptGroup){
    const body=byId.get(unit.id),hits=[],seen=new Set();
    if(!bodies.length)return hits;
    if(unit.operation.kind==='inject'){
      const injection=unit.operation.injection,point=injection.at;
      const tool=nozzleCurveEnvelope({from:point,to:point,bounds:{min:point,max:point},chordErrorMm:0,
        poseCone:{reference:injection.pose,halfAngleRad:0}},stock,{forgivenessMm:0}).shape;
      for(const id of index.query(tool,ROUNDING_MM,{acceptGroup}))hits.push({unit:byId.get(id).unit,witness:{receiver:null,material:null}});
      return hits;
    }
    for(const record of body.records)for(const other of candidates(nozzle(record).shape,id=>!seen.has(id)&&acceptGroup(id))){
      const state={witness:null};
      for(const solid of other.solids){state.witness=pair(record,null,solid);if(state.witness)break;}
      if(!state.witness)for(const candidate of other.records){state.witness=pair(record,candidate);if(state.witness)break;}
      if(state.witness){seen.add(other.unit.id);hits.push({unit:other.unit,witness:state.witness});}
    }
    return hits;
  }
  function underside(record){
    const body=material(record);if(!body)return null;
    if(!body.frame)return body.shape;
    const depth=(record.depth[0]+record.depth[1])/2,n=body.frame.normal,slack=Math.min(PRINT_RESOLUTION_MM,record.depth[1]/4);
    const shape={a:add(record.start.point,scale(n,-depth+slack)),b:add(record.end.point,scale(n,-depth+slack)),normal:n,
      side:body.frame.side,radius:record.range.widthMm[1]/2,depth:PRINT_RESOLUTION_MM+slack};
    const margin=body.errorMm+(PRINT_RESOLUTION_MM+slack)*2;
    return margin?{parts:[shape],margin}:shape;
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
  function supportPair(receiver,candidate){
    const pending=[[receiver,candidate]];
    while(pending.length){
      const [a,b]=pending.pop(),am=material(a),bm=material(b);if(!am||!bm)continue;
      stats.supportPairs++;
      if(am.exact&&bm.exact){if(exactSupport(a,b))return {receiver:a.ref,material:b.ref,provisional:false};continue;}
      if(!convexIntersects(underside(a),bm.shape,ROUNDING_MM))continue;
      const precision=typeof supportPrecision==='number'?supportPrecision:supportPrecision.get(JSON.stringify([a.ref.id,b.ref.id]))??PRINT_RESOLUTION_MM/8;
      if(am.errorMm<=precision&&bm.errorMm<=precision)
        return {receiver:a.ref,material:b.ref,provisional:true,precision};
      const splitA=!am.exact&&(bm.exact||am.errorMm>=bm.errorMm),chosen=splitA?a:b;requireTangent(chosen);
      const children=divide(chosen);if(!children)throw unresolved(a,b);
      for(const child of children)pending.push(splitA?[child,b]:[a,child]);
    }
    return null;
  }
  function supportHits(unit,acceptGroup){
    const hits=[],seen=new Set();
    for(const record of byId.get(unit.id).records){
      const under=underside(record);if(!under)continue;
      for(const other of candidates(under,id=>!seen.has(id)&&acceptGroup(id))){
        const state={witness:null};
        for(const candidate of other.records){state.witness=supportPair(record,candidate);if(state.witness)break;}
        // Stationary occupied solids contribute through explicit material
        // requirements; a convex envelope is not a fabricated substrate face.
        if(state.witness){seen.add(other.unit.id);hits.push({unit:other.unit,witness:state.witness});}
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
  function verifySelf(unit){
    if(unit.operation.kind==='inject'||proofs.clear(unit.layerId,unit.layerId))return;
    const records=byId.get(unit.id).records;
    function conflict(witness){throw Object.assign(Error('A continuous source course blocks its own nozzle access: '+unit.operation.id),
      {code:'CONTINUOUS_NOZZLE_CONFLICT',operation:unit.id,refinementCourses:[unit.id],witness});}
    for(const [i,record] of records.entries()){
      for(const previous of records.slice(0,i)){const hit=pair(record,previous);if(hit)conflict(hit);}
      if(!material(record))continue;
      const pending=[record];
      while(pending.length){
        const next=pending.pop();if(!convexIntersects(nozzle(next).shape,material(next).shape,ROUNDING_MM))continue;
        requireTangent(next);const children=divide(next);if(!children)throw unresolved(next,next);
        const hit=pair(children[1],children[0]);if(hit)conflict(hit);pending.push(...children);
      }
    }
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
  return {source,reader,index,byId,stats,proofs,nozzleHits,supportHits,requiredHits,verifySelf,cutsForWitness,mutualConflict,atomicSupportConflict,
    interval,pair,deposited,occupied:new Set(),withinGroups:null,groupPrefixes:null,
    operationOf:id=>byId.get(id)?.unit.sourceOperation??id};
}

function boxCorners(bounds){return Array.from({length:8},(_,mask)=>bounds.min.map((value,k)=>mask&(1<<k)?bounds.max[k]:value));}
