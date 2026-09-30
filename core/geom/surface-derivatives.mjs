// Second derivatives for surface geodesics. Same homogeneous NURBS and basis
// evaluator as the rest of the geometry core; no Rhino modelling-kernel code.
import { basisDerivatives, findSpan } from './nurbs.mjs';
import { requireThat, cross, dot } from './tolerance.mjs';

function baseSurfaceDerivatives(patch, u, v) {
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


// Analytic derivatives of a single evaluated normal-offset surface. This does
// not build an offset stack or repair folds. Third rational derivatives of the
// native patch give second derivatives of its unit normal without finite
// differencing, so distances in an offset chart remain physical millimetres.
export function surfaceDerivatives(patch,u,v,{normalMm=0}={}){
  const base=baseSurfaceDerivatives(patch,u,v);
  requireThat(Number.isFinite(normalMm),'Surface normal offset must be finite.');
  if(normalMm===0)return base;
  const su=findSpan(patch.knotsU,patch.nu,patch.orderU,u),sv=findSpan(patch.knotsV,patch.nv,patch.orderV,v);
  const bu=basisDerivatives(patch.knotsU,su,u,patch.orderU,Math.min(3,patch.orderU-1)),bv=basisDerivatives(patch.knotsV,sv,v,patch.orderV,Math.min(3,patch.orderV-1));
  const h=new Map(),s=new Map(),choose=[[1],[1,1],[1,2,1],[1,3,3,1]];
  for(let total=0;total<=3;total++)for(let a=0;a<=total;a++){
    const b=total-a,value=[0,0,0,0];
    for(let i=0;i<patch.orderU;i++)for(let j=0;j<patch.orderV;j++){
      const index=((su-patch.orderU+1+i)*patch.nv+sv-patch.orderV+1+j)*4,f=(bu[a]?.[i]??0)*(bv[b]?.[j]??0);
      for(let k=0;k<4;k++)value[k]+=f*patch.cp[index+k];
    }
    h.set(a+':'+b,value);
    const vector=value.slice(0,3);
    for(let i=0;i<=a;i++)for(let j=0;j<=b;j++)if(i!==a||j!==b){const previous=s.get(i+':'+j),weight=h.get((a-i)+':'+(b-j))[3]*choose[a][i]*choose[b][j];for(let k=0;k<3;k++)vector[k]-=weight*previous[k];}
    s.set(a+':'+b,vector.map(x=>x/h.get('0:0')[3]));
  }
  const add=(...vectors)=>vectors[0].map((_,k)=>vectors.reduce((n,v)=>n+v[k],0)),scale=(v,n)=>v.map(x=>x*n);
  const U=s.get('1:0'),V=s.get('0:1'),UU=s.get('2:0'),UV=s.get('1:1'),VV=s.get('0:2');
  const A=cross(U,V),L=Math.hypot(...A),N=scale(A,1/L);
  const Au=add(cross(UU,V),cross(U,UV)),Av=add(cross(UV,V),cross(U,VV));
  const Auu=add(cross(s.get('3:0'),V),scale(cross(UU,UV),2),cross(U,s.get('2:1')));
  const Auv=add(cross(s.get('2:1'),V),cross(UU,VV),cross(U,s.get('1:2')));
  const Avv=add(cross(s.get('1:2'),V),scale(cross(UV,VV),2),cross(U,s.get('0:3')));
  const Lu=dot(N,Au),Lv=dot(N,Av),Nu=scale(add(Au,scale(N,-Lu)),1/L),Nv=scale(add(Av,scale(N,-Lv)),1/L);
  const second=(Aij,Ai,Ni,Nj,Li,Lj)=>scale(add(Aij,scale(Ni,-Lj),scale(Nj,-Li),scale(N,-dot(Nj,Ai)-dot(N,Aij))),1/L);
  const Nuu=second(Auu,Au,Nu,Nu,Lu,Lu),Nuv=second(Auv,Au,Nu,Nv,Lu,Lv),Nvv=second(Avv,Av,Nv,Nv,Lv,Lv);
  const point=add(base.point,scale(N,normalMm)),du=add(U,scale(Nu,normalMm)),dv=add(V,scale(Nv,normalMm));
  const duu=add(UU,scale(Nuu,normalMm)),duv=add(UV,scale(Nuv,normalMm)),dvv=add(VV,scale(Nvv,normalMm));
  const normal=cross(du,dv),det=dot(normal,normal),E=dot(du,du),F=dot(du,dv),G=dot(dv,dv);
  requireThat(Number.isFinite(det)&&det>E*G*1e-14,'Normal-offset surface has a singular tangent or local focal collapse; reduce normalMm.');
  const uvOf=vector=>{const a=dot(du,vector),b=dot(dv,vector);return [(G*a-F*b)/det,(E*b-F*a)/det];};
  return {point,du,dv,duu,duv,dvv,normal:scale(normal,1/Math.sqrt(det)),uvOf,method:'analytic-rational-normal-offset'};
}
