// Adapt an existing interpreted DENSO program into a stationary-bed simulation.
// This intentionally changes tool spin and over-limit inclination; preserve that
// provenance rather than presenting this as the original robot machine program.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {interpretDenso} from '../../core/export/denso.mjs';
import {loadMachine} from '../../core/machine/profile.mjs';
import {geometry,orientation,matvec,norm,sub} from '../../core/machine/split-delta.mjs';
import {exportSplitDeltaPreview,interpretSplitDelta} from '../../core/export/split-delta-player.mjs';

export function adaptDensoMotion(program,{tiltCapDeg=45}={}){
  if(!Number.isFinite(tiltCapDeg)||tiltCapDeg<0||tiltCapDeg>45||!program.moves?.length)throw Error('Invalid adaptation input');
  let changed=0,maxSourceTiltDeg=0;
  const poseFor=axis=>{
    const tilt=Math.acos(Math.max(-1,Math.min(1,-axis[2])))*180/Math.PI,azimuth=Math.atan2(-axis[1],-axis[0])*180/Math.PI;
    maxSourceTiltDeg=Math.max(maxSourceTiltDeg,tilt);if(tilt>tiltCapDeg+1e-6)changed++;
    const R=orientation(Math.min(tilt,tiltCapDeg),azimuth,0);
    return {rotaryDeg:0,toolAxis:matvec(R,[0,0,-1]),toolUp:matvec(R,[0,1,0])};
  };
  const first=program.moves[0],path={schema:'saampath/1',initialPosition:first.from,initialPose:poseFor(first.toolAxisFrom),actions:[]};
  let previous=first.from,time=0;
  for(const m of program.moves){
    if(norm(sub(previous,m.from))>1e-5)throw Error('DENSO part-relative moves are discontinuous');
    if(m.startSeconds>time+1e-7)path.actions.push({kind:'dwell',seconds:m.startSeconds-time});
    path.actions.push({kind:'move',to:m.to,pose:poseFor(m.toolAxisTo),speedMmS:m.speedMmS,durationSeconds:m.durationSeconds,volumeMm3:m.commandedVolumeMm3,phase:m.phase,layer:m.layer,operation:m.operation});
    previous=m.to;time=m.startSeconds+m.durationSeconds;
  }
  if(program.seconds>time+1e-7)path.actions.push({kind:'dwell',seconds:program.seconds-time});
  return {path,adaptation:{policy:'stationary bed; original interpreted part-relative TCP and commanded volume; preserve requested durations; spin=0 minimal-tilt frame; explicitly cap nozzle inclination',tiltCapDeg,changedTiltEndpoints:changed,maxSourceTiltDeg,sourceRotaryRemoved:true,hardwareExecutable:false,processValidation:'Orientation change alters the deposition approach; collision, bead placement and physical printing remain unvalidated'}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [sourceDirectory,outputDirectory]=process.argv.slice(2);if(!sourceDirectory||!outputDirectory)throw Error('Usage: node tools/split-delta/import-denso.mjs source-bundle output-preview-directory');
  const plan=JSON.parse(await readFile(join(sourceDirectory,'plan.json'),'utf8')),machine=JSON.parse(await readFile(join(sourceDirectory,'machine.json'),'utf8')),bytes=await readFile(join(sourceDirectory,'exports/denso-pacscript/part.zip'));
  const source=interpretDenso(bytes,plan,machine),{path,adaptation}=adaptDensoMotion(source),target=loadMachine('split-delta'),code=exportSplitDeltaPreview(path),preview=interpretSplitDelta(code,geometry(target.kinematicModel),{maxSamples:500000});
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let hMin=Infinity,hMax=-Infinity;
  for(const s of preview.samples){for(let i=0;i<3;i++){min[i]=Math.min(min[i],s.tcp[i]);max[i]=Math.max(max[i],s.tcp[i]);}hMin=Math.min(hMin,...s.heights);hMax=Math.max(hMax,...s.heights);}
  const report={schema:'saam-split-delta-adaptation/1',sourceDirectory:resolve(sourceDirectory),sourceSha256:createHash('sha256').update(bytes).digest('hex'),...adaptation,sourceSummary:source.summary,preview:{samples:preview.samples.length,seconds:preview.seconds,tcpBounds:{min,max},carriageRangeMm:[hMin,hMax],sourceCodeSha256:createHash('sha256').update(code).digest('hex'),coverage:preview.coverage},machine:target};
  await mkdir(outputDirectory,{recursive:true});await writeFile(join(outputDirectory,'preview.sdgcode'),code);await writeFile(join(outputDirectory,'path.saampath'),JSON.stringify(path));await writeFile(join(outputDirectory,'adaptation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({adaptation,preview:report.preview},null,2));
}
