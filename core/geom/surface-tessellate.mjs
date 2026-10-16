// Output conversion of a completed native boundary. World vertices share
// coedge identities; each face has distinct chart vertices, including both
// sides of a periodic seam. Internal diagonals never borrow seam identities.
import {solidKernel} from './solid.mjs';
import {curvePosition,coedgeUvAt} from './surface-topology.mjs';
import {bezierSpans,bezierRoots} from './curve-ops.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';
import {evaluate,evaluateCurve} from './nurbs.mjs';
import {surfaceIsoCurve,surfaceSegmentCurves} from './surface-curves.mjs';
import {distance,dot,requireThat} from './tolerance.mjs';
import {ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

export async function tessellateSurfaceSolid(solid,{toleranceMm=.02}={}){
  requireThat(solid.kind==='surface-solid'&&solid.topology&&!solid.topology.unmatched.length,'Tessellation needs a closed native surface boundary.');
  return tessellateSurfaceShell(solid,{toleranceMm});
}

// Open authored shells still display their trimmed faces; material conversion
// uses the closed-solid entry above. Both derive the same conforming boundary.
export async function tessellateSurfaceShell(solid,{toleranceMm=.02}={}){
  requireThat(solid.topology&&Array.isArray(solid.patches),'Tessellation needs native surface boundary topology.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Tessellation tolerance must be positive.');
  if(solid.empty)return {vertices:[],triangles:[],faceIndices:[],cornerNormals:[],notes:[...(solid.notes??[])]};
  const kernel=await solidKernel(),topology=solid.topology,vertices=topology.vertices.map(point=>[...point]),boundaries=new Map();
  const edgeSamples=topology.edges.map((edge,index)=>{
    const curve=topology.curves[edge.curve],[lo,hi]=edge.range,at=t=>({point:curvePosition(curve,t)});
    const cuts=[lo,hi],chartSpans=[];
    for(const face of topology.faces)for(const loop of face.loops)for(const use of loop)if(use.edge===index){
      const patch=solid.patches[face.patch];
      if(use.uvCurve){
        const curve=use.uvCurve,coordinates=Array.from({length:curve.n},(_,i)=>[curve.cp[i*4]/curve.cp[i*4+3],curve.cp[i*4+1]/curve.cp[i*4+3]]);
        chartSpans.push(Math.hypot(...[0,1].map(k=>Math.max(...coordinates.map(p=>p[k]))-Math.min(...coordinates.map(p=>p[k])))));
        cuts.push(...curvedChartCuts(use,edge.range,patch));continue;
      }
      chartSpans.push(distance(...use.uvRange));
      for(const [axis,knots] of patchBreaks(patch).entries()){
        const a=use.uvRange[0][axis],delta=use.uvRange[1][axis]-a;
        if(delta)for(const knot of knots){const t=(knot-a)/delta;if(t>0&&t<1)cuts.push(lo+t*(hi-lo));}
      }
    }
    const guard=(hi-lo)*ROUNDING_RELATIVE/Math.min(...chartSpans.filter(span=>span>0));
    const ordered=[lo];for(const cut of [...new Set(cuts)].sort((a,b)=>a-b))if(cut-ordered.at(-1)>guard&&hi-cut>guard)ordered.push(cut);ordered.push(hi);
    const samples=sampleCurveIntervals({at,cuts:ordered,stepMm:Infinity,toleranceMm:toleranceMm/2});
    return samples.map((sample,i)=>{
      if(i===0)return {id:edge.vertices[0],t:sample.t};
      if(i===samples.length-1)return {id:edge.vertices[1],t:sample.t};
      const id=vertices.length;vertices.push(sample.point);return {id,t:sample.t};
    });
  });
  const triangles=topology.faces.flatMap(face=>triangulateFace(kernel,solid.patches[face.patch],face,topology.edges,edgeSamples,boundaries,vertices));
  const targetMm=Math.max(toleranceMm,solid.construction.toleranceMm);
  const refined=refineSurfaceTriangles(solid,vertices,triangles,boundaries,targetMm/2);
  if(targetMm>toleranceMm)refined.notes.push(`Output mesh accuracy is limited by the ${targetMm} mm native surface construction; requested ${toleranceMm} mm.`);
  const retained=refined.triangles.filter(triangle=>new Set(triangle.corners.map(corner=>corner.id)).size===3);
  return {vertices,triangles:retained.map(triangle=>{
    const ids=triangle.corners.map(corner=>corner.id);
    return solid.patches[triangle.face].normalSide<0?ids.reverse():ids;
  }),faceIndices:retained.map(triangle=>triangle.face),cornerNormals:retained.map(triangle=>{
    const patch=solid.patches[triangle.face],sign=patch.normalSide??1,normals=triangle.corners.map(corner=>evaluate(patch,...corner.uv).normal?.map(v=>v*sign)??null);
    return patch.normalSide<0?normals.reverse():normals;
  }),notes:[...(solid.notes??[]),...refined.notes],tessellation:{toleranceMm,sampledErrorMm:refined.error,method:'conforming-native-boundary'}};
}

function triangulateFace(kernel,patch,face,edges,edgeSamples,boundaries,vertices){
  const spans=[];
  const charts=face.loops.map(coedges=>{
    const traversal=patch.normalSide<0?[...coedges].reverse():coedges,points=[];
    for(const coedge of traversal){
      const edge=edges[coedge.edge],orientation=coedge.orientation*(patch.normalSide<0?-1:1);
      const samples=orientation>0?edgeSamples[coedge.edge]:[...edgeSamples[coedge.edge]].reverse();
      const chain=samples.map(sample=>({...sample,uv:coedgeUvAt(coedge,edge.range,sample.t),uvMap:{use:coedge,range:edge.range}}));
      for(let i=1;i<chain.length;i++)spans.push({curve:edge.curve,a:chain[i-1],b:chain[i]});
      for(const sample of chain){const last=points.at(-1);if(!last||distance(sample.uv,last.uv)>ROUNDING_RELATIVE&&!(sample.id===last.id&&collapsedChartEdge(patch,last,sample,vertices[sample.id],ROUNDING_MM)))points.push(sample);}
    }
    if(points.length>1&&(distance(points[0].uv,points.at(-1).uv)<=ROUNDING_RELATIVE||points[0].id===points.at(-1).id&&collapsedChartEdge(patch,points[0],points.at(-1),vertices[points[0].id],ROUNDING_MM)))points.pop();
    return points;
  }).filter(chart=>chart.length>=3);
  if(!charts.length)return [];
  const records=charts.flat();records.forEach((record,chartId)=>{record.chartId=chartId;});
  const atSample=sample=>{
    const candidates=records.filter(record=>record.id===sample.id).sort((a,b)=>distance(a.uv,sample.uv)-distance(b.uv,sample.uv));
    requireThat(candidates.length,'A surface boundary sample has no chart vertex.');
    return {...candidates[0],...sample};
  };
  for(const span of spans)rememberBoundary(boundaries,face.patch,span.curve,atSample(span.a),atSample(span.b));
  const loops=charts.map(chart=>chart.map(record=>record.uv)),raw=kernel.triangulate(loops,ROUNDING_RELATIVE,false);
  const triangles=constrainFaceBoundary(raw,records,loops).map(triangle=>triangle.map(index=>records[index]));
  return knotSpanTriangles(patch,triangles,records,vertices).map(corners=>({face:face.patch,corners}));
}

function curvedChartCuts(use,range,patch){
  const curve=use.uvCurve,domain=curve.domain,parameters=[...curve.knots];
  for(const span of bezierSpans(curve))for(const [axis,knots] of patchBreaks(patch).entries())for(const knot of knots)
    bezierRoots(Array.from({length:span.cp.length/4},(_,i)=>span.cp[i*4+axis]-knot*span.cp[i*4+3]),span.a,span.b,parameters);
  return parameters.map(t=>((t-domain[0])/(domain[1]-domain[0])-use.uvParameterRange[0])/(use.uvParameterRange[1]-use.uvParameterRange[0])).filter(f=>f>0&&f<1).map(f=>range[0]+f*(range[1]-range[0]));
}
function boundaryUvAt(boundary,t){
  const [a,b]=boundary.ends;
  return a.uvMap?coedgeUvAt(a.uvMap.use,a.uvMap.range,t):interpolate(a.uv,b.uv,(t-a.t)/(b.t-a.t));
}

// Seed triangles within native knot spans. Refining across long straight runs
// and sharp profile changes otherwise creates a growing field of slivers.
const breakCache=new WeakMap();
function patchBreaks(patch){
  if(!breakCache.has(patch)){
    const domains=[patch.domainU,patch.domainV],knots=[patch.knotsU,patch.knotsV];
    const cuts=planarPatch(patch)?[[],[]]:knots.map((values,axis)=>{
      const [lo,hi]=domains[axis],other=1-axis;
      const probes=[...new Set(knots[other])].filter(k=>k>=domains[other][0]&&k<=domains[other][1]);
      const curves=probes.map(k=>surfaceIsoCurve(patch,other,k));
      return [...new Set(values)].filter(k=>k>lo&&k<hi&&curves.some(curve=>distance(evaluateCurve(curve,k,true).derivative,evaluateCurve(curve,k).derivative)*(hi-lo)>ROUNDING_MM));
    });
    breakCache.set(patch,cuts);
  }
  return breakCache.get(patch);
}
function knotSpanTriangles(patch,triangles,records,vertices){
  const cuts=patchBreaks(patch);
  if(!cuts.some(axis=>axis.length))return triangles;
  const points=new Map(),key=uv=>uv.map(v=>Math.round(v/ROUNDING_RELATIVE)).join(',');
  for(const record of records){for(const [axis,knots] of cuts.entries())for(const knot of knots)if(Math.abs(record.uv[axis]-knot)<=ROUNDING_RELATIVE)record.uv[axis]=knot;points.set(key(record.uv),record);}
  let nextChartId=records.length;
  const at=uv=>{const k=key(uv);if(!points.has(k)){const existing=[...points.values()].find(p=>distance(p.uv,uv)<=ROUNDING_RELATIVE);if(existing)return existing;const position=evaluate(patch,...uv,false).point;
      const collapsed=[...points.values()].find(p=>distance(vertices[p.id],position)<=ROUNDING_MM&&collapsedChartEdge(patch,p,{uv},position,ROUNDING_MM));
      const id=collapsed?.id??vertices.length;if(!collapsed)vertices.push(position);points.set(k,{uv,id,chartId:nextChartId++});}return points.get(k);};
  function half(polygon,axis,knot,side){
    const output=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=(a.uv[axis]-knot)*side,db=(b.uv[axis]-knot)*side;
      if(da>=0)output.push(a);
      if(da>0&&db<0||da<0&&db>0){
        const uv=interpolate(a.uv,b.uv,da/(da-db));uv[axis]=knot;output.push(at(uv));
      }
    }
    return output.filter((p,i)=>i===0||p.chartId!==output[i-1].chartId);
  }
  const output=[];
  for(const triangle of triangles){
    let polygons=[triangle];
    for(const [axis,knots] of cuts.entries())for(const knot of knots)polygons=polygons.flatMap(polygon=>{
      if(!polygon.some(p=>p.uv[axis]<knot)||!polygon.some(p=>p.uv[axis]>knot))return [polygon];
      return [half(polygon,axis,knot,1),half(polygon,axis,knot,-1)].filter(p=>p.length>=3);
    });
    for(const polygon of polygons)for(let i=1;i<polygon.length-1;i++){
      const [a,b,c]=[polygon[0],polygon[i],polygon[i+1]];
      if(new Set([a.chartId,b.chartId,c.chartId]).size===3&&Math.abs((b.uv[0]-a.uv[0])*(c.uv[1]-a.uv[1])-(b.uv[1]-a.uv[1])*(c.uv[0]-a.uv[0]))>ROUNDING_RELATIVE**2)output.push([a,b,c]);
    }
  }
  return output;
}

function chartEdgeKey(face,a,b){return `${face}|${edgeKey(a.chartId,b.chartId)}`;}
function edgeReference(face,a,b,boundaries){
  const chart=chartEdgeKey(face,a,b),boundary=boundaries.get(chart);
  return {chart,key:boundary?.key??chart,boundary};
}
function rememberBoundary(boundaries,face,curve,a,b){
  boundaries.set(chartEdgeKey(face,a,b),{key:'boundary|'+edgeKey(a.id,b.id),curve,ends:[a,b]});
}
// Polygon triangulation may omit collinear chart vertices. Reinsert every
// authored boundary sample before refinement, preserving the shared coedges.
function constrainFaceBoundary(raw,records,loops){
  const locations=[],offset={next:0};
  for(const loop of loops){
    const indices=loop.map(()=>offset.next++);
    for(const [position,index] of indices.entries())locations[index]={indices,position};
  }
  const pathOnEdge=(ai,bi,ci)=>{
    const a=records[ai].uv,b=records[bi].uv,first=locations[ai],last=locations[bi];
    if(first.indices!==last.indices)return null;
    const delta=b.map((v,k)=>v-a[k]),length2=delta[0]**2+delta[1]**2;
    if(length2<=ROUNDING_RELATIVE**2)return null;
    for(const direction of [1,-1]){
      const path=[ai],n=first.indices.length;
      for(let i=(first.position+direction+n)%n;i!==last.position;i=(i+direction+n)%n)path.push(first.indices[i]);
      path.push(bi);
      if(path.length<=2||path.includes(ci))continue;
      const holds=path.slice(1,-1).every(index=>{
        const uv=records[index].uv,t=dot(uv.map((v,k)=>v-a[k]),delta)/length2;
        return t>0&&t<1&&Math.hypot(...uv.map((v,k)=>v-a[k]-t*delta[k]))<=ROUNDING_RELATIVE;
      });
      if(holds)return path;
    }
    return null;
  };
  const pending=[...raw],result=[];
  while(pending.length){
    const triangle=pending.pop(),state={split:false};
    for(let edge=0;edge<3&&!state.split;edge++){
      const ai=triangle[edge],bi=triangle[(edge+1)%3],ci=triangle[(edge+2)%3],path=pathOnEdge(ai,bi,ci);
      if(!path)continue;
      for(let i=1;i<path.length;i++)pending.push([path[i-1],path[i],ci]);
      state.split=true;
    }
    if(!state.split)result.push(triangle);
  }
  return result;
}
function interpolate(a,b,t){return a.map((v,k)=>v+t*(b[k]-v));}
function edgeKey(a,b){return a<b?`${a}:${b}`:`${b}:${a}`;}

function refineSurfaceTriangles(solid,vertices,input,boundaries,toleranceMm){
  const state={triangles:input,nextChartId:1+input.reduce((maximum,triangle)=>Math.max(maximum,...triangle.corners.map(corner=>corner.chartId)),0)};
  for(;;){
    const split=new Map(),errors=state.triangles.map(triangle=>triangleError(solid.patches[triangle.face],triangle,vertices));
    const error=errors.reduce((maximum,value)=>Math.max(maximum,value),0);
    if(error<=toleranceMm)return {triangles:state.triangles,error,notes:[]};
    const marked=refinementEdges(state.triangles,vertices,boundaries,errors,toleranceMm);
    for(let i=0;i<state.triangles.length;i++){
      const triangle=state.triangles[i];
      for(let edge=0;edge<3;edge++){
        const a=triangle.corners[edge],b=triangle.corners[(edge+1)%3],reference=edgeReference(triangle.face,a,b,boundaries);
        if(!marked.has(reference.key)||split.has(reference.key))continue;
        const boundary=reference.boundary,uv=boundary?boundaryUvAt(boundary,(boundary.ends[0].t+boundary.ends[1].t)/2):interpolate(a.uv,b.uv,.5);
        // Sewing may collapse a tiny coedge to one vertex. Subdivision retains
        // that identity instead of reopening it at a fresh evaluated point.
        if(a.id===b.id&&collapsedChartEdge(solid.patches[triangle.face],a,b,vertices[a.id],Math.max(toleranceMm,solid.construction.toleranceMm))){split.set(reference.key,a.id);continue;}
        const position=boundary?curvePosition(solid.topology.curves[boundary.curve],(boundary.ends[0].t+boundary.ends[1].t)/2):planarPatch(solid.patches[triangle.face])?interpolate(vertices[a.id],vertices[b.id],.5):evaluate(solid.patches[triangle.face],...uv,false).point;
        requireThat(uv.some((value,k)=>value!==a.uv[k])&&uv.some((value,k)=>value!==b.uv[k]),'Surface tessellation cannot refine further at floating-point precision.');
        const id=vertices.length;vertices.push(position);split.set(reference.key,id);
      }
    }
    const output=[],chartMids=new Map();
    for(const triangle of state.triangles){
      const corners=triangle.corners,mids=corners.map((a,i)=>{
        const b=corners[(i+1)%3],reference=edgeReference(triangle.face,a,b,boundaries),id=split.get(reference.key);
        if(id===undefined)return null;
        if(chartMids.has(reference.chart))return chartMids.get(reference.chart);
        const mid={id,uv:reference.boundary?boundaryUvAt(reference.boundary,(reference.boundary.ends[0].t+reference.boundary.ends[1].t)/2):interpolate(a.uv,b.uv,.5),chartId:state.nextChartId++};
        chartMids.set(reference.chart,mid);
        if(reference.boundary){
          const boundary=reference.boundary,[first,last]=boundary.ends;
          const shared={...mid,t:(first.t+last.t)/2,uvMap:first.uvMap};
          rememberBoundary(boundaries,triangle.face,boundary.curve,first,shared);
          rememberBoundary(boundaries,triangle.face,boundary.curve,shared,last);
        }
        return mid;
      });
      const count=mids.filter(Boolean).length;
      if(count===0){output.push(triangle);continue;}
      if(count===3){
        appendTriangle(output,triangle.face,[corners[0],mids[0],mids[2]]);
        appendTriangle(output,triangle.face,[mids[0],corners[1],mids[1]]);
        appendTriangle(output,triangle.face,[mids[2],mids[1],corners[2]]);
        appendTriangle(output,triangle.face,[mids[0],mids[1],mids[2]]);continue;
      }
      if(count===1){
        const i=mids.findIndex(Boolean),a=corners[i],b=corners[(i+1)%3],c=corners[(i+2)%3],m=mids[i];
        appendTriangle(output,triangle.face,[a,m,c]);appendTriangle(output,triangle.face,[m,b,c]);continue;
      }
      const i=mids.findIndex((value,k)=>value&&mids[(k+1)%3]),a=corners[i],b=corners[(i+1)%3],c=corners[(i+2)%3],m=mids[i],n=mids[(i+1)%3];
      appendTriangle(output,triangle.face,[b,n,m]);appendTriangle(output,triangle.face,[a,m,c]);appendTriangle(output,triangle.face,[m,n,c]);
    }
    state.triangles=output;
  }
}

// Propagate longest-edge refinement across neighbors. A conforming split of
// only a sliver's short edge can keep producing skinny triangles whose surface
// error worsens; the closure gives every affected triangle a coarse-edge split.
function refinementEdges(triangles,vertices,boundaries,errors,toleranceMm){
  const touching=new Map(),marked=new Set(),pending=[];
  const edges=triangles.map((triangle,index)=>triangle.corners.map((a,i)=>{
    const b=triangle.corners[(i+1)%3],key=edgeReference(triangle.face,a,b,boundaries).key;
    if(!touching.has(key))touching.set(key,[]);touching.get(key).push(index);
    return {key,length:distance(vertices[a.id],vertices[b.id])};
  }));
  const longest=edges.map(row=>row.reduce((a,b)=>a.length>b.length?a:b).key);
  function mark(key){if(!marked.has(key)){marked.add(key);pending.push(key);}}
  for(let i=0;i<triangles.length;i++)if(errors[i]>toleranceMm)for(const edge of edges[i])mark(edge.key);
  for(let i=0;i<pending.length;i++)for(const triangle of touching.get(pending[i]))mark(longest[triangle]);
  return marked;
}

// A sewn vertex can represent a collapsed native chart edge. Prove the
// actual rational edge image stays within construction/output accuracy;
// a periodic arc with coincident endpoints still receives real subdivision.
function collapsedChartEdge(patch,a,b,point,toleranceMm){
  const domains=[patch.domainU,patch.domainV],clamp=uv=>uv.map((v,k)=>Math.max(domains[k][0],Math.min(domains[k][1],v)));
  return surfaceSegmentCurves(patch,clamp(a.uv),clamp(b.uv)).every(curve=>Array.from({length:curve.n},(_,i)=>i*4).every(i=>
    distance([0,1,2].map(k=>curve.cp[i+k]/curve.cp[i+3]),point)<=toleranceMm));
}

function appendTriangle(output,face,corners){
  output.push({face,corners});
}

function triangleError(patch,triangle,vertices){
  if(planarPatch(patch))return 0;
  const corners=triangle.corners;
  return Math.max(...[[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]].map(weights=>{
    const uv=[0,1].map(k=>corners.reduce((sum,corner,i)=>sum+corner.uv[k]*weights[i],0));
    const chord=[0,1,2].map(k=>corners.reduce((sum,corner,i)=>sum+vertices[corner.id][k]*weights[i],0));
    return distance(evaluate(patch,...uv,false).point,chord);
  }));
}

const planeCache=new WeakMap();
function planarPatch(patch){
  if(planeCache.has(patch))return planeCache.get(patch);
  const e=evaluate(patch,(patch.domainU[0]+patch.domainU[1])/2,(patch.domainV[0]+patch.domainV[1])/2);
  const planar=!!e.normal&&Array.from({length:patch.cp.length/4},(_,i)=>i*4).every(i=>
    Math.abs(dot(e.normal,[0,1,2].map(k=>patch.cp[i+k]/patch.cp[i+3]-e.point[k])))<=ROUNDING_MM);
  planeCache.set(patch,planar);return planar;
}
