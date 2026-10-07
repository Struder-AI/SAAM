import {createHash} from 'node:crypto';
export const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export const DENSO_LIMITATIONS=[
  'RC8A is confirmed; mounting, calibration and rotary installation are stated setup assumptions, not measured facts.',
  'Cartesian linear T poses, @0 endpoints, relative EX and TIME are interpreted. IK, reach, singularities, joint and motion limits and collisions are deferred to commissioning/controller behavior.',
  'Playback assumes synchronized linear progress of Cartesian and rotary commands at external speed 100%. Actual acceleration, external-axis interpolation, override, endpoint stops, IO latency and controller acceptance remain unverified.',
  'Relay volume is an estimate from requested duration and configured rate, not measured or metered extrusion. Continuous path geometry does not establish smooth deposition with @0 endpoint commands.',
  'External positioning at the declared start, calibrated tool/work definitions, rotary zero and external heating are prerequisites. No heating, homing or startup positioning is inserted.',
  'Delivery is a source ZIP for a WINCAPS III project. RC8A compilation/import and physical execution have not been validated.'
];
export const toWork=(point,c,rotateZ)=>rotateZ(point,c.workYawDeg).map((v,i)=>v+c.workOffsetMm[i]);
// Installation values in setup.denso. Null means unresolved, permitting
// geometry review but never machine export.
export function validateDensoConfiguration(plan,{required=false}={},validateDirectionPair){
  const c=plan.setup.denso;requireThat(c,'Missing DENSO setup.');
  for(const key of ['toolFrame','workFrame','armGroup','figure','extrusionOutput'])
    requireThat(c[key]===null||(Number.isInteger(c[key])&&c[key]>=0),'Invalid DENSO '+key+'.');
  requireThat([7,8].includes(c.rotaryAxis)&&[-1,1].includes(c.rotarySign),'Invalid external rotary axis/sign.');
  requireThat(c.rotaryInterface===null||c.rotaryInterface==='rc8a-relative-ex','Only the declared RC8A EX rotary interface is implemented; a separate rotary controller needs its own adapter.');
  for(const key of ['rotaryCenterMm','workOffsetMm','initialPositionMm'])requireThat(Array.isArray(c[key])&&c[key].length===3&&c[key].every(Number.isFinite),'Invalid DENSO '+key+'.');
  for(const key of ['workYawDeg','rotaryZeroDeg'])requireThat(Number.isFinite(c[key]),'Invalid DENSO frame/rotary offset.');
  for(const key of ['retreatMm','transitionSeconds'])requireThat(Number.isFinite(c[key])&&c[key]>0,'Invalid DENSO transition setting.');
  requireThat(c.initialPose&&Number.isFinite(c.initialPose.rotaryDeg),'DENSO initial pose needs a finite rotary angle.');
  validateDirectionPair(c.initialPose.toolAxis,c.initialPose.toolUp);
  requireThat(c.extrusionRateMm3S===null||(Number.isFinite(c.extrusionRateMm3S)&&c.extrusionRateMm3S>0),'Invalid relay rate.');
  requireThat(c.configurationSource===null||(typeof c.configurationSource==='string'&&c.configurationSource.trim()),'Configuration needs a source.');
  requireThat(typeof c.mounting==='string'&&c.mounting.length>0&&c.temperatureControl==='external-preheated','DENSO requires mounting basis and external temperature control.');
  const missing=['configurationSource','toolFrame','workFrame','armGroup','figure','extrusionOutput','extrusionRateMm3S','rotaryInterface'].filter(k=>c[k]===null);
  if(required)requireThat(!missing.length,'DENSO installation is unconfigured; supply '+missing.join(', ')+'. Synthetic setup belongs only in development prints.');
  requireThat(plan.process.retractMm===0&&plan.process.fanPercent===0,'Relay output cannot retract or control a fan.');
  return {configured:!missing.length,missing};
}
const value=v=>v===null||v===undefined?'Not set':Array.isArray(v)?v.join(', '):String(v);
// Studio settings rows: the installation as configured.
const rows=({machine,setup})=>{const c=setup.denso;return [
  ['Robot / controller',machine.name],['Installation basis',c.configurationSource??'Not configured'],['Mounting',c.mounting],
  ['Tool / work frame',value(c.toolFrame)+' / '+value(c.workFrame)],['Arm group / figure',value(c.armGroup)+' / '+value(c.figure)],
  ['Rotary interface',c.rotaryInterface??'Not confirmed'],['External axis',c.rotaryAxis+' · sign '+c.rotarySign+' · zero '+c.rotaryZeroDeg+'°'],
  ['Rotary center',value(c.rotaryCenterMm)+' mm'],['Work offset / yaw',value(c.workOffsetMm)+' mm / '+c.workYawDeg+'°'],
  ['External starting point',value(c.initialPositionMm)+' mm'],['Starting bed angle',c.initialPose.rotaryDeg+'°'],
  ['Starting tool direction',value(c.initialPose.toolAxis)],['Starting tool up',value(c.initialPose.toolUp)],
  ['Relay output / rate',value(c.extrusionOutput)+' / '+value(c.extrusionRateMm3S)+' mm³/s; estimate'],
  ['Transition retreat / time',c.retreatMm+' mm / '+c.transitionSeconds+' s'],['Heating',c.temperatureControl+' · '+setup.nozzleC+' / '+setup.bedC+'°C'],
  ['Motion interpretation','Nominal Cartesian / rotary progress; controller IK; robot feasibility deferred']];};
export const createAdapter=Export=>({output:'denso-pacscript',poses:true,
  settings:{key:'denso',validate:(settings,options)=>validateDensoConfiguration(settings,options,Export.frame.validateDirectionPair),rows},
  export:(prepared,settings)=>exportDenso(prepared,settings,settings.machine,settings.release,Export)});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const num=x=>{requireThat(Number.isFinite(x),'Nonfinite PacScript number.');return Number(x.toFixed(8));};
function exportDenso(path,plan,machine,release,Export){
  const c=plan.setup.denso,{rotateZ,rotatePointZ:bedPoint,validateDirectionPair}=Export.frame;
  requireThat(distance(path.initialPosition,c.initialPositionMm)<1e-8,'DENSO initial position differs from setup.');
  const defaultPose={rotaryDeg:0,toolAxis:[0,0,-1],toolUp:[0,1,0]},initial=path.initialPose??defaultPose;
  requireThat(Math.abs(initial.rotaryDeg-c.initialPose.rotaryDeg)<1e-9&&['toolAxis','toolUp'].every(k=>initial[k].every((v,i)=>Math.abs(v-c.initialPose[k][i])<1e-9)),'DENSO initial orientation or rotary position differs from setup.');
  let rotary=path.initialPose?.rotaryDeg??c.initialPose.rotaryDeg,from=path.initialPosition,relay=false,seconds=0,volumeMm3=0,onSeconds=0;
  const lines=[];
  for(const action of path.actions){
    if(action.kind==='move'){
      const pose=action.pose??defaultPose;
      requireThat(Number.isFinite(pose.rotaryDeg),'DENSO motion needs a finite rotary angle.');
      validateDirectionPair(pose.toolAxis,pose.toolUp);
      const room=bedPoint(action.to,pose.rotaryDeg,c.rotaryCenterMm),work=toWork(room,c,rotateZ),
        up=rotateZ(pose.toolUp,pose.rotaryDeg+c.workYawDeg),axis=rotateZ(pose.toolAxis,pose.rotaryDeg+c.workYawDeg),on=action.volumeMm3>0;
      if(on!==relay){lines.push(`${on?'Set':'Reset'} IO[${c.extrusionOutput}]`);relay=on;}
      const ms=num((action.durationSeconds??distance(from,action.to)/action.speedMmS)*1000);requireThat(ms>0,'DENSO motion needs a positive requested duration.');
      seconds+=ms/1000;volumeMm3+=action.volumeMm3;if(on)onSeconds+=ms/1000;
      const label={phase:action.phase,layer:action.layer,operation:action.operation??null,volumeMm3:action.volumeMm3};
      lines.push(`Move L, @0 T(${[...work,...up,...axis,c.figure].map(num).join(',')}) EX((${c.rotaryAxis},${num((pose.rotaryDeg-rotary)*c.rotarySign)})), Time=${ms} ' SAAM ${JSON.stringify(label)}`);
      from=action.to;rotary=pose.rotaryDeg;
    }else if(action.kind==='dwell'){
      if(relay){lines.push(`Reset IO[${c.extrusionOutput}]`);relay=false;}lines.push(`Delay ${num(action.seconds*1000)}`);seconds+=num(action.seconds*1000)/1000;
    }else if(['retract','recover'].includes(action.kind))requireThat(action.filamentMm===0,'DENSO relay cannot retract.');
    else if(action.kind==='fan')requireThat(action.percent===0,'DENSO fan control is not implemented.');
    else throw new Error('Unsupported DENSO action '+action.kind);
  }
  const files=new Map(),names=[];
  // Keep each helper small; the controller compiler's installed limits still
  // need vendor verification. Splitting does not change the motion sequence.
  for(let i=0;i<lines.length;i+=2000){const name='chunk'+String(names.length).padStart(4,'0');names.push(name);files.set(name+'.pcs',`Sub ${name}\n${lines.slice(i,i+2000).map(l=>'  '+l).join('\n')}\nEnd Sub\n`);}
  files.set('main.pcs',[...names.map(n=>`#Include "${n}.pcs"`),"' SAAM experimental RC8A; external start/heat and rotary setup required.",'Sub Main',`  TakeArm ${c.armGroup} Keep = 0`,`  ChangeTool ${c.toolFrame}`,`  ChangeWork ${c.workFrame}`,`  Reset IO[${c.extrusionOutput}]`,...names.map(n=>'  Call '+n),`  Reset IO[${c.extrusionOutput}]`,'End Sub',''].join('\n'));
  files.set('manifest.json',JSON.stringify({schema:'saam-denso-program/1',entry:'main.pcs',machineHash:digest(machine),setupHash:digest(plan.setup),release,limitations:DENSO_LIMITATIONS,
    initialRotaryControllerDeg:c.rotaryZeroDeg+c.initialPose.rotaryDeg*c.rotarySign,sourceFiles:[...files.keys()]},null,2)+'\n');
  return {bytes:Export.packZip(files),report:{seconds,volumeMm3,materialModel:'relay-estimate',estimatedRelayVolumeMm3:c.extrusionRateMm3S*onSeconds,limitations:DENSO_LIMITATIONS,
    notice:'Experimental RC8A program. Requested TIME at 100% external speed; reach, joint limits, collisions and physical deposition unchecked.'}};
}
