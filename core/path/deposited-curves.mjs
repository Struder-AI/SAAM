import {extrudedSegmentBounds,extrudedSegmentsContain,raycastExtrudedSegments} from '../geom/extruded-segments.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {distance,requireThat,subtract,add,scale,dot,cross,normalize} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,CONSTRUCTION_TOLERANCE_MM,CHORD_TOLERANCE_MM} from '../dimensions.mjs';


import {strokeRange} from './deposition.mjs';
import {pointSegmentDistance} from '../region/region2d.mjs';

// Publish individual nominal bead strands after all curve/process edits. No
// bounding rectangle or filled sheet is inferred between disconnected strands.
// source selects one producer; operationId retains the scheduling prerequisite.
export function depositedCurveSegments(operations,{widthMm,source=null,horizontalOnly=false,excludedRoles=[]}={}) {
  const segments=[];
  for(const op of operations)for(const stroke of op.strokes){
    if(excludedRoles.includes(stroke.role)||stroke.points.length<2)continue;
    const points=stroke.closed?strokeRange({points:stroke.points,closed:true}).points:stroke.points;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);
      const volume=stroke.volumesMm3?.[i-1]??length*(stroke.beadAreaMm2??0);
      if(volume<=0||length<PRINT_RESOLUTION_MM||horizontalOnly&&Math.abs(a[2]-b[2])>=PRINT_RESOLUTION_MM)continue;
      const width=stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm??widthMm;
      segments.push({a,b,source,operationId:op.id,radius:width/2});
    }
  }
  return segments;
}

// Process scale: default lateral support tolerance, a small fraction of a line width.
export function curveSupportsPoint(segments,p,z,{source=null,toleranceMm=(1.5*CONSTRUCTION_TOLERANCE_MM)}={}) {
  return segments.some(s=>(source===null||s.source===source||s.operationId===source)&&
    p[0]>=Math.min(s.a[0],s.b[0])-s.radius-toleranceMm&&p[0]<=Math.max(s.a[0],s.b[0])+s.radius+toleranceMm&&
    p[1]>=Math.min(s.a[1],s.b[1])-s.radius-toleranceMm&&p[1]<=Math.max(s.a[1],s.b[1])+s.radius+toleranceMm&&
    pointSegmentDistance(p,s.a,s.b)<=s.radius+toleranceMm&&atSupportHeight(p,z,s.a,s.b));
}

function atSupportHeight(p,z,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
  if(squared<ROUNDING_MM**2)return false;
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared));
  return Math.abs(a[2]+t*(b[2]-a[2])-z)<PRINT_RESOLUTION_MM;
}

// Freeze the source reference normal before a field moves the centerline away
// from that reference. These are bead-frame data, not tool-orientation commands.
export function depositedBeadFrames(result){
  return {...result,operations:result.operations.map(op=>({...op,strokes:op.strokes.map(stroke=>{
    const points=stroke.closed?strokeRange({points:stroke.points,closed:true}).points:stroke.points;
    const segmentMetadata=points.slice(1).map((b,i)=>{
      const previous=stroke.segmentMetadata?.[i]??{};
      const normal=previous.surfaceNormal??stroke.frameSamples?.[i]?.normal??stroke.normals?.[i]??stroke.poses?.[i]?.toolAxis.map(v=>-v)??(op.slice
        ?evaluateSurface(op.slice,[0,0]).normal:[0,0,1]);
      return {...previous,surfaceNormal:[...normal]};
    });
    return {...stroke,segmentMetadata};
  })}))};
}

// Rectangular normal-gap beads in their local surface frame, with round ends. Width
// and gap come from the final positive-volume strokes; no filled envelope is
// inferred between them. The normal is the declared deposition reference.
// An optional boundaryRole selects finalized source segments by their published
// geometric boundary identity; ordinary material queries retain all segments.
export function depositedBeadSegments(operations,{widthMm,boundaryRole=null}={}){
  const segments=[];
  for(const op of operations)for(const stroke of op.strokes){
    const points=stroke.closed?strokeRange({points:stroke.points,closed:true}).points:stroke.points;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);
      const volume=stroke.volumesMm3?.[i-1]??length*(stroke.beadAreaMm2??0);
      if(length<PRINT_RESOLUTION_MM||volume<=0)continue;
      const metadata=stroke.segmentMetadata?.[i-1];
      if(boundaryRole!==null&&metadata?.boundaryRole!==boundaryRole)continue;
      const width=metadata?.beadWidthMm??stroke.beadWidthMm??widthMm;
      const normal=metadata?.surfaceNormal??stroke.frameSamples?.[i-1]?.normal??stroke.normals?.[i-1]??stroke.poses?.[i-1]?.toolAxis.map(v=>-v)??(op.slice
        ?evaluateSurface(op.slice,[0,0]).normal:[0,0,1]);
      requireThat(Number.isFinite(width)&&width>0,'Deposited bead coverage needs positive width.');
      const tangent=normalize(subtract(b,a));
      const reference=normalize(subtract(normal,scale(tangent,dot(normal,tangent))));
      const heightMm=volume/(length*width);
      segments.push({a,b,radius:width/2,normal:reference,heightMm,operationId:op.id});
    }
  }
  return segments;
}

// Toolpath interprets shape hits as contacts with the producing operation.
export const depositedBeadBounds=extrudedSegmentBounds;
export function depositedBeadsContain(segments,point,toleranceMm=CHORD_TOLERANCE_MM){
  return extrudedSegmentsContain(segments,point,{toleranceMm});
}
export function beadContactAlong(segments,point,direction,options={}){
  const hit=raycastExtrudedSegments(segments,point,scale(direction,-1),options);
  return hit?{...hit,operationId:segments[hit.segmentIndex].operationId}:null;
}
