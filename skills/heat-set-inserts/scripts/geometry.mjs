import {heatSetFeature,dimensions,heatSetTemplate} from './feature.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// Features choose dimensions and placement. Geometry owns the representation
// and Boolean construction; the approach stays clear outward from the mouth.
export async function compileHeatSet(base,features,{buildGeometry,combineSolids,revolvedProfile,materialPresence,toleranceMm=.01}={}){
  requireThat([buildGeometry,combineSolids,revolvedProfile,materialPresence].every(value=>typeof value==='function'),
    'Heat-set needs Geometry buildGeometry, combineSolids, revolvedProfile and materialPresence operations.');
  const normalized=features.map(heatSetFeature),shell=await buildGeometry(base);
  requireThat(normalized.length>0,'Choose at least one heat-set feature.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0,'Invalid heat-set placement tolerance.');
  const t=toleranceMm,bores=[],checks=[];
  for(const f of normalized){
    const {diameterMm,depthMm}=dimensions(f),r=diameterMm/2;
    const axis=f.axis.map(c=>c/Math.hypot(...f.axis));
    const reach=axis.reduce((sum,c,i)=>sum+c*((c<0?shell.bounds.min[i]:shell.bounds.max[i])-f.positionMm[i]),0);
    const outwardReach=axis.reduce((sum,c,i)=>sum-c*((c>0?shell.bounds.min[i]:shell.bounds.max[i])-f.positionMm[i]),0);
    const clearance=Math.max(2*t,outwardReach+2*t);
    const cutDepth=f.throughHole?Math.max(depthMm,reach+2*t):depthMm;
    const prism=(from,to,firstRadius=r,lastRadius=r)=>revolvedProfile({positionMm:f.positionMm,axis,profile:[[from,firstRadius],[to,lastRadius]]});
    const profile=[];
    if(f.chamferDepthMm>0){
      const mouthRadius=r+f.chamferDepthMm*Math.tan(f.chamferAngleDeg*Math.PI/180);
      profile.push([-clearance,mouthRadius],[0,mouthRadius],[f.chamferDepthMm,r]);
    }else profile.push([-clearance,r]);
    profile.push([cutDepth,r]);
    bores.push(revolvedProfile({positionMm:f.positionMm,axis,profile}));
    if(clearance>2*t)checks.push([f,'material outside its mouth was cleared along the insertion axis.',{operation:'intersection',operands:[shell,prism(-clearance,-2*t)]}]);
    checks.push([f,'the face lies below the mouth at part of its rim; the bore is shallower there.',{operation:'difference',operands:[prism(t,3*t),shell]}],
      [f,f.throughHole?'the host ends before the selected insert seat depth.':'the bore breaks out beyond its floor.',{operation:'difference',operands:[prism(depthMm+t,depthMm+3*t),shell]}]);
  }
  const builtBores=[];
  for(const bore of bores)builtBores.push(await buildGeometry(bore));
  const built=combineSolids('difference',[shell,...builtBores]),probes=[];
  for(const [,,request] of checks){
    const operands=[];
    for(const operand of request.operands)operands.push(operand===shell?shell:await buildGeometry(operand));
    probes.push(combineSolids(request.operation,operands));
  }
  const [present,...found]=await materialPresence([built,...probes]);
  const notes=[...(built.notes??[]),...probes.flatMap(probe=>probe.notes??[]),...(!present?['The heat-set holes leave no material.']:[]),...checks.flatMap(([f,note],i)=>found[i]?[`Heat-set ${f.id}: ${note}`]:[])];
  const solid={shape:'boolean',operation:'difference',operands:[base,...bores]};
  return {geometry:{...heatSetTemplate({solid:true}),base:structuredClone(base),features:normalized,toleranceMm,solid},notes};
}
