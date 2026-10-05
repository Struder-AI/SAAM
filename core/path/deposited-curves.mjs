import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {distance,requireThat,subtract,add,scale,dot,cross,normalize} from '../private/toolpath/numeric.mjs';


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
      if(volume<=0||length<1e-8||horizontalOnly&&Math.abs(a[2]-b[2])>=1e-8)continue;
      const width=stroke.segmentMetadata?.[i-1]?.beadWidthMm??stroke.beadWidthMm??widthMm;
      segments.push({a,b,source,operationId:op.id,radius:width/2});
    }
  }
  return segments;
}

export function curveSupportsPoint(segments,p,z,{source=null,toleranceMm=.015}={}) {
  return segments.some(s=>(source===null||s.source===source||s.operationId===source)&&
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
    const points=stroke.closed?strokeRange({points:stroke.points,closed:true}).points:stroke.points;
    const segmentMetadata=points.slice(1).map((b,i)=>{
      const previous=stroke.segmentMetadata?.[i]??{};
      const normal=previous.surfaceNormal??stroke.frameSamples?.[i]?.normal??stroke.normals?.[i]??(op.slice
        ?evaluateSurface(op.slice,op.slice.kind==='height-field'?points[i].slice(0,2):[0,0]).normal:[0,0,1]);
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
      if(length<1e-9||volume<=0)continue;
      const metadata=stroke.segmentMetadata?.[i-1];
      if(boundaryRole!==null&&metadata?.boundaryRole!==boundaryRole)continue;
      const width=metadata?.beadWidthMm??stroke.beadWidthMm??widthMm;
      const normal=metadata?.surfaceNormal??stroke.frameSamples?.[i-1]?.normal??stroke.normals?.[i-1]??(op.slice
        ?evaluateSurface(op.slice,op.slice.kind==='height-field'?a.slice(0,2):[0,0]).normal:[0,0,1]);
      requireThat(Number.isFinite(width)&&width>0,'Deposited bead coverage needs positive width.');
      const tangent=normalize(subtract(b,a));
      const reference=normalize(subtract(normal,scale(tangent,dot(normal,tangent))));
      const heightMm=volume/(length*width);
      segments.push({a,b,radius:width/2,normal:reference,heightMm,operationId:op.id});
    }
  }
  return segments;
}

export function depositedBeadsContain(segments,point,toleranceMm=.02){
  return segments.some(segment=>{
    const {x,y,z,length}=beadCoordinates(segment,point);
    return Math.hypot(x-Math.max(0,Math.min(length,x)),y)<=segment.radius+toleranceMm&&
      z<=toleranceMm&&z>=-segment.heightMm-toleranceMm;
  });
}

export function depositedBeadBounds(segments){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const segment of segments)for(let axis=0;axis<3;axis++){
    const extent=segment.radius*Math.sqrt(Math.max(0,1-segment.normal[axis]**2));
    const depth=-segment.normal[axis]*segment.heightMm;
    min[axis]=Math.min(min[axis],segment.a[axis]-extent+Math.min(0,depth),segment.b[axis]-extent+Math.min(0,depth));
    max[axis]=Math.max(max[axis],segment.a[axis]+extent+Math.max(0,depth),segment.b[axis]+extent+Math.max(0,depth));
  }
  return {min,max};
}

function beadCoordinates(segment,point){
  const tangent=normalize(subtract(segment.b,segment.a)),side=normalize(cross(segment.normal,tangent));
  const relative=subtract(point,segment.a);
  return {x:dot(relative,tangent),y:dot(relative,side),z:dot(relative,segment.normal),
    length:distance(segment.a,segment.b),tangent,side};
}

function slabInterval(position,velocity,low,high){
  const rounding=16*Number.EPSILON*Math.max(1,Math.abs(position),Math.abs(low),Math.abs(high));
  if(Math.abs(velocity)<1e-14)return position>=low-rounding&&position<=high+rounding?[-Infinity,Infinity]:null;
  const a=(low-position)/velocity,b=(high-position)/velocity;
  return [Math.min(a,b),Math.max(a,b)];
}

function diskInterval(x,y,vx,vy,radius){
  const a=vx*vx+vy*vy,b=x*vx+y*vy,c=x*x+y*y-radius*radius;
  if(a<1e-28)return c<=0?[-Infinity,Infinity]:null;
  const discriminant=b*b-a*c;
  if(discriminant<0)return null;
  const root=Math.sqrt(discriminant);
  return [(-b-root)/a,(-b+root)/a];
}

function firstIntervalOverlap(intervals,maxDistanceMm){
  if(intervals.some(interval=>interval===null))return null;
  const low=Math.max(0,...intervals.map(interval=>interval[0]));
  const high=Math.min(maxDistanceMm,...intervals.map(interval=>interval[1]));
  return low<=high?low:null;
}

// First actual bead encountered along point - t*direction, t in world mm.
// The capsule footprint is extruded backwards along its deposition normal;
// disconnected strands never imply a filled support sheet.
export function beadContactAlong(segments,point,direction,{maxDistanceMm=Infinity,toleranceMm=0}={}){
  const ray=scale(normalize(direction),-1);
  let nearest=null;
  for(const [segmentIndex,segment] of segments.entries()){
    const {x,y,z,length,tangent,side}=beadCoordinates(segment,point);
    const vx=dot(ray,tangent),vy=dot(ray,side),vz=dot(ray,segment.normal);
    // Subtracting world coordinates loses precision before the local slab and
    // disk predicates run. Cover that arithmetic roundoff, not a physical gap.
    const rounding=32*Number.EPSILON*Math.max(1,...point.map(Math.abs),...segment.a.map(Math.abs),...segment.b.map(Math.abs));
    const radius=segment.radius+toleranceMm+rounding;
    const depth=slabInterval(z,vz,-segment.heightMm,0);
    const candidates=[
      [slabInterval(x,vx,0,length),slabInterval(y,vy,-radius,radius)],
      [diskInterval(x,y,vx,vy,radius)],
      [diskInterval(x-length,y,vx,vy,radius)]
    ].map(intervals=>firstIntervalOverlap([depth,...intervals],Math.min(maxDistanceMm,nearest?.distanceMm??Infinity)))
      .filter(value=>value!==null);
    if(!candidates.length)continue;
    const distanceMm=Math.min(...candidates);
    if(nearest===null||distanceMm<nearest.distanceMm)nearest={distanceMm,point:add(point,scale(ray,distanceMm)),operationId:segment.operationId,segmentIndex,normal:[...segment.normal]};
  }
  return nearest;
}
