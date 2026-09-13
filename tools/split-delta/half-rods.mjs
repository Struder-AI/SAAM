// Controlled comparison: half-length rods, vertically translated rails at fixed XY,
// every other physical dimension and every source orientation retained.
import fs from 'node:fs';
import {geometry,inverse,railBodyPoint} from '../../core/machine/split-delta.mjs';
import {eulerRotation,interpretSplitDelta} from '../../core/export/split-delta-player.mjs';
import {assessOperatingPath,scalePreviewSource,pathBounds} from './optimize-path.mjs';
import {assemblyClearance} from './assembly-clearance.mjs';
import {radialProfiles,rodHitsProfiles,checkCladding} from './cladding-clearance.mjs';
const out='Prints/development/splitty-half-rods';fs.mkdirSync(out,{recursive:true});
const baseline=JSON.parse(fs.readFileSync('Prints/development/splitty-assembly-search/search.json')).winner;
const old=geometry(baseline.config),neutral=inverse(old,{tcp:[0,0,20]}),length=old.rodLengthMm/2;
const dropMm=neutral.points.reduce((v,p,i)=>{const c=neutral.carriages[i],xy=Math.hypot(p[0]-c[0],p[1]-c[1]);return v+c[2]-p[2]-Math.sqrt(length*length-xy*xy);},0)/6;
const ds=dropMm/old.railDirections[0][2];
const config={...baseline.config,rodLengthMm:length,railReferenceHeightMm:old.railReferenceHeightMm-dropMm,railMinMm:old.railMinMm-ds,railMaxMm:old.railMaxMm-ds,frameHeightMm:old.frameHeightMm-dropMm};delete config.scale;
const g=geometry(config),source=fs.readFileSync('Prints/development/splitty-optimized/unscaled-40.sdgcode','utf8');
for(let i=0;i<6;i++)for(const [a,b]of [[old.railMinMm,g.railMinMm],[old.railMaxMm,g.railMaxMm]]){
 const p=railBodyPoint(old,i,a),q=railBodyPoint(g,i,b);
 if(Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]+dropMm)>1e-8)throw Error('Rail XY changed');
}
const all=[];let tcp=[0,0,20],abc=[0,0,0];
for(const [line,text]of source.split('\n').entries())if(/^G[01]\s/.test(text)){
 const w=Object.fromEntries([...text.matchAll(/([XYZABC])([+-]?[\d.]+)/g)].map(m=>[m[1],+m[2]]));tcp=tcp.map((v,i)=>w['XYZ'[i]]??v);abc=abc.map((v,i)=>w['ABC'[i]]??v);all.push({tcp,rotation:eulerRotation(abc),line:line+1});
}
const profiles=radialProfiles(JSON.parse(fs.readFileSync('Prints/development/wavy-vase-crossed-helices/plan.json')).geometry);
const path=JSON.parse(fs.readFileSync('Prints/development/split-delta-wavy-preview/path.saampath'));
const clad=path.actions.map((a,i)=>({...a,index:i})).filter(a=>a.kind==='move'&&a.phase?.startsWith('cladding')).map(a=>({tcp:a.to,action:a.index,tiltDeg:Math.min(40,Math.acos(Math.max(-1,Math.min(1,-a.pose.toolAxis[2])))*180/Math.PI),azimuthDeg:Math.atan2(-a.pose.toolAxis[1],-a.pose.toolAxis[0])*180/Math.PI}));
const picked=new Set([0,all.length-1]);for(let i=0;i<all.length;i+=Math.ceil(all.length/100))picked.add(i);
for(let k=0;k<3;k++)for(const sign of [-1,1]){let best=0;for(let i=1;i<all.length;i++)if(sign*all[i].tcp[k]>sign*all[best].tcp[k])best=i;picked.add(best);}
const kin=[...picked].map(i=>all[i]),cladCoarse=clad.filter((_,i)=>i%Math.ceil(clad.length/128)===0);
function quick(scale){
 const assessment=assessOperatingPath(kin,config,scale);if(!assessment.passed)return {passed:false,kind:'kinematics',worst:assessment.worst};
 for(let i=0;i<6;i++)if(rodHitsProfiles(railBodyPoint(g,i,g.railMinMm),railBodyPoint(g,i,g.railMaxMm),profiles,scale,{radiusMm:10}))return {passed:false,kind:'rail-part'};
 for(const p of kin){const s=inverse(g,{tcp:p.tcp.map(v=>v*scale),rotation:p.rotation},{diagnostics:false}),a=assemblyClearance(g,s);if(!a.passed)return {passed:false,kind:'assembly',worst:{...a.worst,line:p.line}};}
 const c=checkCladding(g,cladCoarse,profiles,scale);if(!c.passed)return {passed:false,kind:'cladding',worst:c.worst};
 return {passed:true,assessment};
}
const scan=[];for(let scale=.5;scale<=15;scale+=.5)scan.push({scale,...quick(scale)});
const good=scan.filter(x=>x.passed);if(!good.length){fs.writeFileSync(out+'/result.json',JSON.stringify({config,dropMm,scan},null,2));console.log(JSON.stringify({passed:false,dropMm,reason:'No scale passes the retained 1 mm clearance requirement',scan}));process.exit(0);}
let lo=good.at(-1).scale,hi=lo+.5;while(hi-lo>.005){const mid=(lo+hi)/2;if(quick(mid).passed)lo=mid;else hi=mid;}
let scale=Math.floor(lo*1000)/1000,winner=null;
console.log(JSON.stringify({rodLengthMm:length,dropMm,coarseScale:scale,upperFailure:quick(hi)}));
for(let attempt=0;attempt<15;attempt++){
 const cladding=checkCladding(g,clad,profiles,scale);if(!cladding.passed){console.log(JSON.stringify({scale,cladding:cladding.worst}));scale*=.98;continue;}
 const assessment=assessOperatingPath(kin,config,scale,{dense:true});if(!assessment.passed){console.log(JSON.stringify({scale,kinematics:assessment.worst}));scale*=.98;continue;}
 try{
  const code=scalePreviewSource(source,scale),preview=interpretSplitDelta(code,g,{maxSamples:500000});let gap=Infinity,worst=null,min=Infinity,max=-Infinity,builtTop=-Infinity,lastE=0,failure=null;
  for(const p of preview.samples){
   const s=inverse(g,{tcp:p.tcp,rotation:eulerRotation(p.abc)},{diagnostics:false}),a=assemblyClearance(g,s);
   if(!a.passed){failure={kind:'assembly',line:p.line,...a.worst};break;}
   if(a.minGapMm<gap){gap=a.minGapMm;worst={...a.worst,line:p.line};}
   for(const h of s.heights){min=Math.min(min,h);max=Math.max(max,h);}
   if(p.e>lastE+1e-9)builtTop=Math.max(builtTop,p.tcp[2]);lastE=p.e;
   if(Number.isFinite(builtTop))for(let i=0;i<6;i++)if(rodHitsProfiles(s.points[i],s.carriages[i],profiles,scale,{radiusMm:g.rodDiameterMm/2,topMm:builtTop})){failure={kind:'rod-part',line:p.line,rod:i};break;}
   if(failure)break;
  }
  if(failure){console.log(JSON.stringify({scale,failure}));scale*=.98;continue;}
  const deposition=[];for(let i=1;i<preview.samples.length;i++)if(preview.samples[i].e>preview.samples[i-1].e+1e-9)deposition.push(preview.samples[i-1],preview.samples[i]);
  assessment.railIntervalMm=[min,max];assessment.workingTravelMm=max-min;
  winner={config,scale,assessment,cladding,assembly:{passed:true,count:preview.samples.length,minGapMm:gap,worst},depositionBounds:pathBounds(deposition),allMotionBounds:pathBounds(preview.samples)};
  fs.writeFileSync(out+'/winner.sdgcode',code);break;
 }catch(e){console.log(JSON.stringify({scale,error:e.message}));scale*=.98;}
}
fs.writeFileSync(out+'/result.json',JSON.stringify({baseline:'../splitty-assembly-search/search.json',dropMm,dropBasis:'Half rods with rigid vertical rail translation; every rail XY point, inclination and rail length retained.',scan,coarseBracket:[lo,hi],winner},null,2));
console.log(JSON.stringify({winner,dropMm}));if(!winner)process.exitCode=2;
