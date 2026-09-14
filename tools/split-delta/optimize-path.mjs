// Path-specific design study. Every comparison keeps the original rail XY and
// rod length. Numerical samples are evidence, not a continuous collision proof.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {geometry,inverse,rotationVector,matvec,RAD,DEFAULT_GEOMETRY,plateEnvelopeMinimumZ} from '../../core/machine/split-delta.mjs';
import {interpretSplitDelta,eulerRotation} from '../../core/export/split-delta-player.mjs';

export function scalePreviewSource(source,scale){
  if(!Number.isFinite(scale)||scale<=0)throw Error('Positive uniform scale required');
  // This dialect is absolute XYZ. Preserve all orientation, extrusion and timing
  // words verbatim; this is a geometry-fit preview, not a resliced print program.
  return '; Uniform XYZ scale '+scale+'; original ABC/E/F retained; GEOMETRY STUDY ONLY\n'+source.split('\n').map(line=>{
    const at=line.indexOf(';'),code=at<0?line:line.slice(0,at),comment=at<0?'':line.slice(at);
    return code.replace(/([XYZ])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g,(_,k,v)=>k+(Number(v)*scale).toFixed(6))+comment;
  }).join('\n');
}
const multiply=(a,b)=>a.map(row=>[0,1,2].map(j=>row.reduce((s,v,i)=>s+v*b[i][j],0)));
export function reserveRotations(rotation,marginDeg=4,dense=false){
  const result=[rotation];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    const n=Math.hypot(x,y,z);if(!n||(!dense&&n!==1))continue;
    result.push(multiply(rotation,rotationVector([x,y,z].map(v=>v/n*marginDeg*RAD))));
  }
  return result;
}
export function pathBounds(samples,scale=1){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let radius=0;
  for(const s of samples){for(let k=0;k<3;k++){min[k]=Math.min(min[k],s.tcp[k]*scale);max[k]=Math.max(max[k],s.tcp[k]*scale);}radius=Math.max(radius,Math.hypot(s.tcp[0],s.tcp[1])*scale);}
  return {min,max,sizeMm:max.map((v,k)=>v-min[k]),centeredDiameterMm:2*radius};
}
export function assessPath(poses,config,scale,{stopEarly=true}={}){
  const g=geometry(config),branch=Math.sign(inverse(g,{tcp:[0,0,20]}).determinant);
  let count=0,minHeight=Infinity,maxHeight=-Infinity,minRatio=1,maxJoint=0,minElevation=90,minPlateZ=Infinity,worst=null;
  for(const p of poses)for(const rotation of p.rotations){
    const s=inverse(g,{tcp:p.tcp.map(v=>v*scale),rotation});count++;
    const errors=[...s.errors];if(Math.sign(s.determinant)!==branch)errors.push('Assembly branch changed');
    // Conservative solid plate envelope: 5 mm rim outside the pivot hull and
    // 3 mm half-thickness, with 2 mm clearance over an infinite bed plane.
    // This does not replace hotend/part, socket, rod or frame collision checking.
    const plateZ=plateEnvelopeMinimumZ(s.points,rotation,g);
    minPlateZ=Math.min(minPlateZ,plateZ);
    if(errors.length){worst??={line:p.line,tcp:s.tcp,errors};if(stopEarly)return {passed:false,count,worst};}
    if(s.heights.length===6){minHeight=Math.min(minHeight,...s.heights);maxHeight=Math.max(maxHeight,...s.heights);minRatio=Math.min(minRatio,s.singularRatio);maxJoint=Math.max(maxJoint,s.maxJointDeflectionDeg);minElevation=Math.min(minElevation,s.minRodElevationDeg);}
  }
  return {passed:!worst,count,worst,scale,railIntervalMm:[minHeight,maxHeight],workingTravelMm:maxHeight-minHeight,minSingularRatio:minRatio,maxJointDeflectionDeg:maxJoint,requiredJointConeDeg:maxJoint+g.marginDeg,minRodElevationDeg:minElevation,minPlateEnvelopeZMm:minPlateZ};
}
// Printing poses retain their exact commanded tilt. The existing analytical
// rod/joint angular margins apply once, at those operating poses. Additional
// orientation probes test raw kinematic boundaries, without another margin,
// bed/collision checks or track-end checks. Track travel comes from operation.
export function assessOperatingPath(poses,config,scale,{dense=false}={}){
  const operating=assessPath(poses.map(p=>({...p,rotations:[p.rotation]})),config,scale);
  if(!operating.passed)return operating;
  const probeGeometry=geometry({...config,marginDeg:0,checkPlateBedClearance:false});
  let probes=0;
  for(const p of poses){
    const tcp=p.tcp.map(v=>v*scale),nominal=inverse(probeGeometry,{tcp,rotation:p.rotation},{ignoreTrack:true});
    for(const rotation of reserveRotations(p.rotation,config.marginDeg??4,dense).slice(1)){
      const state=inverse(probeGeometry,{tcp,rotation},{ignoreTrack:true});probes++;
      if(!state.valid||Math.sign(state.determinant)!==Math.sign(nominal.determinant))return {...operating,passed:false,worst:{line:p.line,errors:state.errors.length?state.errors:['Assembly branch inside angular margin']},angularProbeCount:probes};
    }
  }
  return {...operating,angularProbeCount:probes,marginBasis:'4-degree rod/joint margins at operating poses; sampled orientation probes against raw kinematic boundaries, without a second angular margin. No collision-free operation beyond commanded tilt is required.'};
}
export function maxPathScale(poses,config,{low=1,high=20,tolerance=.01}={}){
  if(!assessPath(poses,config,low).passed)return {scale:0,bracket:[0,low],failure:assessPath(poses,config,low).worst};
  if(assessPath(poses,config,high).passed)return {scale:high,bracket:[high,high],capped:true};
  while(high-low>tolerance){const mid=(low+high)/2;if(assessPath(poses,config,mid).passed)low=mid;else high=mid;}
  return {scale:low,bracket:[low,high],failure:assessPath(poses,config,high).worst};
}
const sha=s=>createHash('sha256').update(s).digest('hex');
async function main(){
  const sourceFile=resolve(process.argv[2]??'Prints/development/split-delta-wavy-preview/preview.sdgcode'),out=resolve(process.argv[3]??'Prints/development/splitty-optimized');await mkdir(out,{recursive:true});
  const source=await readFile(sourceFile,'utf8'),program=interpretSplitDelta(source,geometry(),{maxSamples:500000}),samples=program.samples;
  // Include every orientation/TCP extreme plus evenly distributed poses. Finalists
  // are subsequently tested on every source sample, then the scaled interpreter.
  const picked=new Set([0,samples.length-1]);for(let i=0;i<samples.length;i+=Math.ceil(samples.length/240))picked.add(i);
  for(const key of ['tcp','abc'])for(let k=0;k<3;k++)for(const sign of [-1,1]){let best=0;for(let i=1;i<samples.length;i++)if(sign*samples[i][key][k]>sign*samples[best][key][k])best=i;picked.add(best);}
  const pose=(s,dense=false)=>({tcp:s.tcp,line:s.line,rotations:reserveRotations(eulerRotation(s.abc),4,dense)});
  const coarse=[...picked].sort((a,b)=>a-b).map(i=>pose(samples[i]));const candidates=[];
  for(const toolLengthMm of [40,60,80])for(const platformRadiusMm of [20,25,30,35,40,45])for(const platformPairMm of [20,30,40,50,60,70]){
    // Keep each tower's two pivots on its own near edge, without interleaving
    // another tower's pivots. Allow 15 mm minimum between adjacent pivot centers.
    const pr=Math.hypot(platformRadiusMm,platformPairMm/2),a=Math.atan2(platformPairMm/2,platformRadiusMm);
    if(a>=Math.PI/3||2*pr*Math.sin(Math.PI/3-a)<15||pr>55)continue;
    const config={...DEFAULT_GEOMETRY,toolLengthMm,platformRadiusMm,platformPairMm};
    const result=maxPathScale(coarse,config);candidates.push({config,...result,pivotDiameterMm:2*Math.hypot(platformRadiusMm,platformPairMm/2)});
  }
  candidates.sort((a,b)=>b.scale-a.scale||a.pivotDiameterMm-b.pivotDiameterMm);
  const original={config:DEFAULT_GEOMETRY,...maxPathScale(coarse,DEFAULT_GEOMETRY)};
  await writeFile(resolve(out,'coarse.json'),JSON.stringify({sourceFile,sourceSha256:sha(source),coarsePoses:coarse.length,candidates,original},null,2));
  console.log(JSON.stringify({phase:'coarse',original,top:candidates.slice(0,8)}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
