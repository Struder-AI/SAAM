import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {geometry,DEFAULT_GEOMETRY} from '../../core/machine/split-delta.mjs';
import {interpretSplitDelta,eulerRotation} from '../../core/export/split-delta-player.mjs';
import {reserveRotations,maxPathScale,assessPath,pathBounds,scalePreviewSource} from './optimize-path.mjs';
const out=resolve('Prints/development/splitty-optimized'),read=name=>readFile(resolve(out,name),'utf8');
const codes={45:await readFile('Prints/development/split-delta-wavy-preview/preview.sdgcode','utf8'),40:await read('unscaled-40.sdgcode')},results=[];
const makePose=(s,dense=true)=>({tcp:s.tcp,line:s.line,get rotations(){return reserveRotations(eulerRotation(s.abc),4,dense);}});
for(const tilt of [45,40]){
  const program=interpretSplitDelta(codes[tilt],geometry({...DEFAULT_GEOMETRY,operatingTiltDeg:tilt}),{maxSamples:500000}),samples=program.samples;
  const coarse=samples.filter((s,i)=>i%400===0||i===samples.length-1).map(s=>makePose(s,false));
  let best=null;
  // Refine near the compact grid leader, including more pair separation while
  // keeping a <=110 mm pivot envelope and >=15 mm adjacent pivot-center gap.
  for(const r of [25,28,30,32,34,36,38,40])for(const p of [50,60,70,74,78,82,86]){
    const radius=Math.hypot(r,p/2),a=Math.atan2(p/2,r);if(radius>55||a>=Math.PI/3||2*radius*Math.sin(Math.PI/3-a)<15)continue;
    const theta=(tilt+4)*Math.PI/180,toolLengthMm=Math.max(40,Math.ceil(3+(radius+5)*Math.tan(theta)+2/Math.cos(theta)));
    const config={...DEFAULT_GEOMETRY,operatingTiltDeg:tilt,platformRadiusMm:r,platformPairMm:p,toolLengthMm,checkPlateBedClearance:true};
    const found=maxPathScale(coarse,config);
    if(!best||found.scale>best.scale+.01||Math.abs(found.scale-best.scale)<=.01&&radius<best.radius)best={config,...found,radius};
  }
  console.log(JSON.stringify({phase:'refined',tilt,best}));
  const configurations=[{name:'compact',config:best.config}];
  for(const {name,config} of configurations){
    const poses=samples.map(s=>makePose(s)),witnesses=[...coarse];let bracket=maxPathScale(witnesses,config),full,scale;
    for(let attempt=0;attempt<20;attempt++){
      scale=Math.floor(bracket.scale*100)/100;full=assessPath(poses,config,scale);
      if(full.passed)break;
      const witness=poses.find(p=>p.line===full.worst.line&&p.tcp.every((v,k)=>Math.abs(v*scale-full.worst.tcp[k])<1e-6));
      if(!witness)throw Error('Cannot resolve failing full-path sample');witnesses.push(witness);bracket=maxPathScale(witnesses,config);
      console.log(JSON.stringify({phase:'witness refinement',name,tilt,scale,worst:full.worst}));
    }
    if(!full?.passed)throw Error('Full path did not converge');
    const scaledCode=scalePreviewSource(codes[tilt],scale),scaled=interpretSplitDelta(scaledCode,geometry(config),{maxSamples:500000,maxStepMm:1,maxStepDeg:.5});
    // Larger XYZ steps can create new interpolation locations. Check those with
    // the same reserve sphere, not just the original unscaled sampling grid.
    const resampled=scaled.samples.map(s=>({...s,tcp:s.tcp.map(v=>v/scale)}));
    const verified=assessPath(resampled.map(s=>makePose(s)),config,scale);if(!verified.passed)throw Error(JSON.stringify({name,tilt,scale,scaledFailure:verified.worst}));
    const deposited=[];for(let i=1;i<samples.length;i++)if(samples[i].e>samples[i-1].e+1e-9)deposited.push(samples[i-1],samples[i]);
    const r={name,config,scale,bracket:bracket.bracket,limitingProbe:bracket.failure,assessment:verified,pivotDiameterMm:2*Math.hypot(config.platformRadiusMm,config.platformPairMm/2),allMotionBounds:pathBounds(samples,scale),depositionBounds:pathBounds(deposited,scale),previewSamples:scaled.samples.length,sourceSha256:createHash('sha256').update(codes[tilt]).digest('hex'),scaledSha256:createHash('sha256').update(scaledCode).digest('hex'),upperRailDiameterMm:2*Math.hypot(180+config.railMaxMm*Math.sin(config.railTiltDeg*Math.PI/180),25)};
    results.push(r);await writeFile(resolve(out,`${name}-${tilt}.sdgcode`),scaledCode);await writeFile(resolve(out,'validated-results.json'),JSON.stringify({results},null,2));console.log(JSON.stringify({phase:'validated',...r}));
  }
}
