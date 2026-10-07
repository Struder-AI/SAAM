// Bounded Dobot adapter: fixed-orientation Cartesian MovL at CP=0 with a stroke
// relay. Cartesian command space only: this is not robot IK or a measured flow model.
import {createHash} from 'node:crypto';
export const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export const DOBOT_LIMITATIONS=[
  'Experimental stroke-stop-start-unblended relay policy: relay stays on through consecutive deposition moves, and is off during travel and dwell. This differs from the legacy continuous-through-travel reference.',
  'Commanded volume is SAAMpath intent, not metered extrusion. Relay volume is an estimate from the configured external rate and modeled rest-to-rest timing; acceleration, pauses and relay lag can change the actual deposit.',
  'Playback shows fixed-orientation Cartesian commands transformed back into the design frame. Robot joint solutions, reachability, singularities, link/fixture collisions and controller queue latency are not simulated.',
  'No startup motion or heating commands are emitted. The configured initial pose and external nozzle/bed temperatures must already be established. No priming dwell is inserted.',
  'Only linear MovL at CP=0, explicit fixed frame/orientation, DO, Sync and relay-off Wait are supported. Joint moves, arcs, orientation changes, tool changes, nonzero retraction and fan control are rejected. No physical validation has been performed.'
];
// The longest pause one Wait command can express, not a limit on how long a
// path may pause; a longer pause is split across commands.
export const WAIT_COMMAND_MS=60000;
export const num=value=>{requireThat(Number.isFinite(value),'Nonfinite Dobot number.');return Number(value.toFixed(10));};
export const transform=(p,c)=>[p[0]*c.scaleX+c.offsetXMm,p[1]*c.scaleY+c.offsetYMm,p[2]+c.bedZMm];
export const inverse=(p,c)=>[(p[0]-c.offsetXMm)/c.scaleX,(p[1]-c.offsetYMm)/c.scaleY,p[2]-c.bedZMm];
export const inside=(p,c)=>requireThat(p.every((v,i)=>Number.isFinite(v)&&v>=c.workspaceMinMm[i]-1e-6&&v<=c.workspaceMaxMm[i]+1e-6),'Dobot command exceeds the configured Cartesian workspace (reachability is not checked).');
export const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-6);

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
  requireThat(Object.keys(c).sort().join()===Object.keys(template).sort().join(),'Invalid Dobot instance configuration fields.');
  const missing=Object.keys(template).filter(k=>c[k]===null);
  for(const key of ['toolFrame','userFrame'])if(c[key]!==null)requireThat(Number.isInteger(c[key])&&c[key]>=0&&c[key]<=50,`Invalid Dobot ${key}.`);
  for(const key of ['scaleX','scaleY','maxLinearSpeedMmS','maxLinearAccelMmS2','accelerationPercent','extrusionRateMm3S'])if(c[key]!==null)requireThat(Number.isFinite(c[key])&&c[key]>0,`Invalid Dobot ${key}.`);
  if(c.accelerationPercent!==null)requireThat(c.accelerationPercent<=100,'Dobot acceleration percent exceeds 100.');
  for(const key of ['offsetXMm','offsetYMm','bedZMm','rDeg'])if(c[key]!==null)requireThat(Number.isFinite(c[key]),`Invalid Dobot ${key}.`);
  for(const key of ['initialPositionMm','workspaceMinMm','workspaceMaxMm'])if(c[key]!==null)requireThat(Array.isArray(c[key])&&c[key].length===3&&c[key].every(Number.isFinite),`Invalid Dobot ${key}.`);
  if(c.workspaceMinMm&&c.workspaceMaxMm)requireThat(c.workspaceMinMm.every((v,i)=>v<c.workspaceMaxMm[i]),'Invalid Dobot configured workspace.');
  if(c.configurationSource!==null)requireThat(typeof c.configurationSource==='string'&&c.configurationSource.trim().length>0&&c.configurationSource.length<=1000,'Dobot configuration needs its source.');
  if(c.extrusionOutput!==null)requireThat(typeof c.extrusionOutput==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(c.extrusionOutput),'Invalid Dobot relay output.');
  if(c.relayPolicy!==null)requireThat(c.relayPolicy==='stroke-stop-start-unblended','Unsupported Dobot relay policy. Explicitly select experimental stroke-stop-start-unblended.');
  if(c.temperatureControl!==null)requireThat(c.temperatureControl==='external-preheated','Dobot requires explicit external-preheated temperature control.');
  if(required){
    requireThat(missing.length===0,`Dobot installation is unconfigured; supply ${missing.join(', ')} before export.`);
    requireThat(plan.setup.nozzleC>0,'Supply the externally controlled Dobot nozzle temperature before export.');
  }
  requireThat(plan.process.retractMm===0&&plan.process.fanPercent===0,'Dobot relay output cannot retract or control a fan; set retractMm and fanPercent to zero.');
}
const value=v=>v===null||v===undefined?'Not set':Array.isArray(v)?v.join(', '):String(v);
// Studio settings rows: the installation as configured.
const rows=({setup})=>{const d=setup.dobot;return [
  ['Robot setup',d.configurationSource??'Not configured; supply installation settings through chat'],
  ['Tool / user frame',value(d.toolFrame)+' / '+value(d.userFrame)],['Nozzle orientation',value(d.rDeg)+'° fixed'],
  ['XY calibration scale',value(d.scaleX)+' / '+value(d.scaleY)],['XY calibration offset',value(d.offsetXMm)+' / '+value(d.offsetYMm)+' mm'],
  ['Bed Z offset',value(d.bedZMm)+' mm'],['External starting position',value(d.initialPositionMm)+' mm in design coordinates'],
  ['Controller workspace minimum',value(d.workspaceMinMm)+' mm'],['Controller workspace maximum',value(d.workspaceMaxMm)+' mm'],
  ['Controller linear speed limit',value(d.maxLinearSpeedMmS)+' mm/s'],['Controller acceleration limit',value(d.maxLinearAccelMmS2)+' mm/s²'],
  ['Commanded acceleration',value(d.accelerationPercent)+'%'],['Extrusion output',value(d.extrusionOutput)],
  ['Extrusion policy',value(d.relayPolicy)],['External extrusion rate',value(d.extrusionRateMm3S)+' mm³/s; estimate only'],
  ['Thermal control',value(d.temperatureControl)],['Externally established nozzle / bed temperature',setup.nozzleC+' / '+setup.bedC+'°C']];};
export const createAdapter=Export=>({output:'dobot-lua',poses:false,settings:{key:'dobot',validate,rows},
  export:(prepared,settings)=>exportDobot(prepared,settings,settings.machine,settings.release,Export.packZip)});

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function exportDobot(path,plan,machine,release,packZip){
  const c=config(plan,machine);
  requireThat(equal(path.initialPosition,c.initialPositionMm),'Dobot initial position differs from the locked external start pose.');
  inside(transform(path.initialPosition,c),c);
  const global=`-- SAAM fixed XYZ calibration; installation values are locked in manifest.json.\nfunction P(x,y,z)\n  return {coordinate={x*${num(c.scaleX)}+${num(c.offsetXMm)},y*${num(c.scaleY)}+${num(c.offsetYMm)},z+${num(c.bedZMm)},${num(c.rDeg)}},tool=${c.toolFrame},user=${c.userFrame}}\nend\n`;
  const lines=['-- SAAM experimental stroke relay program','function RunPlan()',`  DO(${JSON.stringify(c.extrusionOutput)},0)`];
  // Timing and the relay estimate use the written commands: P() of the written
  // coordinates, the written SpeedL/AccL percentages, rest-to-rest motion.
  const written=p=>[num(p[0])*num(c.scaleX)+num(c.offsetXMm),num(p[1])*num(c.scaleY)+num(c.offsetYMm),num(p[2])+num(c.bedZMm)];
  const acceleration=num(c.accelerationPercent)/100*c.maxLinearAccelMmS2;
  let relay=false,from=path.initialPosition,controller=transform(c.initialPositionMm,c),seconds=0,volumeMm3=0,estimate=0;
  const switchRelay=on=>{if(on!==relay){lines.push('  Sync()',`  DO(${JSON.stringify(c.extrusionOutput)},${on?1:0})`);relay=on;}};
  for(const a of path.actions){
    if(a.kind==='move'){
      const to=transform(a.to,c),start=transform(from,c);inside(to,c);
      const requestedSeconds=distance(from,a.to)/a.speedMmS;
      const percent=distance(start,to)/requestedSeconds/c.maxLinearSpeedMmS*100;
      requireThat(percent>0&&percent<=100,'Dobot transformed feed exceeds configured linear speed.');
      switchRelay(a.volumeMm3>0);
      const label={phase:a.phase,layer:a.layer,operation:a.operation??null,commandedVolumeMm3:a.volumeMm3};
      lines.push(`  MovL(P(${a.to.map(num).join(',')}),{SpeedL=${num(percent)},AccL=${num(c.accelerationPercent)},CP=0}) -- SAAM ${JSON.stringify(label)}`);
      const target=written(a.to),{durationS}=motionProfile(distance(controller,target),num(percent)/100*c.maxLinearSpeedMmS,acceleration);
      seconds+=durationS;volumeMm3+=a.volumeMm3;if(relay)estimate+=c.extrusionRateMm3S*durationS;
      from=a.to;controller=target;
    }else if(a.kind==='dwell'){
      // A longer pause is the same pause in commands the controller accepts;
      // the parts sum to the requested milliseconds, so it is not shortened.
      switchRelay(false);lines.push('  Sync()');
      let remaining=a.seconds*1000;
      do{const part=Math.min(remaining,WAIT_COMMAND_MS);lines.push(`  Wait(${num(part)})`);seconds+=num(part)/1000;remaining-=part;}while(remaining>0);
    }else if(['retract','recover'].includes(a.kind))requireThat(a.filamentMm===0,'Dobot relay extrusion cannot retract or recover filament.');
    else if(a.kind==='fan')requireThat(a.percent===0,'Dobot output has no fan control.');
    else throw new Error(`Unsupported Dobot action ${a.kind}.`);
  }
  switchRelay(false);lines.push('  Sync()',`  DO(${JSON.stringify(c.extrusionOutput)},0)`,'end','');
  const manifest={schema:'saam-dobot-program/1',machineId:machine.id,setupHash:digest(plan.setup),machineHash:digest(machine),
    entry:'src0.lua',initialPositionMm:path.initialPosition,coordinateFrame:'SAAM design XYZ; P maps to configured tool/user frame',
    relayPolicy:c.relayPolicy,volumeModel:'SAAM commanded intent plus independent relay-rate estimate',release,limitations:DOBOT_LIMITATIONS};
  return {bytes:packZip(new Map([['global.lua',global],['src1.lua',lines.join('\n')],['src0.lua','-- Entry tab: definitions must be loaded first.\nRunPlan()\n'],['manifest.json',JSON.stringify(manifest,null,2)+'\n']])),
    report:{seconds,volumeMm3,materialModel:'relay-estimate',estimatedRelayVolumeMm3:estimate,limitations:DOBOT_LIMITATIONS,
      notice:`Experimental CP=0 stroke relay output. Commanded volume ${volumeMm3.toFixed(2)} mm³; modeled relay-rate estimate ${estimate.toFixed(2)} mm³ (difference ${(estimate-volumeMm3).toFixed(2)} mm³). Neither is measured deposition. Timing is rest-to-rest from the configured speed and acceleration; the drawn path does not show it. Robot reachability, kinematics and collision clearance are unchecked.`}};
}
