import {planarPolicy,surfacePolicy} from '../../path/builder.mjs';
export const box=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
export function combFixtures(){
  const frame=[box(0,0,12,12),box(4,4,8,8).reverse()];
  const cases=[];
  for(const curved of [false,true])for(const budget of [0,8,12,40])for(const blocked of [false,true]){
    const loops=structuredClone(frame),height=(x,y)=>1+x*.1+.03*(y-6)**2;
    const policy=curved?surfacePolicy(loops,{surfaceZ:height,maxZ:5,maxCombMm:budget,lineWidthMm:.4,liftMm:1,sampleStepMm:.5,sagMm:.01})
      :planarPolicy(loops,{layerZ:1,maxCombMm:budget,lineWidthMm:.4,liftMm:1});
    if(blocked)policy.isTravelClear=(a,b)=>Math.min(a[1],b[1])>=4;
    cases.push({name:`${curved?'surface':'plane'}-${budget}-${blocked}`,from:[2,6,curved?1.2:1],to:[10,6,curved?2:1],policy});
  }
  for(const [name,from,to] of [['direct',[1,2,1],[10,2,1]],['outside',[-1,2,1],[10,2,1]],['height-mismatch',[1,2,1],[10,2,2]],['coincident',[2,2,1],[2,2,1]]])
    cases.push({name,from,to,policy:planarPolicy(frame,{layerZ:1,maxCombMm:40,lineWidthMm:.4,liftMm:1})});
  cases.push({name:'missing-footprint',from:[0,0,1],to:[1,1,1],policy:{maxCombMm:40}});
  cases.push({name:'invalid-step',from:[2,6,1],to:[10,6,1],policy:{combRegion:frame,maxCombMm:40,combSurfaceZ:()=>1,combStepMm:NaN}});
  cases.push({name:'query-error',from:[2,6,1],to:[10,6,1],policy:{combRegion:frame,maxCombMm:40,canTravelDirect(){throw Error('query failed');}}});
  return cases;
}
export function traceCombPolicy(policy,trace){
  const result={...policy};
  for(const key of ['combCorners','combSurfaceZ','canTravelDirect','isTravelClear'])if(policy[key])result[key]=(...args)=>{trace.push([key,args]);return policy[key](...args);};
  if(policy.combIndex){result.combIndex={};for(const key of ['contains','inCorridor'])result.combIndex[key]=(...args)=>{trace.push([key,args]);return policy.combIndex[key](...args);};}
  return result;
}
