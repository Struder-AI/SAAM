// Scheduling interprets material contacts and nozzle-access hits as precedence.
// Geometry owns all numerical volume and sweep predicates.
import {depositedBeadSegments} from './deposited-curves.mjs';
import {convexSupport,convexIntersects,convexSpatialIndex,nozzleSweepHits} from '../geom/convex-clearance.mjs';
import {add,scale,dot,subtract,length,cross,normalize} from '../geom/tolerance.mjs';
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
