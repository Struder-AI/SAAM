// Exact rational composition of a UV curve with a tensor-product surface.
// Knot crossings partition native spans; Bernstein products form each image.
import {preparePlanarCurve} from './curve-loops.mjs';
import {bezierSpans,bezierRoots,extract} from './curve-ops.mjs';
import {bezierPieces} from './surface-intersection.mjs';
import {evaluateCurve,nurbsCurveRecord} from './nurbs.mjs';
import {bernsteinProductWeights} from './bezier-net.mjs';
import {requireThat} from './tolerance.mjs';

export function surfaceCurveImages(patch,definition){
  requireThat(patch.cp&&patch.knotsU&&patch.knotsV,'Surface curve images need a prepared native patch.');
  const cells=bezierPieces(patch),results=[];
  for(const curve of preparePlanarCurve(definition))for(const span of bezierSpans(curve)){
    const cuts=[span.a,span.b];
    for(const [axis,knots] of [patch.knotsU,patch.knotsV].entries())for(const knot of new Set(knots))
      bezierRoots(Array.from({length:span.cp.length/4},(_,i)=>span.cp[i*4+axis]-knot*span.cp[i*4+3]),span.a,span.b,cuts);
    const ordered=[...new Set(cuts)].sort((a,b)=>a-b),pending=[];
    for(let i=1;i<ordered.length;i++)if(ordered[i]>ordered[i-1])pending.push([ordered[i-1],ordered[i]]);
    while(pending.length){
      const [a,b]=pending.shift(),uv=evaluateCurve(curve,(a+b)/2).point;
      const cell=cells.find(cell=>uv[0]>=cell.u[0]&&uv[0]<=cell.u[1]&&uv[1]>=cell.v[0]&&uv[1]<=cell.v[1]);
      requireThat(cell,'UV curve leaves the native surface domain.');
      const piece=extract(curve,a,b),controls=composeBezier(cell,piece);
      if(controls.some(p=>p[3]<=0)){
        const mid=(a+b)/2;requireThat(mid>a&&mid<b,'Surface curve image cannot resolve positive rational weights at parameter precision.');
        pending.unshift([a,mid],[mid,b]);continue;
      }
      results.push({nurbs:controlRecord(controls),uvNurbs:controlRecord(Array.from({length:piece.n},(_,i)=>Array.from(piece.cp.slice(i*4,i*4+4))),2)});
    }
  }
  return results;
}
function product(a,b){
  const p=a.length-1,q=b.length-1,weights=bernsteinProductWeights(p,q),out=Array(p+q+1).fill(0);
  for(let i=0;i<=p;i++)for(let j=0;j<=q;j++)out[i+j]+=a[i]*b[j]*weights[i][j];return out;
}
function power(a,n){const state={value:[1]};for(let i=0;i<n;i++)state.value=product(state.value,a);return state.value;}
function choose(n,k){const state={value:1};for(let i=1;i<=k;i++)state.value*= (n-i+1)/i;return state.value;}
function composeBezier(cell,curve){
  const rows=Array.from({length:curve.n},(_,i)=>Array.from(curve.cp.slice(i*4,i*4+4))),w=rows.map(p=>p[3]);
  const u=rows.map(p=>(p[0]-cell.u[0]*p[3])/(cell.u[1]-cell.u[0])),v=rows.map(p=>(p[1]-cell.v[0]*p[3])/(cell.v[1]-cell.v[0]));
  const otherU=w.map((value,i)=>value-u[i]),otherV=w.map((value,i)=>value-v[i]);
  const p=cell.net.length-1,q=cell.net[0].length-1,controls=Array.from({length:(curve.order-1)*(p+q)+1},()=>[0,0,0,0]);
  for(let i=0;i<=p;i++)for(let j=0;j<=q;j++){
    const basis=product(product(power(u,i),power(otherU,p-i)),product(power(v,j),power(otherV,q-j))),factor=choose(p,i)*choose(q,j);
    for(let k=0;k<basis.length;k++)for(let axis=0;axis<4;axis++)controls[k][axis]+=factor*basis[k]*cell.net[i][j][axis];
  }
  return controls;
}
function controlRecord(controls,dimension=3){
  const degree=controls.length-1;
  return nurbsCurveRecord({order:degree+1,n:controls.length,knots:[...Array(degree+1).fill(0),...Array(degree+1).fill(1)],cp:controls.flat()},dimension);
}
