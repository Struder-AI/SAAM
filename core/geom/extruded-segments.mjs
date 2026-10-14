import {requireThat,subtract,add,scale,dot,cross,normalize,distance} from './tolerance.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

// Capsule footprints extruded from z=-heightMm to z=0 in their supplied normal frame.
// Dimensions and query slack are geometric inputs; no process or operation identity.
export function extrudedSegmentsContain(segments,point,{toleranceMm=0}={}){
  return segments.some(segment=>{
    const {x,y,z,length}=segmentCoordinates(segment,point);
    return Math.hypot(x-Math.max(0,Math.min(length,x)),y)<=segment.radius+toleranceMm&&
      z<=toleranceMm&&z>=-segment.heightMm-toleranceMm;
  });
}

export function extrudedSegmentBounds(segments){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const segment of segments)for(let axis=0;axis<3;axis++){
    const extent=segment.radius*Math.sqrt(Math.max(0,1-segment.normal[axis]**2));
    const depth=-segment.normal[axis]*segment.heightMm;
    min[axis]=Math.min(min[axis],segment.a[axis]-extent+Math.min(0,depth),segment.b[axis]-extent+Math.min(0,depth));
    max[axis]=Math.max(max[axis],segment.a[axis]+extent+Math.max(0,depth),segment.b[axis]+extent+Math.max(0,depth));
  }
  return {min,max};
}

function segmentCoordinates(segment,point){
  const tangent=normalize(subtract(segment.b,segment.a)),side=normalize(cross(segment.normal,tangent));
  const relative=subtract(point,segment.a);
  return {x:dot(relative,tangent),y:dot(relative,side),z:dot(relative,segment.normal),
    length:distance(segment.a,segment.b),tangent,side};
}

function slabInterval(position,velocity,low,high){
  const rounding=ROUNDING_RELATIVE*Math.max(1,Math.abs(position),Math.abs(low),Math.abs(high));
  if(Math.abs(velocity)<ROUNDING_RELATIVE)return position>=low-rounding&&position<=high+rounding?[-Infinity,Infinity]:null;
  const a=(low-position)/velocity,b=(high-position)/velocity;
  return [Math.min(a,b),Math.max(a,b)];
}

function diskInterval(x,y,vx,vy,radius){
  const a=vx*vx+vy*vy,b=x*vx+y*vy,c=x*x+y*y-radius*radius;
  if(a<ROUNDING_RELATIVE**2)return c<=0?[-Infinity,Infinity]:null;
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

// First intersection along point + t*direction, with distance in world mm.
export function raycastExtrudedSegments(segments,point,direction,{maxDistanceMm=Infinity,toleranceMm=0}={}){
  const ray=normalize(direction);
  let nearest=null;
  for(const [segmentIndex,segment] of segments.entries()){
    const {x,y,z,length,tangent,side}=segmentCoordinates(segment,point);
    const vx=dot(ray,tangent),vy=dot(ray,side),vz=dot(ray,segment.normal);
    // Subtracting world coordinates loses precision before the local slab and
    // disk predicates run. Cover that arithmetic roundoff, not a physical gap.
    const rounding=ROUNDING_RELATIVE*Math.max(1,...point.map(Math.abs),...segment.a.map(Math.abs),...segment.b.map(Math.abs));
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
    if(nearest===null||distanceMm<nearest.distanceMm)nearest={distanceMm,point:add(point,scale(ray,distanceMm)),segmentIndex,normal:[...segment.normal]};
  }
  return nearest;
}

// Preparation indexes immutable supplied shapes, retaining their source order.
export function prepareExtrudedSegmentQuery(segments,{toleranceMm=0}={}){
  const bounds=extrudedSegmentBounds(segments);
  const entries=segments.map((segment,index)=>({segment,index,bounds:extrudedSegmentBounds([segment])}));
  function build(items){
    const box=items.reduce((b,e)=>({min:b.min.map((v,k)=>Math.min(v,e.bounds.min[k])),max:b.max.map((v,k)=>Math.max(v,e.bounds.max[k]))}),{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
    if(items.length<=8)return {bounds:box,items};
    const axis=[0,1,2].sort((a,b)=>(box.max[b]-box.min[b])-(box.max[a]-box.min[a]))[0];
    const ordered=[...items].sort((a,b)=>(a.bounds.min[axis]+a.bounds.max[axis])-(b.bounds.min[axis]+b.bounds.max[axis])),mid=Math.floor(items.length/2);
    return {bounds:box,left:build(ordered.slice(0,mid)),right:build(ordered.slice(mid))};
  }
  const tree=build(entries);
  function intersects(box,point,normal){
    let low=0,high=Infinity;
    for(let k=0;k<3;k++){
      const epsilon=ROUNDING_RELATIVE*Math.max(1,Math.abs(point[k]),Math.abs(box.min[k]),Math.abs(box.max[k]))+toleranceMm;
      if(Math.abs(normal[k])<ROUNDING_RELATIVE){if(point[k]<box.min[k]-epsilon||point[k]>box.max[k]+epsilon)return false;continue;}
      const a=(point[k]-box.max[k]-epsilon)/normal[k],b=(point[k]-box.min[k]+epsilon)/normal[k];
      low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));if(high<low)return false;
    }
    return true;
  }
  return {bounds,cast(point,direction){
    const normal=scale(normalize(direction),-1),candidates=[],pending=[tree];
    while(pending.length){const node=pending.pop();if(!intersects(node.bounds,point,normal))continue;if(node.items)candidates.push(...node.items.filter(entry=>intersects(entry.bounds,point,normal)));else pending.push(node.left,node.right);}
    const hit=raycastExtrudedSegments(candidates.map(e=>e.segment),point,direction,{toleranceMm});
    return hit?{...hit,segmentIndex:candidates[hit.segmentIndex].index}:null;
  }};
}
