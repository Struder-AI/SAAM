// Second derivatives for surface geodesics. Same homogeneous NURBS and basis
// evaluator as the rest of the geometry core; no Rhino modelling-kernel code.
import { basisDerivatives, findSpan } from './nurbs.mjs';
import { requireThat, cross, dot } from './tolerance.mjs';

export function surfaceDerivatives(patch, u, v) {
  requireThat(u >= patch.domainU[0] && u <= patch.domainU[1] && v >= patch.domainV[0] && v <= patch.domainV[1],
    'Surface offset reaches the patch boundary; provide a larger regular patch or reduce the offset.');
  const su = findSpan(patch.knotsU, patch.nu, patch.orderU, u), sv = findSpan(patch.knotsV, patch.nv, patch.orderV, v);
  const bu = basisDerivatives(patch.knotsU, su, u, patch.orderU, Math.min(2, patch.orderU - 1));
  const bv = basisDerivatives(patch.knotsV, sv, v, patch.orderV, Math.min(2, patch.orderV - 1));
  const orders = [[0,0],[1,0],[0,1],[2,0],[1,1],[0,2]], h = orders.map(() => [0,0,0,0]);
  for (let i=0;i<patch.orderU;i++) for(let j=0;j<patch.orderV;j++) {
    const base=((su-patch.orderU+1+i)*patch.nv+sv-patch.orderV+1+j)*4;
    for(let n=0;n<orders.length;n++) {
      const [a,b]=orders[n], f=(bu[a]?.[i]??0)*(bv[b]?.[j]??0);
      for(let k=0;k<4;k++) h[n][k]+=f*patch.cp[base+k];
    }
  }
  const w=h[0][3], point=h[0].slice(0,3).map(x=>x/w);
  const du=point.map((p,k)=>(h[1][k]-p*h[1][3])/w), dv=point.map((p,k)=>(h[2][k]-p*h[2][3])/w);
  const duu=point.map((p,k)=>(h[3][k]-2*du[k]*h[1][3]-p*h[3][3])/w);
  const duv=point.map((p,k)=>(h[4][k]-du[k]*h[2][3]-dv[k]*h[1][3]-p*h[4][3])/w);
  const dvv=point.map((p,k)=>(h[5][k]-2*dv[k]*h[2][3]-p*h[5][3])/w);
  const normal=cross(du,dv), det=dot(normal,normal), E=dot(du,du), F=dot(du,dv), G=dot(dv,dv);
  requireThat(Number.isFinite(det) && det > E*G*1e-14 && w>0, 'Surface offset requires a regular patch without poles or singular tangents.');
  const uvOf = vector => {const a=dot(du,vector),b=dot(dv,vector);return [(G*a-F*b)/det,(E*b-F*a)/det];};
  return {point,du,dv,duu,duv,dvv,normal:normal.map(x=>x/Math.sqrt(det)),uvOf};
}
