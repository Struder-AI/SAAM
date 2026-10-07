import {evaluateSurface} from './surface-evaluation.mjs';

import {cross,dot,requireThat,distance} from './tolerance.mjs';

// Plain slice descriptors retain their native geometry. Numerical derivatives
// supply the metric only where no analytic chart derivatives are available.
export function evaluatedSurfaceDerivatives(surface,u,v,{normalMm=0,toleranceMm=.01}={}){
  const domains=[surface.domainU,surface.domainV],coordinates=[u,v];
  requireThat(domains.every((d,k)=>coordinates[k]>=d[0]-1e-9&&coordinates[k]<=d[1]+1e-9),'Evaluated surface sample leaves its chart domain.');
  [u,v]=coordinates.map((x,k)=>Math.max(domains[k][0],Math.min(domains[k][1],x)));coordinates[0]=u;coordinates[1]=v;
  const pointAt=(a,b)=>evaluateSurface(surface.slice??surface,[a,b],normalMm).point;
  const point=pointAt(u,v);
  const stencil=(axis,h)=>{
    const x=coordinates[axis],domain=domains[axis],center=Math.max(domain[0]+h,Math.min(domain[1]-h,x));
    const nodes=[center-h,center,center+h];
    requireThat(nodes[0]<nodes[1]&&nodes[1]<nodes[2],'Evaluated surface derivative cannot resolve chart coordinates.');
    const samples=nodes.map(t=>pointAt(axis===0?t:u,axis===1?t:v));
    const weights=nodes.map((a,i)=>{const b=nodes[(i+1)%3],c=nodes[(i+2)%3],den=(a-b)*(a-c);return [(2*x-b-c)/den,2/den];});
    return {first:[0,1,2].map(k=>samples.reduce((sum,p,i)=>sum+p[k]*weights[i][0],0)),second:[0,1,2].map(k=>samples.reduce((sum,p,i)=>sum+p[k]*weights[i][1],0)),h};
  };
  const derivative=axis=>{
    const span=domains[axis][1]-domains[axis][0];let h=span/128,previous=stencil(axis,h);
    for(;;){
      const next=stencil(axis,h/2),firstError=distance(previous.first,next.first)*h,secondError=distance(previous.second,next.second)*h*h;
      if(Math.max(firstError,secondError)<=toleranceMm/16)return next;
      h/=2;previous=next;
    }
  };
  const U=derivative(0),V=derivative(1),hu=U.h,hv=V.h;
  const us=[Math.max(domains[0][0],u-hu),Math.min(domains[0][1],u+hu)],vs=[Math.max(domains[1][0],v-hv),Math.min(domains[1][1],v+hv)];
  const corners=[pointAt(us[0],vs[0]),pointAt(us[1],vs[0]),pointAt(us[0],vs[1]),pointAt(us[1],vs[1])];
  const duv=[0,1,2].map(k=>(corners[3][k]-corners[2][k]-corners[1][k]+corners[0][k])/((us[1]-us[0])*(vs[1]-vs[0])));
  const du=U.first,dv=V.first,area=cross(du,dv),det=dot(area,area),E=dot(du,du),F=dot(du,dv),G=dot(dv,dv);
  requireThat(Number.isFinite(det)&&det>E*G*1e-14,'Evaluated surface has a singular physical metric.');
  return {point,du,dv,duu:U.second,duv,dvv:V.second,normal:area.map(n=>n/Math.sqrt(det)),uvOf(vector){const a=dot(du,vector),b=dot(dv,vector);return [(G*a-F*b)/det,(E*b-F*a)/det];},method:'adaptive-numerical-slice-chart'};
}
