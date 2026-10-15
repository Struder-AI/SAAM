// Convex volume/contact and swept-nozzle queries in arbitrary XYZ frames.
// Inputs are numerical shapes; this module knows no process or operation IDs.
import {add,subtract,scale,dot,cross,length,normalize,requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {interpolateDirectionPair,rotation,mv} from './frame.mjs';

export function convexSupport(shape,direction){
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
  const center=subtract(a.a??a.parts[0].a,b.a??b.parts[0].a),initial=length(center)>ROUNDING_MM?center:[1,0,0];
  const state={simplex:[subtract(convexSupport(a,initial),convexSupport(b,scale(initial,-1)))],distance:Infinity};
  for(;;){
    const closest=simplexClosest(state.simplex);
    if(closest.distance<=ROUNDING_MM)return 0;
    const direction=scale(closest.point,-1),next=subtract(convexSupport(a,direction),convexSupport(b,scale(direction,-1)));
    const lowerBound=dot(closest.point,next)/closest.distance;
    if(lowerBound>thresholdMm+ROUNDING_MM)return lowerBound;
    const improvement=closest.distance**2-dot(closest.point,next);
    if(improvement<=ROUNDING_MM*Math.max(1,closest.distance)||state.simplex.some(p=>length(subtract(p,next))<=ROUNDING_MM))return closest.distance;
    if(state.distance-closest.distance<=ROUNDING_MM)return closest.distance;
    state.distance=closest.distance;state.simplex=[...closest.points,next];
  }
}

export const convexDistance=(a,b)=>convexSeparation(a,b);
export const convexIntersects=(a,b,toleranceMm=PRINT_RESOLUTION_MM)=>convexSeparation(a,b,toleranceMm)<=toleranceMm;

// Index immutable volumes, optionally partitioned by opaque caller-owned groups.
// Filter whole groups before traversing their beads. One witness per group is
// sufficient when the caller is proving relationships rather than listing hits.
export function convexSpatialIndex(shapes,{groups=null}={}){
  requireThat(!groups||groups.length===shapes.length,'Spatial index groups must match its shapes.');
  const entries=shapes.map((shape,index)=>({shape,index,bounds:convexBounds(shape)}));
  function build(items,partition={}){
    const bounds=items.reduce((box,item)=>({min:box.min.map((v,i)=>Math.min(v,item.bounds.min[i])),max:box.max.map((v,i)=>Math.max(v,item.bounds.max[i]))}),
      {min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
    if(items.length<=8)return {...partition,bounds,items};
    const axis=[0,1,2].reduce((best,i)=>bounds.max[i]-bounds.min[i]>bounds.max[best]-bounds.min[best]?i:best,0);
    const ordered=[...items].sort((a,b)=>a.bounds.min[axis]+a.bounds.max[axis]-b.bounds.min[axis]-b.bounds.max[axis]),mid=Math.floor(items.length/2);
    return {...partition,bounds,left:build(ordered.slice(0,mid),partition),right:build(ordered.slice(mid),partition)};
  }
  const partitions=new Map();
  if(groups)for(const entry of entries){
    const group=groups[entry.index];if(!partitions.has(group))partitions.set(group,[]);partitions.get(group).push(entry);
  }
  const tree=groups?build([...partitions].map(([group,items])=>{const tree=build(items,{group,grouped:true});return {group,tree,bounds:tree.bounds};})):build(entries);
  const selected={allowed:null,tree:null};
  // Reuse a filtered top-level tree across queries with the same immutable
  // allowed-group set. Whole proven-irrelevant subtrees disappear before scans.
  function selectedTree(node,allowed){
    if(node.items){const items=node.items.filter(item=>allowed.has(item.group));return items.length===node.items.length?node:items.length?{...node,items}:null;}
    const left=selectedTree(node.left,allowed),right=selectedTree(node.right,allowed);
    if(!left)return right;if(!right)return left;
    if(left===node.left&&right===node.right)return node;
    return {left,right,bounds:{min:left.bounds.min.map((v,i)=>Math.min(v,right.bounds.min[i])),max:left.bounds.max.map((v,i)=>Math.max(v,right.bounds.max[i]))}};
  }
  function selection(allowed){
    requireThat(groups,'Group selection needs a grouped spatial index.');
    if(selected.allowed!==allowed){selected.allowed=allowed;selected.tree=selectedTree(tree,allowed)??build([]);}
    return selected.tree;
  }
  return {bounds:tree.bounds,query(shape,toleranceMm=PRINT_RESOLUTION_MM,{accept=null,acceptGroup=null,firstPerGroup=false,confirm=null,withinGroups=null}={}){
    const box=convexBounds(shape),pending=[withinGroups?selection(withinGroups):tree],found=[],settled=new Set();
    while(pending.length){
      const node=pending.pop(),{group,grouped}=node;
      if(firstPerGroup&&grouped&&settled.has(group)||!boundsOverlap(box,node.bounds,toleranceMm))continue;
      if(node.items){for(const item of node.items){
        if(!boundsOverlap(box,item.bounds,toleranceMm))continue;
        if(item.tree){if(!acceptGroup||acceptGroup(item.group))pending.push(item.tree);}
        else if((!accept||accept(item.index))&&convexIntersects(shape,item.shape,toleranceMm)&&(!confirm||confirm(item.shape))){
          found.push(item.index);if(firstPerGroup&&grouped){settled.add(group);break;}
        }
      }}else pending.push(node.left,node.right);
    }
    return found;
  }};
}

export const DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG=15;
// Physical allowance on the nozzle surface; bead overlap is independent.
export const NOZZLE_FORGIVENESS_MM=.1;
export function nozzleAt(point,axis,lengthMm,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG){
  const outward=normalize(axis);
  requireThat(Number.isFinite(includedAngleDeg)&&includedAngleDeg>0&&includedAngleDeg<180,'Nozzle cone included angle must be between 0 and 180 degrees.');
  // Eroding an infinite cone by this distance moves its apex along the axis.
  const start=add(point,scale(outward,NOZZLE_FORGIVENESS_MM/Math.sin(includedAngleDeg*Math.PI/360)));
  return {a:start,b:add(start,scale(outward,lengthMm)),normal:outward,radius:0,endRadius:lengthMm*Math.tan(includedAngleDeg*Math.PI/360),depth:0};
}

// Bound one interval of the original rigid-frame interpolation, preserving its
// parameterization through refinement. A fixed-axis translated cone is convex.
function nozzleInterval(motion,a,b){
    const {from,to,fromPose,toPose,lengthMm,includedAngleDeg}=motion;
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
    const radiusBound=(lengthMm+NOZZLE_FORGIVENESS_MM/Math.sin(halfAngle))/Math.cos(halfAngle);
    const error=radiusBound*Math.min(1-Math.sqrt((1+frameCosine)/2),2*axisChord);
    const shapes=[a,b].map((t,i)=>nozzleAt(from.map((v,k)=>v+(to[k]-v)*t),axes[i],lengthMm,includedAngleDeg));
    return {parts:shapes,margin:error,motion,a,b,fixed:axisChord===0};
}

// Coarse conservative envelopes for spatial rejection; a changing-pose hull
// alone cannot prove collision, because it also fills clear space between poses.
export function sweptNozzle(from,to,fromPose,toPose,lengthMm,includedAngleDeg=DEFAULT_NOZZLE_INCLUDED_ANGLE_DEG){
  const motion={from,to,fromPose,toPose,lengthMm,includedAngleDeg},pieces=[],pending=[{a:0,b:1}];
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
    const mid=(interval.a+interval.b)/2;
    if(mid<=interval.a||mid>=interval.b)return true;
    const left=nozzleInterval(interval.motion,interval.a,mid),right=nozzleInterval(interval.motion,mid,interval.b);
    if(convexIntersects(left.parts[1],shape,toleranceMm))return true;
    pending.push(left,right);
  }
  return false;
}

export function nozzleSweepHits(index,from,to,fromPose,toPose,options={}){
  const reach=nozzleSweepReach(index.bounds,from,to,fromPose,toPose),hits=new Set();
  for(const sweep of sweptNozzle(from,to,fromPose,toPose,reach)){
    function confirm(shape){return nozzleIntervalIntersects(sweep,shape,ROUNDING_MM);}
    if(sweep.fixed){for(const hit of index.query(sweep,ROUNDING_MM,options))hits.add(hit);}
    else for(const hit of index.query(sweep,ROUNDING_MM,{...options,confirm}))hits.add(hit);
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

export function nozzleMotionHits(index,occupied,from,to,fromPose,toPose,{withinGroups=null}={}){
  if(!occupied.size)return [];
  return nozzleSweepHits(index,from,to,fromPose,toPose,{accept:hit=>occupied.has(hit),withinGroups});
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
