// Bounded, reproducible physical-dimension search. Toolpath orientations and order
// are fixed; the only program transformation is uniform absolute XYZ scaling.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {geometry,orientation,carriagePoint,norm,sub,inverse,pairedEdgeLayout} from '../../core/machine/split-delta.mjs';
import {radialProfiles,checkCladding,rodHitsProfiles} from './cladding-clearance.mjs';
import {assessOperatingPath,reserveRotations,scalePreviewSource,pathBounds} from './optimize-path.mjs';
import {assemblyClearance,segmentDistance,CLEARANCE,railBodyPoint} from './assembly-clearance.mjs';
import {interpretSplitDelta,eulerRotation} from '../../core/export/split-delta-player.mjs';
const fixedRod=process.env.SPLITTY_ROD_LENGTH?Number(process.env.SPLITTY_ROD_LENGTH):null;
if(fixedRod!==null&&(!Number.isFinite(fixedRod)||fixedRod<=0))throw Error('Invalid fixed rod length');
const out=fixedRod?'Prints/development/splitty-fixed-'+fixedRod+'-rods':'Prints/development/splitty-assembly-search';await mkdir(out,{recursive:true});
const original=JSON.parse(await readFile('Prints/development/splitty-inward-5/cladding-clearance.json','utf8')),path=JSON.parse(await readFile('Prints/development/split-delta-wavy-preview/path.saampath','utf8')),source=await readFile('Prints/development/splitty-optimized/unscaled-40.sdgcode','utf8'),profiles=radialProfiles(JSON.parse(await readFile('Prints/development/wavy-vase-crossed-helices/plan.json','utf8')).geometry);
export const bounds={towerRadiusMm:[40,400],frameHeightMm:[300,1400],railSeparationMm:[20,180],railTiltDeg:[-15,15],railToeDeg:[-20,20],rodLengthMm:[150,900],rodDiameterMm:[4,12],toolLengthMm:[40,250],platformRadiusMm:[10,85],platformPairMm:[16,140],platformClockDeg:[-60,60],platformPairSkewDeg:[-40,40],plateThicknessMm:[3,10],plateRimMm:[3,10],scale:[.1,15]};
if(fixedRod){bounds.rodLengthMm=[fixedRod,fixedRod];bounds.towerRadiusMm=[20,400];bounds.frameHeightMm=[150,1400];}
const adapted=path.actions.map((a,i)=>({...a,index:i})).filter(a=>a.kind==='move').map(a=>({tcp:a.to,action:a.index,cladding:a.phase?.startsWith('cladding'),tiltDeg:Math.min(40,Math.acos(Math.max(-1,Math.min(1,-a.pose.toolAxis[2])))*180/Math.PI),azimuthDeg:Math.atan2(-a.pose.toolAxis[1],-a.pose.toolAxis[0])*180/Math.PI}));
// Read exact exported orientations; retain every source move including travel.
const all=[];let tcp=[0,0,20],abc=[0,0,0];
for(const [line,text] of source.split('\n').entries())if(/^G[01]\s/.test(text)){
 const w=Object.fromEntries([...text.matchAll(/([XYZABC])([+-]?[\d.]+)/g)].map(m=>[m[1],Number(m[2])]));
 tcp=tcp.map((v,i)=>w['XYZ'[i]]??v);abc=abc.map((v,i)=>w['ABC'[i]]??v);
 all.push({tcp,abc,rotation:eulerRotation(abc),line:line+1});
}
const clad=adapted.filter(p=>p.cladding),coarse=clad.filter((p,i)=>i%Math.ceil(clad.length/64)===0||i===clad.length-1);
const ids=new Set([0,all.length-1]);for(let i=0;i<all.length;i+=Math.ceil(all.length/64))ids.add(i);
for(let k=0;k<3;k++)for(const sign of [-1,1]){let best=0;for(let i=1;i<all.length;i++)if(sign*all[i].tcp[k]>sign*all[best].tcp[k])best=i;ids.add(best);}
try{for(const i of JSON.parse(await readFile(out+'/witnesses.json','utf8')))ids.add(i);}catch{}
const kin=[...ids].map(i=>all[i]);
function checkAssembly(poses,g,scale){
 let minGapMm=Infinity,worst=null,count=0;
 for(const [index,p]of poses.entries())for(const rotation of [p.rotation]){
  const state=inverse(g,{tcp:p.tcp.map(v=>v*scale),rotation},{diagnostics:false});
  if(state.carriages.length!==6)return {passed:false,index,line:p.line,reason:'unreachable',count};
  const r=assemblyClearance(g,state);count++;
  if(r.minGapMm<minGapMm){minGapMm=r.minGapMm;worst={...r.worst,line:p.line};}
  if(!r.passed)return {passed:false,index,line:p.line,minGapMm,worst,count};
 }
 return {passed:true,minGapMm,worst,count};
}
function configFor(v){const dz=Math.cos(v.railTiltDeg*Math.PI/180)*Math.cos(v.railToeDeg*Math.PI/360);return {...original.config,...v,operatingTiltDeg:40,railMountOffsetMm:25,railReferenceHeightMm:v.frameHeightMm/2,railMinMm:0,railMaxMm:v.frameHeightMm/dz};}
const rejects={};function reject(reason){rejects[reason]=(rejects[reason]??0)+1;return null;}
function rate(v){try{
 if(fixedRod)v={...v,rodLengthMm:fixedRod};
 const config=configFor(v),g=geometry(config);
 if(!pairedEdgeLayout(g).passed)return reject('paired-edge layout');
 // Fixed joint packaging assumption; reject merged anchors and crossed rails.
 for(let i=0;i<6;i++)for(let j=0;j<i;j++)if(norm(sub(g.anchors[i],g.anchors[j]))<15)return reject('constraint1');
 const w0=v.railSeparationMm-v.frameHeightMm*Math.tan(v.railToeDeg*Math.PI/360)/Math.cos(v.railTiltDeg*Math.PI/180),w1=2*v.railSeparationMm-w0;if(Math.min(w0,w1)<20)return reject('constraint2');
 for(let i=0;i<6;i++)for(let j=0;j<i;j++){
  const a=sub(g.rails[i],g.rails[j]),di=g.railDirections[i],dj=g.railDirections[j],d=[di[0]/di[2]-dj[0]/dj[2],di[1]/di[2]-dj[1]/dj[2]],dd=d[0]**2+d[1]**2,z=dd?Math.max(0,Math.min(v.frameHeightMm,-(a[0]*d[0]+a[1]*d[1])/dd)):0;
  if(segmentDistance(railBodyPoint(g,i,0),railBodyPoint(g,i,g.railMaxMm),railBodyPoint(g,j,0),railBodyPoint(g,j,g.railMaxMm))<21)return reject('constraint3');
 }
 // Frame geometry is now free: its rails must also stay outside the part.
 // 20 mm rail-body envelope is a fixed packaging assumption, not a joint variable.
 for(let i=0;i<6;i++)if(rodHitsProfiles(railBodyPoint(g,i,0),railBodyPoint(g,i,g.railMaxMm),profiles,v.scale,{radiusMm:10}))return reject('constraint4');
 const assembly=checkAssembly(kin,g,v.scale);if(!assembly.passed){return reject('constraint5');}
 if(!checkCladding(g,coarse,profiles,v.scale).passed)return reject('constraint6');
 const assessment=assessOperatingPath(kin,config,v.scale);if(!assessment.passed){return reject('constraint7');}
 const diameter=s=>2*Math.max(...g.rails.map((_,i)=>Math.hypot(...railBodyPoint(g,i,s).slice(0,2))));
 // Include the bed needed to support this part; do not reward an undersized bed.
 const baseDiameterMm=Math.max(diameter(0)+20,24.6*v.scale+10),topDiameterMm=diameter(g.railMaxMm)+20,averageDiameterMm=(baseDiameterMm+topDiameterMm)/2;
 const score=fixedRod?v.scale:(24.399867887378893*v.scale)**2*(30*v.scale)/(averageDiameterMm**2*v.frameHeightMm);
 return {v,config,score,baseDiameterMm,topDiameterMm,averageDiameterMm,assessment};
 }catch(error){return reject(error.message+' constraint8');}}
let seed=19373;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const keys=Object.keys(bounds).filter(k=>!fixedRod||k!=='rodLengthMm'),elite=[];
function keep(r){if(!r)return;elite.unshift(r);elite.sort((a,b)=>b.score-a.score);if(elite.length>18)elite.length=18;}
const initial={...original.config,towerRadiusMm:(258.7397971733316+180)/2,frameHeightMm:900,railToeDeg:0,platformClockDeg:0,platformPairSkewDeg:0,rodDiameterMm:6,plateThicknessMm:6,plateRimMm:5,scale:2.52};keep(rate(initial));
try{const prior=JSON.parse(await readFile(out+'/progress.json','utf8'));for(const r of prior.elite)keep(rate(r.v));}catch{}
for(const tool of [100,150,200])for(const rod of [250,350,450])keep(rate({...initial,towerRadiusMm:180,frameHeightMm:800,railTiltDeg:0,rodLengthMm:rod,toolLengthMm:tool,platformRadiusMm:22,platformPairMm:38,scale:tool/30}));
for(const radius of [220,280,340])for(const rod of [300,380,460])for(const tool of [80,130])keep(rate({...initial,towerRadiusMm:radius,railSeparationMm:100,frameHeightMm:800,railTiltDeg:0,rodLengthMm:rod,toolLengthMm:tool,platformRadiusMm:45,platformPairMm:65,scale:1}));
for(const radius of [200,240,280])for(const rod of [300,350,400])for(const tool of [70,100])for(const pr of [25,40])for(const pp of [60,90])keep(rate({...initial,towerRadiusMm:radius,railSeparationMm:100,frameHeightMm:800,railTiltDeg:0,rodLengthMm:rod,toolLengthMm:tool,platformRadiusMm:pr,platformPairMm:pp,scale:1}));
if(fixedRod)for(const radius of [50,80,110])for(const width of [60,100])for(const tool of [50,80])for(const pr of [20,30])for(const pp of [20,35])keep(rate({...initial,towerRadiusMm:radius,railSeparationMm:width,frameHeightMm:300,railTiltDeg:0,rodLengthMm:fixedRod,toolLengthMm:tool,platformRadiusMm:pr,platformPairMm:pp,scale:.5}));
const started=Date.now(),iterations=Number(process.env.SPLITTY_ITERATIONS??1800);let evaluated=0;
for(let i=0;i<iterations;i++){
 let v;if(i<120||!elite.length){v={...initial};for(const key of keys){const [lo,hi]=bounds[key];v[key]=lo+(hi-lo)*rand();}}
 else{v={...elite[Math.floor(rand()*Math.min(elite.length,8))].v};for(let n=0;n<1+Math.floor(rand()*5);n++){const key=keys[Math.floor(rand()*keys.length)],[lo,hi]=bounds[key],fraction=i<500?.20:.07;v[key]=Math.max(lo,Math.min(hi,v[key]+(rand()*2-1)*(hi-lo)*fraction));}}
 keep(rate(v));evaluated++;if((i+1)%300===0){console.log(JSON.stringify({evaluated,bestScore:elite[0]?.score,seconds:(Date.now()-started)/1000}));await writeFile(out+'/progress.json',JSON.stringify({evaluated,bounds,elite:elite.slice(0,5)},null,2));}
}
// Finalists must clear all nominal source endpoints. Angular probes
// check kinematic boundaries only, without applying a second margin. Failed poses become search witnesses on the next run.
let winner=null;const witnesses=new Set([...ids]);
const finalists=elite.slice(0,1).flatMap(r=>[1,.97,.94,.90,.85,.8,.7,.6].map(f=>rate({...r.v,scale:r.v.scale*f})).filter(Boolean)).sort((a,b)=>b.score-a.score);
for(const r of finalists){
 console.log(JSON.stringify({phase:'finalist',scale:r.v.scale,score:r.score}));
 const g=geometry(r.config);
 r.fullCladding=checkCladding(g,clad,profiles,r.v.scale,{stopEarly:true});
 if(!r.fullCladding.passed){console.log('cladding failed');continue;}
 r.fullAssembly=checkAssembly(all,g,r.v.scale);
 if(!r.fullAssembly.passed){console.log(JSON.stringify(r.fullAssembly));witnesses.add(r.fullAssembly.index);continue;}
 r.assessment=assessOperatingPath(kin,r.config,r.v.scale,{dense:true});
 if(!r.assessment.passed){console.log(JSON.stringify(r.assessment.worst));continue;}
 try{
  const code=scalePreviewSource(source,r.v.scale),preview=interpretSplitDelta(code,g,{maxSamples:500000});
  const samplePoses=preview.samples.map(p=>({...p,rotation:eulerRotation(p.abc)}));
  r.interpolatedAssembly=checkAssembly(samplePoses,g,1);
  if(!r.interpolatedAssembly.passed){console.log(JSON.stringify(r.interpolatedAssembly));continue;}
  // Rod/part clearance also covers all interpolated travel, against material deposited up to that sample. Cladding retains the full built height.
  let partFailure=null,builtTopMm=-Infinity,lastE=0;
  for(const p of samplePoses){if(p.e>lastE+1e-9)builtTopMm=Math.max(builtTopMm,p.tcp[2]);lastE=p.e;if(!Number.isFinite(builtTopMm))continue;const state=inverse(g,{tcp:p.tcp,rotation:p.rotation},{diagnostics:false});for(let i=0;i<6;i++)if(rodHitsProfiles(state.points[i],state.carriages[i],profiles,r.v.scale,{radiusMm:g.rodDiameterMm/2,topMm:builtTopMm})){partFailure={line:p.line,rod:i};break;}if(partFailure)break;}
  r.interpolatedRodPart={passed:!partFailure,worst:partFailure,count:samplePoses.length};
  if(partFailure){console.log(JSON.stringify(partFailure));continue;}
  const deposition=[];for(let i=1;i<preview.samples.length;i++)if(preview.samples[i].e>preview.samples[i-1].e+1e-9)deposition.push(preview.samples[i-1],preview.samples[i]);
  r.depositionBounds=pathBounds(deposition);r.allMotionBounds=pathBounds(preview.samples);
  const hs=preview.samples.flatMap(p=>p.heights);r.assessment.railIntervalMm=[hs.reduce((a,b)=>Math.min(a,b),Infinity),hs.reduce((a,b)=>Math.max(a,b),-Infinity)];r.assessment.workingTravelMm=r.assessment.railIntervalMm[1]-r.assessment.railIntervalMm[0];
  winner=r;await writeFile(out+'/winner.sdgcode',code);break;
 }catch(e){r.interpreterError=e.message;console.log(e.message);}
}
await writeFile(out+'/witnesses.json',JSON.stringify([...witnesses]));
await writeFile(out+'/search.json',JSON.stringify({bounds,iterations:evaluated,objective:fixedRod?'Maximize uniform part scale with rod length fixed at '+fixedRod+' mm':'Part enclosing-cylinder volume / average base-top rail-envelope cylinder volume',fixed:'Existing 40-degree-adapted source; uniform XYZ scale only; 4-degree reserve fixed',clearance:CLEARANCE,assumptions:'Full rail length checked. Rod/rod, rod/rail, rod/bed, rail/rail, rail/part and rod/part checked; plate/part retained at cladding endpoints. Spherical pivots have a fixed25 mm inward mounting offset from the rail body centerline; full rods are checked, including against their own rail. Mount brackets themselves are not modeled. No nozzle, plate/rail, carriage housings, joint bodies, frame beams or drives. Thickness bounds are geometric assumptions, not structural ratings. Sampled evidence, not continuous certification.',winner,elite,finalists},null,2));
console.log(JSON.stringify({rejects,winner,seconds:(Date.now()-started)/1000}));
if(!winner)process.exitCode=2;
