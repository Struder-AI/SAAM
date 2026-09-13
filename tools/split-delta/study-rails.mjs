import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {geometry,orientation,matvec,DEFAULT_GEOMETRY} from '../../core/machine/split-delta.mjs';
import {interpretSplitDelta,eulerRotation,exportSplitDeltaPreview} from '../../core/export/split-delta-player.mjs';
import {reserveRotations,maxPathScale} from './optimize-path.mjs';

const out=resolve('Prints/development/splitty-optimized');await mkdir(out,{recursive:true});
const source=await readFile('Prints/development/split-delta-wavy-preview/preview.sdgcode','utf8'),path=JSON.parse(await readFile('Prints/development/split-delta-wavy-preview/path.saampath','utf8'));
let changed=0;
for(const target of [path,...path.actions]){
  const p=target===path?target.initialPose:target.pose;if(!p)continue;
  const tilt=Math.acos(Math.max(-1,Math.min(1,-p.toolAxis[2])))*180/Math.PI;if(tilt<=40)continue;
  const R=orientation(40,Math.atan2(-p.toolAxis[1],-p.toolAxis[0])*180/Math.PI,0);p.toolAxis=matvec(R,[0,0,-1]);p.toolUp=matvec(R,[0,1,0]);changed++;
}
const source40=exportSplitDeltaPreview(path);await writeFile(resolve(out,'unscaled-40.sdgcode'),source40);
const coarseStudy=JSON.parse(await readFile(resolve(out,'coarse.json'),'utf8'));
const shapes=[coarseStudy.candidates[0].config,{...DEFAULT_GEOMETRY,toolLengthMm:40,platformRadiusMm:25,platformPairMm:50},{...DEFAULT_GEOMETRY,toolLengthMm:40,platformRadiusMm:35,platformPairMm:40},DEFAULT_GEOMETRY];
const results=[];
for(const tilt of [45,40]){
  const p=interpretSplitDelta(tilt===45?source:source40,geometry({...DEFAULT_GEOMETRY,operatingTiltDeg:tilt}),{maxSamples:500000}),ids=new Set([0,p.samples.length-1]);
  for(let i=0;i<p.samples.length;i+=Math.ceil(p.samples.length/300))ids.add(i);
  for(const key of ['tcp','abc'])for(let k=0;k<3;k++)for(const sign of [-1,1]){let best=0;for(let i=1;i<p.samples.length;i++)if(sign*p.samples[i][key][k]>sign*p.samples[best][key][k])best=i;ids.add(best);}
  const poses=[...ids].sort((a,b)=>a-b).map(i=>({...p.samples[i],rotations:reserveRotations(eulerRotation(p.samples[i].abc),4,true)}));
  for(const shape of shapes)for(const railTiltDeg of [0,3,6,9,12,15]){
    const config={...shape,operatingTiltDeg:tilt,railTiltDeg},r=maxPathScale(poses,config);results.push({config,...r});
    console.log(JSON.stringify({tilt,railTiltDeg,plate:[shape.platformRadiusMm,shape.platformPairMm],tool:shape.toolLengthMm,scale:r.scale,limit:r.failure?.errors}));
  }
}
await writeFile(resolve(out,'rail-study.json'),JSON.stringify({changedPoseEndpointsAt40:changed,results:results.sort((a,b)=>b.scale-a.scale)},null,2));
