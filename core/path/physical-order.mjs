// Scheduling interprets material contacts and nozzle-access hits as precedence.
// Geometry owns all numerical volume and sweep predicates.
import {depositedBeadSegments} from './deposited-curves.mjs';
import {convexSupport,convexSpatialIndex,sweptNozzle,nozzleSweepReach} from '../geom/convex-clearance.mjs';
import {add,scale,dot,subtract,length,cross,normalize} from '../geom/tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {uprightPose} from './pose.mjs';
import {precedenceLookup} from './precedence.mjs';

export function depositionCourses(operations){
  const groups=new Map(),courses=[];
  for(const operation of operations){
    const chunks=[];
    if(operation.continuous||operation.strokes.some(s=>s.stationaryExtrusion))chunks.push(operation.strokes);
    else for(const stroke of operation.strokes){
      const connector=stroke.segmentMetadata?.some(m=>m.connector),previous=chunks.at(-1);
      if(previous&&(connector||previous.at(-1).segmentMetadata?.some(m=>m.connector)))previous.push(stroke);
      else chunks.push([stroke]);
    }
    if(!chunks.length)chunks.push([]);
    const units=chunks.map((strokes,index)=>({...operation,id:chunks.length===1?operation.id:operation.id+'/course:'+index,
      sourceOperation:operation.id,strokes}));
    groups.set(operation.id,units.map(unit=>unit.id));courses.push(...units);
  }
  return {courses,groups};
}

export function physicalOrdering(courses,{onProgress,prerequisites=new Map()}={}){
  const beads=courses.flatMap(course=>depositedBeadSegments([course],{widthMm:course.process?.lineWidthMm??.4}));
  const byStart=new Map();
  for(const [i,bead] of beads.entries()){if(!byStart.has(bead.a))byStart.set(bead.a,[]);byStart.get(bead.a).push(i);}
  // Segment bodies end at their authored vertices. Rounding every interior
  // sample overhangs a curved course and invents self-obstructions.
  const shapes=beads.map(bead=>({a:bead.a,b:bead.b,normal:bead.normal,side:normalize(cross(bead.normal,subtract(bead.b,bead.a))),radius:bead.radius,depth:bead.heightMm}));
  const index=convexSpatialIndex(shapes,{groups:beads.map(bead=>bead.operationId)}),edges=[],contacts=new Set(),blockers=new Set();
  function edge(before,after,kind){
    if(before===after)return;
    const key=before+'\n'+after+'\n'+kind,seen=kind==='substrate'?contacts:blockers;
    if(seen.has(key))return;seen.add(key);edges.push({before,after,kind});
  }
  for(const [i,bead] of beads.entries()){
    const shape=shapes[i],base=add(bead.a,scale(bead.normal,-bead.heightMm)),level=dot(base,bead.normal);
    const along=normalize(subtract(bead.b,bead.a)),inset=Math.min(PRINT_RESOLUTION_MM,length(subtract(bead.b,bead.a))/4);
    // A shared lateral edge is not support underneath. Query the interior of
    // the underside footprint, retaining print-resolution normal contact slack.
    const underside={a:add(add(base,scale(bead.normal,PRINT_RESOLUTION_MM)),scale(along,inset)),
      b:add(add(bead.b,scale(bead.normal,-bead.heightMm+PRINT_RESOLUTION_MM)),scale(along,-inset)),
      normal:bead.normal,side:shape.side,radius:Math.max(bead.radius/2,bead.radius-PRINT_RESOLUTION_MM),depth:PRINT_RESOLUTION_MM*2};
    const contactHits=index.query(underside,ROUNDING_MM,{
      accept:j=>Math.abs(dot(convexSupport(shapes[j],bead.normal),bead.normal)-level)<=PRINT_RESOLUTION_MM*2,
      acceptGroup:group=>group!==bead.operationId&&!contacts.has(group+'\n'+bead.operationId+'\nsubstrate'),firstPerGroup:true
    });
    for(const j of contactHits){
      if(beads[j].operationId===bead.operationId)continue;
      // Overlapping same-layer claims are not substrate relationships. The
      // candidate's upper boundary must actually meet this bead's underside.
      const upper=dot(convexSupport(shapes[j],bead.normal),bead.normal);
      if(Math.abs(upper-level)<=PRINT_RESOLUTION_MM*2)edge(beads[j].operationId,bead.operationId,'substrate');
    }
  }
  const known=[...edges,...[...prerequisites].flatMap(([after,parents])=>[...parents].map(before=>({before,after})))];
  const supportedBefore=precedenceLookup(courses.map(course=>course.id),known);
  // These constraints already prove failure; let composition report its cycle
  // without spending time deriving further, unnecessary nozzle relationships.
  if(supportedBefore.cyclic)return {beads,shapes,index,byStart,edges,substrateDependencies:contacts.size,nozzleDependencies:0};
  for(const [completed,course] of courses.entries()){
    onProgress?.({stage:'Resolving physical print order',completed,total:courses.length});
    const laid=new Set();
    for(const stroke of course.strokes){
      const points=stroke.points;
      if(!points.length)continue;
      const intervals=points.length===1?[[0,0]]:points.slice(1).map((_,i)=>[i,i+1]);
      for(const [a,b] of intervals){
        const from=stroke.poses?.[a]??uprightPose(),to=stroke.poses?.[b]??uprightPose();
        for(const sweep of sweptNozzle(points[a],points[b],from,to,nozzleSweepReach(index.bounds,points[a],points[b],from,to)))
          for(const j of index.query(sweep,ROUNDING_MM,{
            accept:j=>beads[j].operationId!==course.id||laid.has(j),
            acceptGroup:group=>group===course.id?laid.size>0:!supportedBefore.has(course.id,group)&&!blockers.has(course.id+'\n'+group+'\nnozzle-access'),
            firstPerGroup:true
          })){
            if(laid.has(j))throw Object.assign(Error('Continuous course '+course.id+' blocks its own nozzle access; an interruptible boundary or different path is needed.'),
              {code:'CONTINUOUS_NOZZLE_CONFLICT',operation:course.id,segment:[points[a],points[b]],materialSegment:beads[j]});
            edge(course.id,beads[j].operationId,'nozzle-access');
          }
        for(const j of byStart.get(points[a])??[])if(beads[j].operationId===course.id&&beads[j].b===points[b])laid.add(j);
      }
    }
  }
  return {beads,shapes,index,byStart,edges,substrateDependencies:contacts.size,nozzleDependencies:blockers.size};
}
