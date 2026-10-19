import {createHash} from 'node:crypto';
import {createKinematics,heldTableDeg} from './kinematics.mjs';
export const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
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
  requireThat(Number.isFinite(c.retreatMm)&&c.retreatMm>0,'Invalid DENSO tool retreat.');
  requireThat(Number.isFinite(heldTableDeg(c)),'DENSO setup needs a finite table angle (tableDeg).');
  validateDirectionPair(c.initialPose?.toolAxis,c.initialPose?.toolUp);
  requireThat(typeof c.mounting==='string'&&c.mounting.length>0&&c.temperatureControl==='external-preheated','DENSO requires mounting basis and external temperature control.');
  const missing=['toolFrame','workFrame','armGroup','figure','extrusionOutput','rotaryInterface'].filter(k=>c[k]==null);
  if(required)requireThat(!missing.length,'DENSO installation is unconfigured: '+missing.join(', ')+(missing.length>1?' are':' is')+' not set. Synthetic setup belongs only in development prints.');
  return {configured:!missing.length,missing};
}
export function createAdapter(Export){
  const kinematics=createKinematics(Export.kinematics);
  return {output:'denso-pacscript',poses:true,
    settings:{key:'denso',validate:(settings,options)=>validateDensoConfiguration(settings,options,Export.frame.validateDirectionPair)},
    export:(prepared,settings)=>exportDenso(prepared,settings,settings.machine,settings.release,Export,kinematics)};
}
// A relay switches extrusion on and off; the SAAMpath's retraction and fan
// settings have no command and are left out of the program.
const relayOmissions=omitted=>omitted.size?[`The external relay arrangement omits requested ${[...omitted].join(' and ')} actions; the robot program has no ${[...omitted].join(' or ')} control.`]:[];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const controllerNumber=(x,decimals)=>{requireThat(Number.isFinite(x),'Nonfinite PacScript number.');return Number(x.toFixed(decimals));};
// Every axis comes from DENSO's kinematics: the table angle it chooses and the
// toolhead in the room frame; the controller solves the arm (figure c.figure).
// A robot command needs a positive time: a move without a positive speed is
// written at the profile's default deposition or travel speed, and noted.
const commandSpeed=(action,defaults)=>action.speedMmS>0?action.speedMmS:action.volumeMm3>0?defaults.planarSpeedMmS:defaults.travelSpeedMmS;
const defaultedNote=(count,defaults)=>count?[`${count} move(s) had no positive speed and are written at the profile default (deposition ${defaults.planarSpeedMmS} mm/s, travel ${defaults.travelSpeedMmS} mm/s).`]:[];
function exportDenso(path,plan,machine,release,Export,kinematics){
  const {PRINT_RESOLUTION_MM,BUILD_SCALE_MM,PROGRAM_DECIMALS}=Export.kinematics.dimensions;
  const num=x=>controllerNumber(x,PROGRAM_DECIMALS+3);
  // Direction tolerance: print resolution across the machine reference span.
  const POSE_RESOLUTION=PRINT_RESOLUTION_MM/BUILD_SCALE_MM;
  const c=plan.setup.denso,{rotateZ,validateDirectionPair}=Export.frame;
  requireThat(distance(path.initialPosition,c.initialPositionMm)<PRINT_RESOLUTION_MM,'DENSO initial position differs from setup.');
  const upright={toolAxis:[0,0,-1],toolUp:[0,1,0]},initial=path.initialPose??upright;
  requireThat(['toolAxis','toolUp'].every(k=>initial[k].every((v,i)=>Math.abs(v-c.initialPose[k][i])<POSE_RESOLUTION)),'DENSO initial orientation differs from setup.');
  const placedStart=kinematics.placeTool(c,{point:path.initialPosition,...initial});
  let table=heldTableDeg(c),from=toWork(placedStart.point,c,rotateZ),writtenPose=[...rotateZ(placedStart.toolUp,c.workYawDeg),...rotateZ(placedStart.toolAxis,c.workYawDeg)].map(num),relay=false,seconds=0,volumeMm3=0,onSeconds=0,defaulted=0,collapsed=0,carried=0,untimed=0,untimedRelay=0;
  const lines=[],omitted=new Set(),temperatures=new Set(),estimated=Number.isFinite(c.extrusionRateMm3S)&&c.extrusionRateMm3S>0;
  for(const action of path.actions){
    if(action.kind==='move'){
      const pose=action.pose??upright;
      validateDirectionPair(pose.toolAxis,pose.toolUp);
      const placed=kinematics.placeTool(c,{point:action.to,toolAxis:pose.toolAxis,toolUp:pose.toolUp}),work=toWork(placed.point,c,rotateZ).map(value=>Export.number(value,'xyz')),
        up=rotateZ(placed.toolUp,c.workYawDeg),axis=rotateZ(placed.toolAxis,c.workYawDeg),nextPose=[...up,...axis].map(num);
      const length=distance(from,work),orientationChanged=nextPose.some((value,index)=>value!==writtenPose[index]);
      if(!length&&!orientationChanged&&!(action.durationSeconds>0)){collapsed++;carried+=action.volumeMm3;continue;}
      // A reorientation in place has no requested time: the controller turns at its own speed.
      const speed=commandSpeed(action,plan.defaultProcess);
      if(length>0&&action.durationSeconds===undefined&&speed!==action.speedMmS)defaulted++;
      const requestedMs=(action.durationSeconds??(length>0?length/speed:0))*1000,ms=Number.isFinite(requestedMs)?num(requestedMs):0;
      if(!ms&&!length&&!orientationChanged){collapsed++;carried+=action.volumeMm3;continue;}
      const volume=action.volumeMm3>0?action.volumeMm3+carried:0,on=volume>0;if(action.volumeMm3>0)carried=0;
      if(on!==relay){lines.push(`${on?'Set':'Reset'} IO[${c.extrusionOutput}]`);relay=on;}
      seconds+=ms/1000;volumeMm3+=volume;if(on)onSeconds+=ms/1000;if(!ms){untimed++;if(on)untimedRelay++;}
      const label={phase:action.phase,layer:action.layer,operation:action.operation??null,volumeMm3:volume};
      lines.push(`Move L, @0 T(${[...work,...nextPose,c.figure].join(',')}) EX((${c.rotaryAxis},${num((placed.tableDeg-table)*c.rotarySign)}))${ms>0?`, Time=${ms}`:''} ' SAAM ${JSON.stringify(label)}`);
      from=work;writtenPose=nextPose;table=placed.tableDeg;
    }else if(action.kind==='dwell'){
      if(relay){lines.push(`Reset IO[${c.extrusionOutput}]`);relay=false;}lines.push(`Delay ${num(action.seconds*1000)}`);seconds+=num(action.seconds*1000)/1000;
    }else if(['retract','recover'].includes(action.kind)){if(action.filamentMm>0)omitted.add('retraction');}
    else if(action.kind==='fan'){if(action.percent!==0)omitted.add('fan');}
    else if(action.kind==='temperature'){Export.temperatureC(action.targetC);temperatures.add(action.targetC);}
    else throw new Error('Unsupported DENSO action '+action.kind);
  }
  const files=new Map(),names=[];
  // Keep each helper small; the controller compiler's installed limits still
  // need vendor verification. Splitting does not change the motion sequence.
  for(let i=0;i<lines.length;i+=2000){const name='chunk'+String(names.length).padStart(4,'0');names.push(name);files.set(name+'.pcs',`Sub ${name}\n${lines.slice(i,i+2000).map(l=>'  '+l).join('\n')}\nEnd Sub\n`);}
  files.set('main.pcs',[...names.map(n=>`#Include "${n}.pcs"`),"' SAAM experimental RC8A; external start/heat and rotary setup required.",'Sub Main',`  TakeArm ${c.armGroup} Keep = 0`,`  ChangeTool ${c.toolFrame}`,`  ChangeWork ${c.workFrame}`,`  Reset IO[${c.extrusionOutput}]`,...names.map(n=>'  Call '+n),`  Reset IO[${c.extrusionOutput}]`,'End Sub',''].join('\n'));
  const limitations=[...relayOmissions(omitted),...defaultedNote(defaulted,plan.defaultProcess),
    ...(collapsed?[`${collapsed} move(s) collapsed at ${PRINT_RESOLUTION_MM} mm XYZ precision; their commanded material carries to the next written deposition${carried?`; ${carried} mm³ at the end has no representable deposition and is omitted`:''}.`]:[]),
    ...(untimed?[`${untimed} move(s) have no representable TIME command; controller-selected duration is excluded from reported seconds${untimedRelay?'; their relay duration is unknown, so the total relay-material estimate is unavailable':''}.`]:[]),
    ...(estimated?[]:['Relay-material estimate unavailable: no positive external extrusionRateMm3S is configured.']),
    ...(temperatures.size?[`Requested nozzle temperature action(s) (${[...temperatures].join(', ')} °C) are not written; an external controller or operator must arrange them at their requested points.`]:[])];
  files.set('manifest.json',JSON.stringify({schema:'saam-denso-program/1',entry:'main.pcs',machineHash:digest(machine),setupHash:digest(plan.setup),release,limitations,
    initialRotaryControllerDeg:c.rotaryZeroDeg+heldTableDeg(c)*c.rotarySign,sourceFiles:[...files.keys()]},null,2)+'\n');
  const available=estimated&&!untimedRelay;
  return {bytes:Export.packZip(files),report:{seconds,untimedMoves:untimed,volumeMm3,omittedVolumeMm3:carried,materialModel:available?'relay-estimate':'relay-estimate-unavailable',estimatedRelayVolumeMm3:available?c.extrusionRateMm3S*onSeconds:null,limitations,
    timingModel:'Written TIME at 100% external speed; controller acceleration, endpoint stops and IO lag excluded.',
    notice:`Commanded volume ${volumeMm3.toFixed(2)} mm³; ${available?`duration-times-rate relay estimate ${(c.extrusionRateMm3S*onSeconds).toFixed(2)} mm³ (difference ${(c.extrusionRateMm3S*onSeconds-volumeMm3).toFixed(2)} mm³)`:'relay-material estimate unavailable'}. Neither is measured deposition. External start and heating are declared in setup; the program inserts neither.`}};
}
