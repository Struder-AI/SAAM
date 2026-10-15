// Convex volume/contact and swept-nozzle queries in arbitrary XYZ frames.
// Inputs are numerical shapes; this module knows no process or operation IDs.
import {add,subtract,scale,dot,cross,length,normalize,requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {interpolateDirectionPair,rotation,mv} from './frame.mjs';

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
  if(shape.vertices)return shape.vertices.reduce((best,p)=>dot(p,direction)>dot(best,direction)?p:best);
  if(shape.body){const point=convexSupport(shape.body,direction);return dot(shape.sweep,direction)>0?add(point,shape.sweep):point;}
  if(shape.parts){
    const points=shape.parts.map(part=>convexSupport(part,direction));
    const best=points.reduce((best,p)=>dot(p,direction)>dot(best,direction)?p:best);
    return shape.margin?add(best,scale(normalize(direction),shape.margin)):best;
  }
  const normal=shape.normal,radial=subtract(direction,scale(normal,dot(direction,normal))),size=length(radial);
  if(shape.side){
    const end=dot(shape.a,direction)>dot(shape.b,direction)?shape.a:shape.b;
    return add(add(end,scale(shape.side,dot(shape.side,direction)>=0?shape.radius:-shape.radius)),scale(normal,dot(direction,normal)<0?-shape.depth:0));
  }
  const useA=dot(shape.a,direction)+shape.radius*size>dot(shape.b,direction)+(shape.endRadius??shape.radius)*size;
  const end=useA?shape.a:shape.b,radius=useA?shape.radius:shape.endRadius??shape.radius;
  const point=add(end,size>ROUNDING_MM?scale(radial,radius/size):[0,0,0]);
  return add(point,scale(normal,dot(direction,normal)<0?-shape.depth:0));
}
export const convexBounds=shape=>({min:[0,1,2].map(i=>convexSupport(shape,[0,1,2].map(k=>k===i?-1:0))[i]),
  max:[0,1,2].map(i=>convexSupport(shape,[0,1,2].map(k=>k===i?1:0))[i])});
export const boundsOverlap=(a,b,slack=PRINT_RESOLUTION_MM)=>
  a.min[0]<=b.max[0]+slack&&a.max[0]>=b.min[0]-slack&&
  a.min[1]<=b.max[1]+slack&&a.max[1]>=b.min[1]-slack&&
  a.min[2]<=b.max[2]+slack&&a.max[2]>=b.min[2]-slack;

// Closest point in a simplex, by its feasible affine faces. At most four
// vertices, so this also handles degenerate/coplanar simplexes explicitly.
function simplexClosest(points){
  const best={distance:Infinity,point:null,points:null};
  for(let mask=1;mask<2**points.length;mask++){
    const selected=points.filter((_,i)=>mask&(1<<i)),base=selected[0],edges=selected.slice(1).map(p=>subtract(p,base));
    const matrix=edges.map(a=>[...edges.map(b=>dot(a,b)),-dot(a,base)]),count=edges.length;
    const solve={valid:true};
    for(let column=0;column<count;column++){
      const pivot=matrix.reduce((found,row,i)=>i>=column&&Math.abs(row[column])>Math.abs(matrix[found][column])?i:found,column);
      if(Math.abs(matrix[pivot][column])<=ROUNDING_MM**2){solve.valid=false;break;}
      [matrix[column],matrix[pivot]]=[matrix[pivot],matrix[column]];
      const divisor=matrix[column][column];
      for(let j=column;j<=count;j++)matrix[column][j]/=divisor;
      for(let i=0;i<count;i++)if(i!==column){const factor=matrix[i][column];for(let j=column;j<=count;j++)matrix[i][j]-=factor*matrix[column][j];}
    }
    if(!solve.valid)continue;
    const weights=matrix.map(row=>row[count]),first=1-weights.reduce((sum,v)=>sum+v,0),all=[first,...weights];
    if(all.some(v=>v<0))continue;
    const point=selected.reduce((sum,p,i)=>add(sum,scale(p,all[i])),[0,0,0]),distance=length(point);
    if(distance<best.distance)Object.assign(best,{distance,point,points:selected.filter((_,i)=>all[i]>0)});
  }
  return best;
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
  const axesA=[normalize(subtract(a.b,a.a)),a.side,a.normal],axesB=[normalize(subtract(b.b,b.a)),b.side,b.normal];
  const centerA=add(scale(add(a.a,a.b),.5),scale(a.normal,-a.depth/2)),centerB=add(scale(add(b.a,b.b),.5),scale(b.normal,-b.depth/2));
  const spansA=[length(subtract(a.b,a.a))/2,a.radius,a.depth/2],spansB=[length(subtract(b.b,b.a))/2,b.radius,b.depth/2],offset=subtract(centerB,centerA);
  for(const axis of [...axesA,...axesB,...axesA.flatMap(x=>axesB.map(y=>cross(x,y)))]){
    const size=length(axis);if(size<=ROUNDING_RELATIVE)continue;
    const radiusA=axesA.reduce((sum,v,k)=>sum+Math.abs(dot(v,axis))*spansA[k],0),radiusB=axesB.reduce((sum,v,k)=>sum+Math.abs(dot(v,axis))*spansB[k],0);
    if(Math.abs(dot(offset,axis))>radiusA+radiusB+toleranceMm*size)return false;
  }
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
  // The caller normally extends the cone past all indexed stock. A shorter
  // finite cap needs the general convex predicate instead of this shortcut.
  if(high>sweep.motion.lengthMm)return null;
  const vertices=Array.from({length:2**generators.length},(_,mask)=>{
    const point=generators.reduce((q,g,k)=>mask&(1<<k)?add(q,g):q,origin),z=dot(point,axis);
    return {point,z,r2:Math.max(0,dot(point,point)-z*z)};
  });
  if(vertices.some(v=>c*Math.sqrt(v.r2)-s*v.z<=toleranceMm))return true;
  for(const [k,g] of generators.entries()){
    const dz=projected[k],a=Math.max(0,dot(g,g)-dz*dz),denominator=c*c*a-s*s*dz*dz;
    if(a<=ROUNDING_MM**2||denominator<=0)continue;
    for(const [i,v] of vertices.entries()){
      if(i&(1<<k))continue;
      const b=dot(v.point,g)-v.z*dz,k2=Math.max(0,a*v.r2-b*b),t=(s*dz*Math.sqrt(k2/denominator)-b)/a;
      if(t<=0||t>=1)continue;
      const r2=Math.max(0,v.r2+2*b*t+a*t*t);
      if(c*Math.sqrt(r2)-s*(v.z+dz*t)<=toleranceMm)return true;
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
  return -s*interval.high<=toleranceMm;
}

export function convexIntersects(a,b,toleranceMm=PRINT_RESOLUTION_MM){
  if(a.side&&b.side)return prismIntersects(a,b,toleranceMm);
  const sweep=a.fixed&&a.motion?a:b.fixed&&b.motion?b:null,prism=sweep===a?b:a;
  if(sweep&&prism.side){const hit=fixedConePrismIntersects(sweep,prism,toleranceMm);if(hit!==null)return hit;}
  return convexSeparation(a,b,toleranceMm)<=toleranceMm;
}

// Index immutable volumes in caller-owned partitions and witness groups.
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
  return {bounds:tree.bounds,query(shape,toleranceMm=PRINT_RESOLUTION_MM,{accept=null,acceptGroup=null,firstPerGroup=false,confirm=null,withinGroups=null,groupPrefixes=null,boundsTest=null}={}){
    if(withinGroups)requireThat(groups,'Group selection needs a grouped spatial index.');
    const box=convexBounds(shape),pending=[tree],found=[],settled=new Set(),token={};
    function eligible(member){
      if(member.token!==token){member.token=token;member.allowed=(!withinGroups||withinGroups.has(member.group))&&(!acceptGroup||acceptGroup(member.group));member.through=groupPrefixes?.get(member.group)??Infinity;}
      return member.allowed;
    }
    while(pending.length){
      const node=pending.pop(),{group,grouped}=node;
      if(!boundsOverlap(box,node.bounds,toleranceMm)||boundsTest&&!boundsTest(node.bounds))continue;
      const status=withinGroups?selected(node.partition,withinGroups):2;if(!status)continue;
      if(grouped&&(firstPerGroup&&settled.has(group)||!eligible(node.member)||node.firstIndex>node.member.through))continue;
      if(node.items){for(const item of node.items){
        if(!boundsOverlap(box,item.bounds,toleranceMm)||boundsTest&&!boundsTest(item.bounds))continue;
        if(item.tree){pending.push(item.tree);continue;}
        const group=item.group;
        if(groups&&(firstPerGroup&&settled.has(group)||!eligible(item.member)||item.index>item.member.through))continue;
        if((!accept||accept(item.index))&&convexIntersects(shape,item.shape,toleranceMm)&&(!confirm||confirm(item.shape))){
          found.push(item.index);if(firstPerGroup&&groups)settled.add(group);
        }
      }}else pending.push(node.left,node.right);
    }
    return found;
  }};
}

export const DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG=15;
// Physical allowance on the nozzle surface; bead overlap is independent.
export const NOZZLE_FORGIVENESS_MM=.1;
export function nozzleAt(point,axis,lengthMm,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm=NOZZLE_FORGIVENESS_MM){
  const outward=normalize(axis);
  requireThat(Number.isFinite(includedAngleDeg)&&includedAngleDeg>0&&includedAngleDeg<180,'Nozzle cone included angle must be between 0 and 180 degrees.');
  requireThat(Number.isFinite(forgivenessMm)&&forgivenessMm>=0,'Nozzle surface forgiveness must be finite and nonnegative.');
  // Eroding an infinite cone by this distance moves its apex along the axis.
  const start=add(point,scale(outward,forgivenessMm/Math.sin(includedAngleDeg*Math.PI/360)));
  return {a:start,b:add(start,scale(outward,lengthMm)),normal:outward,radius:0,endRadius:lengthMm*Math.tan(includedAngleDeg*Math.PI/360),depth:0};
}

// Bound one interval of the original rigid-frame interpolation, preserving its
// parameterization through refinement. A fixed-axis translated cone is convex.
function nozzleInterval(motion,a,b){
    const {from,to,fromPose,toPose,lengthMm,includedAngleDeg,forgivenessMm}=motion;
    const poses=[a,b].map(t=>interpolateDirectionPair(
      [fromPose.toolAxis,fromPose.toolUp],[toPose.toolAxis,toPose.toolUp],t));
    const axes=poses.map(p=>scale(p[0],-1)),axisChord=length(subtract(axes[0],axes[1]));
    const halfAngle=includedAngleDeg*Math.PI/360;
    // A frame may roll around an oblique axis: its cone axis then follows a
    // small circle, not the great-circle arc between the endpoint axes. Use
    // the full frame rotation for the rigid-point sagitta bound. The second
    // bound follows from the axis chord and makes pure/near-pure roll cheap.
    const frameCosine=axisChord===0?1:Math.max(-1,Math.min(1,(dot(axes[0],axes[1])+dot(poses[0][1],poses[1][1])+
      dot(cross(axes[0],poses[0][1]),cross(axes[1],poses[1][1]))-1)/2));
    const radiusBound=(lengthMm+forgivenessMm/Math.sin(halfAngle))/Math.cos(halfAngle);
    const error=radiusBound*Math.min(1-Math.sqrt((1+frameCosine)/2),2*axisChord);
    const shapes=[a,b].map((t,i)=>nozzleAt(from.map((v,k)=>v+(to[k]-v)*t),axes[i],lengthMm,includedAngleDeg,forgivenessMm));
    return {parts:shapes,margin:error,motion,t0:a,t1:b,fixed:axisChord===0,
      ...(axisChord===0?{body:shapes[0],sweep:shapes[1].a.map((v,k)=>v-shapes[0].a[k])}:{})};
}

// Coarse conservative envelopes for spatial rejection; a changing-pose hull
// alone cannot prove collision, because it also fills clear space between poses.
export function sweptNozzle(from,to,fromPose,toPose,lengthMm,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm=NOZZLE_FORGIVENESS_MM){
  const motion={from,to,fromPose,toPose,lengthMm,includedAngleDeg,forgivenessMm},pieces=[],pending=[{a:0,b:1}];
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
function nozzleIntervalIntersects(sweep,shape,toleranceMm){
  const pending=[sweep];
  while(pending.length){
    const interval=pending.pop();
    if(!convexIntersects(interval,shape,toleranceMm))continue;
    if(interval.fixed||interval.parts.some(cone=>convexIntersects(cone,shape,toleranceMm)))return true;
    const mid=(interval.t0+interval.t1)/2;
    if(mid<=interval.t0||mid>=interval.t1)return true;
    const left=nozzleInterval(interval.motion,interval.t0,mid),right=nozzleInterval(interval.motion,mid,interval.t1);
    if(convexIntersects(left.parts[1],shape,toleranceMm))return true;
    pending.push(left,right);
  }
  return false;
}

// The infinite cone's signed side inequality is convex. Its supporting
// plane at a node's center gives a lower bound over the entire AABB and
// translated tip segment. A positive bound proves separation before GJK.
function fixedConeBounds(sweep){
  const axis=sweep.body.normal,halfAngle=sweep.motion.includedAngleDeg*Math.PI/360,c=Math.cos(halfAngle),s=Math.sin(halfAngle);
  const tip=add(sweep.body.a,scale(sweep.sweep,.5));
  return bounds=>{
    const q=bounds.min.map((v,k)=>(v+bounds.max[k])/2-tip[k]),z=dot(q,axis),radial=subtract(q,scale(axis,z)),r=length(radial);
    const gradient=add(scale(axis,-s),r>ROUNDING_MM?scale(radial,c/r):[0,0,0]);
    const lower=(r>ROUNDING_MM?c*r:0)-s*z-bounds.min.reduce((sum,v,k)=>sum+Math.abs(gradient[k])*(bounds.max[k]-v)/2,0)-Math.abs(dot(gradient,sweep.sweep))/2;
    return lower<=ROUNDING_MM;
  };
}

export function nozzleSweepHits(index,from,to,fromPose,toPose,options={}){
  const reach=nozzleSweepReach(index.bounds,from,to,fromPose,toPose),hits=new Set();
  const {forgivenessMm=NOZZLE_FORGIVENESS_MM,...filters}=options;
  for(const sweep of sweptNozzle(from,to,fromPose,toPose,reach,DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG,forgivenessMm)){
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

export function nozzleMotionHits(index,occupied,from,to,fromPose,toPose,{withinGroups=null,groupPrefixes=null}={}){
  if(!occupied.size)return [];
  return nozzleSweepHits(index,from,to,fromPose,toPose,{accept:hit=>occupied.has(hit),withinGroups,groupPrefixes});
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
  if(!nozzleMotionHits(index,occupied,from,to,fromPose,toPose,options).length)return [{point:to,pose:toPose}];
  const targetHits=nozzleMotionHits(index,occupied,to,to,toPose,toPose,options);
  if(targetHits.length)return {blocked:targetHits};
  const center=index.bounds.min.map((v,i)=>(v+index.bounds.max[i])/2),radius=length(subtract(index.bounds.max,index.bounds.min))/2+PRINT_RESOLUTION_MM;
  const outwardA=scale(fromPose.toolAxis,-1),outwardB=scale(toPose.toolAxis,-1);
  const state={clearance:radius*2+1};
  for(;;){
    const a=add(from,scale(outwardA,Math.max(0,state.clearance-dot(subtract(from,center),outwardA))));
    const b=add(to,scale(outwardB,Math.max(0,state.clearance-dot(subtract(to,center),outwardB))));
    const route=[{point:a,pose:fromPose}];
    if(length(subtract(outwardA,outwardB))<=ROUNDING_MM){route.push({point:b,pose:toPose},{point:to,pose:toPose});}
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
    if(!blocked.size)return route;
    // Increasing exterior clearance improves routing, rather than truncating a
    // valid job at a fixed iteration/distance budget. A blocked initial retreat
    // cannot be repaired by a larger exterior route.
    const retreat=nozzleMotionHits(index,occupied,from,a,fromPose,fromPose,options);
    if(retreat.length)return {blocked:retreat};
    state.clearance*=2;
    requireThat(Number.isFinite(state.clearance),'Nozzle exterior route has no representable clearance.');
  }
}
