import {evaluateSurface,surfaceChartCovers} from '../geom/surface-evaluation.mjs';
import {sectionPatch} from '../geom/section.mjs';
import {surfacePlane,curveCorrespondence} from '../geom/surface-coincidence.mjs';
import {surfaceIsoCurve} from '../geom/surface-curves.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
import {clipLineToRegion} from '../geom/curve-region.mjs';
import {surfaceChartBounds,surfaceChartStep} from './surface-operations.mjs';
import {sectionHeightSlice,sampledChartRegion} from '../geom/height-slice.mjs';
import {chartPrismContains} from '../geom/chart-prism.mjs';
import {sectionShell} from '../geom/shell.mjs';
import {meshSectionIndex,sectionMeshIndex,meshFaceNormal,meshBoundaryDistance} from '../geom/mesh.mjs';
import {touchesSliceEdge,planeSlice} from '../geom/slice.mjs';
import {affineSurface} from '../geom/affine-surface.mjs';
// The part of a surface that lies inside a solid, as closed loops in the
// surface's own (u,v): the region a curved slice owns, or the part of a patch a
// boolean keeps. Its boundary is where the surface meets the solid's patches
// (surface-surface intersection). The curves are chained in (u,v), oriented
// so the solid's inside is on their left using each partner patch's outward
// normal, and closed along the surface's domain boundary, walked
// counterclockwise from each curve's end to the next curve's start.
import { evaluate } from '../geom/nurbs.mjs';
import {bezierPieces,intersectPatches,edgeSurfacePoint,projectToSurface,projectSurfacePoint,refineIntersectionCurve } from '../geom/surface-intersection.mjs';
import {pointSegmentDistance} from './region2d.mjs';
import { containsPoint } from '../geom/query.mjs';
import { union, intersect, difference } from './intersection.mjs';
import {offsetRegion} from './offset.mjs';
import { requireThat, dot, cross,normalize,TOLERANCE } from '../geom/tolerance.mjs';
import { PRINT_RESOLUTION_MM, PROGRAM_STEP_MM, ROUNDING_MM, ROUNDING_RELATIVE } from '../dimensions.mjs';
import {segmentTrimSpans,faceContainsUv,faceTrimRegion,planarFaceRegion} from '../geom/surface-trim.mjs';

const OFF_SURFACE_MM = PRINT_RESOLUTION_MM; // material within print resolution of a sheet is that sheet's side

class SurfaceBoundaryTopologyError extends Error {
  constructor(message){super(message);this.name='SurfaceBoundaryTopologyError';this.code='INTERIOR_BOUNDARY_ENDPOINT';}
}

// +1 where a patch's normal (du x dv) points out of its solid, -1 where it
// points in: a point just along the normal is tested for containment.
export function outwardSigns(shell) {
  const signs = new Map();
  for (const patch of shell.patches) {
    if(patch.normalSide){signs.set(patch,patch.normalSide);continue;}
    let sign = null;
    for (const [fu, fv] of [[0.5123, 0.4871], [0.3137, 0.6911], [0.7219, 0.2683]]) {
      const e = evaluate(patch, patch.domainU[0] + fu * (patch.domainU[1] - patch.domainU[0]), patch.domainV[0] + fv * (patch.domainV[1] - patch.domainV[0]));
      if (!e.normal) continue;
      sign = containsPoint(shell, e.point.map((v, k) => v + OFF_SURFACE_MM * e.normal[k])) ? -1 : 1;break;
    }
    requireThat(sign !== null, `Patch ${patch.name} has no normal at its sample points.`);
    signs.set(patch, sign);
  }
  return signs;
}

// Curve pieces joined end to end in P's (u,v); every vertex keeps the partner
// patch and its parameters there, for exact refinement later.
function chainPieces(pieces,P,toleranceMm=PRINT_RESOLUTION_MM){
  const frames=new WeakMap();
  const frame=vertex=>{if(!frames.has(vertex))frames.set(vertex,evaluate(P,...vertex.uv));return frames.get(vertex);};
  const close=(a,b)=>{
    const delta=b.uv.map((v,k)=>v-a.uv[k]);
    // UV units do not have one physical scale, especially on a polar cap.
    // The local metric joins root residuals without identifying periodic twins.
    const ends=[frame(a),frame(b)];
    // At a collapsed pole, world coincidence does not identify UV vertices.
    if(ends.some(e=>!e.normal))return Math.hypot(...delta.map((v,k)=>v/([P.domainU,P.domainV][k][1]-[P.domainU,P.domainV][k][0])))<=TOLERANCE.domainFraction;
    return ends.every(e=>Math.hypot(...e.du.map((v,k)=>v*delta[0]+e.dv[k]*delta[1]))<=toleranceMm);
  };
  const pool = pieces.filter(p => !p.closed), chains = pieces.filter(p => p.closed).map(p => ({ vertices: p.vertices, closed: true }));
  while (pool.length) {
    let vertices = pool.pop().vertices;
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const v = pool[i].vertices;
        if (close(vertices.at(-1), v[0])) vertices = [...vertices, ...v.slice(1)];
        else if (close(vertices.at(-1), v.at(-1))) vertices = [...vertices, ...[...v].reverse().slice(1)];
        else if (close(vertices[0], v.at(-1))) vertices = [...v, ...vertices.slice(1)];
        else if (close(vertices[0], v[0])) vertices = [...[...v].reverse(), ...vertices.slice(1)];
        else continue;
        pool.splice(i, 1);grown = true;break;
      }
    }
    const closed = vertices.length > 3 && close(vertices[0], vertices.at(-1));
    chains.push({ vertices: closed ? vertices.slice(0, -1) : vertices, closed });
  }
  return chains;
}

// Orient a chain so the solid's inside lies on its left in (u,v).
function orient(chain,P,shell){
  const vertices=chain.vertices,candidates=[];
  for(let i=1;i<vertices.length;i++){
    const a=vertices[i-1],b=vertices[i],delta=b.uv.map((value,k)=>value-a.uv[k]),left=[-delta[1],delta[0]],mid=a.uv.map((value,k)=>(value+b.uv[k])/2),frame=evaluate(P,...mid);
    const across=frame.du.map((value,k)=>value*left[0]+frame.dv[k]*left[1]),normal=evaluate(b.partner,...b.partnerUv).normal;
    const signed=normal?dot(across,normal)*b.sign:0;
    candidates.push({left,mid,across,signed});
  }
  // Seam splits can leave microscopic numerical segments. The strongest
  // transverse segment determines the chain's orientation; a near-zero segment
  // must not turn a whole material region into its complement.
  const best=candidates.reduce((prior,item)=>!prior||Math.abs(item.signed)>Math.abs(prior.signed)?item:prior,null);
  requireThat(best,'A surface boundary needs a nonempty curve segment.');
  const insideLeft=Math.abs(best.signed)>ROUNDING_RELATIVE?best.signed<0:(()=>{
    const scale=OFF_SURFACE_MM/Math.max(ROUNDING_MM,Math.hypot(...best.across));
    return containsPoint(shell,evaluate(P,...best.mid.map((value,k)=>value+best.left[k]*scale),false).point);
  })();
  return insideLeft?chain:{...chain,vertices:[...vertices].reverse()};
}

// All face domains use their oriented boundary loops. A rectangular chart is
// the ordinary four-point case; holes and disconnected trim loops need no
// separate region-construction route.
function faceBoundaryLocation(P,vertex,boundaries,toleranceMm){
  const point=P.trimLoops?vertex:chartBoundaryEndpoint(P,vertex,toleranceMm);
  if(!point)return null;
  const candidates=[];
  for(const [loop,points] of boundaries.entries())for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],delta=b.map((v,k)=>v-a[k]);
    const frame=evaluate(P,...a),along=frame.du.map((v,k)=>v*delta[0]+frame.dv[k]*delta[1]),offset=frame.du.map((v,k)=>v*(point.uv[0]-a[0])+frame.dv[k]*(point.uv[1]-a[1]));
    const length2=dot(along,along),fraction=length2?Math.max(0,Math.min(1,dot(offset,along)/length2)):0;
    const uv=a.map((v,k)=>v+fraction*delta[k]),world=evaluate(P,...uv,false).point;
    const gap=Math.hypot(...world.map((v,k)=>v-point.point[k])),chartGap=Math.hypot(...uv.map((v,k)=>(v-point.uv[k])/([P.domainU,P.domainV][k][1]-[P.domainU,P.domainV][k][0])));
    if(gap<=toleranceMm)candidates.push({vertex:point,loop,s:i+fraction,gap,chartGap});
  }
  candidates.sort((a,b)=>a.gap-b.gap||a.chartGap-b.chartGap);return candidates[0]??null;
}

function chartBoundaryEndpoint(P,vertex,toleranceMm){
  const domains=[P.domainU,P.domainV],candidates=[];
  for(const [axis,domain] of domains.entries())for(const value of domain)candidates.push({axis,value,gap:Math.abs(vertex.uv[axis]-value)/(domain[1]-domain[0])});
  const boundary=candidates.reduce((best,candidate)=>candidate.gap<best.gap?candidate:best),uv=[...vertex.uv];uv[boundary.axis]=boundary.value;
  const before=evaluate(P,...vertex.uv,false).point,point=evaluate(P,...uv,false).point;
  if(Math.hypot(...point.map((v,k)=>v-before[k]))>toleranceMm)return null;
  if(vertex.uv[boundary.axis]===boundary.value)return vertex;
  // A near-boundary sample is not the curve's endpoint. Correct both charts
  // against the actual domain edge; radial snapping amplifies tangential error
  // at a shallow crossing and creates inconsistent coplanar cap trims.
  if(vertex.partner){
    const edge=boundary.axis===0?(boundary.value===P.domainU[0]?3:1):(boundary.value===P.domainV[0]?0:2);
    const corrected=edgeSurfacePoint(P,edge,vertex.partner,[vertex.uv[1-boundary.axis],...vertex.partnerUv]);
    if(corrected){
      uv[1-boundary.axis]=corrected.t;
      return {...vertex,uv,point:corrected.point,partnerUv:corrected.s};
    }
  }
  return Math.hypot(...point.map((v,k)=>v-before[k]))<=ROUNDING_MM?{...vertex,uv,point}:null;
}

function closeOnBoundary(P,chains,domainInside,boundaries,toleranceMm){
  const loops=chains.filter(c=>c.closed).map(c=>c.vertices.map(x=>x.uv));
  const open=chains.filter(c=>!c.closed).map(chain=>{
    const first=faceBoundaryLocation(P,chain.vertices[0],boundaries,toleranceMm),last=faceBoundaryLocation(P,chain.vertices.at(-1),boundaries,toleranceMm);
    if(!first||!last)throw new SurfaceBoundaryTopologyError(
      `A surface intersection curve on ${P.name} ends inside the surface near ${JSON.stringify(chain.vertices.at(-1).point?.map(v=>+v.toFixed(4)))}; the surfaces may touch tangentially there.`);
    return {...chain,first,last,vertices:[first.vertex,...chain.vertices.slice(1,-1),last.vertex]};
  });
  const starts = open.map(chain => ({chain,...chain.first})), used = new Set();
  for (const first of starts) {
    if (used.has(first.chain)) continue;
    const loop = [];let current = first;
    while (!used.has(current.chain)) {
      used.add(current.chain);loop.push(...current.chain.vertices.map(x => x.uv));
      const end=current.chain.last,points=boundaries[end.loop],n=points.length;
      const next = starts.filter(candidate=>candidate.loop===end.loop).reduce((best, candidate) => {
        const gap = ((candidate.s - end.s) % n + n) % n;
        return !best || gap < best.gap ? { ...candidate, gap } : best;
      }, null);
      requireThat(next,'A face boundary has an unmatched incoming intersection.');
      for (let k = Math.floor(end.s) + 1; k < end.s + next.gap; k++) if (k - end.s > ROUNDING_RELATIVE) loop.push(points[k%n]);
      current = next;
    }
    loops.push(loop);
  }
  for(const [index,points] of boundaries.entries())if(!open.some(chain=>chain.first.loop===index||chain.last.loop===index)){
    const a=points[0],b=points[1],mid=a.map((v,k)=>(v+b[k])/2),left=[a[1]-b[1],b[0]-a[0]],frame=evaluate(P,...mid);
    const across=frame.du.map((v,k)=>v*left[0]+frame.dv[k]*left[1]),step=Math.min(OFF_SURFACE_MM/Math.max(ROUNDING_MM,Math.hypot(...across)),.25);
    if(domainInside(mid.map((v,k)=>v+step*left[k])))loops.push(points);
  }
  return loops;
}

// A mesh triangle as a flat bilinear patch whose u = 1 edge collapses to its
// third vertex, with the sign that makes its normal the mesh's outward one.
function trianglePatch(mesh, i) {
  const [a, b, c] = mesh.triangles[i].map(k => mesh.vertices[k]);
  const patch = { name: `triangle:${i}`, nu: 2, nv: 2, orderU: 2, orderV: 2, knotsU: [0, 0, 1, 1], knotsV: [0, 0, 1, 1],
    cp: Float64Array.from([...a, 1, ...b, 1, ...c, 1, ...c, 1]), domainU: [0, 1], domainV: [0, 1] };
  const e = evaluate(patch, 0, 0.5);
  return { patch, sign: dot(e.normal, meshFaceNormal(mesh, i)) > 0 ? 1 : -1 };
}

// The solid's boundary as patches with outward signs: a spline shell's own
// patches, or a triangle mesh's faces near the surface.
function boundaryPatches(solid, P) {
  if (solid.kind !== 'triangle-mesh') { const signs = outwardSigns(solid); return solid.patches.map(patch => ({ patch, sign: signs.get(patch) })); }
  const hull = bezierHull(P);
  return solid.triangles.map((t, i) => i).filter(i => {
    const corners = solid.triangles[i].map(k => solid.vertices[k]);
    return [0, 1, 2].every(a => Math.min(...corners.map(p => p[a])) <= hull.max[a] && Math.max(...corners.map(p => p[a])) >= hull.min[a]);
  }).map(i => trianglePatch(solid, i));
}

// One face pair is intersected once. Both parameterizations refer to those
// same computed points; Boolean construction owns the shared edge identity.
export function surfaceBoundaryPair(A,B,signA,signB,options){
  const pair=unrefinedBoundaryPair(A,B,signA,signB,options);
  const refine=(P,Q,sign,pieces)=>pieces.map(piece=>{
    const curve=refineIntersectionCurve(P,Q,{points:piece.vertices.map(vertex=>vertex.point),
      uvA:piece.vertices.map(vertex=>vertex.uv),uvB:piece.vertices.map(vertex=>vertex.partnerUv)},options.chordMm);
    return {...piece,vertices:curve.points.map((point,i)=>({point,uv:curve.uvA[i],partnerUv:curve.uvB[i],partner:Q,sign}))};
  });
  const refined={...pair,a:refine(A,B,signB,pair.a),b:refine(B,A,signA,pair.b)};
  const clipped=result=>({...result,a:clipBoundaryPieces(A,result.a),b:clipBoundaryPieces(B,result.b),points:(result.points??[]).filter(point=>faceContainsUv(A,...point.uvA)&&faceContainsUv(B,...point.uvB))});
  const prepared=clipped(refined);
  if(!options.complete||pair.discovery||!refined.a.length)return prepared;
  const planeA=surfacePlane(A),planeB=surfacePlane(B);
  if(!!planeA===!!planeB)return prepared;
  if(planeA&&surfaceSupportedByPlane(B,planarBoundary(A,options))||planeB&&surfaceSupportedByPlane(A,planarBoundary(B,options)))return prepared;
  if(monotonePlaneTrace(planeA?B:A,planeA??planeB,planeA?refined.b:refined.a))return prepared;
  // A fast planar section supplies seeds, rather than declaring that finding
  // one component proves no smaller interior component exists.
  const initialCurves=refined.a.map(piece=>({closed:piece.closed,ends:piece.ends??['edge','edge'],points:piece.vertices.map(vertex=>vertex.point),uvA:piece.vertices.map(vertex=>vertex.uv),uvB:piece.vertices.map(vertex=>vertex.partnerUv)}));
  const audited=generalBoundaryPair(A,B,signA,signB,{...options,initialCurves});
  return clipped({...audited,a:refine(A,B,signB,audited.a),b:refine(B,A,signA,audited.b)});
}

// A strict coefficient sign for one derivative, together with opposite signs
// on its two domain ends, proves one plane root for every value of the other
// parameter. A trace covering that whole parameter interval is then complete.
function monotonePlaneTrace(patch,plane,pieces){
  const offset=dot(plane.normal,plane.point);
  const cells=bezierPieces(patch).map(piece=>({...piece,values:piece.net.map(row=>row.map(point=>dot(plane.normal,point.slice(0,3))-offset*point[3]))}));
  const guard=ROUNDING_MM*Math.max(...cells.flatMap(cell=>cell.net.flat().map(point=>point[3])));
  const domains=[patch.domainU,patch.domainV];
  for(let axis=0;axis<2;axis++)for(const sign of [1,-1]){
    const increasing=cells.every(cell=>axis===0?cell.values.slice(1).every((row,i)=>row.every((value,j)=>sign*(value-cell.values[i][j])>guard)):
      cell.values.every(row=>row.slice(1).every((value,j)=>sign*(value-row[j])>guard)));
    if(!increasing)continue;
    const lower=cells.filter(cell=>(axis?cell.v:cell.u)[0]===domains[axis][0]),upper=cells.filter(cell=>(axis?cell.v:cell.u)[1]===domains[axis][1]);
    if(!lower.every(cell=>(axis?cell.values.map(row=>row[0]):cell.values[0]).every(value=>sign*value<-guard))||
      !upper.every(cell=>(axis?cell.values.map(row=>row.at(-1)):cell.values.at(-1)).every(value=>sign*value>guard)))continue;
    const free=1-axis,spans=pieces.flatMap(piece=>piece.vertices.slice(1).map((vertex,i)=>[piece.vertices[i].uv[free],vertex.uv[free]].sort((a,b)=>a-b))).sort((a,b)=>a[0]-b[0]);
    const coverage={end:domains[free][0]};
    for(const [low,high] of spans){if(low>coverage.end+ROUNDING_RELATIVE)break;coverage.end=Math.max(coverage.end,high);}
    if(coverage.end>=domains[free][1]-ROUNDING_RELATIVE)return true;
  }
  return false;
}

function unrefinedBoundaryPair(A,B,signA,signB,options){
  const planarB=planarBoundary(B,options),planarA=planarBoundary(A,options);
  if(planarA&&planarB)return boundedPlanarPair(A,B,signA,signB,planarA,planarB);
  if(planarB){
    const pieces=planarSurfacePieces(A,{patch:B,sign:signB},planarB,options);
    if(!pieces.length&&planarA){
      const reverse=planarSurfacePieces(B,{patch:A,sign:signA},planarA,options);
      if(reverse.length)return {a:reverseBoundaryPieces(B,signB,reverse),b:reverse};
    }
    if(pieces.length)return {a:pieces,b:reverseBoundaryPieces(A,signA,pieces)};
    if(surfaceSupportedByPlane(A,planarB))return {a:[],b:[],points:[]};
    return generalBoundaryPair(A,B,signA,signB,options);
  }
  if(planarA){
    const pieces=planarSurfacePieces(B,{patch:A,sign:signA},planarA,options);
    if(pieces.length)return {a:reverseBoundaryPieces(B,signB,pieces),b:pieces};
    if(surfaceSupportedByPlane(B,planarA))return {a:[],b:[],points:[]};
    return generalBoundaryPair(A,B,signA,signB,options);
  }
  return generalBoundaryPair(A,B,signA,signB,options);
}

// A positive-weight control hull on one side of a plane has no transverse
// intersection. Its zero-distance edge contacts were clipped above; restarting
// a four-parameter marcher cannot discover a hidden crossing in that hull.
function surfaceSupportedByPlane(patch,boundary){
  const anchor=boundary.corners[0],values=[];
  for(let i=0;i<patch.cp.length;i+=4)values.push(dot(boundary.normal,[0,1,2].map(k=>patch.cp[i+k]/patch.cp[i+3]-anchor[k])));
  return values.every(value=>value>=-ROUNDING_MM)||values.every(value=>value<=ROUNDING_MM);
}

// Bounded planes intersect in a line interval or an isolated point. Solving
// those events directly also handles intersection lines lying on both edges,
// where a surface marcher has no transverse step into either face.
function boundedPlanarPair(A,B,signA,signB,boundaryA,boundaryB){
  const na=boundaryA.normal,nb=boundaryB.normal,direction=cross(na,nb),length=Math.hypot(...direction);
  if(length<=ROUNDING_RELATIVE)return {a:[],b:[],points:[]};
  const anchor=boundaryA.corners[0],offset=dot(nb,boundaryB.corners[0].map((v,k)=>v-anchor[k]));
  const correction=cross(direction,na),origin=anchor.map((v,k)=>v+offset*correction[k]/length**2),unit=direction.map(v=>v/length);
  const intervals=boundary=>{
    const anchor=boundary.corners[0],x=normalize(boundary.corners[1].map((v,k)=>v-anchor[k])),y=cross(boundary.normal,x);
    const project=p=>[dot(p.map((v,k)=>v-anchor[k]),x),dot(p.map((v,k)=>v-anchor[k]),y)];
    const cut=clipLineToRegion(project(origin),[dot(unit,x),dot(unit,y)],[boundary.corners.map(project)]),merged=[];
    for(const span of [...cut.spans,...cut.contacts].sort((a,b)=>a[0]-b[0])){
      const last=merged.at(-1);
      if(last&&span[0]<=last[1]+ROUNDING_MM)last[1]=Math.max(last[1],span[1]);else merged.push([...span]);
    }
    return merged;
  };
  const pieces=[],points=[];
  const vertex=t=>{
    const point=origin.map((v,k)=>v+t*unit[k]),uvA=snapBoundaryUv(A,projectSurfacePoint(A,point,{toleranceMm:PROGRAM_STEP_MM}).uv),uvB=snapBoundaryUv(B,projectSurfacePoint(B,point,{toleranceMm:PROGRAM_STEP_MM}).uv);
    return {point,uvA,uvB};
  };
  for(const [a0,a1] of intervals(boundaryA))for(const [b0,b1] of intervals(boundaryB)){
    const low=Math.max(a0,b0),high=Math.min(a1,b1);
    if(high<low-ROUNDING_MM)continue;
    if(high-low<=ROUNDING_MM){
      const point=vertex((low+high)/2);
      if(faceContainsUv(A,...point.uvA)&&faceContainsUv(B,...point.uvB))points.push(point);
      continue;
    }
    const vertices=[vertex(low),vertex(high)].map(v=>({uv:v.uvA,point:v.point,partner:B,partnerUv:v.uvB,sign:signB}));
    pieces.push({closed:false,ends:['boundary','boundary'],vertices});
  }
  const onA=splitPartnerSeams(A,{patch:B,sign:signB},pieces),onB=splitPartnerSeams(B,{patch:A,sign:signA},reverseBoundaryPieces(A,signA,onA));
  return {a:reverseBoundaryPieces(B,signB,onB),b:onB,points:points.filter(point=>faceContainsUv(A,...point.uvA)&&faceContainsUv(B,...point.uvB))};
}

function generalBoundaryPair(A,B,signA,signB,options){
  const {curves,points,discovery}=intersectPatches(A,B,options);
  const pieces=curves.map(c=>({closed:c.closed,ends:c.ends,vertices:c.points.map((point,i)=>({uv:c.uvA[i],point,partner:B,partnerUv:c.uvB[i],sign:signB}))}));
  return {a:pieces,b:reverseBoundaryPieces(A,signA,pieces),points,discovery};
}

function snapBoundaryUv(patch,source){
  const uv=[...source],point=evaluate(patch,...source,false).point;
  for(const [axis,domain] of [patch.domainU,patch.domainV].entries())for(const value of domain){
    if(Math.abs(uv[axis]-value)>TOLERANCE.domainFraction*(domain[1]-domain[0]))continue;
    const candidate=uv.map((coordinate,k)=>k===axis?value:coordinate);
    if(Math.hypot(...evaluate(patch,...candidate,false).point.map((coordinate,k)=>coordinate-point[k]))<=ROUNDING_MM)uv[axis]=value;
  }
  return uv;
}
function reverseBoundaryPieces(partner,sign,pieces){
  return pieces.map(piece=>({...piece,vertices:piece.vertices.map(vertex=>({uv:vertex.partnerUv,point:vertex.point,partner,partnerUv:vertex.uv,sign}))}));
}

function clipBoundaryPieces(P,pieces){
  const result=[];
  for(const raw of pieces){
    const piece={...raw,vertices:raw.vertices.map(vertex=>{
      const uv=snapBoundaryUv(P,vertex.uv),partnerUv=snapBoundaryUv(vertex.partner,vertex.partnerUv);
      return {...vertex,uv,partnerUv,point:evaluate(P,...uv,false).point};
    })};
    if(!P.trimLoops&&!piece.vertices[0]?.partner.trimLoops){result.push(piece);continue;}
    const state={current:null};
    const points=piece.closed?[...piece.vertices,piece.vertices[0]]:piece.vertices;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      const left=segmentTrimSpans(a.uv,b.uv,P.trimLoops),right=segmentTrimSpans(a.partnerUv,b.partnerUv,a.partner.trimLoops);
      for(const x of left)for(const y of right){
        const lo=Math.max(x[0],y[0]),hi=Math.min(x[1],y[1]);if(hi<=lo)continue;
        const first=boundaryVertex(P,a,b,lo),last=boundaryVertex(P,a,b,hi);
        if(state.current&&Math.hypot(...state.current.at(-1).uv.map((v,k)=>v-first.uv[k]))<=TOLERANCE.domainFraction)state.current.push(last);
        else{state.current=[first,last];result.push({closed:false,vertices:state.current});}
      }
    }
  }
  return result;
}

// A run along the chart edge bounds no interior change. Domain closure supplies
// that edge; including it as an interior crossing can invert a coplanar region.
function interiorBoundaryPieces(P,pieces){
  const result=[];
  const onSameEdge=(a,b)=>[P.domainU,P.domainV].some((domain,k)=>domain.some(value=>
    Math.abs(a.uv[k]-value)<=TOLERANCE.domainFraction*(domain[1]-domain[0])&&Math.abs(b.uv[k]-value)<=TOLERANCE.domainFraction*(domain[1]-domain[0])));
  for(const piece of pieces){
    const vertices=piece.closed?[...piece.vertices,piece.vertices[0]]:piece.vertices;
    if(!vertices.some((point,i)=>i&&onSameEdge(vertices[i-1],point))){result.push(piece);continue;}
    const state={current:null};
    for(let i=1;i<vertices.length;i++){
      const a=vertices[i-1],b=vertices[i];
      if(onSameEdge(a,b)){state.current=null;continue;}
      if(state.current)state.current.push(b);
      else{state.current=[a,b];result.push({closed:false,vertices:state.current});}
    }
  }
  return result;
}
function boundaryVertex(P,a,b,t){
  if(t===0)return a;if(t===1)return b;
  const uv=a.uv.map((v,k)=>v+t*(b.uv[k]-v)),partnerUv=a.partnerUv.map((v,k)=>v+t*(b.partnerUv[k]-v));
  return {...a,uv,partnerUv,point:evaluate(P,...uv,false).point};
}
function bezierHull(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.cp.length; i += 4) for (let a = 0; a < 3; a++) { const v = P.cp[i + a] / P.cp[i + 3]; min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v); }
  return { min, max };
}

// Planar bilinear faces and mesh triangles share bounded plane intersections.
// Edge endpoints use the existing surface/edge corrector instead of marching
// across a degenerate triangle patch pole.
function planarBoundary(patch,options){
  if(patch.nu!==2||patch.nv!==2||patch.orderU!==2||patch.orderV!==2)return curvedPlanarBoundary(patch,options);
  const corners=[0,4,8,12].map(i=>[0,1,2].map(k=>patch.cp[i+k]/patch.cp[i+3])),[a,b,c,d]=corners;
  const product=cross(b.map((v,k)=>v-a[k]),c.map((v,k)=>v-a[k]));
  if(Math.hypot(...product)<=ROUNDING_MM**2)return null;
  const normal=product.map(value=>value/Math.hypot(...product));
  if(Math.abs(dot(normal,d.map((v,k)=>v-a[k])))>ROUNDING_MM)return null;
  const triangle=Math.hypot(...c.map((v,k)=>v-d[k]))<=ROUNDING_MM;
  return {corners:triangle?[a,b,c]:[a,b,d,c],normal,edgeIds:triangle?[3,2,0]:[3,2,1,0],reversed:triangle?[false,false,true]:[false,false,true,true]};
}
// Planarity is independent of the UV chart: circular and other rational
// planar faces use the same scalar-plane section and native edge corrector.
const curvedPlaneBoundaries=new WeakMap();
function curvedPlanarBoundary(patch,{chordMm,planarChordMm=chordMm/10}){
  const plane=surfacePlane(patch);if(!plane)return null;
  if(!curvedPlaneBoundaries.has(patch))curvedPlaneBoundaries.set(patch,new Map());
  const cache=curvedPlaneBoundaries.get(patch);if(cache.has(planarChordMm))return cache.get(planarChordMm);
  const edges=[{axis:0,fixed:patch.domainU[0],range:patch.domainV,edge:3},
    {axis:1,fixed:patch.domainV[1],range:patch.domainU,edge:2},
    {axis:0,fixed:patch.domainU[1],range:[...patch.domainV].reverse(),edge:1},
    {axis:1,fixed:patch.domainV[0],range:[...patch.domainU].reverse(),edge:0}];
  const spans=[];
  for(const edge of edges){
    const uv=t=>edge.axis===0?[edge.fixed,t]:[t,edge.fixed];
    const cuts=[0,.25,.5,.75,1].map(f=>edge.range[0]+f*(edge.range[1]-edge.range[0]));
    const samples=sampleCurveIntervals({at:t=>({point:evaluate(patch,...uv(t),false).point}),cuts,stepMm:Infinity,toleranceMm:planarChordMm});
    const ordered=edge.range[1]>=edge.range[0]?samples:[...samples].reverse();
    for(let i=1;i<ordered.length;i++){
      const first=ordered[i-1],last=ordered[i];
      if(Math.hypot(...first.point.map((value,k)=>value-last.point[k]))>ROUNDING_MM)spans.push({first,last,edge:edge.edge});
    }
  }
  const boundary=spans.length?{normal:plane.normal,corners:spans.map(span=>span.first.point),edgeIds:spans.map(span=>span.edge),ranges:spans.map(span=>[span.first.t,span.last.t])}:null;
  cache.set(planarChordMm,boundary);return boundary;
}
function planarSurfacePieces(P,partner,boundary,{seedMm,chordMm,planarChordMm=chordMm/10}){
  const {patch,sign}=partner;
  const [a,b]=boundary.corners,normal=boundary.normal,x=normalize(b.map((v,k)=>v-a[k])),y=cross(normal,x);
  const project=point=>{const relative=point.map((v,k)=>v-a[k]);return [dot(relative,x),dot(relative,y)];};
  const polygon=boundary.corners.map(project),clipPolygon=boundary.ranges?offsetRegion([polygon],planarChordMm):[polygon];
  const cut=sectionPatch(P,{normal,offset:dot(normal,a)},{minFeatureMm:seedMm,chordMm:planarChordMm}),pieces=[];
  if(cut.coincident)return pieces;
  for(const chain of cut.chains){
    const state={vertices:null};
    for(let i=1;i<chain.length;i++){
      const first=chain[i-1],last=chain[i],origin=project(first.point),end=project(last.point),direction=end.map((v,k)=>v-origin[k]);
      if(Math.hypot(...direction)<=ROUNDING_MM)continue;
      const clipped=clipLineToRegion(origin,direction,clipPolygon,{range:[0,1]});
      const spans=[...clipped.spans,...clipped.contacts].filter(([lo,hi])=>hi>lo).sort((p,q)=>p[0]-q[0]),merged=[];
      for(const span of spans){const prior=merged.at(-1);if(prior&&span[0]<=prior[1])prior[1]=Math.max(prior[1],span[1]);else merged.push([...span]);}
      for(const [lo,hi] of merged){
        const start=planarSurfaceVertex(P,patch,sign,polygon,boundary,first,last,origin,direction,lo),finish=planarSurfaceVertex(P,patch,sign,polygon,boundary,first,last,origin,direction,hi);
        if(state.vertices&&Math.hypot(...state.vertices.at(-1).uv.map((v,k)=>v-start.uv[k]))<=TOLERANCE.domainFraction)state.vertices.push(finish);
        else{const vertices=[start,finish];pieces.push({closed:false,vertices});state.vertices=vertices;}
      }
    }
  }
  return splitPartnerSeams(P,partner,pieces);
}

const periodicAxes=new WeakMap();
function periodicSurfaceAxes(patch){
  if(!periodicAxes.has(patch))periodicAxes.set(patch,[patch.domainU,patch.domainV].map((domain,axis)=>
    curveCorrespondence(surfaceIsoCurve(patch,axis,domain[0]),surfaceIsoCurve(patch,axis,domain[1]))===1));
  return periodicAxes.get(patch);
}
// A continuous world curve can cross a periodic chart cut. Each bounded UV
// image ends at that cut; its twin begins on the opposite domain edge.
function splitPartnerSeams(P,partner,pieces){
  const patch=partner.patch,periodic=periodicSurfaceAxes(patch),domains=[patch.domainU,patch.domainV],output=[];
  for(const piece of pieces){
    const state={vertices:[piece.vertices[0]]};
    for(let i=1;i<piece.vertices.length;i++){
      const first=piece.vertices[i-1],last=piece.vertices[i];
      const crossings=periodic.flatMap((active,axis)=>active&&Math.abs(last.partnerUv[axis]-first.partnerUv[axis])>(domains[axis][1]-domains[axis][0])/2?[axis]:[]);
      for(const axis of crossings){
        const low=domains[axis][0],high=domains[axis][1],from=first.partnerUv[axis]<last.partnerUv[axis]?low:high,to=from===low?high:low;
        const edge=axis===0?(from===low?3:1):(from===low?0:2);
        const guess=[(first.partnerUv[1-axis]+last.partnerUv[1-axis])/2,...first.uv.map((value,k)=>(value+last.uv[k])/2)];
        const root=edgeSurfacePoint(patch,edge,P,guess);
        requireThat(root,'A planar intersection could not resolve its periodic chart cut.');
        const uv=[...first.partnerUv];uv[axis]=from;uv[1-axis]=root.t;
        const before={...first,uv:root.s,point:root.point,partnerUv:uv};
        state.vertices.push(before);output.push({...piece,closed:false,vertices:state.vertices});
        state.vertices=[{...before,partnerUv:uv.map((value,k)=>k===axis?to:value)}];
      }
      state.vertices.push(last);
    }
    if(state.vertices.length>1)output.push({...piece,vertices:state.vertices});
  }
  return output;
}

function planarSurfaceVertex(P,partner,sign,polygon,boundary,first,last,origin,direction,t){
  const uv=[first.u+t*(last.u-first.u),first.v+t*(last.v-first.v)],point=origin.map((v,k)=>v+t*direction[k]);
  const edge=polygon.map((a,i)=>({index:i,distance:pointSegmentDistance(point,a,polygon[(i+1)%polygon.length])})).reduce((best,candidate)=>candidate.distance<best.distance?candidate:best);
  if(t>0&&t<1||edge.distance<=ROUNDING_MM){
    const start=polygon[edge.index],end=polygon[(edge.index+1)%polygon.length],delta=end.map((v,k)=>v-start[k]),length2=delta[0]**2+delta[1]**2;
    const coordinate=Math.max(0,Math.min(1,((point[0]-start[0])*delta[0]+(point[1]-start[1])*delta[1])/length2));
    const edgeId=boundary.edgeIds[edge.index],domain=edgeId===0||edgeId===2?partner.domainU:partner.domainV,fraction=boundary.reversed?.[edge.index]?1-coordinate:coordinate;
    const interval=boundary.ranges?.[edge.index];
    const along=interval?interval[0]+coordinate*(interval[1]-interval[0]):domain[0]+fraction*(domain[1]-domain[0]);
    const refined=edgeSurfacePoint(partner,edgeId,P,[along,...uv]);
    requireThat(refined,'A native surface intersection could not resolve a planar face edge.');
    const partnerUv=edgeId===3?[partner.domainU[0],refined.t]:edgeId===1?[partner.domainU[1],refined.t]:[refined.t,edgeId===2?partner.domainV[1]:partner.domainV[0]];
    return {uv:refined.s,point:refined.point,partner,partnerUv,sign};
  }
  const native=evaluate(P,...uv),projection=projectSurfacePoint(partner,native.point,{toleranceMm:PROGRAM_STEP_MM});
  requireThat(projection.distance<=PROGRAM_STEP_MM,'A planar intersection sample is outside its bounded face.');
  return {uv,point:native.point,partner,partnerUv:projection.uv,sign};
}

// Inside region of surface P with respect to a closed solid (a spline shell or
// a triangle mesh): loops in P's (u,v) (counterclockwise outer loops,
// clockwise holes) and the oriented boundary curves, each vertex carrying its
// partner patch and parameters there.
export function surfaceInside(P, solid, { chordMm = TOLERANCE.chord, seedMm = 0.4, sampleStepMm = seedMm, boundaryPieces=null } = {}) {
  const shell = solid, pieces = [];
  if(boundaryPieces)pieces.push(...boundaryPieces);
  else for (const partner of boundaryPatches(solid, P)) {
    const pair=surfaceBoundaryPair(P,partner.patch,1,partner.sign,{seedMm,chordMm});
    pieces.push(...pair.a);
  }
  const joiningMm=Math.max(chordMm,solid.construction?.toleranceMm??PRINT_RESOLUTION_MM);
  const chains=chainPieces(interiorBoundaryPieces(P,pieces),P,joiningMm).map(chain=>orient(chain,P,shell));
  const sample = uv => containsPoint(shell,evaluate(P,...uv,false).point);
  let raw;
  try{raw=closeOnBoundary(P,chains,sample,faceTrimRegion(P,{toleranceMm:chordMm}),joiningMm);}catch(error){
    // At a mesh tangency, adjacent facet intersections can terminate in the
    // chart interior without a unique stitch. Keep the exact authored chart
    // and use the shared physical containment/root construction for this case.
    if(solid.kind!=='triangle-mesh'||!(error instanceof SurfaceBoundaryTopologyError))throw error;
    const sampled=sampledSurfaceInside(solid,{kind:'patch',patch:P},{sampleStepMm});
    return {loops:sampled.loops,curves:[],report:{...sampled.report,reason:'tangential-facet-intersection',nativeBoundaryCode:error.code,nativeBoundaryMessage:error.message}};
  }
  return {loops:raw.length?union(raw,[]):[],curves:chains,report:{method:'native-surface-boundaries',planarFaceMethod:'scalar-plane-section-edge-corrector',chordMm,planarChordMm:chordMm/10,seedMm}};
}



// Search data for many sections of one geometry by slices sharing a chart
// orientation (a plane family): every mesh leaf is indexed in the slice's
// frame. The result is sectioned exactly like the geometry it came from.
export function prepareSection(geometry, slice) {
  if (slice.kind !== 'plane') return geometry;
  if (geometry.kind === 'boolean') return { ...geometry, operands: geometry.operands.map(o => prepareSection(o, slice)) };
  if (geometry.kind === 'assembly') return { ...geometry, components: geometry.components.map(c => prepareSection(c, slice)) };
  if (geometry.kind === 'prepared-mesh') return prepareSection(geometry.mesh, slice);
  if (geometry.kind !== 'triangle-mesh') return geometry;
  return { kind: 'prepared-mesh', mesh: geometry, bounds: geometry.bounds, index: meshSectionIndex(geometry, frameAxes(slice)) };
}

// The region of a solid on a slice: {slice, loops, nudgedByMm, touchesEdge,
// open}. Geometry is a spline shell, a triangle mesh, a boolean of
// solids or an assembly (the union of its components), each possibly prepared.
// nudgedByMm is the largest displacement a degenerate plane cut needed;
// touchesEdge says the region reaches a patch slice's edge, where the slice
// stops inside the solid instead of crossing it. open lists the gaps a plane
// cut that did not close joined (up to options.gapMm, the line width) and the
// pieces it dropped, at chart points.
export function section(geometry, slice, options = {}) {
  requireThat(geometry?.bounds, 'Section needs a solid with bounds.');
  requireThat(options.side===undefined||options.side===null||options.side==='negative'||options.side==='positive','Section side is negative or positive.');
  requireThat(!options.side||slice.kind==='plane'||slice.kind==='patch'||slice.kind==='slice-chart'&&slice.slice?.kind==='plane','One-sided section needs an oriented plane or native patch.');
  const { loops, nudgedByMm, open = [], report } = sectionLoops(geometry, slice, options);
  return { slice, loops, nudgedByMm, touchesEdge: touchesSliceEdge(slice, loops), open,...(report?{report}:{}) };
}

function sectionLoops(geometry, slice, options) {
  if(options.side&&slice.kind==='slice-chart'&&slice.slice?.kind==='plane')return sectionLoops(geometry,slice.slice,options);
  if(options.side&&slice.kind==='patch')return oneSidedPatchSection(geometry,slice,options);
  if(slice.kind==='plane'){
    const low=slice.normal.reduce((sum,n,k)=>sum+n*((n>=0?geometry.bounds.min[k]:geometry.bounds.max[k])-slice.origin[k]),0);
    const high=slice.normal.reduce((sum,n,k)=>sum+n*((n>=0?geometry.bounds.max[k]:geometry.bounds.min[k])-slice.origin[k]),0);
    if(low>PRINT_RESOLUTION_MM||high<-PRINT_RESOLUTION_MM)return {loops:[],nudgedByMm:0};
  }
  if(geometry.kind==='chart-prism'){
    if(slice.kind==='height-field'&&slice.reference===geometry.reference.reference){
      const offset=slice.offsetMm-geometry.reference.offsetMm;
      return {loops:offset>geometry.fromMm+PRINT_RESOLUTION_MM&&offset<=geometry.toMm+PRINT_RESOLUTION_MM?geometry.loopsUv:[],nudgedByMm:0};
    }
    if(slice.kind==='patch'&&slice.referencePatch===geometry.reference.referencePatch){
      const delta=(slice.translation??[0,0,0]).map((v,k)=>v-(geometry.reference.translation?.[k]??0)),offset=dot(delta,geometry.direction);
      if(Math.hypot(...delta.map((v,k)=>v-offset*geometry.direction[k]))<=PRINT_RESOLUTION_MM)return {loops:offset>geometry.fromMm+PRINT_RESOLUTION_MM&&offset<=geometry.toMm+PRINT_RESOLUTION_MM?geometry.loopsUv:[],nudgedByMm:0};
    }
    let extent;
    if(slice.kind==='patch')extent={min:[slice.patch.domainU[0],slice.patch.domainV[0]],max:[slice.patch.domainU[1],slice.patch.domainV[1]]};
    else if(['surface-chart','slice-chart','sleeve-chart'].includes(slice.kind)){const bounds=surfaceChartBounds(slice);extent={min:bounds.map(b=>b[0]),max:bounds.map(b=>b[1])};}
    else if(slice.kind==='plane'){
      const corners=Array.from({length:8},(_,i)=>[0,1,2].map(k=>((i>>k)&1?geometry.bounds.max[k]:geometry.bounds.min[k])-slice.origin[k]));
      const points=corners.map(p=>[dot(p,slice.xAxis),dot(p,slice.yAxis)]);extent={min:[0,1].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1].map(k=>Math.max(...points.map(p=>p[k])))};
    }else extent={min:geometry.bounds.min.slice(0,2),max:geometry.bounds.max.slice(0,2)};
    const boundsUv=[0,1].map(k=>[extent.min[k],extent.max[k]]);
    const sideOffsetMm=options.side==='negative'?-2*ROUNDING_MM:options.side==='positive'?2*ROUNDING_MM:0;
    const loops=sampledChartRegion(extent,surfaceChartStep(slice,boundsUv,options.sampleStepMm??.2),uv=>{
      if(uv.some((v,k)=>v<extent.min[k]||v>extent.max[k]))return false;
      if(!surfaceChartCovers(slice,uv))return false;
      const point=evaluateSurface(slice,uv).point;
      return options.side?chartPrismContains(geometry,point.map((v,k)=>v+sideOffsetMm*slice.normal[k]),{boundaryToleranceMm:ROUNDING_MM}):chartPrismContains(geometry,point);
    },{surface:slice,precisionUv:ROUNDING_RELATIVE});
    return {loops,nudgedByMm:sideOffsetMm};
  }
  if (geometry.kind === 'boolean') return combine(geometry.operation, geometry.operands.map(o => sectionLoops(o, slice, options)));
  if (geometry.kind === 'assembly') return combine('union', geometry.components.map(c => sectionLoops(c, slice, options)));
  if (slice.kind === 'height-field') return sectionHeightSlice(geometry, slice, options);
  if (slice.kind === 'patch') {
    const solid = geometry.kind === 'prepared-mesh' ? geometry.mesh : geometry;
    // Print material on a native chart and faceted solid uses the same physical
    // containment/root section as evaluated charts. Facet seam topology is not
    // a reliable closed boundary at tangencies. The exact surfaceInside port
    // remains available for authored boundary intersections.
    if(solid.kind==='triangle-mesh')return sampledSurfaceInside(solid,slice,options);
    try{
      const inside=surfaceInside(slice.patch,solid,options);return {loops:inside.loops,nudgedByMm:0,report:inside.report};
    }catch(error){
      if(!(error instanceof SurfaceBoundaryTopologyError))throw error;
      const sampled=sampledSurfaceInside(solid,slice,options);
      return {...sampled,report:{...sampled.report,reason:'tangential-surface-intersection',nativeBoundaryCode:error.code,nativeBoundaryMessage:error.message}};
    }
  }
  if(['surface-chart','slice-chart','sleeve-chart'].includes(slice.kind)){
    if(slice.kind==='slice-chart'&&slice.slice?.kind==='plane')return sectionLoops(geometry,slice.slice,options);
    return sampledSurfaceInside(geometry,slice,options);
  }
  requireThat(slice.kind === 'plane', `Unsupported slice kind ${slice.kind}.`);
  if (geometry.kind === 'prepared-mesh') return sectionPreparedMesh(geometry, slice, options);
  if (geometry.kind === 'triangle-mesh') return sectionPreparedMesh({ mesh: geometry, index: meshSectionIndex(geometry, frameAxes(slice), { search: false }) }, slice, options);
  requireThat(Array.isArray(geometry.patches), 'Unsupported geometry backend.');
  return sectionShell(geometry, slice, options);
}

// Face retention queries the material on either side of the same native chart.
// Affine faces reuse exact plane sections; curved charts reuse bounded sampling.
function oneSidedPatchSection(geometry,slice,options){
  const patch=slice.patch;
  if(!affineSurface(patch))return sampledSurfaceInside(geometry,slice,options);
  const uv=[patch.domainU[0],patch.domainV[0]],e=evaluate(patch,...uv),plane=planeSlice({origin:e.point,normal:e.normal,xAxis:e.du});
  const face=planarFaceRegion(patch,faceTrimRegion(patch),{origin:plane.origin,x:plane.xAxis,y:plane.yAxis},PRINT_RESOLUTION_MM/4);
  const cut=sectionLoops(geometry,plane,options),loops=intersect(face,cut.loops);
  const uu=dot(e.du,e.du),uvDot=dot(e.du,e.dv),vv=dot(e.dv,e.dv),det=uu*vv-uvDot*uvDot;
  return {...cut,loops:loops.map(loop=>loop.map(([x,y])=>{
    const d=plane.xAxis.map((v,k)=>v*x+plane.yAxis[k]*y),u=dot(d,e.du),v=dot(d,e.dv);
    return [uv[0]+(u*vv-v*uvDot)/det,uv[1]+(v*uu-u*uvDot)/det];
  }))};
}

// Mesh and evaluated-chart sections share point containment on the exact
// authored reference. Tangential triangle edges need no patch-curve stitching.
function sampledSurfaceInside(geometry,slice,options){
  const boundsUv=surfaceChartBounds(slice,[],options.boundsUv),extent={min:boundsUv.map(b=>b[0]),max:boundsUv.map(b=>b[1])},source=geometry.kind==='prepared-mesh'?geometry.mesh:geometry;
  const sampleStepMm=options.sampleStepMm??slice.sampleStepMm??0.2,step=surfaceChartStep(slice,boundsUv,sampleStepMm);
  const contains=uv=>{
    if(uv.some((v,k)=>v<extent.min[k]||v>extent.max[k])||!surfaceChartCovers(slice,uv))return false;
    const e=evaluateSurface(slice,uv);
    requireThat(e.normal,'Material section requires a regular surface normal.');
    if(options.side){const offset=options.side==='negative'?-PRINT_RESOLUTION_MM:PRINT_RESOLUTION_MM;return containsPoint(source,e.point.map((v,k)=>v+offset*e.normal[k]));}
    if(containsPoint(source,e.point))return true;
    if(source.kind==='triangle-mesh'&&meshBoundaryDistance(source,e.point,ROUNDING_MM)>ROUNDING_MM)return false;
    return containsPoint(source,e.point.map((v,k)=>v+PRINT_RESOLUTION_MM*e.normal[k]))||containsPoint(source,e.point.map((v,k)=>v-PRINT_RESOLUTION_MM*e.normal[k]));
  };
  return {loops:sampledChartRegion(extent,step,contains,{surface:slice,precisionUv:ROUNDING_RELATIVE}),nudgedByMm:0,
    report:{method:'sampled-surface-inside',reference:slice.kind,sampleStepMm,boundaryToleranceMm:PROGRAM_STEP_MM}};
}
// A mesh index cuts at frame height n·origin; its loops sit in the frame's
// (x, y) and shift to the slice's chart origin.
function sectionPreparedMesh({ mesh, index }, slice, { gapMm = 0, side = null } = {}) {
  const axes = frameAxes(slice);
  if (!axes.every((axis, i) => axis.every((v, k) => v === index.axes[i][k])))
    return sectionPreparedMesh({ mesh, index: meshSectionIndex(mesh, axes, { search: false }) }, slice, { gapMm, side });
  const [x, y, n] = axes, o = slice.origin;
  const cut = sectionMeshIndex(index, dot(n, o), { gapMm, side });
  const ox = dot(x, o), oy = dot(y, o), shift = ([a, b]) => [a - ox, b - oy];
  return { loops: ox === 0 && oy === 0 ? cut.loops : cut.loops.map(loop => loop.map(shift)), nudgedByMm: cut.nudgedByMm,
    open: cut.open.map(item => ({ ...item, point: shift(item.point) })) };
}

const frameAxes = slice => [slice.xAxis, slice.yAxis, slice.normal];

// Operands share the slice's chart, so a boolean of solids is the same boolean
// of their regions. Difference subtracts every later operand from the first.
function combine(operation, sections) {
  const loops = sections.map(s => s.loops);
  const result = operation === 'union' ? loops.reduce((a, b) => union(a, b), [])
    : operation === 'difference' ? difference(loops[0], loops.slice(1).reduce((a, b) => union(a, b), []))
    : loops.slice(1).reduce((a, b) => intersect(a, b), loops[0]);
  const nudgedByMm = sections.reduce((n, s) => Math.abs(s.nudgedByMm ?? 0) > Math.abs(n) ? s.nudgedByMm : n, 0);
  const reports=sections.map(s=>s.report).filter(Boolean);
  return {loops:result,nudgedByMm,open:sections.flatMap(s=>s.open??[]),...(reports.length?{report:{method:'surface-region-'+operation,operands:reports}}:{})};
}

