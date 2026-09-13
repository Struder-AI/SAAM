import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {geometry,orientation,matvec} from '../../core/machine/split-delta.mjs';
import {radialProfiles,checkCladding} from './cladding-clearance.mjs';
import {reserveRotations,assessPath,pathBounds,scalePreviewSource} from './optimize-path.mjs';
import {exportSplitDeltaPreview,interpretSplitDelta} from '../../core/export/split-delta-player.mjs';

const out='Prints/development/splitty-collision-optimized';await mkdir(out,{recursive:true});
const previous=JSON.parse(await readFile('Prints/development/splitty-inward-5/cladding-clearance.json','utf8')),path=JSON.parse(await readFile('Prints/development/split-delta-wavy-preview/path.saampath','utf8')),profiles=radialProfiles(JSON.parse(await readFile('Prints/development/wavy-vase-crossed-helices/plan.json','utf8')).geometry);
const all=path.actions.map((a,i)=>({...a,index:i})).filter(a=>a.kind==='move').map(a=>({tcp:a.to,action:a.index,cladding:a.phase?.startsWith('cladding'),tiltDeg:Math.min(40,Math.acos(Math.max(-1,Math.min(1,-a.pose.toolAxis[2])))*180/Math.PI),azimuthDeg:Math.atan2(-a.pose.toolAxis[1],-a.pose.toolAxis[0])*180/Math.PI}));
const records=[];
for(const policy of ['existing','radial40']){
 const motions=all.map(p=>policy==='radial40'&&p.cladding?{...p,tiltDeg:40,azimuthDeg:Math.atan2(p.tcp[1],p.tcp[0])*180/Math.PI}:p),cladding=motions.filter(p=>p.cladding),coarse=cladding.filter((p,i)=>i%Math.ceil(cladding.length/96)===0||i===cladding.length-1);
 const ids=new Set([0,motions.length-1]);for(let i=0;i<motions.length;i+=Math.ceil(motions.length/24))ids.add(i);
 for(let k=0;k<3;k++)for(const sign of [-1,1]){let best=0;for(let i=1;i<motions.length;i++)if(sign*motions[i].tcp[k]>sign*motions[best].tcp[k])best=i;ids.add(best);}
 const kin=[...ids].map(i=>({tcp:motions[i].tcp,line:motions[i].action,rotations:reserveRotations(orientation(motions[i].tiltDeg,motions[i].azimuthDeg),4)}));
 let best=null;
 for(const r of [10,14,18,22,26,30,34])for(const pair of [20,26,32,38,44,50,56,62,68,74,80,86]){
  const radius=Math.hypot(r,pair/2),a=Math.atan2(pair/2,r);if(a>=Math.PI/3||2*radius*Math.sin(Math.PI/3-a)<15)continue;
  const config={...previous.config,platformRadiusMm:r,platformPairMm:pair},g=geometry(config);
  const passes=s=>checkCladding(g,coarse,profiles,s).passed&&assessPath(kin,config,s).passed;
  let lo=.25,hi=10;if(!passes(lo))continue;
  while(hi-lo>.03){const mid=(lo+hi)/2;if(passes(mid))lo=mid;else hi=mid;}
  const record={policy,config,scale:Math.floor(lo*100)/100,pivotDiameterMm:2*radius,bracket:[lo,hi]};records.push(record);if(!best||record.scale>best.scale)best=record;
 }
 if(!best)throw Error('No candidate passed');
 const g=geometry(best.config);let full=checkCladding(g,cladding,profiles,best.scale,{stopEarly:false});
 while(!full.passed&&best.scale>.25){best.scale=Math.round((best.scale-.05)*100)/100;full=checkCladding(g,cladding,profiles,best.scale,{stopEarly:true});}
 const adjusted=structuredClone(path);for(const p of motions){const R=orientation(p.tiltDeg,p.azimuthDeg),a=adjusted.actions[p.action];a.to=p.tcp.map(v=>v*best.scale);a.pose={rotaryDeg:0,toolAxis:matvec(R,[0,0,-1]),toolUp:matvec(R,[0,1,0])};}adjusted.initialPosition=adjusted.initialPosition.map(v=>v*best.scale);
 const code=exportSplitDeltaPreview(adjusted),preview=interpretSplitDelta(code,g,{maxSamples:500000}),assessment=assessPath(kin,best.config,best.scale,{stopEarly:false});
 const deposit=[];for(let i=1;i<preview.samples.length;i++)if(preview.samples[i].e>preview.samples[i-1].e+1e-9)deposit.push(preview.samples[i-1],preview.samples[i]);
 best.result={full,assessment,depositionBounds:pathBounds(deposit),allMotionBounds:pathBounds(preview.samples)};
 await writeFile(`${out}/${policy}.sdgcode`,code);await writeFile(`${out}/${policy}.json`,JSON.stringify(best,null,2));console.log(JSON.stringify(best));
}
await writeFile(out+'/search.json',JSON.stringify({varied:'plate pair-center radius 10..34 step4; pair spacing20..86 step6; existing or radial40 approach; uniform scale',fixed:previous.config,minimumAdjacentPivotMm:15,records},null,2));
