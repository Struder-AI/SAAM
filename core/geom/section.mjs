// Exact-as-sampled sectioning of untrimmed NURBS patches by a plane.
//
// For plane (n, d) and surface S(u,v) the section is the zero set of
//   g(u,v) = n . S(u,v) - d
// which is itself a scalar B-spline: its control coefficients are
// w_ij (n . P_ij - d), so the convex-hull property culls whole knot spans with
// an exact sign test (see nurbs.mjs). Surviving spans are sampled on a grid,
// contoured by marching squares, and every crossing is refined by a bracketed
// 1D root find, so contour vertices lie on the plane to program resolution
// rather than being interpolated. Segments are then subdivided until they follow the
// surface within TOLERANCE.chord.
//
// Known sampling limit: a closed section loop smaller than the grid cell can be
// missed. Cell size is driven by minFeatureMm, whose default is the bead width,
// so a missed loop is smaller than anything the nozzle can lay down. This is a
// sampling basis, not a proof of completeness.

import {clipLineToRegion} from './curve-region.mjs';
import {bezierPieces} from './surface-intersection.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';
import {evaluateSurface,surfaceChartCovers} from './surface-evaluation.mjs';
import { evaluate, evaluateScalar, prepareScalar, gradientBound, planeCoefficients, candidateSpans, clamp } from './nurbs.mjs';
import { TOLERANCE, requireThat, findRoot, distance, subtract, add, scale, dot } from './tolerance.mjs';
import { PRINT_RESOLUTION_MM, PROGRAM_STEP_MM, ROUNDING_MM } from '../dimensions.mjs';

const CELL_MAX = 96, SPLIT_LIMIT = 8;

// One sign convention, used by every test below. A sampled value of exactly
// zero must classify the same way everywhere or the contour fragments where it
// crosses a grid node - which is what a plane flush with a grid line does.
const positive = value => value >= 0;

export function sectionPatch(patch, plane, { minFeatureMm = 0.4,chordMm=TOLERANCE.chord,boundaryContacts=false } = {}) {
  const { normal, offset } = plane;
  const coefficients = planeCoefficients(patch, normal, offset);
  let allZero = true;
  // Boundary queries use physical residuals: rescaling homogeneous controls
  // cannot turn a nonplanar patch into a coincident sheet. Slice keeps its
  // existing equality convention until that separate contract changes.
  for (const [i,c] of coefficients.entries()) if (Math.abs(c) > PRINT_RESOLUTION_MM*(boundaryContacts?patch.cp[4*i+3]:1)) { allZero = false; break; }
  // The whole patch lies in the slice plane at print resolution: a flush face, not a curve.
  if (allZero) return { chains: [], coincident: true };

  // Sign tests, root finds and cell sampling all use h; only the emitted points
  // need a surface evaluation.
  const g = prepareScalar(patch,coefficients);
  const chains = [];
  for (const span of candidateSpans(patch, coefficients)) {
    const { us, vs, values } = contourGrid(patch, span, g, minFeatureMm, coefficients);
    for (let i = 0; i < us.length - 1; i++)
      for (let j = 0; j < vs.length - 1; j++)
        for (const segment of cellSegments(g, us, vs, values, i, j)) chains.push(segment);
  }
  return { chains: joinSegments(chains, patch, g,chordMm), coincident: false,
    ...(boundaryContacts?{contacts:planeBoundaryContacts(patch,plane,chordMm)}:{}) };
}

// A supporting plane can contain a native chart edge without a transverse
// sign change. Keep those bounded events separate from Slice's half-open cut.
function planeBoundaryContacts(patch,{normal,offset},chordMm){
  const contacts=[];
  for(const piece of bezierPieces(patch))for(const axis of [0,1])for(const end of [0,1]){
    const fixed=[piece.u,piece.v][axis][end];
    if(fixed!==[patch.domainU,patch.domainV][axis][end])continue;
    const rows=axis===0?piece.net[end?piece.net.length-1:0]:piece.net.map(row=>row[end?row.length-1:0]);
    // Positive rational weights turn the numerator residual into millimetres.
    if(!rows.every(row=>Math.abs(dot(normal,row.slice(0,3))/row[3]-offset)<=ROUNDING_MM))continue;
    const range=[piece.u,piece.v][1-axis],uv=t=>axis===0?[fixed,t]:[t,fixed];
    const samples=sampleCurveIntervals({at:t=>({point:evaluate(patch,...uv(t),false).point}),cuts:[range[0],(range[0]+range[1])/2,range[1]],stepMm:Infinity,toleranceMm:chordMm});
    if(!samples.slice(1).some((sample,i)=>distance(sample.point,samples[i].point)>ROUNDING_MM))continue;
    contacts.push({axis,fixed,range,chain:samples.map(sample=>{const [u,v]=uv(sample.t);return {u,v,point:sample.point};})});
  }
  return contacts;
}

// A plane's contour on an evaluated surface keeps that surface's native chart.
// Sampling is physical, while shared marching/root/chaining stages retain UV.
// Features wholly between samples remain below this sampled topology contract.
export function sectionSurface(surface, plane, {boundsUv=null,sampleStepMm=0.2,minFeatureMm=sampleStepMm}={}) {
  if(surface.cp)return sectionPatch(surface,plane,{minFeatureMm});
  if(surface.kind==='patch')return sectionPatch(surface.patch,plane,{minFeatureMm});
  const bounds=boundsUv??[surface.domainU,surface.domainV];
  requireThat(bounds?.length===2&&bounds.every(b=>b?.length===2&&b.every(Number.isFinite)&&b[1]>b[0]),'Evaluated surface section needs bounded chart intervals.');
  requireThat(Number.isFinite(sampleStepMm)&&sampleStepMm>0,'Surface section sampling must be positive physical millimetres.');
  if(surface.kind==='plane'){
    const a=dot(plane.normal,surface.xAxis),b=dot(plane.normal,surface.yAxis),c=dot(plane.normal,surface.origin)-plane.offset,length2=a*a+b*b;
    if(length2<=TOLERANCE.parameter**2)return {chains:[],coincident:Math.abs(c)<=PRINT_RESOLUTION_MM};
    const origin=[-c*a/length2,-c*b/length2],direction=[-b,a],rectangle=[[bounds[0][0],bounds[1][0]],[bounds[0][1],bounds[1][0]],[bounds[0][1],bounds[1][1]],[bounds[0][0],bounds[1][1]]];
    const cut=clipLineToRegion(origin,direction,[rectangle]);
    const chains=cut.spans.map(span=>span.map(t=>{const uv=origin.map((v,k)=>v+t*direction[k]);return {u:uv[0],v:uv[1],point:evaluateSurface(surface,uv).point};}));
    return {chains,coincident:false};
  }
  const chart={...surface,domainU:bounds[0],domainV:bounds[1]},speeds=[0,0];
  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
    const uv=[bounds[0][0]+i*(bounds[0][1]-bounds[0][0])/4,bounds[1][0]+j*(bounds[1][1]-bounds[1][0])/4];
    if(!surfaceChartCovers(chart,uv))continue;
    const e=evaluateSurface(chart,uv);
    requireThat(e.du&&e.dv,'Surface section requires first derivatives of its chart.');
    speeds[0]=Math.max(speeds[0],Math.hypot(...e.du));speeds[1]=Math.max(speeds[1],Math.hypot(...e.dv));
  }
  requireThat(speeds.every(v=>v>0),'Surface section has a singular sampling metric.');
  const counts=bounds.map((b,k)=>Math.max(2,Math.ceil((b[1]-b[0])*speeds[k]/sampleStepMm)));
  const axes=bounds.map((b,k)=>Array.from({length:counts[k]+1},(_,i)=>b[0]+i*(b[1]-b[0])/counts[k])),[us,vs]=axes;
  const g=(u,v)=>surfaceChartCovers(chart,[u,v])?dot(plane.normal,evaluateSurface(chart,[u,v]).point)-plane.offset:NaN;
  const values=us.map(u=>Float64Array.from(vs,v=>g(u,v))),segments=[];
  if(values.every(column=>column.every(value=>Math.abs(value)<=PRINT_RESOLUTION_MM)))return {chains:[],coincident:true};
  for(let i=0;i<us.length-1;i++)for(let j=0;j<vs.length-1;j++)segments.push(...cellSegments(g,us,vs,values,i,j));
  return {chains:joinSegments(segments,chart,g),coincident:false,uncoveredSamples:values.reduce((sum,c)=>sum+c.filter(v=>!Number.isFinite(v)).length,0)};
}
// Sampling density is chosen by the function, not guessed from size. The grid
// starts coarse and doubles while any cell could still hide a contour the
// sampling has not seen. "Could hide" is decided by the gradient bound, so a
// cell is dismissed only when h cannot reach zero inside it. Doubling stops at
// the minFeatureMm cap, which is where the documented sampling limit lives.
function contourGrid(patch, span, g, minFeatureMm, coefficients) {
  const bound = gradientBound(patch, coefficients, span);
  const [maxU, maxV] = cellCounts(patch, span, minFeatureMm);
  let cellsU = Math.min(maxU, patch.orderU > 2 ? 2 : 1), cellsV = Math.min(maxV, patch.orderV > 2 ? 2 : 1);
  for (;;) {
    const us = [], vs = [], values = [];
    for (let i = 0; i <= cellsU; i++) us.push(span.u[0] + (span.u[1] - span.u[0]) * i / cellsU);
    for (let j = 0; j <= cellsV; j++) vs.push(span.v[0] + (span.v[1] - span.v[0]) * j / cellsV);
    for (let i = 0; i <= cellsU; i++) {
      values.push(new Float64Array(cellsV + 1));
      for (let j = 0; j <= cellsV; j++) values[i][j] = g(us[i], vs[j]);
    }
    if ((cellsU >= maxU && cellsV >= maxV) || resolved(g, values, cellsU, cellsV, bound, us, vs)) return { us, vs, values };
    cellsU = Math.min(maxU, cellsU * 2);
    cellsV = Math.min(maxV, cellsV * 2);
  }
}

// Two independent adequacy tests, both of which must hold for every cell.
//
//  * A cell with no sign change is dismissed only when h at its corners is
//    farther from zero than h can possibly travel into the cell, given the
//    gradient bound. That part is rigorous: no zero can hide there.
//  * A cell that does change sign is trusted by marching squares to hold one
//    simple crossing. Two crossings on one edge cancel in the corner signs and
//    alias into a missing arc, so contour cells additionally have their edges
//    sub-sampled and must show a single crossing per edge.
//
// What survives both tests is a component smaller than the final cell, which
// the minFeatureMm cap keeps below what the nozzle can lay down.
const EDGE_SAMPLES = 4;

function resolved(g, values, cellsU, cellsV, bound, us, vs) {
  for (let i = 0; i < cellsU; i++)
    for (let j = 0; j < cellsV; j++) {
      const corners = [values[i][j], values[i + 1][j], values[i + 1][j + 1], values[i][j + 1]];
      if (corners.some(positive) && corners.some(c => !positive(c))) {
        if (!edgesSimple(g, us, vs, i, j)) return false;
        continue;
      }
      // Farthest interior point from a corner is the cell centre.
      const reach = bound.u * (us[i + 1] - us[i]) / 2 + bound.v * (vs[j + 1] - vs[j]) / 2;
      let least = Infinity;
      for (const value of corners) least = Math.min(least, Math.abs(value));
      if (least <= reach) return false;
    }
  return true;
}

function edgesSimple(g, us, vs, i, j) {
  const ends = [[us[i], vs[j], us[i + 1], vs[j]], [us[i + 1], vs[j], us[i + 1], vs[j + 1]],
    [us[i + 1], vs[j + 1], us[i], vs[j + 1]], [us[i], vs[j + 1], us[i], vs[j]]];
  for (const [u0, v0, u1, v1] of ends) {
    let changes = 0, previous = positive(g(u0, v0));
    for (let k = 1; k <= EDGE_SAMPLES; k++) {
      const t = k / EDGE_SAMPLES, current = positive(g(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t));
      if (current !== previous) changes++;
      previous = current;
    }
    if (changes > 1) return false;
  }
  return true;
}

// Upper bound on grid density: cells no larger than half the smallest feature
// the nozzle can lay down, so anything the grid can miss is unprintable anyway.
function cellCounts(patch, span, minFeatureMm) {
  const { nu, nv, cp, orderU, orderV, knotsU, knotsV } = patch;
  const iu0 = Math.max(0, spanIndexOf(knotsU, span.u[0], nu) - orderU + 1);
  const iv0 = Math.max(0, spanIndexOf(knotsV, span.v[0], nv) - orderV + 1);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = iu0; i < Math.min(nu, iu0 + orderU); i++)
    for (let j = iv0; j < Math.min(nv, iv0 + orderV); j++) {
      const b = (i * nv + j) * 4, w = cp[b + 3];
      for (let k = 0; k < 3; k++) { const value = cp[b + k] / w; if (value < min[k]) min[k] = value; if (value > max[k]) max[k] = value; }
    }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const dense = Math.min(CELL_MAX, Math.max(2, Math.ceil(2 * extent / Math.max(minFeatureMm, PRINT_RESOLUTION_MM))));
  return [patch.orderU > 2 ? dense : 1, patch.orderV > 2 ? dense : 1];
}

function spanIndexOf(knots, t, count) {
  for (let i = count - 1; i >= 0; i--) if (knots[i] <= t) return i;
  return 0;
}

// Marching squares over one cell. Crossings are refined along the cell edge by
// a bracketed root find rather than linear interpolation of the corner values.
function cellSegments(g, us, vs, values, i, j) {
  const corners = [
    { u: us[i], v: vs[j], value: values[i][j] },
    { u: us[i + 1], v: vs[j], value: values[i + 1][j] },
    { u: us[i + 1], v: vs[j + 1], value: values[i + 1][j + 1] },
    { u: us[i], v: vs[j + 1], value: values[i][j + 1] }
  ];
  if(corners.some(c=>!Number.isFinite(c.value)))return [];
  const crossings = [];
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    if (positive(a.value) === positive(b.value)) continue;
    const along = a.u === b.u
      ? t => ({ u: a.u, v: a.v + (b.v - a.v) * t })
      : t => ({ u: a.u + (b.u - a.u) * t, v: a.v });
    const t = findRoot(x => { const p = along(x); return g(p.u, p.v); }, 0, 1, a.value, b.value);
    crossings.push({ edge: e, ...along(t) });
  }
  if (crossings.length === 2) return [[crossings[0], crossings[1]]];
  if (crossings.length === 4) {
    // Saddle: the cell centre decides which pairing keeps the region connected.
    const centre = g((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2);
    return positive(centre) === positive(corners[0].value)
      ? [[crossings[0], crossings[1]], [crossings[2], crossings[3]]]
      : [[crossings[1], crossings[2]], [crossings[3], crossings[0]]];
  }
  return [];
}

// Join cell segments into polylines, then subdivide each span until the chord
// follows the surface within tolerance.
//
// Endpoints are matched with a tolerance rather than by exact value: a crossing
// on a shared knot-span boundary is solved separately by each span, from
// different brackets, so the two results agree to rounding but not bit for
// bit. Exact keys leave the contour broken at every span boundary.
function joinSegments(segments, patch, g,chordMm=TOLERANCE.chord) {
  const epsU = (patch.domainU[1] - patch.domainU[0]) * TOLERANCE.domainFraction;
  const epsV = (patch.domainV[1] - patch.domainV[0]) * TOLERANCE.domainFraction;
  const cell = p => [Math.round(p.u / epsU), Math.round(p.v / epsV)];
  const ends = new Map();
  const add = (p, segment) => {
    const [cu, cv] = cell(p), id = `${cu}|${cv}`;
    const list = ends.get(id) ?? [];
    list.push({ point: p, segment });
    ends.set(id, list);
  };
  // Look in the neighbouring cells too, so a match is not lost to rounding.
  const near = tip => {
    const [cu, cv] = cell(tip), out = [];
    for (let du = -1; du <= 1; du++)
      for (let dv = -1; dv <= 1; dv++)
        for (const entry of ends.get(`${cu + du}|${cv + dv}`) ?? [])
          if (Math.abs(entry.point.u - tip.u) <= epsU && Math.abs(entry.point.v - tip.v) <= epsV) out.push(entry);
    return out;
  };
  for (const segment of segments) for (const point of segment) add(point, segment);
  const used = new Set(), chains = [];
  for (const segment of segments) {
    if (used.has(segment)) continue;
    used.add(segment);
    const chain = [segment[0], segment[1]];
    for (const direction of [1, 0]) {
      for (;;) {
        const tip = direction ? chain[chain.length - 1] : chain[0];
        const match = near(tip).find(entry => !used.has(entry.segment));
        if (!match) break;
        used.add(match.segment);
        const other = match.segment[0] === match.point ? match.segment[1] : match.segment[0];
        if (direction) chain.push(other); else chain.unshift(other);
      }
    }
    chains.push(refine(chain, patch, g,chordMm));
  }
  return chains;
}

function refine(chain, patch, g,chordMm=TOLERANCE.chord) {
  const out = [withPoint(patch, chain[0])];
  for (let i = 1; i < chain.length; i++) out.push(...split(patch, g, out[out.length - 1], withPoint(patch, chain[i]), 0,chordMm));
  return out;
}

const withPoint = (patch, p) => p.point ? p : { ...p, point: evaluateSurface(patch, [p.u, p.v]).point };

// Recursive chord check. The refinement point must lie on the section, so the
// parameter midpoint is projected back onto g = 0 along the perpendicular in
// parameter space before it is used or measured.
function split(patch, g, a, b, depth,chordMm=TOLERANCE.chord) {
  if (depth >= SPLIT_LIMIT) return [b];
  const mid = contourPointNear(patch, g, (a.u + b.u) / 2, (a.v + b.v) / 2, b.u - a.u, b.v - a.v);
  if (!mid) return [b];
  const chordMid = scale(add(a.point, b.point), 0.5);
  const nativeMid=evaluateSurface(patch,[(a.u+b.u)/2,(a.v+b.v)/2]).point;
  // Trims consume the UV polyline too. A straight world contour can have a
  // curved UV image on a nonuniform planar chart.
  if(Math.max(distance(mid.point,chordMid),distance(nativeMid,chordMid))<=chordMm)return [b];
  return [...split(patch, g, a, mid, depth + 1,chordMm), ...split(patch, g, mid, b, depth + 1,chordMm)];
}

// Step perpendicular to the segment until g changes sign, then solve for the
// crossing. Returns null when no bracket is found nearby, which leaves the
// chord as it is rather than inventing a point off the section.
function contourPointNear(patch, g, u, v, du, dv) {
  const scale0 = Math.hypot(du, dv);
  if (!(scale0 > 0)) return null;
  const pu = -dv / scale0, pv = du / scale0;
  const centre = g(u, v);
  let weight=1;
  if(patch.cp){
    const weights=new Float64Array(patch.nu*patch.nv);
    for(let i=0;i<weights.length;i++)weights[i]=patch.cp[4*i+3];
    weight=evaluateScalar(patch,weights,u,v);
  }
  // The native scalar is a homogeneous numerator; its residual is physical only after division by weight.
  if (Math.abs(centre) <= PROGRAM_STEP_MM*weight) return { u, v, point: evaluateSurface(patch, [u, v]).point };
  for (let step = scale0 / 8; step <= scale0 * 2; step *= 2) {
    for (const direction of [1, -1]) {
      const su = clamp(u + pu * step * direction, patch.domainU), sv = clamp(v + pv * step * direction, patch.domainV);
      const value = g(su, sv);
      if (positive(value) === positive(centre)) continue;
      const t = findRoot(x => g(u + (su - u) * x, v + (sv - v) * x), 0, 1, centre, value);
      const fu = u + (su - u) * t, fv = v + (sv - v) * t;
      return { u: fu, v: fv, point: evaluateSurface(patch, [fu, fv]).point };
    }
  }
  return null;
}
