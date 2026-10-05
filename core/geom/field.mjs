// The part's top surface as a height field.
//
// The draped-skin skill needs, for a point on the bed, the height of the part
// above it and the surface normal there. That is a vertical ray against the
// shell, which for an untrimmed patch is the 2x2 system
//   Sx(u,v) = x,  Sy(u,v) = y
// solved by Newton from seeds inside the spans whose control points can reach
// (x, y). The convex hull property culls the rest exactly, so a seeded solve
// only runs where a solution can exist.

import { evaluate, clamp } from './nurbs.mjs';
import { TOLERANCE } from './tolerance.mjs';

const affineProjections = new WeakMap();
const SEEDS = 3;
const NEWTON_STEPS = 40;

// Spans whose control net can contain (x, y), by XY bounding box of the
// contributing control points.
function candidateSpansAt(patch, x, y) {
  const { nu, nv, orderU, orderV, knotsU, knotsV, cp } = patch, spans = [];
  for (let su = orderU - 1; su < nu; su++) {
    if (knotsU[su + 1] - knotsU[su] < 1e-12) continue;
    for (let sv = orderV - 1; sv < nv; sv++) {
      if (knotsV[sv + 1] - knotsV[sv] < 1e-12) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = su - orderU + 1; i <= su; i++)
        for (let j = sv - orderV + 1; j <= sv; j++) {
          const b = (i * nv + j) * 4, w = cp[b + 3];
          const px = cp[b] / w, py = cp[b + 1] / w;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      if (x >= minX - TOLERANCE.point && x <= maxX + TOLERANCE.point && y >= minY - TOLERANCE.point && y <= maxY + TOLERANCE.point)
        spans.push({ u: [knotsU[su], knotsU[su + 1]], v: [knotsV[sv], knotsV[sv + 1]] });
    }
  }
  return spans;
}

// Constant-weight nets reproduce linear UV coordinates through Greville
// abscissae. Certify the entire projected net before using its direct inverse;
// arbitrary/folded projections retain the multi-seed Newton construction.
function affineProjection(patch){
  if(!affineProjections.has(patch)){
    const {nu,nv,orderU,orderV,knotsU,knotsV,cp}=patch;
    const greville=(knots,n,order)=>Array.from({length:n},(_,i)=>Array.from({length:order-1},(_,k)=>knots[i+k+1]).reduce((a,b)=>a+b,0)/(order-1));
    const us=greville(knotsU,nu,orderU),vs=greville(knotsV,nv,orderV),weight=cp[3];
    const xy=(i,j)=>[0,1].map(k=>cp[(i*nv+j)*4+k]/cp[(i*nv+j)*4+3]);
    const origin=xy(0,0),du=xy(nu-1,0).map((v,k)=>(v-origin[k])/(us.at(-1)-us[0])),dv=xy(0,nv-1).map((v,k)=>(v-origin[k])/(vs.at(-1)-vs[0]));
    const determinant=du[0]*dv[1]-du[1]*dv[0];
    let affine=Number.isFinite(determinant)&&Math.abs(determinant)>1e-14;
    for(let i=0;i<nu&&affine;i++)for(let j=0;j<nv&&affine;j++){
      affine=cp[(i*nv+j)*4+3]===weight&&xy(i,j).every((v,k)=>Math.abs(v-origin[k]-du[k]*(us[i]-us[0])-dv[k]*(vs[j]-vs[0]))<=TOLERANCE.point*1e-3);
    }
    affineProjections.set(patch,affine?{origin,du,dv,determinant,u0:us[0],v0:vs[0]}:null);
  }
  return affineProjections.get(patch);
}
const affineUv=({origin,du,dv,determinant,u0,v0},x,y)=>{
  const dx=x-origin[0],dy=y-origin[1];
  return [u0+(dx*dv[1]-dy*dv[0])/determinant,v0+(du[0]*dy-du[1]*dx)/determinant];
};
// True only when the patch's certified affine XY projection holds every point,
// and so their convex hull: the patch then lies above or below all of it.
export function patchCoversChart(patch,points){
  const affine=affineProjection(patch);
  return !!affine&&points.every(([x,y])=>{const [u,v]=affineUv(affine,x,y);return u>=patch.domainU[0]&&u<=patch.domainU[1]&&v>=patch.domainV[0]&&v<=patch.domainV[1];});
}

// Every point of the patch directly above or below (x, y).
export function projectToPatch(patch, x, y) {
  const affine=affineProjection(patch);
  if(affine){
    const [u,v]=affineUv(affine,x,y);
    if(u<patch.domainU[0]-TOLERANCE.parameter||u>patch.domainU[1]+TOLERANCE.parameter||v<patch.domainV[0]-TOLERANCE.parameter||v>patch.domainV[1]+TOLERANCE.parameter)return [];
    const cu=clamp(u,patch.domainU),cv=clamp(v,patch.domainV),frame=evaluate(patch,cu,cv);
    if(Math.hypot(frame.point[0]-x,frame.point[1]-y)<=TOLERANCE.point)return [{u:cu,v:cv,point:frame.point,normal:frame.normal}];
  }
  const hits = [];
  for (const span of candidateSpansAt(patch, x, y))
    for (let i = 1; i <= SEEDS; i++)
      for (let j = 1; j <= SEEDS; j++) {
        const solution = newton(patch, x, y,
          span.u[0] + (span.u[1] - span.u[0]) * i / (SEEDS + 1),
          span.v[0] + (span.v[1] - span.v[0]) * j / (SEEDS + 1));
        if (!solution) continue;
        if (hits.some(hit => Math.abs(hit.u - solution.u) < 1e-7 && Math.abs(hit.v - solution.v) < 1e-7)) continue;
        hits.push(solution);
      }
  return hits;
}

function newton(patch, x, y, u0, v0) {
  let u = u0, v = v0;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    const { point, du, dv, normal } = evaluate(patch, u, v);
    const fx = point[0] - x, fy = point[1] - y;
    if (Math.hypot(fx, fy) <= TOLERANCE.point) return { u, v, point, normal };
    const determinant = du[0] * dv[1] - du[1] * dv[0];
    // A singular Jacobian is a fold or a pole in XY; another seed may reach it.
    if (Math.abs(determinant) < 1e-14) return null;
    const stepU = (fx * dv[1] - fy * dv[0]) / determinant;
    const stepV = (du[0] * fy - du[1] * fx) / determinant;
    const nextU = clamp(u - stepU, patch.domainU), nextV = clamp(v - stepV, patch.domainV);
    if (Math.abs(nextU - u) < TOLERANCE.parameter && Math.abs(nextV - v) < TOLERANCE.parameter) {
      const check = evaluate(patch, nextU, nextV);
      return Math.hypot(check.point[0] - x, check.point[1] - y) <= 1e-6 ? { u: nextU, v: nextV, point: check.point, normal: check.normal } : null;
    }
    u = nextU;
    v = nextV;
  }
  return null;
}

// A pole (a revolved cap's centre) has no normal of its own; a smooth cap's
// normal there is the limit from inside the patch.
function limitNormal(patch, u, v) {
  const inward = (t, [lo, hi]) => t + (t < (lo + hi) / 2 ? 1 : -1) * 1e-6 * (hi - lo);
  return evaluate(patch, inward(u, patch.domainU), inward(v, patch.domainV)).normal;
}

// Height of the part's top surface above (x, y), with the surface normal and
// the local slope from horizontal. Returns null outside the footprint.
export function topAt(shell, x, y) {
  let best = null;
  for (const crossing of crossingsAt(shell, x, y))
    if (!best || crossing.zMm > best.zMm + TOLERANCE.point) best = crossing;
  return best;
}

// Every point where the vertical line through (x, y) crosses the shell, in
// patch order, with its upward normal. A vertical wall touched along the line
// is not a crossing.
export function crossingsAt(shell, x, y) {
  const crossings = [];
  for (const patch of shell.patches)
    for (const hit of projectToPatch(patch, x, y)) {
      const normal = hit.normal ?? limitNormal(patch, hit.u, hit.v);
      if (!normal || Math.abs(normal[2]) < 1e-9) continue;
      const upward = normal[2] > 0 ? normal : normal.map(component => -component);
      crossings.push({
        zMm: hit.point[2],
        normal: upward,
        slopeDeg: Math.acos(Math.min(1, Math.abs(upward[2]))) * 180 / Math.PI,
        patch: patch.name,
        u: hit.u,
        v: hit.v
      });
    }
  return crossings;
}
