// Fixed-size loose NURBS offsets and a functional continuum to unit normals.
import {evaluate} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {prepareOffsetCurvature} from './offset-curvature.mjs';

export function prepareSurfaceOffsets({patch,mode='normal',periodicU=false,periodicV=false}){
  requireThat(patch&&['horizontal','normal','projected-normal'].includes(mode)&&typeof periodicU==='boolean'&&typeof periodicV==='boolean',
    'Surface offsets need a patch, normal, horizontal or projected-normal mode, and explicit periodic flags.');
  const coordinate=(value,domain,periodic)=>{
    requireThat(Number.isFinite(value),'Surface offset parameters must be finite.');
    const [a,b]=domain;
    if(periodic)return a+(((value-a)/(b-a)%1+1)%1)*(b-a);
    requireThat(value>=a-1e-12&&value<=b+1e-12,'Surface offset parameter is outside its patch domain.');
    return Math.max(a,Math.min(b,value));
  };
  const parameters=(u,v)=>[coordinate(u,patch.domainU,periodicU),coordinate(v,patch.domainV,periodicV)];
  const unitDirection=(u,v)=>{
    const evaluated=evaluate(patch,u,v);
    if(mode==='normal'){
      requireThat(evaluated.normal?.every(Number.isFinite),'Surface offset reference has a collapsed normal.');
      return evaluated.normal;
    }
    if(mode==='projected-normal'){
      const n=evaluated.normal,length=n?Math.hypot(n[0],n[1]):0;
      requireThat(n?.every(Number.isFinite)&&length>1e-12,'Surface offset reference has a collapsed horizontal normal projection.');
      return [n[0]/length,n[1]/length,0];
    }
    const {du}=evaluated,length=Math.hypot(du[0],du[1]);
    requireThat(du.every(Number.isFinite)&&length>1e-12,'Surface offset reference has a collapsed horizontal tangent.');
    return [du[1]/length,-du[0]/length,0];
  };
  const greville=(knots,index,order)=>{let sum=0;for(let k=1;k<order;k++)sum+=knots[index+k];return sum/(order-1);};
  const directions=new Float64Array(patch.cp.length);
  for(let i=0;i<patch.nu;i++)for(let j=0;j<patch.nv;j++){
    // Unclamped nonperiodic nets can have outer Greville coordinates outside
    // the active domain; their direction controls use its nearest endpoint.
    const sample=(value,domain,periodic)=>periodic?value:Math.max(domain[0],Math.min(domain[1],value));
    const [u,v]=parameters(sample(greville(patch.knotsU,i,patch.orderU),patch.domainU,periodicU),
      sample(greville(patch.knotsV,j,patch.orderV),patch.domainV,periodicV));
    const normal=unitDirection(u,v),k=(i*patch.nv+j)*4,w=patch.cp[k+3];
    requireThat(Number.isFinite(w)&&w>0,'Surface offset reference weights must be positive and finite.');
    directions.set([normal[0]*w,normal[1]*w,normal[2]*w,w],k);
  }
  const directionPatch={...patch,cp:directions};
  let curvature;
  const limitedPatch=depth=>{
    if(depth===0)return null;
    curvature??=prepareOffsetCurvature(patch,directions,{periodicU,periodicV});
    return curvature.needsLimit(depth)?curvature.limitedPatch(depth):null;
  };
  let queries=0,minLength=Infinity,maxLength=0,minTightness=Infinity,maxTightness=0;
  const frameAt=(u,v,tightness=0)=>{
    requireThat(Number.isFinite(tightness)&&tightness>=0&&tightness<=1,'Surface offset tightness must be between zero and one.');
    [u,v]=parameters(u,v);
    const point=evaluate(patch,u,v,false).point,direction=evaluate(directionPatch,u,v,false).point,length=Math.hypot(...direction);
    requireThat(point.every(Number.isFinite)&&direction.every(Number.isFinite),'Surface offset query produced nonfinite coordinates.');
    if(tightness>0){const normal=unitDirection(u,v);for(let k=0;k<3;k++)direction[k]+=(normal[k]-direction[k])*tightness;}
    queries++;minLength=Math.min(minLength,length);maxLength=Math.max(maxLength,length);
    minTightness=Math.min(minTightness,tightness);maxTightness=Math.max(maxTightness,tightness);
    return {point,direction};
  };
  const offsetPatch=(depth,tightness=0)=>{
    requireThat(Number.isFinite(depth),'Surface offset depth must be finite.');
    requireThat(tightness===0,'Only zero tightness has a fixed-size NURBS offset patch; other tightness values are evaluated functionally without control-point fitting.');
    const limited=limitedPatch(depth);
    if(limited)return {...limited,cp:limited.cp.slice()};
    const cp=patch.cp.slice();
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=depth*directions[i+k];
    return {...patch,cp};
  };
  return {frameAt,offsetPatch,at:(u,v,depth=0,tightness=0)=>{
    requireThat(Number.isFinite(depth),'Surface offset depth must be finite.');
    const {point,direction}=frameAt(u,v,tightness),limited=tightness<1?limitedPatch(depth):null;
    if(!limited)return point.map((p,k)=>p+depth*direction[k]);
    [u,v]=parameters(u,v);
    const loose=evaluate(limited,u,v,false).point;
    if(tightness===0)return loose;
    const normal=unitDirection(u,v);
    return loose.map((p,k)=>p+tightness*(point[k]+depth*normal[k]-p));
  },report:()=>({frameQueries:queries,frameMapping:`${mode} Greville-normal loose control field blended with exact unit reference normals`,
    offsetControlCount:patch.nu*patch.nv,offsetOrderU:patch.orderU,offsetOrderV:patch.orderV,periodicU,periodicV,
    sampledDirectionLengthRange:queries?[minLength,maxLength]:null,queriedTightnessRange:queries?[minTightness,maxTightness]:null,
    ...curvature?.report,
    frameScope:'Control count, knots, degrees and weights are preserved. Loose control depths are locally reduced at sampled over-curvature; requested depth is approximate. Tight queries retain exact unit reference normals and can fold. Intermediate values blend limited loose positions with the tight offset. No global injectivity or clearance certificate.'})};
}
