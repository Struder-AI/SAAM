// Convex volume/contact and swept-nozzle queries in arbitrary XYZ frames.
// Inputs are numerical shapes; this module knows no process or operation IDs.
import {add,subtract,scale,dot,cross,length,normalize,requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {interpolateDirectionPair,rotation,mv} from './frame.mjs';
import {evaluateScalar} from './nurbs.mjs';

// Serializable convex hull; topology is unnecessary for support-map queries.
export function convexVolume(vertices){
  requireThat(Array.isArray(vertices)&&vertices.length>=4&&vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'A convex volume needs finite XYZ vertices.');
  const origin=vertices[0],edges=vertices.slice(1).map(p=>subtract(p,origin));
  const first=edges.find(edge=>length(edge)>ROUNDING_MM),second=first&&edges.find(edge=>length(cross(first,edge))>ROUNDING_MM*length(first));
  const normal=second&&normalize(cross(first,second));
  requireThat(normal&&edges.some(edge=>Math.abs(dot(normal,edge))>ROUNDING_MM),'A convex volume must have nonzero depth.');
  return {vertices:vertices.map(p=>[...p])};
}

export function convexSupport(shape,direction){
  if(shape.translated)return add(convexSupport(shape.translated,direction),shape.offset);
  if(shape.vertices){
    let best=shape.vertices[0],score=dot(best,direction);
    for(let i=1;i<shape.vertices.length;i++){const point=shape.vertices[i],next=dot(point,direction);if(next>score){best=point;score=next;}}
    return best;
  }
  if(shape.body){const point=convexSupport(shape.body,direction);return dot(shape.sweep,direction)>0?add(point,shape.sweep):point;}
  if(shape.parts){
    let best=convexSupport(shape.parts[0],direction),score=dot(best,direction);
    for(let i=1;i<shape.parts.length;i++){const point=convexSupport(shape.parts[i],direction),next=dot(point,direction);if(next>score){best=point;score=next;}}
    if(shape.radialMargin){const radial=subtract(direction,scale(shape.radialNormal,dot(direction,shape.radialNormal))),size=length(radial);
      if(size>0)best=add(best,scale(radial,shape.radialMargin/size));}
    return shape.margin?add(best,scale(normalize(direction),shape.margin)):best;
  }
  const normal=shape.normal,normalProjection=dot(direction,normal);
  if(shape.side){
    const end=dot(shape.a,direction)>dot(shape.b,direction)?shape.a:shape.b;
    return add(add(end,scale(shape.side,dot(shape.side,direction)>=0?shape.radius:-shape.radius)),scale(normal,normalProjection<0?-shape.depth:0));
  }
  const radial=[direction[0]-normal[0]*normalProjection,direction[1]-normal[1]*normalProjection,direction[2]-normal[2]*normalProjection],size=length(radial);
  const useA=dot(shape.a,direction)+shape.radius*size>dot(shape.b,direction)+(shape.endRadius??shape.radius)*size;
  const end=useA?shape.a:shape.b,radius=useA?shape.radius:shape.endRadius??shape.radius;
  const point=add(end,size>ROUNDING_MM?scale(radial,radius/size):[0,0,0]);
  return add(point,scale(normal,dot(direction,normal)<0?-shape.depth:0));
}
// Coordinate-aligned spatial boxes use the rectangular support primitive so
// separating-axis/cone queries need no general simplex solve for their hull.
export function convexBox({min,max}){
  const y=(min[1]+max[1])/2;
  return {a:[min[0],y,max[2]],b:[max[0],y,max[2]],side:[0,1,0],normal:[0,0,1],radius:(max[1]-min[1])/2,depth:max[2]-min[2]};
}
export const convexBounds=shape=>({min:[0,1,2].map(i=>convexSupport(shape,[0,1,2].map(k=>k===i?-1:0))[i]),
  max:[0,1,2].map(i=>convexSupport(shape,[0,1,2].map(k=>k===i?1:0))[i])});
export const boundsOverlap=(a,b,slack=PRINT_RESOLUTION_MM)=>
  a.min[0]<=b.max[0]+slack&&a.max[0]>=b.min[0]-slack&&
  a.min[1]<=b.max[1]+slack&&a.max[1]>=b.min[1]-slack&&
  a.min[2]<=b.max[2]+slack&&a.max[2]>=b.min[2]-slack;

// Closest point on a simplex's vertices, edges and triangle interiors. Explicit
// projections avoid allocating and eliminating a matrix for every affine face.
// Degenerate faces fall back to their edges; an enclosing tetrahedron is zero.
function simplexClosest(points){
  const best={squared:Infinity,point:null,points:null};
  for(const point of points){
    const squared=dot(point,point);
    if(squared<best.squared)Object.assign(best,{squared,point,points:[point]});
  }
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    const a=points[i],b=points[j],edge=subtract(b,a),squaredLength=dot(edge,edge);
    if(squaredLength<=ROUNDING_MM**2)continue;
    const u=-dot(a,edge)/squaredLength;if(u<=0||u>=1)continue;
    const point=add(a,scale(edge,u)),squared=dot(point,point);
    if(squared<best.squared)Object.assign(best,{squared,point,points:[a,b]});
  }
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)for(let k=j+1;k<points.length;k++){
    const a=points[i],b=points[j],c=points[k],ab=subtract(b,a),ac=subtract(c,a),normal=cross(ab,ac),normalSquared=dot(normal,normal);
    if(normalSquared<=ROUNDING_MM**2*Math.max(dot(ab,ab),dot(ac,ac)))continue;
    const u=-dot(a,cross(ac,normal))/normalSquared,v=-dot(a,cross(normal,ab))/normalSquared;
    if(u<0||v<0||u+v>1)continue;
    const point=add(add(a,scale(ab,u)),scale(ac,v)),squared=dot(point,point);
    if(squared<best.squared)Object.assign(best,{squared,point,points:[a,b,c]});
  }
  if(points.length===4){
    const a=points[0],ab=subtract(points[1],a),ac=subtract(points[2],a),ad=subtract(points[3],a),opposite=scale(a,-1);
    const normal=cross(ac,ad),determinant=dot(ab,normal);
    if(determinant!==0){
      const u=dot(opposite,normal)/determinant,v=dot(ab,cross(opposite,ad))/determinant,w=dot(ab,cross(ac,opposite))/determinant;
      if(u>=0&&v>=0&&w>=0&&u+v+w<=1)return {distance:0,point:[0,0,0],points};
    }
  }
  return {distance:Math.sqrt(best.squared),point:best.point,points:best.points};
}

// GJK separation. A finite threshold permits a proved separating-plane exit;
// Infinity computes the distance. Rounding guards converge without truncation.
function convexSeparation(a,b,thresholdMm=Infinity){
  const center=subtract(convexSupport(a,[1,0,0]),convexSupport(b,[1,0,0])),initial=length(center)>ROUNDING_MM?center:[1,0,0];
  const state={simplex:[subtract(convexSupport(a,initial),convexSupport(b,scale(initial,-1)))],distance:Infinity};
  for(;;){
    const closest=simplexClosest(state.simplex);
    if(closest.distance<=ROUNDING_MM)return 0;
    const direction=scale(closest.point,-1),next=subtract(convexSupport(a,direction),convexSupport(b,scale(direction,-1)));
    const lowerBound=dot(closest.point,next)/closest.distance;
    if(lowerBound>thresholdMm+ROUNDING_MM)return lowerBound;
    const improvement=closest.distance**2-dot(closest.point,next);
    // The simplex gives an upper distance bound; only a support plane gives
    // a lower bound. Stopping with a small squared improvement used to report
    // near-intersections as clear. Converge in distance units and retain the
    // lower bound if floating-point progress stops.
    if(improvement<=ROUNDING_MM*closest.distance||state.simplex.some(p=>length(subtract(p,next))<=ROUNDING_MM)||
      closest.distance>=state.distance)return Math.max(0,lowerBound);
    state.distance=closest.distance;state.simplex=[...closest.points,next];
  }
}

export const convexDistance=(a,b)=>convexSeparation(a,b);
// Separating axes retain zero-thickness faces and avoid simplex degeneracy at
// local surface contact. side marks orthogonal rectangular bead prisms.
function prismIntersects(a,b,toleranceMm){
  const along=shape=>{const delta=subtract(shape.b,shape.a),size=length(delta);return size>0?scale(delta,1/size):cross(shape.side,shape.normal);};
  const axesA=[along(a),a.side,a.normal],axesB=[along(b),b.side,b.normal];
  const centerA=add(scale(add(a.a,a.b),.5),scale(a.normal,-a.depth/2)),centerB=add(scale(add(b.a,b.b),.5),scale(b.normal,-b.depth/2));
  const spansA=[length(subtract(a.b,a.a))/2,a.radius,a.depth/2],spansB=[length(subtract(b.b,b.a))/2,b.radius,b.depth/2],offset=subtract(centerB,centerA);
  // Test face axes before constructing edge crosses. Most separated pairs
  // finish here; eagerly building all fifteen axes creates avoidable garbage.
  function separates(axis){
    const size=length(axis);if(size<=ROUNDING_RELATIVE)return false;
    let radiusA=0,radiusB=0;
    for(let k=0;k<3;k++){radiusA+=Math.abs(dot(axesA[k],axis))*spansA[k];radiusB+=Math.abs(dot(axesB[k],axis))*spansB[k];}
    return Math.abs(dot(offset,axis))>radiusA+radiusB+toleranceMm*size;
  }
  for(const axis of axesA)if(separates(axis))return false;
  for(const axis of axesB)if(separates(axis))return false;
  for(const x of axesA)for(const y of axesB)if(separates(cross(x,y)))return false;
  return true;
}
// A fixed-axis translated nozzle against a bead is a cone against a zonotope:
// the bead's three edge generators plus the negative nozzle translation.
// Off-axis minima of the cone side inequality continue to a hull edge along
// a generator of the cone. Hypercube edges cover all zonotope hull edges.
// On-axis minima come from clipping the axis against its facet slabs.
function fixedConePrismIntersects(sweep,prism,toleranceMm){
  const axis=sweep.body.normal,origin=subtract(add(prism.a,scale(prism.side,-prism.radius)),add(sweep.body.a,scale(prism.normal,prism.depth)));
  const generators=[subtract(prism.b,prism.a),scale(prism.side,prism.radius*2),scale(prism.normal,prism.depth)];
  if(length(sweep.sweep)>0)generators.push(scale(sweep.sweep,-1));
  const halfAngle=sweep.motion.includedAngleDeg*Math.PI/360,c=Math.cos(halfAngle),s=Math.sin(halfAngle);
  const projected=generators.map(v=>dot(v,axis)),z0=dot(origin,axis),low=z0+projected.reduce((n,z)=>n+Math.min(0,z),0),high=z0+projected.reduce((n,z)=>n+Math.max(0,z),0);
  // A crossed flat face or finite upper cap needs the general convex predicate.
  if(high>sweep.motion.lengthMm||sweep.body.radius>0&&low<0)return null;
  const sideTolerance=toleranceMm+c*sweep.body.radius;
  // One supporting plane of the cone can separate the whole zonotope. Use
  // its centre's radial direction before constructing all vertices/edges.
  const centre=generators.reduce((point,g)=>add(point,scale(g,.5)),origin),height=dot(centre,axis);
  const radial=subtract(centre,scale(axis,height)),radialLength=length(radial);
  if(radialLength>ROUNDING_MM){
    const direction=subtract(scale(radial,c/radialLength),scale(axis,s));
    const minimum=dot(centre,direction)-generators.reduce((sum,g)=>sum+Math.abs(dot(g,direction))/2,0);
    if(minimum>sideTolerance+ROUNDING_MM)return false;
  }
  const vertices=Array.from({length:2**generators.length},(_,mask)=>{
    const point=generators.reduce((q,g,k)=>mask&(1<<k)?add(q,g):q,origin),z=dot(point,axis);
    return {point,z,r2:Math.max(0,dot(point,point)-z*z)};
  });
  if(vertices.some(v=>c*Math.sqrt(v.r2)-s*v.z<=sideTolerance))return true;
  for(const [k,g] of generators.entries()){
    const dz=projected[k],a=Math.max(0,dot(g,g)-dz*dz),denominator=c*c*a-s*s*dz*dz;
    if(a<=ROUNDING_MM**2||denominator<=0)continue;
    for(const [i,v] of vertices.entries()){
      if(i&(1<<k))continue;
      const b=dot(v.point,g)-v.z*dz,k2=Math.max(0,a*v.r2-b*b),t=(s*dz*Math.sqrt(k2/denominator)-b)/a;
      if(t<=0||t>=1)continue;
      const r2=Math.max(0,v.r2+2*b*t+a*t*t);
      if(c*Math.sqrt(r2)-s*(v.z+dz*t)<=sideTolerance)return true;
    }
  }
  const interval={low,high};
  for(let i=0;i<generators.length;i++)for(let j=i+1;j<generators.length;j++){
    const normal=cross(generators[i],generators[j]),size=length(normal);if(size<=ROUNDING_MM**2)continue;
    const base=dot(origin,normal),spans=generators.map(g=>dot(g,normal)),minimum=base+spans.reduce((n,v)=>n+Math.min(0,v),0),maximum=base+spans.reduce((n,v)=>n+Math.max(0,v),0),along=dot(axis,normal);
    if(Math.abs(along)<=ROUNDING_RELATIVE*size){if(minimum>ROUNDING_MM*size||maximum< -ROUNDING_MM*size)return false;continue;}
    const ends=[minimum/along,maximum/along];interval.low=Math.max(interval.low,Math.min(...ends));interval.high=Math.min(interval.high,Math.max(...ends));
    if(interval.low>interval.high+ROUNDING_MM)return false;
  }
  return -s*interval.high<=sideTolerance;
}

function roundedBody(shape){
  let body=shape,margin=0;
  while(body.parts?.length===1){margin+=(body.margin??0)+(body.radialMargin??0);body=body.parts[0];}
  return {body,margin};
}
export function convexIntersects(a,b,toleranceMm=PRINT_RESOLUTION_MM){
  if(a.side&&b.side)return prismIntersects(a,b,toleranceMm);
  const x=roundedBody(a),y=roundedBody(b),expanded=toleranceMm+x.margin+y.margin;
  // A separating prism axis remains a separating plane after spherical
  // inflation by its two radii. Passing these axes is only a candidate hit.
  if(x.body.side&&y.body.side&&!prismIntersects(x.body,y.body,expanded))return false;
  const sweep=x.body.fixed&&x.body.motion?x.body:y.body.fixed&&y.body.motion?y.body:null,prism=sweep===x.body?y.body:x.body;
  if(sweep&&prism.side){
    // The cone side function is 1-Lipschitz: a positive margin larger than
    // both inflation radii certifies clearance without a rounded-body GJK.
    const hit=fixedConePrismIntersects(sweep,prism,expanded);
    if(hit===false)return false;
    if(hit!==null&&x.margin+y.margin===0)return hit;
    // The core bodies are contained in their inflated envelopes. An actual
    // core intersection proves envelope intersection without a simplex query.
    if(hit===true&&fixedConePrismIntersects(sweep,prism,toleranceMm)===true)return true;
  }
  return convexSeparation(a,b,toleranceMm)<=toleranceMm;
}

// Index immutable volumes in caller-owned partitions and witness groups.
// boundsOnly returns conservative candidates; the caller must perform its own
// shape/contact query. Proxies and lazy intervals otherwise repeat that work.
// Proven partition admission precedes local spatial and group/ordinal filters.
export function convexSpatialIndex(shapes,{groups=null,partitions=null}={}){
  requireThat(!groups||groups.length===shapes.length,'Spatial index groups must match its shapes.');
  requireThat(!partitions||partitions.length===shapes.length,'Spatial partitions must match their shapes.');
  const members=new Map();
  const entries=shapes.map((shape,index)=>{const group=groups?.[index];if(groups&&!members.has(group))members.set(group,{group,token:null,allowed:true,through:Infinity});
    return {shape,tree:null,index,group,member:groups?members.get(group):null,bounds:convexBounds(shape)};});
  function build(items,partition=null){
    const node={bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},items:null,left:null,right:null,group:undefined,grouped:false,firstIndex:Infinity,partition,member:null},bounds=node.bounds;
    for(const item of items){node.firstIndex=Math.min(node.firstIndex,item.index);for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],item.bounds.min[k]);bounds.max[k]=Math.max(bounds.max[k],item.bounds.max[k]);}}
    if(items.length<=8){node.items=items;node.group=items[0]?.group;node.grouped=Boolean(groups)&&items.length>0&&items.every(item=>!item.tree&&item.group===node.group);node.member=node.grouped?items[0].member:null;return node;}
    const axis=[0,1,2].reduce((best,i)=>bounds.max[i]-bounds.min[i]>bounds.max[best]-bounds.min[best]?i:best,0);
    const ordered=[...items].sort((a,b)=>a.bounds.min[axis]+a.bounds.max[axis]-b.bounds.min[axis]-b.bounds.max[axis]),mid=Math.floor(items.length/2);
    node.left=build(ordered.slice(0,mid),partition);node.right=build(ordered.slice(mid),partition);
    node.grouped=node.left.grouped&&node.right.grouped&&node.left.group===node.right.group;
    node.group=node.grouped?node.left.group:undefined;node.member=node.grouped?node.left.member:null;return node;
  }
  const membership=partitions??groups,held=new Map();
  if(membership)for(const item of entries){const key=membership[item.index];if(!held.has(key))held.set(key,[]);held.get(key).push(item);}
  const roots=[...held.values()].map(items=>{const partition={members:[...new Set(items.map(item=>item.group))],token:null,status:1},tree=build(items,partition);return {shape:null,tree,index:tree.firstIndex,group:undefined,member:null,bounds:tree.bounds};});
  const tree=membership?build(roots):build(entries),selection={allowed:null,token:{}};
  // An entire partition can be excluded or admitted from proven group order.
  // Only a partially selected partition needs member-level filtering. A single
  // immutable selection owns this bounded memo; native slices are caller data.
  function selected(partition,allowed){
    if(!partition)return 1;
    if(selection.allowed!==allowed){selection.allowed=allowed;selection.token={};}
    if(partition.token===selection.token)return partition.status;
    const count=partition.members.reduce((sum,group)=>sum+Number(allowed.has(group)),0),status=count===0?0:count===partition.members.length?2:1;
    partition.token=selection.token;partition.status=status;return status;
  }
  return {empty:shapes.length===0,bounds:tree.bounds,query(shape,toleranceMm=PRINT_RESOLUTION_MM,{accept=null,acceptGroup=null,firstPerGroup=false,confirm=null,withinGroups=null,groupPrefixes=null,boundsTest=null,boundsOnly=false}={}){
    if(withinGroups)requireThat(groups,'Group selection needs a grouped spatial index.');
    const region=prepareConvexBoundsQuery(shape,toleranceMm),box=region.bounds,pending=[tree],found=[],settled=new Set(),token={};
    const admitted=bounds=>(!boundsTest||boundsTest(bounds))&&region.mayIntersect(bounds);
    function eligible(member){
      if(member.token!==token){member.token=token;member.allowed=(!withinGroups||withinGroups.has(member.group))&&(!acceptGroup||acceptGroup(member.group));member.through=groupPrefixes?.get(member.group)??Infinity;}
      return member.allowed;
    }
    while(pending.length){
      const node=pending.pop(),{group,grouped}=node;
      if(!boundsOverlap(box,node.bounds,toleranceMm))continue;
      const status=withinGroups?selected(node.partition,withinGroups):2;if(!status)continue;
      if(grouped&&(firstPerGroup&&settled.has(group)||!eligible(node.member)||node.firstIndex>node.member.through))continue;
      if(!admitted(node.bounds))continue;
      if(node.items){for(const item of node.items){
        if(!boundsOverlap(box,item.bounds,toleranceMm))continue;
        const group=item.group;
        if(!item.tree&&groups&&(firstPerGroup&&settled.has(group)||!eligible(item.member)||item.index>item.member.through))continue;
        if(!admitted(item.bounds))continue;
        if(item.tree){pending.push(item.tree);continue;}
        if((!accept||accept(item.index))&&(boundsOnly||convexIntersects(shape,item.shape,toleranceMm))&&(!confirm||confirm(item.shape))){
          found.push(item.index);if(firstPerGroup&&groups)settled.add(group);
        }
      }}else pending.push(node.left,node.right);
    }
    return found;
  }};
}

// Prepare conservative box admission once for repeated spatial/refinement
// queries. A positive result is only a candidate, never a contact witness.
export function prepareConvexBoundsQuery(shape,toleranceMm=ROUNDING_MM){
  const bounds=convexBounds(shape),rounded=roundedBody(shape);
  const cone=rounded.body.fixed&&rounded.body.motion?fixedConeBounds(rounded.body,toleranceMm+rounded.margin):null;
  return {bounds,mayIntersect:box=>boundsOverlap(bounds,box,toleranceMm)&&(!cone||cone(box))};
}

export const DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG=80;
export const DEFAULT_NOZZLE_TIP_DIAMETER_MM=.9;
export const DEFAULT_NOZZLE_GEOMETRY=Object.freeze({includedAngleDeg:DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,tipDiameterMm:DEFAULT_NOZZLE_TIP_DIAMETER_MM});
// Physical allowance on the nozzle surface; bead overlap is independent.
export const NOZZLE_FORGIVENESS_MM=.2;
export const nozzleSideOffsetMm=(includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM)=>
  forgivenessMm-tipDiameterMm/2*Math.cos(includedAngleDeg*Math.PI/360);
export function nozzleAt(point,axis,lengthMm,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM){
  const outward=normalize(axis);
  requireThat(Number.isFinite(includedAngleDeg)&&includedAngleDeg>0&&includedAngleDeg<180,'Nozzle cone included angle must be between 0 and 180 degrees.');
  requireThat(Number.isFinite(forgivenessMm)&&forgivenessMm>=0,'Nozzle surface forgiveness must be finite and nonnegative.');
  requireThat(Number.isFinite(tipDiameterMm)&&tipDiameterMm>=0,'Nozzle flat-tip diameter must be finite and nonnegative.');
  const angle=includedAngleDeg*Math.PI/360,sideOffset=nozzleSideOffsetMm(includedAngleDeg,forgivenessMm,tipDiameterMm);
  // Erode both the flat face and conical side. A vanishing flat retains the
  // pointed cone's shifted apex; a wider flat retains a finite bottom face.
  const offset=Math.max(forgivenessMm,sideOffset/Math.sin(angle));
  const start=add(point,scale(outward,offset)),startRadius=offset===forgivenessMm?Math.max(0,(offset*Math.sin(angle)-sideOffset)/Math.cos(angle)):0;
  return {a:start,b:add(start,scale(outward,lengthMm)),normal:outward,radius:startRadius,endRadius:startRadius+lengthMm*Math.tan(angle),depth:0};
}

// Lowest reference-height offset of the whole nozzle, including its flat face.
// The reference is Lipschitz over the perpendicular plane. Every cone generator
// must increase that field; otherwise no finite floor can certify clearance.
export function nozzleReferenceFloorMm(cosine,slope=0,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM){
  const aligned=Math.max(-1,Math.min(1,cosine)),deviation=Math.acos(aligned),angle=includedAngleDeg*Math.PI/360+deviation;
  if(angle>=Math.PI/2||slope>=1/Math.tan(angle))return -Infinity;
  const shape=nozzleAt([0,0,0],[0,0,1],0,includedAngleDeg,forgivenessMm,tipDiameterMm),sine=Math.sqrt(Math.max(0,1-aligned*aligned));
  return shape.a[2]*(aligned-slope*sine)-shape.radius*(sine+slope);
}

function nozzleRadiusBound(lengthMm,includedAngleDeg,forgivenessMm,tipDiameterMm){
  const shape=nozzleAt([0,0,0],[0,0,1],lengthMm,includedAngleDeg,forgivenessMm,tipDiameterMm);
  return Math.hypot(shape.b[2],shape.endRadius);
}

// Bound one interval of the original rigid-frame interpolation, preserving its
// parameterization through refinement. A fixed-axis translated cone is convex.
function nozzleInterval(motion,a,b){
    const {from,to,fromPose,toPose,lengthMm,includedAngleDeg,forgivenessMm,tipDiameterMm}=motion;
    const poses=[a,b].map(t=>interpolateDirectionPair(
      [fromPose.toolAxis,fromPose.toolUp],[toPose.toolAxis,toPose.toolUp],t));
    const axes=poses.map(p=>scale(p[0],-1)),axisChord=length(subtract(axes[0],axes[1]));
    // A frame may roll around an oblique axis: its cone axis then follows a
    // small circle, not the great-circle arc between the endpoint axes. Use
    // the full frame rotation for the rigid-point sagitta bound. The second
    // bound follows from the axis chord and makes pure/near-pure roll cheap.
    const frameCosine=axisChord===0?1:Math.max(-1,Math.min(1,(dot(axes[0],axes[1])+dot(poses[0][1],poses[1][1])+
      dot(cross(axes[0],poses[0][1]),cross(axes[1],poses[1][1]))-1)/2));
    const radiusBound=nozzleRadiusBound(lengthMm,includedAngleDeg,forgivenessMm,tipDiameterMm);
    const error=radiusBound*Math.min(1-Math.sqrt((1+frameCosine)/2),2*axisChord);
    const shapes=[a,b].map((t,i)=>nozzleAt(from.map((v,k)=>v+(to[k]-v)*t),axes[i],lengthMm,includedAngleDeg,forgivenessMm,tipDiameterMm));
    return {parts:shapes,margin:error,motion,t0:a,t1:b,fixed:axisChord===0,
      ...(axisChord===0?{body:shapes[0],sweep:shapes[1].a.map((v,k)=>v-shapes[0].a[k])}:{})};
}

// Coarse conservative envelopes for spatial rejection; a changing-pose hull
// alone cannot prove collision, because it also fills clear space between poses.
export function sweptNozzle(from,to,fromPose,toPose,lengthMm,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM){
  const motion={from,to,fromPose,toPose,lengthMm,includedAngleDeg,forgivenessMm,tipDiameterMm},pieces=[],pending=[{a:0,b:1}];
  while(pending.length){
    const {a,b}=pending.pop(),sweep=nozzleInterval(motion,a,b),mid=(a+b)/2;
    if(sweep.margin>NOZZLE_FORGIVENESS_MM/4&&mid>a&&mid<b){pending.push({a,b:mid},{a:mid,b});continue;}
    pieces.push(sweep);
  }
  return pieces;
}

// Refine only a spatial candidate. Exact cones witness a hit; separated hulls
// prove clearance. This terminates at floating-point representability rather
// than a subdivision budget or an extra physical forgiveness margin.
export function nozzleIntervalIntersects(sweep,shape,toleranceMm=ROUNDING_MM){
  const pending=[sweep];
  while(pending.length){
    const interval=pending.pop();
    if(!convexIntersects(interval,shape,toleranceMm))continue;
    if(interval.fixed||interval.parts.some(cone=>convexIntersects(cone,shape,toleranceMm)))return true;
    const mid=(interval.t0+interval.t1)/2;
    if(mid<=interval.t0||mid>=interval.t1)throw Object.assign(Error('Continuous nozzle clearance is unresolved at numerical precision.'),{code:'NOZZLE_CLEARANCE_UNRESOLVED'});
    const left=nozzleInterval(interval.motion,interval.t0,mid),right=nozzleInterval(interval.motion,mid,interval.t1);
    if(convexIntersects(left.parts[1],shape,toleranceMm))return true;
    pending.push(left,right);
  }
  return false;
}

// The infinite cone's signed side inequality is convex. Its supporting
// plane at a node's center gives a lower bound over the entire AABB and
// translated tip segment. A positive bound proves separation before GJK.
function fixedConeBounds(sweep,toleranceMm=ROUNDING_MM){
  const axis=sweep.body.normal,halfAngle=sweep.motion.includedAngleDeg*Math.PI/360,c=Math.cos(halfAngle),s=Math.sin(halfAngle);
  const tip=add(sweep.body.a,scale(sweep.sweep,.5));
  return bounds=>{
    const x=(bounds.min[0]+bounds.max[0])/2-tip[0],y=(bounds.min[1]+bounds.max[1])/2-tip[1],z=(bounds.min[2]+bounds.max[2])/2-tip[2];
    const axial=x*axis[0]+y*axis[1]+z*axis[2];
    const rx=x-axis[0]*axial,ry=y-axis[1]*axial,rz=z-axis[2]*axial,r=Math.hypot(rx,ry,rz),factor=r>ROUNDING_MM?c/r:0;
    const gx=axis[0]*-s+(factor?rx*factor:0),gy=axis[1]*-s+(factor?ry*factor:0),gz=axis[2]*-s+(factor?rz*factor:0);
    const boxRadius=Math.abs(gx)*(bounds.max[0]-bounds.min[0])/2+Math.abs(gy)*(bounds.max[1]-bounds.min[1])/2+Math.abs(gz)*(bounds.max[2]-bounds.min[2])/2;
    const motion=gx*sweep.sweep[0]+gy*sweep.sweep[1]+gz*sweep.sweep[2];
    const lower=(r>ROUNDING_MM?c*r:0)-c*sweep.body.radius-s*axial-boxRadius-Math.abs(motion)/2;
    return lower<=toleranceMm;
  };
}

// Supporting plane of the enlarged infinite cone, minimized over both boxes.
// A positive lower bound proves all positions/poses clear; overlap proves nothing.
export function nozzleBoundsClear(positions,poseCone,material,forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG){
  const angle=includedAngleDeg*Math.PI/360+poseCone.halfAngleRad;
  if(angle>=Math.PI/2)return false;
  const axis=normalize(scale(poseCone.reference.toolAxis,-1)),c=Math.cos(angle),s=Math.sin(angle);
  const q=positions.min.map((v,k)=>(material.min[k]+material.max[k]-v-positions.max[k])/2);
  const z=dot(q,axis),radial=subtract(q,scale(axis,z)),r=length(radial);
  const gradient=add(scale(axis,-s),r>ROUNDING_MM?scale(radial,c/r):[0,0,0]);
  const lower=(r>ROUNDING_MM?c*r:0)-s*z-q.reduce((sum,_,k)=>sum+Math.abs(gradient[k])*
    (material.max[k]-material.min[k]+positions.max[k]-positions.min[k])/2,0);
  return lower+nozzleSideOffsetMm(includedAngleDeg,forgivenessMm,tipDiameterMm)>ROUNDING_MM*8;
}

export function nozzleSweepHits(index,from,to,fromPose,toPose,options={}){
  const reach=nozzleSweepReach(index.bounds,from,to,fromPose,toPose),hits=new Set();
  const {forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,...filters}=options;
  for(const sweep of sweptNozzle(from,to,fromPose,toPose,reach,includedAngleDeg,forgivenessMm,tipDiameterMm)){
    function confirm(shape){return nozzleIntervalIntersects(sweep,shape,ROUNDING_MM);}
    if(sweep.fixed){for(const hit of index.query(sweep,ROUNDING_MM,{...filters,boundsTest:fixedConeBounds(sweep)}))hits.add(hit);}
    else for(const hit of index.query(sweep,ROUNDING_MM,{...filters,confirm}))hits.add(hit);
  }
  return [...hits];
}

export function nozzleSweepReach(bounds,from,to,fromPose,toPose){
  if(bounds.min.some(value=>!Number.isFinite(value)))return 1;
  const a=scale(fromPose.toolAxis,-1),b=scale(toPose.toolAxis,-1);
  if(length(subtract(a,b))<=ROUNDING_RELATIVE){
    const upper=dot(a,bounds.min.map((value,i)=>a[i]>=0?bounds.max[i]:value));
    return Math.max(PRINT_RESOLUTION_MM,upper-Math.min(dot(from,a),dot(to,a)))+PRINT_RESOLUTION_MM;
  }
  const center=bounds.min.map((value,i)=>(value+bounds.max[i])/2);
  return Math.max(length(subtract(from,center)),length(subtract(to,center)))+length(subtract(bounds.max,bounds.min))+PRINT_RESOLUTION_MM;
}

export function nozzleMotionHits(index,occupied,from,to,fromPose,toPose,{withinGroups=null,groupPrefixes=null,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM}={}){
  if(!occupied.size||index.empty)return [];
  return nozzleSweepHits(index,from,to,fromPose,toPose,{accept:hit=>occupied.has(hit),withinGroups,groupPrefixes,includedAngleDeg,tipDiameterMm});
}

function radialPose(radial,up){
  const axis=scale(radial,-1),projected=subtract(up,scale(axis,dot(up,axis)));
  const along=length(projected)>ROUNDING_MM?projected:cross(axis,Math.abs(axis[0])<.9?[1,0,0]:[0,1,0]);
  return {toolAxis:axis,toolUp:normalize(along)};
}

// An effectively infinite cone cannot pass below stock. Transfer on an exterior
// plane for a fixed orientation, or around the enclosing sphere for changing
// orientation. Every returned continuous move uses the same swept-volume query.
export function nozzleMotionRoute(index,occupied,from,to,fromPose,toPose,options={}){
  if(!nozzleMotionHits(index,occupied,from,to,fromPose,toPose,options).length)return {kind:'direct',waypoints:[{point:to,pose:toPose}]};
  const targetHits=nozzleMotionHits(index,occupied,to,to,toPose,toPose,options);
  if(targetHits.length)return {kind:'blocked',blocked:targetHits};
  const bounds=options.bounds??index.bounds,center=bounds.min.map((v,i)=>(v+bounds.max[i])/2);
  const radius=length(subtract(bounds.max,bounds.min))/2,gap=Math.max(PRINT_RESOLUTION_MM,options.clearanceMm??PRINT_RESOLUTION_MM);
  const outwardA=scale(fromPose.toolAxis,-1),outwardB=scale(toPose.toolAxis,-1);
  const fixedAxis=length(subtract(outwardA,outwardB))<=ROUNDING_MM;
  const top=bounds.min.reduce((sum,v,i)=>sum+(outwardA[i]>=0?bounds.max[i]-center[i]:v-center[i])*outwardA[i],0);
  const state={clearance:fixedAxis?top+gap:radius/Math.cos(Math.PI/8)+gap};
  for(;;){
    const a=add(from,scale(outwardA,Math.max(0,state.clearance-dot(subtract(from,center),outwardA))));
    const b=add(to,scale(outwardB,Math.max(0,state.clearance-dot(subtract(to,center),outwardB))));
    const route=[{point:a,pose:fromPose}];
    if(fixedAxis){route.push({point:b,pose:toPose},{point:to,pose:toPose});}
    else{
      const ra=normalize(subtract(a,center)),rb=normalize(subtract(b,center)),pa=radialPose(ra,fromPose.toolUp);
      const perpendicular=cross(ra,rb),sine=length(perpendicular),cosine=Math.max(-1,Math.min(1,dot(ra,rb))),angle=Math.atan2(sine,cosine);
      const axis=sine>ROUNDING_MM?normalize(perpendicular):normalize(cross(ra,pa.toolUp));
      const count=Math.max(1,Math.ceil(angle/(Math.PI/4)));
      route.push({point:a,pose:pa},{point:add(center,scale(ra,state.clearance)),pose:pa});
      for(let i=1;i<=count;i++){
        const turn=rotation(axis,angle*i/count),radial=mv(turn,ra),up=mv(turn,pa.toolUp);
        route.push({point:add(center,scale(radial,state.clearance)),pose:radialPose(radial,up)});
      }
      route.push({point:b,pose:route.at(-1).pose},{point:b,pose:toPose},{point:to,pose:toPose});
    }
    const cursor={point:from,pose:fromPose},blocked=new Set();
    for(const next of route){for(const hit of nozzleMotionHits(index,occupied,cursor.point,next.point,cursor.pose,next.pose,options))blocked.add(hit);cursor.point=next.point;cursor.pose=next.pose;}
    if(!blocked.size)return {kind:'exterior-clearance',waypoints:route};
    // Increasing exterior clearance improves routing, rather than truncating a
    // valid job at a fixed iteration/distance budget. A blocked initial retreat
    // cannot be repaired by a larger exterior route.
    const retreat=nozzleMotionHits(index,occupied,from,a,fromPose,fromPose,options);
    if(retreat.length)return {kind:'blocked',blocked:retreat};
    state.clearance*=2;
    requireThat(Number.isFinite(state.clearance),'Nozzle exterior route has no representable clearance.');
  }
}

// Enclose an oriented rectangular section swept along a bounded curve interval.
// These are numerical envelopes; an overlap is not an intersection witness.
function sectionFrame(tangent,referenceNormal){
  const projected=subtract(referenceNormal,scale(tangent,dot(referenceNormal,tangent))),size=length(projected);
  if(size<=ROUNDING_RELATIVE)return null;
  const normal=scale(projected,1/size);
  return {normal,side:normalize(cross(normal,tangent)),projectedSize:size};
}

export function rectangularSection(point,tangent,referenceNormal,radius,depth){
  const frame=sectionFrame(tangent,referenceNormal);
  requireThat(frame,'A section reference normal is parallel to its tangent.');
  return {vertices:[-1,1].flatMap(sign=>{
    const side=add(point,scale(frame.side,sign*radius));
    return [side,add(side,scale(frame.normal,-depth))];
  }),frame};
}

export function rectangularSweepEnvelope({from,to,bounds,chordErrorMm,tangentCone,normalCone,radius,depth,sectionFrameBounds=null}){
  const chord=subtract(to,from),size=length(chord),tangent=tangentCone.halfAngleRad===0?tangentCone.axis:size>ROUNDING_MM?scale(chord,1/size):tangentCone.axis;
  const frame=sectionFrame(tangent,normalCone.axis),extent=radius[1]+depth[1];
  if(!frame){
    const box={vertices:Array.from({length:8},(_,mask)=>bounds.min.map((value,k)=>(mask&(1<<k)?bounds.max[k]+extent:value-extent)))};
    return {shape:box,frame:null,normalError:2,sideError:2,errorMm:extent,exact:false};
  }
  const tangentError=Math.min(2,length(subtract(tangent,tangentCone.axis))+2*Math.sin(tangentCone.halfAngleRad/2));
  const referenceError=2*Math.sin(normalCone.halfAngleRad/2);
  // Projection changes by at most dN + 2*dT. Normalizing a nonzero vector
  // changes its direction by at most twice that error / reference magnitude.
  const ordinaryError=Math.min(2,2*(referenceError+2*tangentError)/frame.projectedSize);
  const directionalError=sectionFrameBounds?Math.min(2,length(subtract(frame.normal,sectionFrameBounds.axis))+2*Math.sin(sectionFrameBounds.halfAngleRad/2)):2;
  const normalError=Math.min(ordinaryError,directionalError),sideError=Math.min(2,tangentError+normalError);
  const planar=sectionFrameBounds&&directionalError<ordinaryError;
  // Side/curve uncertainty in a known section plane must not fabricate extra
  // thickness. Normal-frame uncertainty remains a spherical enclosure.
  const radialMargin=planar?chordErrorMm+radius[1]*sideError:0;
  const axialError=planar?Math.min(chordErrorMm,sectionFrameBounds.projection[1]-sectionFrameBounds.projection[0]+
    chordErrorMm*length(subtract(frame.normal,sectionFrameBounds.axis))):0;
  const margin=planar?axialError+(radius[1]+depth[1])*normalError:chordErrorMm+radius[1]*sideError+depth[1]*normalError;
  const body={a:from,b:to,side:frame.side,normal:frame.normal,radius:radius[1],depth:depth[1]};
  const exact=margin===0&&radialMargin===0&&radius[0]===radius[1]&&depth[0]===depth[1];
  return {shape:margin||radialMargin?{parts:[body],margin,...(radialMargin?{radialMargin,radialNormal:frame.normal}:{})}:body,
    frame,normalError,sideError,sphericalErrorMm:margin,planarErrorMm:radialMargin,
    errorMm:margin+radialMargin+radius[1]-radius[0]+depth[1]-depth[0],exact};
}

// Curve positions need only stay within the chord's geometric error tube.
// All poses are enclosed independently, so nonuniform curve parameter speed
// cannot change the pose/position coupling assumed by the envelope.
export function nozzleCurveEnvelope({from,to,bounds,chordErrorMm,poseCone},stockBounds,{forgivenessMm=NOZZLE_FORGIVENESS_MM,tipDiameterMm=DEFAULT_NOZZLE_TIP_DIAMETER_MM,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG}={}){
  const reach=Math.hypot(...bounds.min.map((value,k)=>Math.max(Math.abs(stockBounds.min[k]-bounds.max[k]),Math.abs(stockBounds.max[k]-value))))+PRINT_RESOLUTION_MM;
  const reference=poseCone.reference,motion={from,to,fromPose:reference,toPose:reference,lengthMm:reach,
    includedAngleDeg,forgivenessMm,tipDiameterMm};
  const halfAngle=includedAngleDeg*Math.PI/360,angle=poseCone.halfAngleRad;
  if(angle>0&&halfAngle+angle<Math.PI/2){
    // Rotating an eroded cone through angle encloses its side in a cone
    // widened by that angle, retaining its original side offset. The lowest
    // flat face is d*cos(angle)-r*sin(angle); its enclosing radius is
    // r*cos(angle)+d*sin(angle). This also covers a pointed nozzle (r=0).
    const base=nozzleAt([0,0,0],[0,0,1],reach,includedAngleDeg,forgivenessMm,tipDiameterMm),sine=Math.sin(angle),cosine=Math.cos(angle);
    const low=base.a[2]*cosine-base.radius*sine,high=base.b[2]+base.endRadius*sine;
    const radius=base.radius*cosine+base.a[2]*sine,axis=scale(reference.toolAxis,-1),enlarged=(halfAngle+angle)*360/Math.PI;
    const shifted={...motion,from:add(from,scale(axis,low)),to:add(to,scale(axis,low)),lengthMm:high-low,
      includedAngleDeg:enlarged,forgivenessMm:0,tipDiameterMm:radius*2};
    const body=nozzleInterval(shifted,0,1),endRadius=radius+(high-low)*Math.tan(halfAngle+angle);
    // Bound distance to the reference cone, then to any admitted pose. The
    // bound converges with the angle; chord uncertainty remains independent.
    const axialError=Math.max(base.a[2]-low,high-base.b[2]),radialError=Math.max(Math.abs(radius-base.radius),Math.abs(endRadius-base.endRadius));
    const errorMm=chordErrorMm+Math.hypot(axialError,radialError)+Math.hypot(base.b[2],base.endRadius)*2*Math.sin(angle/2);
    return {shape:chordErrorMm?{parts:[body],margin:chordErrorMm}:body,
      errorMm,exact:false};
  }
  const body=nozzleInterval(motion,0,1);
  const radius=nozzleRadiusBound(reach,includedAngleDeg,forgivenessMm,tipDiameterMm);
  const errorMm=chordErrorMm+radius*2*Math.sin(poseCone.halfAngleRad/2);
  return {shape:errorMm?{parts:[body],margin:errorMm}:body,errorMm,exact:errorMm===0};
}

// The feasible translations between two convex bodies form an interval. Find
// its exterior brackets directly instead of bisecting every source stroke.
export function translationContactInterval(body,translation,obstacle,{resolutionMm=PRINT_RESOLUTION_MM/4,toleranceMm=ROUNDING_MM}={}){
  requireThat(Number.isFinite(resolutionMm)&&resolutionMm>0,'Contact bracket needs a positive spatial resolution.');
  const span=length(translation);
  function at(t){return {translated:body,offset:scale(translation,t)};}
  function hits(t){return convexIntersects(at(t),obstacle,toleranceMm);}
  function crosses(a,b){return convexIntersects({body:at(a),sweep:scale(translation,b-a)},obstacle,toleranceMm);}
  if(!crosses(0,1))return null;
  const search={lo:0,hi:1,hit:hits(0)?0:hits(1)?1:null};
  while(search.hit===null){
    const mid=(search.lo+search.hi)/2;
    if(mid<=search.lo||mid>=search.hi)throw Object.assign(Error('Translated contact has no representable intersection witness.'),{code:'CONTACT_UNRESOLVED'});
    if(hits(mid)){search.hit=mid;break;}
    if(crosses(search.lo,mid))search.hi=mid;else search.lo=mid;
  }
  const left={lo:0,hi:search.hit},right={lo:search.hit,hi:1};
  if(hits(0))left.hi=0;
  else while(span*(left.hi-left.lo)>resolutionMm){
    const mid=(left.lo+left.hi)/2;if(mid<=left.lo||mid>=left.hi)break;
    if(hits(mid))left.hi=mid;else left.lo=mid;
  }
  if(hits(1))right.lo=1;
  else while(span*(right.hi-right.lo)>resolutionMm){
    const mid=(right.lo+right.hi)/2;if(mid<=right.lo||mid>=right.hi)break;
    if(hits(mid))right.lo=mid;else right.hi=mid;
  }
  return {from:left.lo,to:right.hi,at:search.hit,entry:[left.lo,left.hi],exit:[right.lo,right.hi]};
}

// A numerical reference height field, used only for separation certificates.
// It need not coincide with any printed material. Actual curve controls/vertices
// are bounded against it, so selecting it never assigns a native layer or fills
// a sparse layer surface. Clamping its parameter coordinates extends the graph
// globally with the same certified Lipschitz bound.
export function referenceHeightGraph(patch,direction){
  if(patch?.kind==='linear'){
    const axis=normalize(direction),guard=ROUNDING_MM*8,residual=point=>dot(point,axis);
    return {axis,slope:0,curvature:0,residual,curveBounds(geometry){
      const vertices=geometry.kind==='polyline'?geometry.points:geometry.kind==='nurbs'?geometry.controlPoints:null;
      if(!vertices)return null;
      let lo=Infinity,hi=-Infinity;for(const point of vertices){const value=residual(point);lo=Math.min(lo,value);hi=Math.max(hi,value);}
      return [lo-guard,hi+guard];
    }};
  }
  if(!patch?.cp||patch.orderU<2||patch.orderV<2||!patch.domainU||!patch.domainV)return null;
  for(const [knots,order,domain]of [[patch.knotsU,patch.orderU,patch.domainU],[patch.knotsV,patch.orderV,patch.domainV]]){
    if(!knots||!(domain[1]>domain[0]))return null;
    let previous=null,count=0;for(const knot of knots){count=knot===previous?count+1:1;previous=knot;
      if(knot>domain[0]&&knot<domain[1]&&count>=order)return null;}
  }
  const w=patch.cp[3];if(!(w>0))return null;
  const points=[];for(let i=0;i<patch.nu*patch.nv;i++){
    if(patch.cp[i*4+3]!==w)return null;
    points.push([0,1,2].map(k=>patch.cp[i*4+k]/w));
  }
  const axis=normalize(direction),origin=points[0],project=v=>subtract(v,scale(axis,dot(v,axis)));
  const U=scale(project(subtract(points[(patch.nu-1)*patch.nv],origin)),1/(patch.domainU[1]-patch.domainU[0]));
  const V=scale(project(subtract(points[patch.nv-1],origin)),1/(patch.domainV[1]-patch.domainV[0]));
  const E=dot(U,U),F=dot(U,V),G=dot(V,V),det=E*G-F*F;
  if(!(det>ROUNDING_RELATIVE*E*G))return null;
  const dualU=scale(subtract(scale(U,G),scale(V,F)),1/det),dualV=scale(subtract(scale(V,E),scale(U,F)),1/det);
  const heights=points.map(point=>dot(point,axis)),gradient=[0,0];
  for(let i=0;i<patch.nu;i++)for(let j=0;j<patch.nv;j++){
    if(i+1<patch.nu){const span=patch.knotsU[i+patch.orderU]-patch.knotsU[i+1];if(span>0)
      gradient[0]=Math.max(gradient[0],(patch.orderU-1)*Math.abs(heights[(i+1)*patch.nv+j]-heights[i*patch.nv+j])/span);}
    if(j+1<patch.nv){const span=patch.knotsV[j+patch.orderV]-patch.knotsV[j+1];if(span>0)
      gradient[1]=Math.max(gradient[1],(patch.orderV-1)*Math.abs(heights[i*patch.nv+j+1]-heights[i*patch.nv+j])/span);}
  }
  const slope=Math.max(...[-1,1].flatMap(u=>[-1,1].map(v=>length(add(scale(dualU,u*gradient[0]),scale(dualV,v*gradient[1]))))))*(1+ROUNDING_RELATIVE)+ROUNDING_RELATIVE;
  let curvature=Infinity;
  const bezier=patch.nu===patch.orderU&&patch.nv===patch.orderV&&
    patch.knotsU.every((v,i)=>v===patch.domainU[i<patch.orderU?0:1])&&patch.knotsV.every((v,i)=>v===patch.domainV[i<patch.orderV?0:1]);
  if(bezier){
    let uu=0,uv=0,vv=0;const p=patch.orderU-1,q=patch.orderV-1,du=patch.domainU[1]-patch.domainU[0],dv=patch.domainV[1]-patch.domainV[0];
    for(let i=0;i<patch.nu;i++)for(let j=0;j<patch.nv;j++){
      const at=(u,v)=>heights[u*patch.nv+v];
      if(i+2<patch.nu)uu=Math.max(uu,p*(p-1)*Math.abs(at(i+2,j)-2*at(i+1,j)+at(i,j))/(du*du));
      if(j+2<patch.nv)vv=Math.max(vv,q*(q-1)*Math.abs(at(i,j+2)-2*at(i,j+1)+at(i,j))/(dv*dv));
      if(i+1<patch.nu&&j+1<patch.nv)uv=Math.max(uv,p*q*Math.abs(at(i+1,j+1)-at(i+1,j)-at(i,j+1)+at(i,j))/(du*dv));
    }
    curvature=(uu*dot(dualU,dualU)+2*uv*length(dualU)*length(dualV)+vv*dot(dualV,dualV))*(1+ROUNDING_RELATIVE)+ROUNDING_RELATIVE;
  }
  const guard=ROUNDING_MM*8*(1+slope);
  function residual(point){
    const delta=subtract(point,origin),u=patch.domainU[0]+dot(delta,dualU),v=patch.domainV[0]+dot(delta,dualV);
    return dot(point,axis)-evaluateScalar(patch,heights,u,v);
  }
  function curveBounds(geometry){
    const vertices=geometry.kind==='polyline'?geometry.points:geometry.kind==='nurbs'?geometry.controlPoints:null;
    if(!vertices)return null;
    let low=Infinity,high=-Infinity,previous=null,previousValue=0,previousRegion=null;
    const region=point=>{const delta=subtract(point,origin);return [dot(delta,dualU)+patch.domainU[0],dot(delta,dualV)+patch.domainV[0]].map((v,k)=>v<patch[k?'domainV':'domainU'][0]?-1:v>patch[k?'domainV':'domainU'][1]?1:0);};
    for(const point of vertices){const value=residual(point);
      const currentRegion=region(point);
      if(previous){const distance=length(project(subtract(point,previous))),smooth=currentRegion.every((v,k)=>v===previousRegion[k]);
        const allowance=geometry.kind==='polyline'?Math.min(slope*distance/2,smooth&&Number.isFinite(curvature)?curvature*distance*distance/8:Infinity):0;
        low=Math.min(low,value,previousValue-allowance,value-allowance);high=Math.max(high,value,previousValue+allowance,value+allowance);
      }else{low=value;high=value;}previous=point;previousValue=value;previousRegion=currentRegion;
    }
    if(geometry.kind==='nurbs'){
      const bounds=convexBounds({vertices}),diameter=length(subtract(bounds.max,bounds.min));low-=slope*diameter;high+=slope*diameter;
    }
    return [low-guard,high+guard];
  }
  return {axis,slope,curvature,residual,curveBounds};
}

// A fixed tangent and one slerped normal interval bound the projected section
// normal. This is a directional bound, not a sampled section approximation.
export function sectionNormalProjectionBound(tangent,fromNormal,toNormal,axis){
  const frame=sectionFrame(tangent,fromNormal);if(!frame)return -1;
  const cosine=Math.max(-1,Math.min(1,dot(fromNormal,toNormal))),angle=Math.atan2(length(cross(fromNormal,toNormal)),cosine);
  const error=Math.min(2,4*Math.sin(angle/2)/frame.projectedSize+ROUNDING_RELATIVE);
  return Math.max(-1,dot(frame.normal,axis)-error);
}

// Projection of an orthogonalized section normal from bounded tangent/normal
// cones. The projection operator changes by at most sin(tangent angle); a
// ball around its reference vector bounds the resulting direction angle.
export function sectionNormalConeProjectionBound(tangentCone,normalCone,axis){
  if(!tangentCone||!normalCone)return -1;
  const frame=sectionFrame(tangentCone.axis,normalCone.axis);if(!frame)return -1;
  const error=2*Math.sin(normalCone.halfAngleRad/2)+Math.sin(Math.min(Math.PI/2,tangentCone.halfAngleRad));
  if(error>=frame.projectedSize)return -1;
  const angle=Math.acos(Math.max(-1,Math.min(1,dot(frame.normal,axis))))+Math.asin(error/frame.projectedSize);
  return Math.cos(Math.min(Math.PI,angle));
}

// Lower-bound the tip's support along its moving outward axis relative to a
// reference center. Position is affine and the frame follows one SO(3) arc.
// |(P.n)''| <= 2|P'|*angle + max|P-center|*angle², so the endpoint scalar
// interpolation minus this bound/8 encloses the entire coupled motion.
export function movingAxisSupportBound(from,to,fromPose,toPose,angle,center){
  const a=subtract(from,center),b=subtract(to,center),first=dot(a,scale(fromPose.toolAxis,-1)),last=dot(b,scale(toPose.toolAxis,-1));
  const curvature=2*length(subtract(to,from))*angle+Math.max(length(a),length(b))*angle*angle;
  return Math.min(first,last)-curvature/8-ROUNDING_MM*4;
}

// Convex endpoint bounds for a moving rectangular section. The tangent is
// fixed on this source span; its reference normal follows one slerp arc.
export function movingSectionBounds(from,to,tangent,fromNormal,toNormal,radius,depthRange,center,projectionAxis){
  const depth=depthRange[1];
  const frame=sectionFrame(tangent,fromNormal);if(!frame)return null;
  const angle=Math.atan2(length(cross(fromNormal,toNormal)),Math.max(-1,Math.min(1,dot(fromNormal,toNormal))));
  const referenceError=2*Math.sin(angle/2),crossLow=Math.sqrt(Math.max(0,1-Math.min(1,Math.abs(dot(fromNormal,tangent))+referenceError)**2));
  const normalAxial=Math.min(1,Math.max(Math.abs(dot(fromNormal,projectionAxis)),Math.abs(dot(toNormal,projectionAxis)))/Math.max(ROUNDING_RELATIVE,Math.cos(angle/2)));
  // Nearly planar normals/tangents give a nearly constant section frame even
  // when the reference normal rotates along that plane. Bound this correlation
  // instead of isotropically inflating the section by its full normal change.
  const planarError=crossLow>0?4*(normalAxial+Math.abs(dot(tangent,projectionAxis)))/crossLow:2;
  const error=Math.min(2,4*Math.sin(angle/2)/frame.projectedSize,planarError)+ROUNDING_RELATIVE;
  const a=subtract(from,center),b=subtract(to,center),reach=Math.max(length(a),length(b));
  const normalLow=Math.min(dot(a,frame.normal),dot(b,frame.normal))-reach*error;
  const sideHigh=Math.max(Math.abs(dot(a,frame.side)),Math.abs(dot(b,frame.side)))+reach*error;
  const radiusBound=Math.sqrt(reach*reach+radius*radius+2*radius*sideHigh+Math.max(0,depth*depth-2*depth*normalLow))+ROUNDING_MM*4;
  const delta=subtract(b,a),size2=dot(delta,delta),t=size2?Math.max(0,Math.min(1,-dot(a,delta)/size2)):0;
  const positionRadiusMin=length(add(a,scale(delta,t)));
  const topRadiusMin=Math.sqrt(Math.max(0,positionRadiusMin**2-Math.min(sideHigh**2,2*radius*sideHigh)))-ROUNDING_MM*4;
  const normalHigh=Math.max(dot(a,frame.normal),dot(b,frame.normal))+reach*error;
  const depthTerm=d=>d*d-2*d*(d>=0?normalLow:normalHigh);
  const underRadiusMax=Math.sqrt(Math.max(0,reach**2+radius**2+2*radius*sideHigh+
    Math.max(depthTerm(depthRange[0]-PRINT_RESOLUTION_MM),depthTerm(depth+PRINT_RESOLUTION_MM))))+ROUNDING_MM*4;
  const extent=radius*Math.min(1,Math.abs(dot(frame.side,projectionAxis))+error)+depth*Math.min(1,Math.abs(dot(frame.normal,projectionAxis))+error);
  const lo=Math.min(dot(from,projectionAxis),dot(to,projectionAxis))-extent,hi=Math.max(dot(from,projectionAxis),dot(to,projectionAxis))+extent;
  return {radius:radiusBound,projection:[lo-ROUNDING_MM*4,hi+ROUNDING_MM*4],positionRadiusMin:Math.max(0,positionRadiusMin-ROUNDING_MM*4),topRadiusMin,underRadiusMax,normalCosine:reach&&normalLow>0?Math.min(1,normalLow/reach):-1};
}
