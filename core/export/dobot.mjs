import {requireThat,distance} from '../private/export/numeric.mjs';
// Bounded Dobot adapter: fixed-orientation Cartesian MovL at CP=0 with a stroke
// relay. Cartesian command space only: this is not robot IK or a measured flow model.
import {createHash} from 'node:crypto';
import {packZip} from './zip.mjs';
import {validateSetup} from '../machine/rules.mjs';

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
  requireThat(machine.id==='dobot-mg400'&&plan.output==='dobot-lua','Incompatible Dobot output.');
  validateSetup(plan,machine,{required:true});
  return plan.setup.dobot;
}

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function exportDobot(path,plan,machine,release={}){
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
