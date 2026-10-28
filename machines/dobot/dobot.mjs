// Bounded Dobot adapter: fixed-orientation Cartesian MovL at CP=0 with a stroke
// relay. Cartesian command space only: this is not robot IK or a measured flow model.
import {createHash} from 'node:crypto';
export const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

// The longest pause one Wait command can express, not a limit on how long a
// path may pause; a longer pause is split across commands.
export const WAIT_COMMAND_MS=60000;
export const controllerNumber=(value,decimals)=>{requireThat(Number.isFinite(value),'Nonfinite Dobot number.');return Number(value.toFixed(decimals));};
export const transform=(p,c)=>[p[0]*c.scaleX+c.offsetXMm,p[1]*c.scaleY+c.offsetYMm,p[2]+c.bedZMm];
export const inverse=(p,c)=>[(p[0]-c.offsetXMm)/c.scaleX,(p[1]-c.offsetYMm)/c.scaleY,p[2]-c.bedZMm];
// The start pose is compared at print resolution. Rectangular display envelopes
// do not establish robot reachability and do not constrain the program.
export const equal=(a,b,PRINT_RESOLUTION_MM)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<PRINT_RESOLUTION_MM);

// Adopted from the selected legacy motion-trace/trace-lib.mjs. No assumed
// velocity or acceleration: both come from this instance's locked setup.
export function motionProfile(lengthMm,speedMmS,accelMmS2){
  const ramp=speedMmS*speedMmS/accelMmS2;
  return ramp<=lengthMm
    ?{durationS:2*speedMmS/accelMmS2+(lengthMm-ramp)/speedMmS,peakSpeedMmS:speedMmS}
    :{durationS:2*Math.sqrt(lengthMm/accelMmS2),peakSpeedMmS:Math.sqrt(accelMmS2*lengthMm)};
}

export function config(plan,machine){
  requireThat(plan.output==='dobot-lua','Incompatible Dobot output.');
  return plan.setup.dobot;
}

// Machine-instance values in setup.dobot. Null means unresolved, permitting
// geometry review but never machine export.
function validate(plan,{required=false}={}){
  const c=plan.setup.dobot,template=plan.machine.defaultSetup.dobot;
  const optional=['configurationSource','extrusionRateMm3S','workspaceMinMm','workspaceMaxMm'];
  requireThat(Object.keys(c).filter(key=>!optional.includes(key)).sort().join()===Object.keys(template).filter(key=>!optional.includes(key)).sort().join(),'Invalid Dobot instance configuration fields.');
  const missing=Object.keys(template).filter(k=>!['configurationSource','extrusionRateMm3S','workspaceMinMm','workspaceMaxMm'].includes(k)&&c[k]==null);
  for(const key of ['toolFrame','userFrame'])if(c[key]!==null)requireThat(Number.isInteger(c[key])&&c[key]>=0&&c[key]<=50,`Invalid Dobot ${key}.`);
  for(const key of ['scaleX','scaleY','maxLinearSpeedMmS','maxLinearAccelMmS2','accelerationPercent'])if(c[key]!==null)requireThat(Number.isFinite(c[key])&&c[key]>0,`Invalid Dobot ${key}.`);
  if(c.accelerationPercent!==null)requireThat(c.accelerationPercent<=100,'Dobot acceleration percent exceeds 100.');
  for(const key of ['offsetXMm','offsetYMm','bedZMm','rDeg'])if(c[key]!==null)requireThat(Number.isFinite(c[key]),`Invalid Dobot ${key}.`);
  if(c.initialPositionMm!==null)requireThat(Array.isArray(c.initialPositionMm)&&c.initialPositionMm.length===3&&c.initialPositionMm.every(Number.isFinite),'Invalid Dobot initialPositionMm.');
  if(c.extrusionOutput!==null)requireThat(typeof c.extrusionOutput==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(c.extrusionOutput),'Invalid Dobot relay output.');
  if(c.relayPolicy!==null)requireThat(c.relayPolicy==='stroke-stop-start-unblended','Unsupported Dobot relay policy. Explicitly select experimental stroke-stop-start-unblended.');
  if(c.temperatureControl!==null)requireThat(c.temperatureControl==='external-preheated','Dobot requires explicit external-preheated temperature control.');
  if(required){
    requireThat(missing.length===0,`Dobot installation is unconfigured: ${missing.join(', ')} ${missing.length>1?'are':'is'} not set.`);
  }
}
export const createAdapter=Export=>({output:'dobot-lua',poses:false,settings:{key:'dobot',validate},
  write:(prepared,settings,sink)=>writeDobot(prepared,settings,settings.machine,settings.release,Export,sink)});

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// A robot command needs a positive time: a move without a positive speed is
// written at the profile's default deposition or travel speed, and noted.
const commandSpeed=(action,defaults)=>action.speedMmS>0?action.speedMmS:action.volumeMm3>0?defaults.planarSpeedMmS:defaults.travelSpeedMmS;
const defaultedNote=(count,defaults)=>count?[`${count} move(s) had no positive speed and are written at the profile default (deposition ${defaults.planarSpeedMmS} mm/s, travel ${defaults.travelSpeedMmS} mm/s).`]:[];
async function writeDobot(path,plan,machine,release,Export,sink){
  const {PRINT_RESOLUTION_MM,PROGRAM_DECIMALS}=Export.kinematics.dimensions;
  const num=value=>controllerNumber(value,PROGRAM_DECIMALS+5);
  const c=config(plan,machine);
  requireThat(equal(path.initialPosition,c.initialPositionMm,PRINT_RESOLUTION_MM),'Dobot initial position differs from the locked external start pose.');
  const global=`-- SAAM controller XYZ after locked calibration and ${PRINT_RESOLUTION_MM} mm rounding.\nfunction P(x,y,z)\n  return {coordinate={x,y,z,${num(c.rDeg)}},tool=${c.toolFrame},user=${c.userFrame}}\nend\n`;
  const body=await sink.member();let firstLine=true;
  async function flush(){for(const line of lines){await body.write((firstLine?'':'\n')+line);firstLine=false;}lines.length=0;}
  const omitted=new Set(),temperatures=new Set(),lines=['-- SAAM experimental stroke relay program','function RunPlan()',`  DO(${JSON.stringify(c.extrusionOutput)},0)`];
  // Timing and the relay estimate use literal calibrated controller XYZ,
  // the written SpeedL/AccL percentages and rest-to-rest motion.
  const acceleration=num(c.accelerationPercent)/100*c.maxLinearAccelMmS2;
  const estimated=Number.isFinite(c.extrusionRateMm3S)&&c.extrusionRateMm3S>0;
  let relay=false,controller=transform(c.initialPositionMm,c),seconds=0,volumeMm3=0,estimate=0,defaulted=0,limited=0,collapsed=0,carried=0;
  const switchRelay=on=>{if(on!==relay){lines.push('  Sync()',`  DO(${JSON.stringify(c.extrusionOutput)},${on?1:0})`);relay=on;}};
  for(const a of path.actions){
    await flush();
    if(a.kind==='move'){
      const target=transform(a.to,c).map(value=>Export.number(value,'xyz'));
      requireThat(target.every(Number.isFinite),'Dobot command coordinates must be finite.');
      const controllerLength=distance(controller,target);
      if(!controllerLength){collapsed++;carried+=a.volumeMm3;continue;}
      const speed=commandSpeed(a,plan.defaultProcess);if(speed!==a.speedMmS)defaulted++;
      const designLength=Math.hypot((target[0]-controller[0])/c.scaleX,(target[1]-controller[1])/c.scaleY,target[2]-controller[2]);
      const requested=(designLength>0?controllerLength/designLength:1)*speed/c.maxLinearSpeedMmS*100;
      // Percentage commands retain five guard decimals beyond fine program precision.
      // This format has the following smallest positive
      // SpeedL value; a larger requested feed uses the controller's 100% limit.
      const percent=Math.max(10**-(PROGRAM_DECIMALS+5),num(Math.min(100,requested)));
      if(percent!==requested)limited++;
      const volume=a.volumeMm3>0?a.volumeMm3+carried:0;if(a.volumeMm3>0)carried=0;
      switchRelay(volume>0);
      const label={phase:a.phase,layer:a.layer,operation:a.operation??null,commandedVolumeMm3:volume};
      lines.push(`  MovL(P(${target.join(',')}),{SpeedL=${num(percent)},AccL=${num(c.accelerationPercent)},CP=0}) -- SAAM ${JSON.stringify(label)}`);
      const {durationS}=motionProfile(controllerLength,num(percent)/100*c.maxLinearSpeedMmS,acceleration);
      seconds+=durationS;volumeMm3+=volume;if(relay&&estimated)estimate+=c.extrusionRateMm3S*durationS;
      controller=target;
    }else if(a.kind==='dwell'){
      // A longer pause is the same pause in commands the controller accepts;
      // the parts sum to the requested milliseconds, so it is not shortened.
      switchRelay(false);lines.push('  Sync()');
      let remaining=a.seconds*1000;
      do{const part=Math.min(remaining,WAIT_COMMAND_MS);lines.push(`  Wait(${num(part)})`);seconds+=num(part)/1000;remaining-=part;await flush();}while(remaining>0);
    }else if(['retract','recover'].includes(a.kind)){if(a.filamentMm>0)omitted.add('retraction');}
    else if(a.kind==='fan'){if(a.percent!==0)omitted.add('fan');}
    else if(a.kind==='temperature'){temperatures.add(a.targetC);}
    else throw new Error(`Unsupported Dobot action ${a.kind}.`);
  }
  switchRelay(false);lines.push('  Sync()',`  DO(${JSON.stringify(c.extrusionOutput)},0)`,'end','');
  await flush();await body.close();
  const limitations=[...defaultedNote(defaulted,plan.defaultProcess),
    ...(collapsed?[`${collapsed} move(s) collapsed at ${PRINT_RESOLUTION_MM} mm XYZ precision; their commanded material carries to the next written deposition${carried?`; ${carried} mm³ at the end has no representable deposition and is omitted`:''}.`]:[]),
    ...(limited?[`${limited} move(s) use representable SpeedL within 0–100%; timing is calculated from the written percentage.`]:[]),
    ...(estimated?[]:['Relay-material estimate unavailable: no positive external extrusionRateMm3S is configured.']),
    ...(temperatures.size?[`Requested nozzle temperature action(s) (${[...temperatures].join(', ')} °C) are not written; an external controller or operator must arrange them at their requested points.`]:[]),
    ...(omitted.size?[`The external relay arrangement omits requested ${[...omitted].join(' and ')} actions; the robot program has no ${[...omitted].join(' or ')} control.`]:[])];
  const manifest={schema:'saam-dobot-program/1',machineId:machine.id,setupHash:digest(plan.setup),machineHash:digest(machine),
    entry:'src0.lua',initialPositionMm:path.initialPosition,coordinateFrame:`Literal calibrated controller XYZ at ${PRINT_RESOLUTION_MM} mm; P supplies fixed tool/user frame and orientation`,
    relayPolicy:c.relayPolicy,volumeModel:'SAAM commanded intent plus optional independent relay-rate estimate',release,limitations};
  await sink.archive(new Map([['global.lua',global],['src1.lua',body],['src0.lua','-- Entry tab: definitions must be loaded first.\nRunPlan()\n'],['manifest.json',JSON.stringify(manifest,null,2)+'\n']]));
  return {
    report:{seconds,volumeMm3,omittedVolumeMm3:carried,materialModel:estimated?'relay-estimate':'relay-estimate-unavailable',estimatedRelayVolumeMm3:estimated?estimate:null,limitations,
      timingModel:'Rest-to-rest Cartesian motion using written SpeedL/AccL and configured controller limits; relay and queue lag excluded.',
      notice:`Commanded volume ${volumeMm3.toFixed(2)} mm³; ${estimated?`modeled relay-rate estimate ${estimate.toFixed(2)} mm³ (difference ${(estimate-volumeMm3).toFixed(2)} mm³)`:'relay-material estimate unavailable'}. Neither is measured deposition. External start and heating are declared in setup; the program inserts neither.`}};
}
