// Scheduling interprets material contacts and nozzle-access hits as precedence.
// Geometry owns all numerical volume and sweep predicates.
import {depositedBeadSegments} from './deposited-curves.mjs';
import {convexSupport,convexSpatialIndex,nozzleSweepHits} from '../geom/convex-clearance.mjs';
import {add,scale,dot,subtract,length,cross,normalize} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {uprightPose} from './pose.mjs';
import {precedenceLookup} from './precedence.mjs';

export function depositionCourses(operations,{splitConnectors=new Set()}={}){
  const groups=new Map(),courses=[],sequence=[];
  for(const operation of operations){
    const chunks=[];
    if(operation.continuous||operation.strokes.some(s=>s.stationaryExtrusion))chunks.push(operation.strokes);
    else for(const stroke of operation.strokes){
      const previous=chunks.at(-1),connector=stroke.segmentMetadata?.some(m=>m.connector);
      if(!splitConnectors.has(operation.id)&&previous&&(connector||previous.at(-1).segmentMetadata?.some(m=>m.connector)))previous.push(stroke);
      else chunks.push([stroke]);
    }
    if(!chunks.length)chunks.push([]);
    const units=chunks.map((strokes,index)=>({...operation,id:chunks.length===1?operation.id:operation.id+'/course:'+index,
      sourceOperation:operation.id,strokes}));
    for(let i=1;i<units.length;i++)if([chunks[i-1].at(-1),chunks[i][0]].some(stroke=>stroke.segmentMetadata?.some(m=>m.connector)))
      sequence.push({before:units[i-1].id,after:units[i].id,kind:'connector-order'});
    groups.set(operation.id,units.map(unit=>unit.id));courses.push(...units);
  }
  return {courses,groups,sequence};
}

export function physicalOrdering(courses,{onProgress,prerequisites=new Map()}={}){
  const beads=courses.flatMap(course=>depositedBeadSegments([course],{widthMm:course.process?.lineWidthMm??.4}));
  onProgress?.({stage:'Indexing deposited beads',completed:0,total:beads.length});
  const byStart=new Map();
  for(const [i,bead] of beads.entries()){if(!byStart.has(bead.a))byStart.set(bead.a,[]);byStart.get(bead.a).push(i);}
  // Segment bodies end at their authored vertices. Rounding every interior
  // sample overhangs a curved course and invents self-obstructions.
  const shapes=beads.map(bead=>({a:bead.a,b:bead.b,normal:bead.normal,side:normalize(cross(bead.normal,subtract(bead.b,bead.a))),radius:bead.radius,depth:bead.heightMm}));
  const index=convexSpatialIndex(shapes,{groups:beads.map(bead=>bead.operationId)}),edges=[];
  const contacts=new Map(courses.map(course=>[course.id,new Set()])),blockers=new Map(courses.map(course=>[course.id,new Set()]));
  const counts={substrateDependencies:0,nozzleDependencies:0};
  function edge(before,after,kind){
    if(before===after)return;
    const seen=kind==='substrate'?contacts.get(after):blockers.get(before),other=kind==='substrate'?before:after;
    if(seen.has(other))return;seen.add(other);edges.push({before,after,kind});
    if(kind==='substrate')counts.substrateDependencies++;else counts.nozzleDependencies++;
  }
  for(const [i,bead] of beads.entries()){
    // Reporting cadence only; this does not bound the contact search.
    if(i%1024===0)onProgress?.({stage:'Resolving material support',completed:i,total:beads.length});
    const shape=shapes[i],base=add(bead.a,scale(bead.normal,-bead.heightMm)),level=dot(base,bead.normal),supportedBy=contacts.get(bead.operationId);
    const along=normalize(subtract(bead.b,bead.a)),inset=Math.min(PRINT_RESOLUTION_MM,length(subtract(bead.b,bead.a))/4);
    // A shared lateral edge is not support underneath. Query the interior of
    // the underside footprint. Positive contact slack stops below the receiving
    // bead's midpoint so thin coincident tops cannot become mutual substrate.
    const underside={a:add(add(base,scale(bead.normal,PRINT_RESOLUTION_MM)),scale(along,inset)),
      b:add(add(bead.b,scale(bead.normal,-bead.heightMm+PRINT_RESOLUTION_MM)),scale(along,-inset)),
      normal:bead.normal,side:shape.side,radius:Math.max(bead.radius/2,bead.radius-PRINT_RESOLUTION_MM),depth:PRINT_RESOLUTION_MM*2};
    const contactHits=index.query(underside,ROUNDING_MM,{
      accept:j=>{const candidate=shapes[j],gap=dot(convexSupport(candidate,bead.normal),bead.normal)-level;
        // Contact through the candidate's back face is not a deposited surface
        // underneath this bead. Side faces remain usable across stack angles.
        const backDepth=-Math.min(0,dot(candidate.normal,bead.normal))*candidate.depth;
        return gap>=-PRINT_RESOLUTION_MM*2&&gap<=Math.min(PRINT_RESOLUTION_MM*2,bead.heightMm/2)&&
          (backDepth<=ROUNDING_MM||gap-backDepth>=-Math.min(PRINT_RESOLUTION_MM*2,backDepth/2));},
      acceptGroup:group=>group!==bead.operationId&&!supportedBy.has(group),firstPerGroup:true
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
    const laid=new Set(),blocked=blockers.get(course.id),withinGroups=new Set(courses.filter(other=>!supportedBefore.has(course.id,other.id)).map(other=>other.id));
    for(const stroke of course.strokes){
      const points=stroke.points;
      if(!points.length)continue;
      const intervals=points.length===1?[[0,0]]:points.slice(1).map((_,i)=>[i,i+1]);
      for(const [a,b] of intervals){
        const from=stroke.poses?.[a]??uprightPose(),to=stroke.poses?.[b]??uprightPose();
          for(const j of nozzleSweepHits(index,points[a],points[b],from,to,{
            accept:j=>beads[j].operationId!==course.id||laid.has(j),
            acceptGroup:group=>group===course.id?laid.size>0:!blocked.has(group),
            firstPerGroup:true,withinGroups
          })){
            if(laid.has(j))throw Object.assign(Error('Continuous course '+course.id+' blocks its own nozzle access; an interruptible boundary or different path is needed.'),
              {code:'CONTINUOUS_NOZZLE_CONFLICT',operation:course.id,segment:[points[a],points[b]],materialSegment:beads[j]});
            edge(course.id,beads[j].operationId,'nozzle-access');
          }
        for(const j of byStart.get(points[a])??[])if(beads[j].operationId===course.id&&beads[j].b===points[b])laid.add(j);
      }
    }
  }
  return {beads,shapes,index,byStart,edges,...counts};
}
