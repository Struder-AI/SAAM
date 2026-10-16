// Sew native face boundaries, without a mesh of the faces. Coedges refer to
// either a shared surface intersection, a native isocurve, or a straight line.
// All uses of a curve split at the same parameters and share vertex identities.
import {evaluate,nurbsCurveRecord} from './nurbs.mjs';
import {prepareNumericalCurve,numericalCurveClosestParameter} from './curve-query.mjs';
import {surfaceIsoCurve,curvePoint} from './surface-curves.mjs';
import {patchDomain} from './surface-trim.mjs';
import {prepareCurveLoops} from './curve-loops.mjs';
import {curveCorrespondence} from './surface-coincidence.mjs';
import {distance,dot,cross,normalize,requireThat} from './tolerance.mjs';
import {BOOLEAN_TOLERANCE_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

export function sewSurfaceBoundary(patches,intersections,{toleranceMm=BOOLEAN_TOLERANCE_MM/2}={}){
  const curves=[];
  for(const curve of intersections)rememberIntersection(curve.points,curve.charts??[{face:curve.a,uv:curve.uvA},{face:curve.b,uv:curve.uvB}],curve,curves,toleranceMm);
  for(const patch of patches)for(const boundary of patch.boundaryCurves??[]){
    const existing=curves.find(curve=>curve.kind==='intersection'&&curve.points.length===boundary.points.length&&curve.points.every((point,i)=>distance(point,boundary.points[i])<=ROUNDING_MM));
    if(existing){if(!existing.charts.some(chart=>chart.face===patch.sourceFace))existing.charts.push({face:patch.sourceFace,uv:boundary.uv});}
    else rememberIntersection(boundary.points,[{face:patch.sourceFace,uv:boundary.uv}],null,curves,toleranceMm);
  }
  // Register full native chart edges before their trimmed uses. A later face
  // may retain only an interval of a neighbour's edge; face order must not
  // choose a shorter canonical parameterization for that shared curve.
  for(const patch of patches)for(const loop of patchDomain(patch))for(let i=0;i<loop.length;i++)
    if(!chartSegmentCollapsed(patch,loop[i],loop[(i+1)%loop.length]))nativeBoundaryMapping(patch,loop[i],loop[(i+1)%loop.length],curves,toleranceMm,{matchIntersections:false});
  const uses=[];
  for(const [face,patch] of patches.entries()){
    for(const [loop,points] of (patch.trimLoops??patchDomain(patch)).entries()){
      if(!Array.isArray(points)){
        const source=prepareCurveLoops([points]).loops[0],ordered=patch.normalSide<0?[...source].reverse():source;
        for(const [order,uvCurve] of ordered.entries()){
          const from=patch.normalSide<0?1:0,to=1-from;
          if(uvCurve.order===2&&uvCurve.n===2&&uvCurve.cp[3]===uvCurve.cp[7]){
            const a=curvePoint(uvCurve,from).slice(0,2),b=curvePoint(uvCurve,to).slice(0,2);
            for(const piece of boundaryCurveUses(patch,a,b,curves,toleranceMm))uses.push({...piece,face,loop,order});
            continue;
          }
          const mapped=canonicalNativeUse({kind:'face-curve',patch,uvCurve},from,to,curves,toleranceMm);
          uses.push({...mapped,face,loop,order,uvCurve,uvParameterRange:[from,to],uvFrom:curvePoint(uvCurve,from).slice(0,2),uvTo:curvePoint(uvCurve,to).slice(0,2)});
        }
        continue;
      }
      const ordered=patch.normalSide<0?[...points].reverse():points;
      const sequence={next:0};
      for(let i=0;i<ordered.length;i++){
        const a=ordered[i],b=ordered[(i+1)%ordered.length];
        if(chartSegmentCollapsed(patch,a,b))continue;
        const pieces=boundaryCurveUses(patch,a,b,curves,toleranceMm);
        for(const piece of pieces){
          if(chartSegmentCollapsed(patch,piece.uvFrom,piece.uvTo))continue;
          uses.push({...piece,face,loop,order:sequence.next++});
        }
      }
    }
  }
  const vertices=[],edges=[],faceLoops=patches.map(patch=>(patch.trimLoops??patchDomain(patch)).map(()=>[]));
  const vertex=point=>{
    const found=vertices.findIndex(other=>distance(point,other)<=toleranceMm);
    if(found>=0)return found;
    vertices.push(point);return vertices.length-1;
  };
  const unmatched=[],closedEdges={count:0,cancelledCoedges:0},contacts={edges:[],vertices:[]};
  for(const curve of curves){
    const active=uses.filter(use=>use.curve===curve.id);
    if(!active.length)continue;
    const values=active.flatMap(use=>[use.from,use.to]).sort((a,b)=>a-b),cuts=[];
    for(const value of values)if(!cuts.length||Math.abs(value-cuts.at(-1))>ROUNDING_RELATIVE)cuts.push(value);
    for(let i=1;i<cuts.length;i++){
      const lo=cuts[i-1],hi=cuts[i],middle=(lo+hi)/2;
      const rawCovering=active.filter(use=>middle>Math.min(use.from,use.to)&&middle<Math.max(use.from,use.to)),covering=[];
      for(const use of rawCovering){
        const opposite=covering.findIndex(prior=>prior.face===use.face&&prior.loop===use.loop&&((prior.to>prior.from)!==(use.to>use.from))&&sameChartPath(patches[use.face],prior,use,middle,toleranceMm/2));
        if(opposite>=0){covering.splice(opposite,1);closedEdges.cancelledCoedges+=2;}
        else covering.push(use);
      }
      if(!covering.length)continue;
      const ends=[curvePosition(curve,lo),curvePosition(curve,hi)];
      if(distance(...ends)<=ROUNDING_MM&&[.25,.5,.75].every(f=>distance(curvePosition(curve,lo+f*(hi-lo)),ends[0])<=ROUNDING_MM))continue;
      const endpointIds=ends.map(vertex);
      if(endpointIds[0]===endpointIds[1]&&[.25,.5,.75].every(f=>distance(curvePosition(curve,lo+f*(hi-lo)),ends[0])<=toleranceMm)){closedEdges.count++;continue;}
      const incidences=covering.map(use=>({face:use.face,loop:use.loop,orientation:use.to>use.from?1:-1,
        order:use.order+(middle-use.from)/(use.to-use.from),uvRange:[useUvAt(use,lo),useUvAt(use,hi)],
        ...(use.uvCurve?{uvCurve:use.uvCurve,uvParameterRange:[useParameterAt(use,lo),useParameterAt(use,hi)]}:{})}));
      const groups=materialEdgeSectors(incidences,patches,curve,lo,hi),shared=[];
      for(const uses of groups){
        const edge={curve:curve.id,range:[lo,hi],vertices:[...endpointIds],uses},index=edges.length;
        edges.push(edge);shared.push(index);
        for(const use of uses)faceLoops[use.face][use.loop].push({edge:index,orientation:use.orientation,order:use.order,uvRange:use.uvRange,
          ...(use.uvCurve?{uvCurve:use.uvCurve,uvParameterRange:use.uvParameterRange}:{})});
        if(uses.length!==2||uses[0].orientation===uses[1].orientation)unmatched.push({edge:index,uses:uses.length,faces:uses.map(use=>use.face),lengthMm:distance(...ends)});
      }
      if(shared.length>1)contacts.edges.push({curve:curve.id,range:[lo,hi],edges:shared});
    }
  }
  splitVertexFans(vertices,edges,contacts);
  for(const [face,loops] of faceLoops.entries())for(const [loop,coedges] of loops.entries()){
    coedges.sort((a,b)=>a.order-b.order);
    for(let i=0;i<coedges.length;i++){
      const current=coedges[i],next=coedges[(i+1)%coedges.length];
      const end=edges[current.edge].vertices[current.orientation>0?1:0],start=edges[next.edge].vertices[next.orientation>0?0:1];
      if(end!==start)unmatched.push({face,loop,kind:'open-face-loop',vertices:[end,start],distanceMm:distance(vertices[end],vertices[start])});
    }
  }
  return {vertices,curves,edges,closedEdges,contacts,faces:faceLoops.map((loops,patch)=>({patch,loops})),unmatched};
}

// A common geometric interval may bound several material sectors. Pair its
// incident faces around the tangent, preserving separate solids at edge contact.
function materialEdgeSectors(uses,patches,curve,lo,hi){
  if(uses.length<=2||uses.length%2||new Set(uses.map(use=>use.face)).size!==uses.length)return [uses];
  const a=curvePosition(curve,lo+(hi-lo)/4),b=curvePosition(curve,lo+3*(hi-lo)/4);
  if(distance(a,b)<=ROUNDING_MM)return [uses];
  const tangent=normalize(b.map((v,k)=>v-a[k]));
  const rays=uses.map(use=>{
    const patch=patches[use.face],uv=coedgeUvAt(use,[lo,hi],(lo+hi)/2),normal=evaluate(patch,...uv).normal;
    if(!normal)return null;
    const outward=normal.map(v=>v*patch.normalSide),direction=cross(outward,tangent).map(v=>v*use.orientation);
    if(Math.hypot(...direction)<=ROUNDING_RELATIVE)return null;
    return {use,direction:normalize(direction)};
  });
  if(rays.some(ray=>!ray))return [uses];
  const x=rays[0].direction,y=cross(tangent,x);
  const ordered=rays.map(ray=>({...ray,angle:Math.atan2(dot(ray.direction,y),dot(ray.direction,x))})).sort((a,b)=>a.angle-b.angle);
  for(let i=0;i<ordered.length;i++)if(dot(ordered[i].direction,ordered[(i+1)%ordered.length].direction)>1-ROUNDING_RELATIVE)return [uses];
  const pairs=[];
  for(let i=0;i<ordered.length;i++)if(ordered[i].use.orientation<0){
    const next=ordered[(i+1)%ordered.length];
    if(next.use.orientation<0)return [uses];
    pairs.push([ordered[i].use,next.use]);
  }
  return pairs.length*2===uses.length?pairs:[uses];
}

// Geometric contact does not identify disconnected surface fans. Topological
// copies keep point/edge contact from creating a nonmanifold output mesh.
function splitVertexFans(vertices,edges,contacts){
  const count=vertices.length;
  for(let vertex=0;vertex<count;vertex++){
    const incident=edges.filter(edge=>edge.vertices.includes(vertex)),links=new Map();
    for(const edge of incident)for(const use of edge.uses){
      if(!links.has(use.face))links.set(use.face,new Set());
      if(edge.uses.length===2)for(const other of edge.uses)links.get(use.face).add(other.face);
    }
    const remaining=new Set(links.keys()),groups=[];
    while(remaining.size){
      const pending=[remaining.values().next().value],group=new Set();
      while(pending.length){const face=pending.pop();if(!remaining.delete(face))continue;group.add(face);pending.push(...links.get(face));}
      groups.push(group);
    }
    if(groups.length<=1)continue;
    const copies=[];
    for(const [i,group] of groups.entries()){
      const id=i===0?vertex:vertices.length;if(i>0)vertices.push([...vertices[vertex]]);copies.push(id);
      for(const edge of incident)if(group.has(edge.uses[0].face))edge.vertices=edge.vertices.map(value=>value===vertex?id:value);
    }
    contacts.vertices.push({vertices:copies,faces:groups.map(group=>[...group])});
  }
}

function chartSegmentCollapsed(patch,a,b){
  const first=evaluate(patch,...a,false).point;
  return distance(first,evaluate(patch,...b,false).point)<=ROUNDING_MM&&
    distance(first,evaluate(patch,...interpolate(a,b,.5),false).point)<=ROUNDING_MM;
}

// A retraced chart boundary can cancel itself. Periodic seam coedges occupy
// distinct places in the chart even though their world curves coincide.
function sameChartPath(patch,a,b,parameter,toleranceMm){
  const first=useUvAt(a,parameter),second=useUvAt(b,parameter);
  const e=evaluate(patch,...first),delta=second.map((v,k)=>v-first[k]);
  return Math.hypot(...e.du.map((v,k)=>v*delta[0]+e.dv[k]*delta[1]))<=toleranceMm;
}

function useParameterAt(use,t){return use.uvParameterRange[0]+(t-use.from)/(use.to-use.from)*(use.uvParameterRange[1]-use.uvParameterRange[0]);}
function useUvAt(use,t){return use.uvCurve?curvePoint(use.uvCurve,useParameterAt(use,t)).slice(0,2):interpolate(use.uvFrom,use.uvTo,(t-use.from)/(use.to-use.from));}
export function coedgeUvAt(use,range,t){
  const fraction=(t-range[0])/(range[1]-range[0]);
  return use.uvCurve?curvePoint(use.uvCurve,use.uvParameterRange[0]+fraction*(use.uvParameterRange[1]-use.uvParameterRange[0])).slice(0,2):interpolate(use.uvRange[0],use.uvRange[1],fraction);
}

function boundaryCurveUses(patch,a,b,curves,toleranceMm){
  const delta=b.map((v,k)=>v-a[k]),length2=delta[0]**2+delta[1]**2,matches=[];
  const uvGuard=4*ROUNDING_RELATIVE*Math.max(patch.domainU[1]-patch.domainU[0],patch.domainV[1]-patch.domainV[0]);
  for(const curve of curves){
    if(curve.kind!=='intersection')continue;
    for(const chart of curve.charts.filter(chart=>chart.face===patch.sourceFace))for(const {p,q,index:i} of chartSegmentsWithin(preparedChartSegments(patch,curve,chart,toleranceMm),{min:a.map((v,k)=>Math.min(v,b[k])-uvGuard),max:a.map((v,k)=>Math.max(v,b[k])+uvGuard)})){
      const coordinates=chart.uv;
      const along=point=>((point[0]-a[0])*delta[0]+(point[1]-a[1])*delta[1])/length2;
      const x=along(p),y=along(q);
      const residual=point=>Math.hypot(...point.map((v,k)=>v-a[k]-along(point)*delta[k]));
      if(residual(p)>uvGuard||residual(q)>uvGuard||Math.abs(y-x)<=ROUNDING_RELATIVE)continue;
      const lo=Math.max(0,Math.min(x,y)),hi=Math.min(1,Math.max(x,y));
      if(hi-lo<=ROUNDING_RELATIVE)continue;
      matches.push({lo,hi,curve:curve.id,from:(i-1+(lo-x)/(y-x))/(coordinates.length-1),to:(i-1+(hi-x)/(y-x))/(coordinates.length-1)});
    }
  }
  matches.sort((x,y)=>x.lo-y.lo||x.hi-y.hi);
  const result=[],state={from:0};
  for(const match of matches){
    if(match.hi<=state.from+ROUNDING_RELATIVE)continue;
    if(match.lo>state.from+ROUNDING_RELATIVE)result.push(nativeBoundaryUse(patch,interpolate(a,b,state.from),interpolate(a,b,match.lo),curves,toleranceMm));
    const lo=Math.max(state.from,match.lo),fraction=(lo-match.lo)/(match.hi-match.lo);
    result.push({curve:match.curve,from:match.from+fraction*(match.to-match.from),to:match.to,uvFrom:interpolate(a,b,lo),uvTo:interpolate(a,b,match.hi)});state.from=match.hi;
  }
  if(state.from<1-ROUNDING_RELATIVE)result.push(nativeBoundaryUse(patch,interpolate(a,b,state.from),b,curves,toleranceMm));
  return result.map(use=>{
    const curve=curves[use.curve];
    if(curve.kind!=='intersection')return use;
    if(curve.line===undefined){
      const onChartEdge=[patch.domainU,patch.domainV].some((domain,k)=>domain.some(value=>Math.abs(use.uvFrom[k]-value)<=ROUNDING_RELATIVE&&Math.abs(use.uvTo[k]-value)<=ROUNDING_RELATIVE));
      if(onChartEdge)return {...use,...nativeBoundaryMapping(patch,use.uvFrom,use.uvTo,curves,toleranceMm,{matchIntersections:false})};
      const native=existingNativeUse({kind:'face-curve',patch,fromUv:use.uvFrom,toUv:use.uvTo},0,1,curves,toleranceMm);
      return native?{...use,...native}:use;
    }
    const line=curves[curve.line],first=curvePosition(curve,use.from),last=curvePosition(curve,use.to);
    return {...use,curve:line.id,from:dot(first.map((v,k)=>v-line.origin[k]),line.direction),to:dot(last.map((v,k)=>v-line.origin[k]),line.direction)};
  });
}

function interpolate(a,b,t){return a.map((v,k)=>v+t*(b[k]-v));}

function nativeBoundaryUse(patch,a,b,curves,toleranceMm){
  return {...nativeBoundaryMapping(patch,a,b,curves,toleranceMm),uvFrom:a,uvTo:b};
}

function nativeBoundaryMapping(patch,a,b,curves,toleranceMm,{matchIntersections=true}={}){
  const shared=matchIntersections?geometricBoundaryUse(patch,a,b,curves,toleranceMm):null;if(shared)return shared;
  const first=evaluate(patch,...a,false).point,last=evaluate(patch,...b,false).point,middle=evaluate(patch,...interpolate(a,b,.5),false).point;
  const length=distance(first,last),d=last.map((v,k)=>v-first[k]);
  if(length>ROUNDING_MM&&distance(middle,interpolate(first,last,.5))<=ROUNDING_MM){
    return lineUse(curves,first,last,toleranceMm);
  }
  const axis=Math.abs(a[0]-b[0])<=ROUNDING_RELATIVE?0:Math.abs(a[1]-b[1])<=ROUNDING_RELATIVE?1:null;
  if(axis!==null){
    const value=a[axis],domain=axis===0?patch.domainU:patch.domainV;
    if(domain.some(v=>Math.abs(v-value)<=ROUNDING_RELATIVE)){
      const native=surfaceIsoCurve(patch,axis,value),along=1-axis,range=native.domain;
      const from=(a[along]-range[0])/(range[1]-range[0]),to=(b[along]-range[0])/(range[1]-range[0]);
      return canonicalNativeUse({kind:'nurbs',native},from,to,curves,toleranceMm);
    }
  }
  return canonicalNativeUse({kind:'face-curve',patch,fromUv:a,toUv:b},0,1,curves,toleranceMm);
}

// Coplanar arrangements can sample the same native curve at different
// parameters. Sew those representations by physical distance, retaining both
// face charts and the one canonical intersection curve.
function geometricBoundaryUse(patch,a,b,curves,toleranceMm){
  const middle=interpolate(a,b,.5),candidates=[];
  for(const curve of curves){
    if(curve.kind!=='intersection')continue;
    for(const chart of curve.charts.filter(chart=>chart.face===patch.sourceFace)){
    const starts=nearCurveParameters(patch,a,curve,chart,toleranceMm),ends=nearCurveParameters(patch,b,curve,chart,toleranceMm),mids=nearCurveParameters(patch,middle,curve,chart,toleranceMm);
    for(const first of starts)for(const last of ends){
      if(Math.abs(first.t-last.t)<=ROUNDING_RELATIVE)continue;
      const low=Math.min(first.t,last.t),high=Math.max(first.t,last.t);
      const interior=mids.filter(mid=>mid.t>low-ROUNDING_RELATIVE&&mid.t<high+ROUNDING_RELATIVE);
      if(!interior.length)continue;
      const error=first.error+last.error+Math.min(...interior.map(mid=>mid.error));
      candidates.push({curve:curve.id,from:first.t,to:last.t,error,span:high-low});
    }
    }
  }
  candidates.sort((a,b)=>a.error-b.error||a.span-b.span);
  return candidates[0]??null;
}

// Intersection charts are immutable during sewing. Their segment validity
// depends on the face and construction budget, not on the lookup point.
const preparedCharts=new WeakMap();
function preparedChartSegments(patch,curve,chart,toleranceMm){
  if(!preparedCharts.has(patch))preparedCharts.set(patch,new WeakMap());
  const cache=preparedCharts.get(patch),stored=cache.get(chart);
  if(stored?.toleranceMm===toleranceMm&&stored.points===curve.points)return stored.segments;
  const segments=[],coordinates=chart.uv;
  for(let i=1;i<coordinates.length;i++){
    const p=coordinates[i-1],q=coordinates[i];
    if(faithfulChartSegment(patch,p,q,curve.points[i-1],curve.points[i],toleranceMm))segments.push({p,q,index:i,min:p.map((v,k)=>Math.min(v,q[k])),max:p.map((v,k)=>Math.max(v,q[k]))});
  }
  cache.set(chart,{toleranceMm,points:curve.points,segments});return segments;
}

// Immutable chart segments share a conservative UV search tree. Queries retain
// every candidate admitted by the original chart/physical-distance predicates.
const segmentTrees=new WeakMap();
function chartSegmentsWithin(segments,bounds){
  function build(entries){
    if(!entries.length)return null;
    const min=[0,1].map(k=>Math.min(...entries.map(s=>s.min[k]))),max=[0,1].map(k=>Math.max(...entries.map(s=>s.max[k])));
    if(entries.length<=8)return {min,max,entries};
    const axis=max[0]-min[0]>=max[1]-min[1]?0:1,ordered=[...entries].sort((a,b)=>a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis]),middle=Math.floor(entries.length/2);
    return {min,max,left:build(ordered.slice(0,middle)),right:build(ordered.slice(middle))};
  }
  if(!segmentTrees.has(segments))segmentTrees.set(segments,build(segments));
  const pending=[segmentTrees.get(segments)],found=[];
  while(pending.length){const node=pending.pop();if(!node||node.min.some((v,k)=>v>bounds.max[k]||node.max[k]<bounds.min[k]))continue;
    if(node.entries)found.push(...node.entries.filter(segment=>segment.min.every((v,k)=>v<=bounds.max[k]&&segment.max[k]>=bounds.min[k])));
    else pending.push(node.right,node.left);
  }
  return found.sort((a,b)=>a.index-b.index);
}

function faithfulChartSegment(patch,a,b,first,last,toleranceMm){
  if(!a||!b)return false;
  const middle=evaluate(patch,...interpolate(a,b,.5),false).point;
  return distance(middle,interpolate(first,last,.5))<=toleranceMm;
}

function nearCurveParameters(patch,uv,curve,chart,toleranceMm){
  const frame=evaluate(patch,...uv),coordinates=chart.uv,found=[];
  const uu=dot(frame.du,frame.du),vv=dot(frame.dv,frame.dv),uvMetric=dot(frame.du,frame.dv),determinant=uu*vv-uvMetric**2;
  const radii=determinant>0?[Math.sqrt(vv/determinant)*toleranceMm,Math.sqrt(uu/determinant)*toleranceMm]:[Infinity,Infinity];
  const bounds={min:uv.map((v,k)=>v-radii[k]),max:uv.map((v,k)=>v+radii[k])};
  for(const {p,q,index:i} of chartSegmentsWithin(preparedChartSegments(patch,curve,chart,toleranceMm),bounds)){
    const delta=q.map((v,k)=>v-p[k]);
    const direction=[0,1,2].map(k=>frame.du[k]*delta[0]+frame.dv[k]*delta[1]);
    const offset=[0,1,2].map(k=>frame.du[k]*(p[0]-uv[0])+frame.dv[k]*(p[1]-uv[1]));
    const length2=dot(direction,direction);if(length2<=ROUNDING_MM**2)continue;
    const fraction=Math.max(0,Math.min(1,-dot(offset,direction)/length2));
    const error=Math.hypot(...offset.map((v,k)=>v+fraction*direction[k]));
    if(error<=toleranceMm)found.push({t:(i-1+fraction)/(coordinates.length-1),error});
  }
  return found;
}
function rememberIntersection(points,charts,source,curves,toleranceMm){
  if(points.length<2)return;
  const first=points[0],last=points.at(-1),delta=last.map((v,k)=>v-first[k]),length2=dot(delta,delta);
  const straight=length2>ROUNDING_MM**2&&points.every(point=>{
    const t=dot(point.map((v,k)=>v-first[k]),delta)/length2;
    return distance(point,first.map((v,k)=>v+t*delta[k]))<=ROUNDING_MM;
  });
  const line=straight?lineUse(curves,first,last,toleranceMm).curve:undefined;
  curves.push({kind:'intersection',id:curves.length,points,charts,source,...(line===undefined?{}:{line})});
}

function lineUse(curves,first,last,toleranceMm){
  const delta=last.map((v,k)=>v-first[k]),length=Math.hypot(...delta),raw=delta.map(v=>v/length);
  const principal=raw.reduce((best,v,i)=>Math.abs(v)>Math.abs(raw[best])?i:best,0),sign=raw[principal]<0?-1:1,direction=raw.map(v=>v*sign);
  const along=dot(first,direction),origin=first.map((v,k)=>v-along*direction[k]);
  const existing=curves.find(curve=>curve.kind==='line'&&[first,last].every(point=>{
    const d=point.map((v,k)=>v-curve.origin[k]),t=dot(d,curve.direction);
    return Math.hypot(...d.map((v,k)=>v-t*curve.direction[k]))<=toleranceMm/4;
  }));
  const curve=existing??{kind:'line',id:curves.length,origin,direction};if(!existing)curves.push(curve);
  return {curve:curve.id,from:dot(first.map((v,k)=>v-curve.origin[k]),curve.direction),to:dot(last.map((v,k)=>v-curve.origin[k]),curve.direction)};
}
function canonicalNativeUse(candidate,from,to,curves,toleranceMm){
  const existing=existingNativeUse(candidate,from,to,curves,toleranceMm);if(existing)return existing;
  const curve={...candidate,id:curves.length};curves.push(curve);return {curve:curve.id,from,to};
}
function existingNativeUse(candidate,from,to,curves,toleranceMm){
  const points=[0,.25,.5,.75,1].map(t=>curvePosition(candidate,t));
  for(const curve of curves){
    if(curve.kind==='line'||curve.kind==='intersection')continue;
    if(candidate.kind==='nurbs'&&curve.kind==='nurbs'){
      const direction=curveCorrespondence(candidate.native,curve.native);
      if(direction)return {curve:curve.id,from:direction>0?from:1-from,to:direction>0?to:1-to};
    }
    for(const sign of [1,-1]){
      const matches=points.every((point,i)=>distance(point,curvePosition(curve,sign>0?i/4:1-i/4))<=toleranceMm/4);
      if(matches)return {curve:curve.id,from:sign>0?from:1-from,to:sign>0?to:1-to};
    }
    if(curve.kind==='nurbs'){
      const interval=partialNativeInterval(curve,points,toleranceMm/4);
      if(interval)return {curve:curve.id,from:interval[0]+from*(interval[1]-interval[0]),to:interval[0]+to*(interval[1]-interval[0])};
    }
  }
  return null;
}

const nativeEdgeQueries=new WeakMap();
function partialNativeInterval(curve,points,toleranceMm){
  if(!nativeEdgeQueries.has(curve.native))nativeEdgeQueries.set(curve.native,prepareNumericalCurve({kind:'nurbs',...nurbsCurveRecord(curve.native)}));
  const query=nativeEdgeQueries.get(curve.native),bounds=[0,1,2].map(k=>Array.from({length:curve.native.n},(_,i)=>curve.native.cp[i*4+k]/curve.native.cp[i*4+3]));
  if([points[0],points.at(-1)].some(p=>p.some((v,k)=>v<Math.min(...bounds[k])-toleranceMm||v>Math.max(...bounds[k])+toleranceMm)))return null;
  const interval=[points[0],points.at(-1)].map(p=>numericalCurveClosestParameter(query,0,1,p,{toleranceMm:ROUNDING_MM,maxDistanceMm:toleranceMm}));
  if(interval.some(t=>t===null))return null;
  if(Math.abs(interval[1]-interval[0])<=ROUNDING_RELATIVE)return null;
  return points.every((p,i)=>distance(p,curvePosition(curve,interval[0]+i/4*(interval[1]-interval[0])))<=toleranceMm)?interval:null;
}

export function curvePosition(curve,t){
  if(curve.kind==='line')return curve.origin.map((v,k)=>v+t*curve.direction[k]);
  if(curve.kind==='nurbs')return curvePoint(curve.native,t);
  if(curve.kind==='face-curve')return evaluate(curve.patch,...(curve.uvCurve?curvePoint(curve.uvCurve,t).slice(0,2):interpolate(curve.fromUv,curve.toUv,t)),false).point;
  const position=Math.max(0,Math.min(curve.points.length-1,t*(curve.points.length-1))),index=Math.min(curve.points.length-2,Math.floor(position));
  return interpolate(curve.points[index],curve.points[index+1],position-index);
}

// A rigid translation preserves topology and parameter correspondence. Only
// world coordinates move; no intersection, classification or sewing is rerun.
export function translateSurfaceSolid(solid,offset){
  const movedPoint=point=>point.map((value,k)=>value+offset[k]);
  const movedControls=source=>{
    const cp=Float64Array.from(source);
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=offset[k]*cp[i+3];
    return cp;
  };
  const patchMap=new Map();
  const patches=solid.patches.map(patch=>{
    const moved={...patch,cp:movedControls(patch.cp),boundaryCurves:patch.boundaryCurves?.map(curve=>({...curve,points:curve.points.map(movedPoint)}))};
    patchMap.set(patch,moved);return moved;
  });
  const curves=solid.topology.curves.map(curve=>{
    if(curve.kind==='line')return {...curve,origin:movedPoint(curve.origin)};
    if(curve.kind==='nurbs')return {...curve,native:{...curve.native,cp:movedControls(curve.native.cp)}};
    if(curve.kind==='face-curve')return {...curve,patch:patchMap.get(curve.patch)};
    return {...curve,points:curve.points.map(movedPoint)};
  });
  return {...solid,patches,bounds:{min:movedPoint(solid.bounds.min),max:movedPoint(solid.bounds.max)},
    intersections:solid.intersections.map(curve=>({...curve,points:curve.points.map(movedPoint)})),
    contacts:solid.contacts?.map(contact=>({...contact,point:movedPoint(contact.point)})),
    topology:{...solid.topology,curves,vertices:solid.topology.vertices.map(movedPoint)}};
}
