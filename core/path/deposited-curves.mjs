import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,CONSTRUCTION_TOLERANCE_MM} from '../dimensions.mjs';


import {strokeRange} from './deposition.mjs';
import {pointSegmentDistance} from '../region/region2d.mjs';
import {operationCurveSpans} from './curve-path.mjs';

// Publish individual nominal bead strands after all curve/process edits. No
// bounding rectangle or filled sheet is inferred between disconnected strands.
// source selects one producer; operationId retains the scheduling prerequisite.
export function depositedCurveSegments(operations,{widthMm,source=null,horizontalOnly=false,excludedRoles=[]}={}) {
  const segments=[];
  for(const op of operations){
    if(excludedRoles.includes(op.canonicalEntity?.role))continue;
    for(const span of operationCurveSpans(op)){
      if(excludedRoles.includes(span.role))continue;
      const a=span.start.point,b=span.end.point;
      if(!(span.range.rateMm3PerMm[1]>0)||distance(a,b)<PRINT_RESOLUTION_MM||horizontalOnly&&Math.abs(a[2]-b[2])>=PRINT_RESOLUTION_MM)continue;
      segments.push({a,b,source,operationId:op.id,radius:(span.start.widthMm+span.end.widthMm)/4});
    }
  }
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

