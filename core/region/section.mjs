import {evaluateSurface,surfaceChartCovers} from '../geom/surface-evaluation.mjs';
import {sectionPatch} from '../geom/section.mjs';
import {clipLineToRegion} from '../geom/curve-region.mjs';
import {surfaceChartBounds,surfaceChartStep} from './surface-operations.mjs';
import {sectionHeightSlice,sampledChartRegion} from '../geom/height-slice.mjs';
import {chartPrismContains} from '../geom/chart-prism.mjs';
import {sectionShell} from '../geom/shell.mjs';
import {meshSectionIndex,sectionMeshIndex,meshFaceNormal,meshBoundaryDistance} from '../geom/mesh.mjs';
import {touchesSliceEdge} from '../geom/slice.mjs';
// The part of a surface that lies inside a solid, as closed loops in the
// surface's own (u,v): the region a curved slice owns, or the part of a patch a
// boolean keeps. Its boundary is where the surface meets the solid's patches
// (surface-surface intersection). The curves are chained in (u,v), oriented
// so the solid's inside is on their left using each partner patch's outward
// normal, and closed along the surface's domain boundary, walked
// counterclockwise from each curve's end to the next curve's start.
import { evaluate } from '../geom/nurbs.mjs';
import { intersectPatches,edgeSurfacePoint,projectToSurface } from '../geom/surface-intersection.mjs';
import {pointSegmentDistance} from './region2d.mjs';
import { containsPoint } from '../geom/query.mjs';
import { union, intersect, difference } from './intersection.mjs';
import { requireThat, dot, cross,normalize,TOLERANCE } from '../geom/tolerance.mjs';
import { PRINT_RESOLUTION_MM, PROGRAM_STEP_MM, ROUNDING_MM, ROUNDING_RELATIVE } from '../dimensions.mjs';

const OFF_SURFACE_MM = PRINT_RESOLUTION_MM; // material within print resolution of a sheet is that sheet's side

class SurfaceBoundaryTopologyError extends Error {
  constructor(message){super(message);this.name='SurfaceBoundaryTopologyError';this.code='INTERIOR_BOUNDARY_ENDPOINT';}
}

// +1 where a patch's normal (du x dv) points out of its solid, -1 where it
// points in: a point just along the normal is tested for containment.
export function outwardSigns(shell) {
  const signs = new Map();
  for (const patch of shell.patches) {
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
function chainPieces(pieces, P) {
  const tolerance = TOLERANCE.domainFraction * Math.hypot(P.domainU[1] - P.domainU[0], P.domainV[1] - P.domainV[0]);
  const close = (a, b) => Math.hypot(a.uv[0] - b.uv[0], a.uv[1] - b.uv[1]) <= tolerance;
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
function orient(chain, P, shell) {
  const v = chain.vertices, i = Math.min(Math.max(1, Math.floor(v.length / 2)), v.length - 1), a = v[i - 1], b = v[i];
  const d = [b.uv[0] - a.uv[0], b.uv[1] - a.uv[1]], left = [-d[1], d[0]];
  const mid = [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2], e = evaluate(P, ...mid);
  const across = [0, 1, 2].map(k => e.du[k] * left[0] + e.dv[k] * left[1]);
  const partner = evaluate(b.partner, ...b.partnerUv), outward = partner.normal?.map(n => n * b.sign);
  let insideLeft = outward ? dot(across, outward) < 0 : null;
  if (insideLeft === null || Math.abs(dot(across, outward)) < ROUNDING_RELATIVE) {
    // Tangential crossing: test a point just to the left instead.
    const scale = OFF_SURFACE_MM / Math.max(ROUNDING_MM, Math.hypot(...across));
    insideLeft = containsPoint(shell, evaluate(P, mid[0] + left[0] * scale, mid[1] + left[1] * scale, false).point);
  }
  return insideLeft ? chain : { ...chain, vertices: [...v].reverse() };
}

// Position on the domain boundary, counterclockwise from (u0, v0), in [0, 4).
function perimeterAt(P, [u, v]) {
  const [u0, u1] = P.domainU, [v0, v1] = P.domainV, du = u1 - u0, dv = v1 - v0, eps = TOLERANCE.domainFraction;
  const sides = [[Math.abs(v - v0) / dv, (u - u0) / du], [Math.abs(u - u1) / du, 1 + (v - v0) / dv],
    [Math.abs(v - v1) / dv, 2 + (u1 - u) / du], [Math.abs(u - u0) / du, 3 + (v1 - v) / dv]];
  const [gap, s] = sides.reduce((best, side) => side[0] < best[0] ? side : best);
  return gap <= eps ? ((s % 4) + 4) % 4 : null;
}
const corner = (P, k) => [[P.domainU[0], P.domainV[0]], [P.domainU[1], P.domainV[0]], [P.domainU[1], P.domainV[1]], [P.domainU[0], P.domainV[1]]][k % 4];

function closeOnBoundary(P, chains, domainInside) {
  const loops = chains.filter(c => c.closed).map(c => c.vertices.map(x => x.uv)), open = chains.filter(c => !c.closed);
  for (const c of open) {
    const at = [c.vertices[0], c.vertices.at(-1)].map(x => x.uv);
    if(!at.every(p => perimeterAt(P, p) !== null))throw new SurfaceBoundaryTopologyError(
      `A surface intersection curve on ${P.name} ends inside the surface near ${JSON.stringify(c.vertices.at(-1).point?.map(v => +v.toFixed(4)))}; the surfaces may touch tangentially there.`);
  }
  const starts = open.map(chain => ({ chain, s: perimeterAt(P, chain.vertices[0].uv) })), used = new Set();
  for (const first of starts) {
    if (used.has(first.chain)) continue;
    const loop = [];let current = first;
    while (!used.has(current.chain)) {
      used.add(current.chain);loop.push(...current.chain.vertices.map(x => x.uv));
      const end = perimeterAt(P, current.chain.vertices.at(-1).uv);
      const next = starts.reduce((best, candidate) => {
        const gap = ((candidate.s - end) % 4 + 4) % 4;
        return !best || gap < best.gap ? { ...candidate, gap } : best;
      }, null);
      for (let k = Math.floor(end) + 1; k < end + next.gap; k++) if (k - end > ROUNDING_RELATIVE) loop.push(corner(P, k));
      current = next;
    }
    loops.push(loop);
  }
  if (!open.length && domainInside()) loops.push([0, 1, 2, 3].map(k => corner(P, k)));
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
function bezierHull(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.cp.length; i += 4) for (let a = 0; a < 3; a++) { const v = P.cp[i + a] / P.cp[i + 3]; min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v); }
  return { min, max };
}

// Planar bilinear faces and mesh triangles share bounded plane intersections.
// Edge endpoints use the existing surface/edge corrector instead of marching
// across a degenerate triangle patch pole.
function planarBoundary(patch){
  if(patch.nu!==2||patch.nv!==2||patch.orderU!==2||patch.orderV!==2)return null;
  const corners=[0,4,8,12].map(i=>[0,1,2].map(k=>patch.cp[i+k]/patch.cp[i+3])),[a,b,c,d]=corners;
  const product=cross(b.map((v,k)=>v-a[k]),c.map((v,k)=>v-a[k]));
  if(Math.hypot(...product)<=ROUNDING_MM**2)return null;
  const normal=normalize(product);
  if(Math.abs(dot(normal,d.map((v,k)=>v-a[k])))>ROUNDING_MM)return null;
  const triangle=Math.hypot(...c.map((v,k)=>v-d[k]))<=ROUNDING_MM;
  return {corners:triangle?[a,b,c]:[a,b,d,c],normal,edgeIds:triangle?[3,2,0]:[3,2,1,0],reversed:triangle?[false,false,true]:[false,false,true,true]};
}
function planarSurfacePieces(P,partner,boundary,{seedMm,chordMm}){
  const {patch,sign}=partner;
  const [a,b]=boundary.corners,normal=boundary.normal,x=normalize(b.map((v,k)=>v-a[k])),y=cross(normal,x);
  const project=point=>{const relative=point.map((v,k)=>v-a[k]);return [dot(relative,x),dot(relative,y)];};
  const polygon=boundary.corners.map(project),cut=sectionPatch(P,{normal,offset:dot(normal,a)},{minFeatureMm:seedMm,chordMm:chordMm/10}),pieces=[];
  if(cut.coincident)return pieces;
  for(const chain of cut.chains){
    const state={vertices:null};
    for(let i=1;i<chain.length;i++){
      const first=chain[i-1],last=chain[i],origin=project(first.point),end=project(last.point),direction=end.map((v,k)=>v-origin[k]);
      if(Math.hypot(...direction)<=ROUNDING_MM)continue;
      const clipped=clipLineToRegion(origin,direction,[polygon],{range:[0,1]});
      const spans=[...clipped.spans,...clipped.contacts].filter(([lo,hi])=>hi>lo).sort((p,q)=>p[0]-q[0]),merged=[];
      for(const span of spans){const prior=merged.at(-1);if(prior&&span[0]<=prior[1])prior[1]=Math.max(prior[1],span[1]);else merged.push([...span]);}
      for(const [lo,hi] of merged){
        const start=planarSurfaceVertex(P,patch,sign,polygon,boundary,first,last,origin,direction,lo),finish=planarSurfaceVertex(P,patch,sign,polygon,boundary,first,last,origin,direction,hi);
        if(state.vertices&&Math.hypot(...state.vertices.at(-1).uv.map((v,k)=>v-start.uv[k]))<=TOLERANCE.domainFraction)state.vertices.push(finish);
        else{const vertices=[start,finish];pieces.push({closed:false,vertices});state.vertices=vertices;}
      }
    }
  }
  return pieces;
}

function planarSurfaceVertex(P,partner,sign,polygon,boundary,first,last,origin,direction,t){
  const uv=[first.u+t*(last.u-first.u),first.v+t*(last.v-first.v)],point=origin.map((v,k)=>v+t*direction[k]);
  const edge=polygon.map((a,i)=>({index:i,distance:pointSegmentDistance(point,a,polygon[(i+1)%polygon.length])})).reduce((best,candidate)=>candidate.distance<best.distance?candidate:best);
  if(t>0&&t<1||edge.distance<=ROUNDING_MM){
    const start=polygon[edge.index],end=polygon[(edge.index+1)%polygon.length],delta=end.map((v,k)=>v-start[k]),length2=delta[0]**2+delta[1]**2;
    const coordinate=Math.max(0,Math.min(1,((point[0]-start[0])*delta[0]+(point[1]-start[1])*delta[1])/length2));
    const edgeId=boundary.edgeIds[edge.index],domain=edgeId===0||edgeId===2?partner.domainU:partner.domainV,fraction=boundary.reversed[edge.index]?1-coordinate:coordinate;
    const along=domain[0]+fraction*(domain[1]-domain[0]);
    const refined=edgeSurfacePoint(partner,edgeId,P,[along,...uv]);
    requireThat(refined,'A native surface intersection could not resolve a planar face edge.');
    const partnerUv=edgeId===3?[partner.domainU[0],refined.t]:edgeId===1?[partner.domainU[1],refined.t]:[refined.t,edgeId===2?partner.domainV[1]:partner.domainV[0]];
    return {uv:refined.s,point:refined.point,partner,partnerUv,sign};
  }
  const native=evaluate(P,...uv),projection=projectToSurface(partner,native.point,[(partner.domainU[0]+partner.domainU[1])/2,(partner.domainV[0]+partner.domainV[1])/2]);
  return {uv,point:native.point,partner,partnerUv:projection.uv,sign};
}

// Inside region of surface P with respect to a closed solid (a spline shell or
// a triangle mesh): loops in P's (u,v) (counterclockwise outer loops,
// clockwise holes) and the oriented boundary curves, each vertex carrying its
// partner patch and parameters there.
export function surfaceInside(P, solid, { chordMm = TOLERANCE.chord, seedMm = 0.4, sampleStepMm = seedMm } = {}) {
  const shell = solid, pieces = [];
  for (const partner of boundaryPatches(solid, P)) {
    const planar=planarBoundary(partner.patch);
    if(planar){pieces.push(...planarSurfacePieces(P,partner,planar,{seedMm,chordMm}));continue;}
    const {patch:y,sign}=partner;
    const { curves } = intersectPatches(P, y, { chordMm, seedMm });
    for (const c of curves)
      pieces.push({ closed: c.closed, vertices: c.points.map((point, i) => ({ uv: c.uvA[i], point, partner: y, partnerUv: c.uvB[i], sign })) });
  }
  const chains = chainPieces(pieces, P).map(chain => orient(chain, P, shell));
  const sample = () => {
    const u = P.domainU[0] + 1.37e-3 * (P.domainU[1] - P.domainU[0]), v = P.domainV[0] + 1.11e-3 * (P.domainV[1] - P.domainV[0]);
    return containsPoint(shell, evaluate(P, u, v, false).point);
  };
  let raw;
  try{raw=closeOnBoundary(P,chains,sample);}catch(error){
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
  const { loops, nudgedByMm, open = [], report } = sectionLoops(geometry, slice, options);
  return { slice, loops, nudgedByMm, touchesEdge: touchesSliceEdge(slice, loops), open,...(report?{report}:{}) };
}

function sectionLoops(geometry, slice, options) {
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
    const loops=sampledChartRegion(extent,surfaceChartStep(slice,boundsUv,options.sampleStepMm??.2),uv=>{
      if(uv.some((v,k)=>v<extent.min[k]||v>extent.max[k]))return false;
      if(!surfaceChartCovers(slice,uv))return false;
      return chartPrismContains(geometry,evaluateSurface(slice,uv).point);
    },{surface:slice,precisionUv:ROUNDING_RELATIVE});
    return {loops,nudgedByMm:0};
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
    const inside=surfaceInside(slice.patch,solid,options);return {loops:inside.loops,nudgedByMm:0,report:inside.report};
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

// Mesh and evaluated-chart sections share point containment on the exact
// authored reference. Tangential triangle edges need no patch-curve stitching.
function sampledSurfaceInside(geometry,slice,options){
  const boundsUv=surfaceChartBounds(slice,[],options.boundsUv),extent={min:boundsUv.map(b=>b[0]),max:boundsUv.map(b=>b[1])},source=geometry.kind==='prepared-mesh'?geometry.mesh:geometry;
  const sampleStepMm=options.sampleStepMm??slice.sampleStepMm??0.2,step=surfaceChartStep(slice,boundsUv,sampleStepMm);
  const contains=uv=>{
    if(uv.some((v,k)=>v<extent.min[k]||v>extent.max[k])||!surfaceChartCovers(slice,uv))return false;
    const e=evaluateSurface(slice,uv);
    requireThat(e.normal,'Material section requires a regular surface normal.');
    if(containsPoint(source,e.point))return true;
    if(source.kind==='triangle-mesh'&&meshBoundaryDistance(source,e.point,ROUNDING_MM)>ROUNDING_MM)return false;
    return containsPoint(source,e.point.map((v,k)=>v+PRINT_RESOLUTION_MM*e.normal[k]))||containsPoint(source,e.point.map((v,k)=>v-PRINT_RESOLUTION_MM*e.normal[k]));
  };
  return {loops:sampledChartRegion(extent,step,contains,{surface:slice,precisionUv:ROUNDING_RELATIVE}),nudgedByMm:0,
    report:{method:'sampled-surface-inside',reference:slice.kind,sampleStepMm,boundaryToleranceMm:PROGRAM_STEP_MM}};
}
// A mesh index cuts at frame height n·origin; its loops sit in the frame's
// (x, y) and shift to the slice's chart origin.
function sectionPreparedMesh({ mesh, index }, slice, { gapMm = 0 } = {}) {
  const axes = frameAxes(slice);
  if (!axes.every((axis, i) => axis.every((v, k) => v === index.axes[i][k])))
    return sectionPreparedMesh({ mesh, index: meshSectionIndex(mesh, axes, { search: false }) }, slice, { gapMm });
  const [x, y, n] = axes, o = slice.origin;
  const cut = sectionMeshIndex(index, dot(n, o), { gapMm });
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

