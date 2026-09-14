// Adapt recorded DENSO part-relative paths to Tippy's stationary-bed study.
// This is a scaled motion study, not regeneration or a controller exporter.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {interpretDenso} from '../../core/export/denso.mjs';
import {loadMachine} from '../../core/machine/profile.mjs';
import {tiltyGeometry,tiltyInverse,gimbalRotation} from '../../core/machine/tilty.mjs';
import {createStudy} from './create-study.mjs';

const rad=Math.PI/180;
export function gimbalForAxis(axis,tiltDeg){
  const azimuth=Math.atan2(-axis[1],-axis[0]),z=Math.cos(tiltDeg*rad),x=Math.sin(tiltDeg*rad)*Math.cos(azimuth),y=Math.sin(tiltDeg*rad)*Math.sin(azimuth);
  return [Math.atan2(-y,z)/rad,Math.asin(Math.max(-1,Math.min(1,x)))/rad,0];
}
export function fitPose(g,tcp,axis,minimumTiltDeg=0){
  const requested=Math.min(g.maxTiltDeg,Math.acos(Math.max(-1,Math.min(1,-axis[2])))/rad);
  const at=d=>{const anglesDeg=gimbalForAxis(axis,d),s=tiltyInverse(g,{tcp,rotation:gimbalRotation(anglesDeg[0]*rad,anglesDeg[1]*rad)});return {valid:s.valid,anglesDeg,tiltDeg:d};};
  const desired=at(requested);if(desired.valid)return desired;
  if(requested<minimumTiltDeg-1e-6)return null;
  let low=minimumTiltDeg,high=requested,accepted=at(low);
  // Usually feasibility is an interval starting upright. Search interior
  // inclinations too: the upper rail limit can make upright unreachable.
  if(!accepted.valid){
    for(let d=requested-1;d>minimumTiltDeg;d-=1){const s=at(d);if(s.valid){accepted=s;low=d;high=Math.min(requested,d+1);break;}}
    if(!accepted.valid)return null;
  }
  for(let i=0;i<13;i++){const d=(low+high)/2,s=at(d);if(s.valid){low=d;accepted=s;}else high=d;}
  // Keep a little room from the orientation boundary for interpolation.
  const inset=at(Math.max(minimumTiltDeg,low-.1));return inset.valid?inset:accepted;
}

export async function fitDensoTippy(sourceDirectory,directory,{scale:fixedScale}={}){
  const plan=JSON.parse(await readFile(join(sourceDirectory,'plan.json'),'utf8')),machine=JSON.parse(await readFile(join(sourceDirectory,'machine.json'),'utf8'));
  const bytes=await readFile(join(sourceDirectory,'exports/denso-pacscript/part.zip')),program=interpretDenso(bytes,plan,machine),g=tiltyGeometry(loadMachine('tilty').kinematicModel);
  const originalMoves=program.moves.length,compact=[];
  // Bound each preview chord by at most 1 mm of original path. Preserve
  // extrusion, operation and layer boundaries and aggregate time/material.
  let pending=null,length=0;
  for(const m of program.moves){
    const distance=Math.hypot(...m.to.map((v,i)=>v-m.from[i]));
    if(pending&&(length+distance>1||m.extruding!==pending.extruding||m.phase!==pending.phase||m.operation!==pending.operation||m.layer!==pending.layer||Math.max(...m.toolAxisTo.map((v,i)=>Math.abs(v-pending.toolAxisFrom[i])))>.05)){
      compact.push(pending);pending=null;length=0;
    }
    if(!pending)pending={...m};else{pending.to=m.to;pending.toolAxisTo=m.toolAxisTo;pending.durationSeconds+=m.durationSeconds;pending.commandedVolumeMm3+=m.commandedVolumeMm3;}
    length+=distance;
  }
  if(pending)compact.push(pending);program.moves=compact;
  console.log(`Compacted ${originalMoves} recorded moves to ${compact.length} preview chords.`);
  const endpoints=[{tcp:program.moves[0].from,axis:program.moves[0].toolAxisFrom},...program.moves.map(m=>({tcp:m.to,axis:m.toolAxisTo,cladding:m.extruding&&m.phase.startsWith('cladding')}))];
  for(let i=1;i<endpoints.length;i++)if(endpoints[i].cladding)endpoints[i-1].cladding=true;
  const minimumFor=p=>{
    if(p.minimumTiltDeg!==undefined)return p.minimumTiltDeg;
    if(!p.cladding)return p.minimumTiltDeg=0;
    const baseline=fitPose(g,p.tcp,p.axis);if(!baseline)throw Error('Original-size Tippy approach is not reachable');
    return p.minimumTiltDeg=Math.max(Math.min(20,Math.acos(Math.max(-1,Math.min(1,-p.axis[2])))/rad),baseline.tiltDeg-5);
  };
  const sample=endpoints.filter((_,i)=>i%Math.max(1,Math.floor(endpoints.length/2200))===0);
  sample.push(...[0,1,2].flatMap(j=>[endpoints.reduce((a,b)=>a.tcp[j]<b.tcp[j]?a:b),endpoints.reduce((a,b)=>a.tcp[j]>b.tcp[j]?a:b)]));
  sample.sort((a,b)=>b.tcp[2]-a.tcp[2]);
  const feasible=scale=>sample.every(p=>fitPose(g,p.tcp.map(v=>v*scale),p.axis,minimumFor(p)));
  let lo=fixedScale??0,hi=fixedScale??1;
  if(fixedScale===undefined){while(feasible(hi)&&hi<32){lo=hi;hi*=2;}
    for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(feasible(mid))lo=mid;else hi=mid;}}
  console.log(`Coarse uniform-scale bracket ${lo.toFixed(5)}–${hi.toFixed(5)}.`);
  // Final source includes every original endpoint. If denser checks find a
  // limit, decrease the scale and repeat; never silently move an extrusion TCP.
  let scale=fixedScale??Math.floor(lo*995)/1000,source,checks,attempts=0;
  while(attempts++<30){
    let previous=null,failed=null,changed=0,minTilt=Infinity,maxTilt=0,checked=0;
    const commands=[],bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let i=0;i<endpoints.length;i++){
      if(i&&i%10000===0)console.log(`Prepared ${i}/${endpoints.length} preview poses.`);
      const p=endpoints[i],tcp=p.tcp.map(v=>v*scale),pose=fitPose(g,tcp,p.axis,minimumFor(p));
      if(!pose){failed={endpoint:i,tcp};break;}
      const current={tcp,anglesDeg:pose.anglesDeg};checked++;
      if(Math.abs(pose.tiltDeg-Math.acos(Math.max(-1,Math.min(1,-p.axis[2])))/rad)>.01)changed++;
      if(i){const move=program.moves[i-1],corrections=[],n=Math.max(1,Math.ceil(Math.hypot(...tcp.map((v,j)=>v-previous.tcp[j]))/.5),Math.ceil(Math.max(...pose.anglesDeg.map((v,j)=>Math.abs(v-previous.anglesDeg[j])))/2));
        for(let k=1;k<n;k++){
          const t=k/n,point=tcp.map((v,j)=>previous.tcp[j]+(v-previous.tcp[j])*t),a=pose.anglesDeg.map((v,j)=>previous.anglesDeg[j]+(v-previous.anglesDeg[j])*t);
          if(!tiltyInverse(g,{tcp:point,rotation:gimbalRotation(a[0]*rad,a[1]*rad)}).valid){
            const mixed=p.axis.map((v,j)=>endpoints[i-1].axis[j]+(v-endpoints[i-1].axis[j])*t),length=Math.hypot(...mixed);
            const adjusted=fitPose(g,point,mixed.map(v=>v/length),Math.min(minimumFor(p),minimumFor(endpoints[i-1])));
            if(!adjusted){failed={endpoint:i,fraction:t,tcp:point};break;}
            corrections.push({tcp:point,anglesDeg:adjusted.anglesDeg,t});
          }checked++;
        }
        if(failed)break;
        let priorT=0;for(const command of [...corrections,{...current,t:1}]){
          const fraction=command.t-priorT;commands.push({tcp:command.tcp,anglesDeg:command.anglesDeg,seconds:move.durationSeconds*scale*fraction,volumeMm3:move.commandedVolumeMm3*scale**3*fraction,phase:move.phase,layer:move.layer,operation:move.operation});priorT=command.t;
        }
        if(move.extruding){minTilt=Math.min(minTilt,pose.tiltDeg);maxTilt=Math.max(maxTilt,pose.tiltDeg);for(let j=0;j<3;j++){bounds.min[j]=Math.min(bounds.min[j],tcp[j]);bounds.max[j]=Math.max(bounds.max[j],tcp[j]);}}
      }
      previous=current;
    }
    if(failed){console.log(`Scale ${scale}: blocked at ${JSON.stringify(failed)}; reducing.`);scale=Math.floor(scale*.995*1000)/1000;continue;}
    source={schema:'saam-machine-study-source/1',orientation:'gimbal-rx-ry',initial:{tcp:endpoints[0].tcp.map(v=>v*scale),anglesDeg:fitPose(g,endpoints[0].tcp.map(v=>v*scale),endpoints[0].axis).anglesDeg},moves:commands};
    checks={checkedPoses:checked,changedOrientationEndpoints:changed,extrudingTiltRangeDeg:[minTilt,maxTilt],depositedBoundsMm:bounds};break;
  }
  if(!source)throw Error('Could not obtain a completely checked adapted source');
  await createStudy(directory,'tilty',{source});
  const studyPath=join(directory,'plan.json'),study=JSON.parse(await readFile(studyPath,'utf8'));
  study.skills=structuredClone(plan.skills);
  if(study.skills['pipe-cladding'])study.skills['pipe-cladding'].normalMm*=scale;
  for(const key of ['layerMm','firstLayerMm','lineWidthMm','skinNormalMm'])if(Number.isFinite(plan.process[key]))study.process[key]=plan.process[key]*scale;
  await writeFile(studyPath,JSON.stringify(study,null,2)+'\n');
  const report={sourceDirectory:resolve(sourceDirectory),sourceSha256:createHash('sha256').update(bytes).digest('hex'),originalMoves,previewMoves:compact.length,maximumCompactedPathLengthMm:scale,machineId:'tilty',displayName:'Tippy',scale,coarseScaleBracket:[lo,hi],...checks,
    policy:'Uniformly scale recorded part-relative motion, bead dimensions and volumes. Compact short source paths to preview chords while retaining shell order and aggregating duration/material. Remove external rotary and independent tool roll; retain inclination azimuth. Cladding stays at least 20 degrees (or its smaller source angle), and loses at most five additional degrees from the original-size Tippy adaptation. No geometry/path regeneration.',
    coverage:`Every adapted endpoint and interpolated poses at <=2 mm / <=2 degree increments pass Tippy model limits. ${fixedScale===undefined?'Largest tested centered uniform scale for this orientation policy':'User-selected quick preview scale'}, not a global optimum or continuous collision certificate. Part/tool collisions and deposition process are not validated. Not a hardware program.`};
  await writeFile(join(directory,'fit-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output,scale]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node tools/kinematics/fit-denso-tippy.mjs <DENSO bundle> <new study directory> [scale]');
  await mkdir(output,{recursive:true});await fitDensoTippy(input,output,scale?{scale:Number(scale)}:{});
}
