import {distance} from '../geom/tolerance.mjs';
import {pointSegmentDistance} from '../region/region2d.mjs';

// Publish individual nominal bead strands after all curve/process edits. No
// bounding rectangle or filled sheet is inferred between disconnected strands.
// source selects one producer; operationId retains the scheduling prerequisite.
export function depositedCurveSegments(operations,{widthMm,source=null,horizontalOnly=false,excludedRoles=[]}={}) {
  const segments=[];
  for(const op of operations)for(const stroke of op.strokes){
    if(excludedRoles.includes(stroke.role)||stroke.points.length<2)continue;
    const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);
      const volume=stroke.volumesMm3?.[i-1]??length*(stroke.beadAreaMm2??0);
      if(volume<=0||length<1e-8||horizontalOnly&&Math.abs(a[2]-b[2])>=1e-8)continue;
      const width=stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm??widthMm;
      segments.push({a,b,source,operationId:op.id,radius:width/2});
    }
  }
  return segments;
}

export function curveSupportsPoint(segments,p,z,{source=null,toleranceMm=.015}={}) {
  return segments.some(s=>s.source===source&&
    p[0]>=Math.min(s.a[0],s.b[0])-s.radius-toleranceMm&&p[0]<=Math.max(s.a[0],s.b[0])+s.radius+toleranceMm&&
    p[1]>=Math.min(s.a[1],s.b[1])-s.radius-toleranceMm&&p[1]<=Math.max(s.a[1],s.b[1])+s.radius+toleranceMm&&
    pointSegmentDistance(p,s.a,s.b)<=s.radius+toleranceMm&&atSupportHeight(p,z,s.a,s.b));
}

function atSupportHeight(p,z,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
  if(squared<1e-16)return false;
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared));
  return Math.abs(a[2]+t*(b[2]-a[2])-z)<1e-6;
}
