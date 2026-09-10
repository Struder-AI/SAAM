import {createHash} from 'node:crypto';
import {packZip,unpackZip} from './zip.mjs';
import {interpretDensoFiles,toWork,DENSO_LIMITATIONS} from './denso-player.mjs';
import {validateDensoConfiguration} from '../machine/denso.mjs';
import {rotateZ,bedPoint,validatePose,uprightPose,samePose} from '../path/pose.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const num=x=>{requireThat(Number.isFinite(x),'Nonfinite PacScript number.');return Number(x.toFixed(8));};
export function exportDenso(path,plan,machine,release={}){
  validateDensoConfiguration(plan,{required:true});const c=plan.setup.denso;
  requireThat(distance(path.initialPosition,c.initialPositionMm)<1e-8,'DENSO initial position differs from setup.');
  requireThat(samePose(path.initialPose??uprightPose(),c.initialPose),'DENSO initial orientation or rotary position differs from setup.');
  let rotary=path.initialPose?.rotaryDeg??c.initialPose.rotaryDeg,from=path.initialPosition,relay=false;
  const lines=[];
  for(const action of path.actions){
    if(action.kind==='move'){
      const pose=validatePose(action.pose??uprightPose()),room=bedPoint(action.to,pose.rotaryDeg,c.rotaryCenterMm),work=toWork(room,c),
        up=rotateZ(pose.toolUp,pose.rotaryDeg+c.workYawDeg),axis=rotateZ(pose.toolAxis,pose.rotaryDeg+c.workYawDeg),on=action.volumeMm3>0;
      if(on!==relay){lines.push(`${on?'Set':'Reset'} IO[${c.extrusionOutput}]`);relay=on;}
      const ms=num((action.durationSeconds??distance(from,action.to)/action.speedMmS)*1000);requireThat(ms>0,'DENSO motion needs a positive requested duration.');
      const label={phase:action.phase,layer:action.layer,operation:action.operation??null,volumeMm3:action.volumeMm3};
      lines.push(`Move L, @0 T(${[...work,...up,...axis,c.figure].map(num).join(',')}) EX((${c.rotaryAxis},${num((pose.rotaryDeg-rotary)*c.rotarySign)})), Time=${ms} ' SAAM ${JSON.stringify(label)}`);
      from=action.to;rotary=pose.rotaryDeg;
    }else if(action.kind==='dwell'){
      if(relay){lines.push(`Reset IO[${c.extrusionOutput}]`);relay=false;}lines.push(`Delay ${num(action.seconds*1000)}`);
    }else if(['retract','recover'].includes(action.kind))requireThat(action.filamentMm===0,'DENSO relay cannot retract.');
    else if(action.kind==='fan')requireThat(action.percent===0,'DENSO fan control is not implemented.');
    else throw new Error('Unsupported DENSO action '+action.kind);
  }
  const files=new Map(),names=[];
  // Keep each helper small; the controller compiler's installed limits still
  // need vendor verification. Splitting does not change the motion sequence.
  for(let i=0;i<lines.length;i+=2000){const name='chunk'+String(names.length).padStart(4,'0');names.push(name);files.set(name+'.pcs',`Sub ${name}\n${lines.slice(i,i+2000).map(l=>'  '+l).join('\n')}\nEnd Sub\n`);}
  files.set('main.pcs',[...names.map(n=>`#Include "${n}.pcs"`),"' SAAM experimental RC8; external start/heat and rotary setup required.",'Sub Main',`  TakeArm ${c.armGroup} Keep = 0`,`  ChangeTool ${c.toolFrame}`,`  ChangeWork ${c.workFrame}`,`  Reset IO[${c.extrusionOutput}]`,...names.map(n=>'  Call '+n),`  Reset IO[${c.extrusionOutput}]`,'End Sub',''].join('\n'));
  files.set('manifest.json',JSON.stringify({schema:'saam-denso-program/1',entry:'main.pcs',machineHash:digest(machine),setupHash:digest(plan.setup),release,limitations:DENSO_LIMITATIONS,
    initialRotaryControllerDeg:c.rotaryZeroDeg+c.initialPose.rotaryDeg*c.rotarySign,sourceFiles:[...files.keys()]},null,2)+'\n');
  return packZip(files);
}
export function interpretDenso(bytes,plan,machine){
  const entries=unpackZip(bytes);requireThat(entries.has('manifest.json'),'Missing DENSO manifest.');
  const m=JSON.parse(entries.get('manifest.json').toString('utf8'));
  requireThat(m.schema==='saam-denso-program/1'&&m.entry==='main.pcs'&&m.machineHash===digest(machine)&&m.setupHash===digest(plan.setup),'DENSO setup/machine identity differs.');
  requireThat(Array.isArray(m.sourceFiles)&&[...entries.keys()].filter(k=>k!=='manifest.json').sort().join()===m.sourceFiles.slice().sort().join(),'DENSO source inventory differs.');
  const files=Object.fromEntries(m.sourceFiles.map(n=>[n,entries.get(n).toString('utf8')]));
  const program=interpretDensoFiles(files,plan,machine);program.checks.push('archive-integrity');return program;
}
