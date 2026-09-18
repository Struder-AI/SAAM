// Continuous source-side contact preparation. Fixed arc sample correspondence
// advects steep radial details between Z profiles without switching branches.
import {requireThat} from './tolerance.mjs';
import {regularizeDirectionalContour} from './directional-contour.mjs';
const TAU=2*Math.PI,wrap=a=>((a%TAU)+TAU)%TAU;
function profile(loop,anchor){
  const radii=[],angles=[];
  for(let i=0;i<loop.length;i++){
    const p=loop[i],r=Math.hypot(p[0]-anchor[0],p[1]-anchor[1]),a=Math.atan2(p[1]-anchor[1],p[0]-anchor[0]);
    radii.push(r);angles.push(i?angles[i-1]+wrap(a-angles[i-1]):a);
  }
  requireThat(angles.at(-1)<angles[0]+TAU,'Regularized contact contour lost angular ordering.');
  for(let i=0;i<angles.length;i++){
    const gap=(i+1<angles.length?angles[i+1]:angles[0]+TAU)-angles[i];
    requireThat(gap>0&&gap<Math.PI,'Regularized contact profile needs each chord to span a positive angle smaller than pi.');
  }
  return {radii,angles};
}
const shift=(a,b)=>TAU*Math.round((a.angles[0]-b.angles[0])/TAU);
function atIndex(a,b,t,i,s=shift(a,b)){
  const angle=a.angles[i]+t*(b.angles[i]+s-a.angles[i]),r=a.radii[i]+t*(b.radii[i]-a.radii[i]);
  return [r*Math.cos(angle),r*Math.sin(angle)];
}
function discrepancy(a,b,actual,t,tolerance){
  const s=shift(a,b);let maximum=0;
  for(let i=0;i<a.radii.length;i++){
    const p=atIndex(a,b,t,i,s),r=actual.radii[i],angle=actual.angles[i];
    maximum=Math.max(maximum,Math.hypot(p[0]-r*Math.cos(angle),p[1]-r*Math.sin(angle)));
    if(maximum>tolerance)return maximum;
  }
  return maximum;
}
function radius(a,b,t,theta){
  const s=shift(a,b),angle=i=>a.angles[i]+t*(b.angles[i]+s-a.angles[i]),first=angle(0),query=first+wrap(theta-first);
  let lo=0,hi=a.radii.length-1;
  while(lo<hi){const mid=(lo+hi+1)>>1;if(angle(mid)<=query)lo=mid;else hi=mid-1;}
  const p=atIndex(a,b,t,lo,s),q=atIndex(a,b,t,(lo+1)%a.radii.length,s),dx=q[0]-p[0],dy=q[1]-p[1];
  const value=(p[0]*dy-p[1]*dx)/(Math.cos(query)*dy-Math.sin(query)*dx);
  requireThat(Number.isFinite(value)&&value>0,'Prepared contact profile lost a positive radial intersection.');return value;
}
export function prepareRadialSleeveContact({curveAt,anchorAt,startMm,endMm,stepMm=.4,side='inside',toleranceMm=.1,samples=16384,maxProfiles=100000,maxSourceDistanceQueries=4000000,distanceToSourceWithin=null,onProgress=null}){
  requireThat([startMm,endMm,stepMm,toleranceMm].every(Number.isFinite)&&endMm>startMm&&stepMm>0&&toleranceMm>0&&['inside','outside'].includes(side),
    'Contact preparation needs a positive interval, step, tolerance and inside/outside side.');
  requireThat([maxProfiles,maxSourceDistanceQueries].every(v=>Number.isSafeInteger(v)&&v>0),'Contact preparation budgets must be positive safe integers.');
  const frameBudget=toleranceMm*.95,slabs=new Map(),frames=new Map();
  const report={contactProfiles:0,contactIntervals:0,contactSamples:0,compressedSamples:0,maxCompressionMm:0,maxDetailCorrespondenceMm:0,
    minimumProfileInterpolationTargetMm:toleranceMm*.05,maxProfileInterpolationTargetMm:0,maxSampledProfileCombinedErrorMm:0,detailToleranceMm:toleranceMm,contactSamplesPerProfile:samples,logRadiusSlopeTarget:256,maxSourceChordLogRadiusSlope:0,maxDepth:0,
    meshTransitionIntervals:0,sourceDistanceQueries:0,maxSourceDistanceQueries,maxSampledSourceDistanceMm:0,
    strategy:'continuous-polar-profiles with sampled 3D-validated radial transitions at ledges'};
  function meshTransition(a,b,fa,fb){
    if(!distanceToSourceWithin||b-a>toleranceMm/2)return false;
    const knots=[0,...new Set([...fa.angles,...fb.angles].map(wrap))].sort((x,y)=>x-y);knots.push(TAU);
    for(const t of [.5,.25,.75]){
      const z=a+(b-a)*t,c=anchorAt(z),at=theta=>{
        const r=(1-t)*radius(fa,fa,0,theta)+t*radius(fb,fb,0,theta);
        return [c[0]+r*Math.cos(theta),c[1]+r*Math.sin(theta),z];
      };
      const validate=(lo,hi,p,q,depth=0)=>{
        requireThat(report.sourceDistanceQueries<maxSourceDistanceQueries,'Contact mesh-distance query budget exhausted; increase maxSourceDistanceQueries. No complete contact mapping was generated.');
        const mid=(lo+hi)/2,m=at(mid),d=distanceToSourceWithin(m,toleranceMm);report.sourceDistanceQueries++;
        if(report.sourceDistanceQueries%32768===0)onProgress?.({stage:'Checking mesh contact transitions',completed:report.sourceDistanceQueries,zMm:z});
        if(!Number.isFinite(d))return false;
        report.maxSampledSourceDistanceMm=Math.max(report.maxSampledSourceDistanceMm,d);
        const chordError=Math.max(...[.25,.5,.75].map(s=>{
          const v=s===.5?m:at(lo+(hi-lo)*s);return Math.hypot(...v.map((x,k)=>x-p[k]-s*(q[k]-p[k])));
        }));
        const reach=Math.max(Math.hypot(...m.map((x,k)=>x-p[k])),Math.hypot(...m.map((x,k)=>x-q[k])));
        if(d+reach+chordError<=toleranceMm)return true;
        if(depth>=12)return false;
        return validate(lo,mid,p,m,depth+1)&&validate(mid,hi,m,q,depth+1);
      };
      for(let i=1;i<knots.length;i++)if(!validate(knots[i-1],knots[i],at(knots[i-1]),at(knots[i])))return false;
    }
    report.meshTransitionIntervals++;return true;
  }
  function frame(z){
    if(frames.has(z))return frames.get(z);
    requireThat(report.contactProfiles<maxProfiles,'Contact profile budget exhausted; no complete contact mapping was prepared.');
    const c=anchorAt(z);let result;
    try{result=regularizeDirectionalContour(curveAt(z),c,{toleranceMm:frameBudget,samples});}
    catch(error){throw new Error(`Contact profile at Z ${z} mm: ${error.message}`);}
    const value=profile(result.loop,c);value.errorMm=result.report.correspondenceErrorMm;report.contactProfiles++;
    if(report.contactProfiles%32===0)onProgress?.({stage:'Preparing mesh contact profiles',completed:report.contactProfiles,zMm:z});
    report.maxDetailCorrespondenceMm=Math.max(report.maxDetailCorrespondenceMm,result.report.correspondenceErrorMm);
    report.maxSourceChordLogRadiusSlope=Math.max(report.maxSourceChordLogRadiusSlope,result.report.maxChordLogRadiusSlope);
    if(frames.size>=128)frames.delete(frames.keys().next().value);frames.set(z,value);return value;
  }
  function interval(a,b,fa=frame(a),fb=frame(b),depth=0){
    report.contactIntervals++;report.maxDepth=Math.max(report.maxDepth,depth);
    let good=true;
    for(const t of [.5,.25,.75]){
      const actual=frame(a+(b-a)*t),remaining=toleranceMm-actual.errorMm;
      report.maxProfileInterpolationTargetMm=Math.max(report.maxProfileInterpolationTargetMm,remaining);
      const error=discrepancy(fa,fb,actual,t,remaining);
      if(error>remaining){good=false;break;}
      report.maxSampledProfileCombinedErrorMm=Math.max(report.maxSampledProfileCombinedErrorMm,actual.errorMm+error);
    }
    const radial=!good&&depth>=8&&meshTransition(a,b,fa,fb);
    return {a,b,fa,fb,depth,good:good||radial,radial,left:null,right:null};
  }
  function select(z){
    requireThat(z>=startMm-1e-9&&z<=endMm+1e-9,'Contact query is outside its prepared height interval.');
    z=Math.max(startMm,Math.min(endMm,z));
    const index=Math.min(Math.max(1,Math.ceil((endMm-startMm)/stepMm-1e-12))-1,Math.floor((z-startMm)/stepMm));
    let node=slabs.get(index);
    if(!node){const a=startMm+index*stepMm;node=interval(a,Math.min(endMm,a+stepMm));if(slabs.size>=4)slabs.delete(slabs.keys().next().value);slabs.set(index,node);}
    while(!node.good){
      requireThat(node.depth<16,`Contact cannot meet its sampled profile interpolation tolerance in Z ${node.a} to ${node.b}; no complete mapping was generated.`);
      const mid=(node.a+node.b)/2;
      if(z<=mid)node=node.left??=interval(node.a,mid,node.fa,frame(mid),node.depth+1);
      else node=node.right??=interval(mid,node.b,frame(mid),node.fb,node.depth+1);
    }
    return {node,t:(z-node.a)/(node.b-node.a)};
  }
  return {report,at(point,fidelity=1){
    requireThat(point.length===3&&point.every(Number.isFinite)&&Number.isFinite(fidelity)&&fidelity>=0&&fidelity<=1,'Contact requires finite XYZ and fidelity from0 to1.');
    if(fidelity===0)return [...point];
    const c=anchorAt(point[2]),dx=point[0]-c[0],dy=point[1]-c[1],r=Math.hypot(dx,dy);
    if(r<1e-12){requireThat(side==='inside','Outside contact has no direction at the fitted center.');return [...point];}
    const {node,t}=select(point[2]),theta=Math.atan2(dy,dx),target=node.radial?
      (1-t)*radius(node.fa,node.fa,0,theta)+t*radius(node.fb,node.fb,0,theta):radius(node.fa,node.fb,t,theta);report.contactSamples++;
    if(side==='inside'?r<=target:r>=target)return [...point];
    const delta=fidelity*(target-r);report.compressedSamples++;report.maxCompressionMm=Math.max(report.maxCompressionMm,Math.abs(delta));
    return [point[0]+dx*delta/r,point[1]+dy*delta/r,point[2]];
  }};
}
