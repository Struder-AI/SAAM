import {distance,requireThat} from '../geom/tolerance.mjs';
import {sliceNormal} from '../geom/slice.mjs';
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

// Freeze the source reference normal before a field moves the centerline away
// from that reference. These are bead-frame data, not tool-orientation commands.
export function depositedBeadFrames(result){
  return {...result,operations:result.operations.map(op=>({...op,strokes:op.strokes.map(stroke=>{
    const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
    const segmentMetadata=points.slice(1).map((b,i)=>{
      const previous=stroke.segmentMetadata?.[i]??{};
      const normal=previous.surfaceNormal??stroke.normals?.[i]??(op.slice
        ?sliceNormal(op.slice,op.slice.kind==='height-field'?points[i].slice(0,2):[0,0]):[0,0,1]);
      return {...previous,surfaceNormal:[...normal]};
    });
    return {...stroke,segmentMetadata};
  })}))};
}

// Rectangular normal-gap beads in an XY chart, with round segment ends. Width
// and gap come from the final positive-volume strokes; no filled envelope is
// inferred between them. The normal is the declared deposition reference.
export function depositedBeadSegments(operations,{widthMm}={}){
  const segments=[];
  for(const op of operations)for(const stroke of op.strokes){
    const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);
      const volume=stroke.volumesMm3?.[i-1]??length*(stroke.beadAreaMm2??0);
      if(length<1e-9||volume<=0)continue;
      const metadata=stroke.segmentMetadata?.[i-1];
      const width=metadata?.beadWidthMm??stroke.beadWidthMm??widthMm;
      const normal=metadata?.surfaceNormal??stroke.normals?.[i-1]??(op.slice
        ?sliceNormal(op.slice,op.slice.kind==='height-field'?a.slice(0,2):[0,0]):[0,0,1]);
      requireThat(Number.isFinite(width)&&width>0&&normal[2]>1e-8,
        'Deposited XY bead coverage needs positive width and an upward deposition reference.');
      segments.push({a,b,radius:width/2,verticalMm:volume/(length*width*normal[2]),operationId:op.id});
    }
  }
  return segments;
}

export function depositedBeadsContain(segments,point,toleranceMm=.02){
  return segments.some(({a,b,radius,verticalMm})=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
    if(squared<1e-16)return false;
    const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/squared));
    const z=a[2]+t*(b[2]-a[2]);
    return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)<=radius+toleranceMm&&
      point[2]<=z+toleranceMm&&point[2]>=z-verticalMm-toleranceMm;
  });
}

export function depositedTopAt(segments,[x,y],ceilingMm,toleranceMm=.02){
  let top=null;
  for(const {a,b,radius} of segments){
    const dx=b[0]-a[0],dy=b[1]-a[1],squared=dx*dx+dy*dy;
    if(squared<1e-16)continue;
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/squared));
    const z=a[2]+t*(b[2]-a[2]);
    if(z<=ceilingMm+toleranceMm&&Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<=radius+toleranceMm)top=top===null?z:Math.max(top,z);
  }
  return top;
}
