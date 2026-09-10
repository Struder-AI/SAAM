// Bounded Dobot adapter, sharing SAAMpath, ZIP integrity and bundle lifecycle.
// The adopted Lua runtime executes the actual delivered helper/entry/body files.
// Cartesian command space only: this is not robot IK or a measured flow model.
import {createHash} from 'node:crypto';
import {packZip,unpackZip} from './zip.mjs';
import {LuaRuntime,LuaTable,LuaSubsetError} from './dobot-lua-subset.mjs';
import {validatePath} from './griffin.mjs';
import {checkMachinePath,validateSetup,validateDobotConfiguration} from '../machine/profile.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';

export const DOBOT_LIMITATIONS=[
  'Experimental stroke-stop-start-unblended relay policy: relay stays on through consecutive deposition moves, and is off during travel and dwell. This differs from the legacy continuous-through-travel reference.',
  'Commanded volume is SAAMpath intent, not metered extrusion. Relay volume is an estimate from the configured external rate and modeled rest-to-rest timing; acceleration, pauses and relay lag can change the actual deposit.',
  'Playback shows fixed-orientation Cartesian commands transformed back into the design frame. Robot joint solutions, reachability, singularities, link/fixture collisions and controller queue latency are not simulated.',
  'No startup motion or heating commands are emitted. The configured initial pose and external nozzle/bed temperatures must already be established. No priming dwell is inserted.',
  'Only linear MovL at CP=0, explicit fixed frame/orientation, DO, Sync and relay-off Wait are supported. Joint moves, arcs, orientation changes, tool changes, nonzero retraction and fan control are rejected. No physical validation has been performed.'
];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const num=value=>{requireThat(Number.isFinite(value),'Nonfinite Dobot number.');return Number(value.toFixed(10));};
const transform=(p,c)=>[p[0]*c.scaleX+c.offsetXMm,p[1]*c.scaleY+c.offsetYMm,p[2]+c.bedZMm];
const inverse=(p,c)=>[(p[0]-c.offsetXMm)/c.scaleX,(p[1]-c.offsetYMm)/c.scaleY,p[2]-c.bedZMm];
const inside=(p,c)=>requireThat(p.every((v,i)=>Number.isFinite(v)&&v>=c.workspaceMinMm[i]-1e-6&&v<=c.workspaceMaxMm[i]+1e-6),'Dobot command exceeds the configured Cartesian workspace (reachability is not checked).');
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-6);

// Adopted from the selected legacy motion-trace/trace-lib.mjs. No assumed
// velocity or acceleration: both come from this instance's locked setup.
export function motionProfile(lengthMm,speedMmS,accelMmS2){
  const ramp=speedMmS*speedMmS/accelMmS2;
  return ramp<=lengthMm
    ?{durationS:2*speedMmS/accelMmS2+(lengthMm-ramp)/speedMmS,peakSpeedMmS:speedMmS}
    :{durationS:2*Math.sqrt(lengthMm/accelMmS2),peakSpeedMmS:Math.sqrt(accelMmS2*lengthMm)};
}

function config(plan,machine){
  requireThat(machine.id==='dobot-mg400'&&plan.output==='dobot-lua','Incompatible Dobot output.');
  validateSetup(plan,machine);validateDobotConfiguration(plan,machine,{required:true});
  return plan.setup.dobot;
}

export function exportDobot(path,plan,machine,release={}){
  const c=config(plan,machine);validatePath(path);
  requireThat(equal(path.initialPosition,c.initialPositionMm),'Dobot initial position differs from the locked external start pose.');
  inside(transform(path.initialPosition,c),c);
  const global=`-- SAAM fixed XYZ calibration; installation values are locked in manifest.json.\nfunction P(x,y,z)\n  return {coordinate={x*${num(c.scaleX)}+${num(c.offsetXMm)},y*${num(c.scaleY)}+${num(c.offsetYMm)},z+${num(c.bedZMm)},${num(c.rDeg)}},tool=${c.toolFrame},user=${c.userFrame}}\nend\n`;
  const lines=['-- SAAM experimental stroke relay program','function RunPlan()',`  DO(${JSON.stringify(c.extrusionOutput)},0)`];
  let relay=false,from=path.initialPosition;
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
      from=a.to;
    }else if(a.kind==='dwell'){
      switchRelay(false);lines.push('  Sync()',`  Wait(${num(a.seconds*1000)})`);
    }else if(['retract','recover'].includes(a.kind))requireThat(a.filamentMm===0,'Dobot relay extrusion cannot retract or recover filament.');
    else if(a.kind==='fan')requireThat(a.percent===0,'Dobot output has no fan control.');
    else throw new Error(`Unsupported Dobot action ${a.kind}.`);
  }
  switchRelay(false);lines.push('  Sync()',`  DO(${JSON.stringify(c.extrusionOutput)},0)`,'end','');
  const manifest={schema:'saam-dobot-program/1',machineId:machine.id,setupHash:digest(plan.setup),machineHash:digest(machine),
    entry:'src0.lua',initialPositionMm:path.initialPosition,coordinateFrame:'SAAM design XYZ; P maps to configured tool/user frame',
    relayPolicy:c.relayPolicy,volumeModel:'SAAM commanded intent plus independent relay-rate estimate',release,limitations:DOBOT_LIMITATIONS};
  return packZip(new Map([['global.lua',global],['src1.lua',lines.join('\n')],['src0.lua','-- Entry tab: definitions must be loaded first.\nRunPlan()\n'],['manifest.json',JSON.stringify(manifest,null,2)+'\n']]));
}

export function interpretDobot(bytes,plan,machine){
  const c=config(plan,machine),entries=unpackZip(bytes);
  requireThat([...entries.keys()].sort().join()==='global.lua,manifest.json,src0.lua,src1.lua','Dobot bundle must contain exactly global.lua, src1.lua, src0.lua and manifest.json.');
  const manifest=JSON.parse(entries.get('manifest.json').toString('utf8'));
  requireThat(manifest.schema==='saam-dobot-program/1'&&manifest.machineId===machine.id&&manifest.entry==='src0.lua'&&manifest.setupHash===digest(plan.setup)&&manifest.machineHash===digest(machine),'Dobot manifest does not match the locked machine/setup.');
  requireThat(equal(manifest.initialPositionMm??[],c.initialPositionMm)&&manifest.relayPolicy===c.relayPolicy,'Dobot manifest start/policy mismatch.');
  const files=Object.fromEntries(['global.lua','src1.lua','src0.lua'].map(name=>[name,entries.get(name).toString('utf8')]));
  const sourceLines=Object.fromEntries(Object.entries(files).map(([name,text])=>[name,text.split(/\r?\n/)]));
  let controllerPosition=transform(c.initialPositionMm,c),seconds=0,relay=null,volume=0,estimate=0,synchronized=true;
  const moves=[],events=[];inside(controllerPosition,c);
  const fail=(message,site)=>{throw new LuaSubsetError(message,site);};
  const need=(condition,message,site)=>{if(!condition)fail(message,site);};
  const host={
    DO:(args,site)=>{
      need(args.length===2&&String(args[0])===c.extrusionOutput&&[0,1].includes(args[1]),'Unexpected relay output or value.',site);
      need(synchronized,'Relay transition requires Sync after queued motion.',site);
      relay=args[1]===1;events.push({kind:relay?'extrusion-on':'extrusion-off',startSeconds:seconds,line:site.line,file:site.file});
    },
    Sync:(args,site)=>{need(args.length===0,'Sync takes no arguments.',site);synchronized=true;},
    Wait:(args,site)=>{
      need(args.length===1&&Number.isFinite(args[0])&&args[0]>=0&&args[0]<=60000,'Invalid Wait milliseconds.',site);
      need(relay===false&&synchronized,'Dwell requires relay off and synchronized motion.',site);
      events.push({kind:'dwell',startSeconds:seconds,seconds:args[0]/1000,line:site.line,file:site.file});seconds+=args[0]/1000;
    },
    MovL:(args,site)=>{
      need(args.length===2&&args[0] instanceof LuaTable&&args[1] instanceof LuaTable,'MovL requires an explicit point and options.',site);
      const point=args[0],coordinates=point.get('coordinate'),options=args[1];
      need([...point.map.keys()].sort().join()==='coordinate,tool,user'&&point.get('tool')===c.toolFrame&&point.get('user')===c.userFrame,'Unexpected point fields or tool/user frame.',site);
      need(coordinates instanceof LuaTable&&coordinates.map.size===4&&coordinates.toArray().length===4,'MovL requires exactly XYZ and fixed R.',site);
      const values=coordinates.toArray();need(values.every(Number.isFinite)&&Math.abs(values[3]-c.rDeg)<1e-8,'Unsupported orientation or nonfinite point.',site);
      need([...options.map.keys()].sort().join()==='AccL,CP,SpeedL'&&options.get('CP')===0,'Only explicit SpeedL/AccL and unblended CP=0 are supported.',site);
      const speedPercent=options.get('SpeedL'),accelPercent=options.get('AccL');
      need(Number.isFinite(speedPercent)&&speedPercent>0&&speedPercent<=100&&Math.abs(accelPercent-c.accelerationPercent)<1e-8,'Invalid speed or changed acceleration.',site);
      need(relay!==null,'Unknown initial relay state.',site);
      const to=values.slice(0,3);inside(to,c);
      const length=distance(controllerPosition,to);need(length>1e-9,'Zero-length MovL is unsupported.',site);
      const speed=speedPercent/100*c.maxLinearSpeedMmS,acceleration=accelPercent/100*c.maxLinearAccelMmS2;
      const timing=motionProfile(length,speed,acceleration);
      const match=/-- SAAM (\{.*\})\s*$/.exec(sourceLines[site.file]?.[site.line-1]??'');
      need(match,'MovL is missing its commanded-intent annotation.',site);
      const label=JSON.parse(match[1]);
      need(typeof label.phase==='string'&&Number.isFinite(label.layer)&&Number.isFinite(label.commandedVolumeMm3)&&label.commandedVolumeMm3>=0,'Invalid commanded intent.',site);
      need(relay===(label.commandedVolumeMm3>0),'Actual relay state differs from the annotated deposition intent.',site);
      const fromDesign=inverse(controllerPosition,c),toDesign=inverse(to,c),designLength=distance(fromDesign,toDesign);
      const moveEstimate=relay?c.extrusionRateMm3S*timing.durationS:0;
      moves.push({line:site.line,file:site.file,from:fromDesign,to:toDesign,controllerFrom:[...controllerPosition],controllerTo:to,
        extruding:relay,volumeMm3:label.commandedVolumeMm3,commandedVolumeMm3:label.commandedVolumeMm3,estimatedRelayVolumeMm3:moveEstimate,
        phase:label.phase,layer:label.layer,operation:label.operation,fan:0,speedMmS:speed*designLength/length,
        startSeconds:seconds,durationSeconds:timing.durationS,controllerLengthMm:length,controllerSpeedMmS:speed,
        accelerationMmS2:acceleration,peakSpeedMmS:timing.peakSpeedMmS,interpolation:'rest-to-rest-linear',blend:0});
      volume+=label.commandedVolumeMm3;estimate+=moveEstimate;seconds+=timing.durationS;controllerPosition=to;synchronized=false;
    }
  };
  const runtime=new LuaRuntime({host,stepLimit:5_000_000});
  for(const name of ['global.lua','src1.lua','src0.lua'])runtime.load(files[name],name);
  requireThat(relay===false&&synchronized&&moves.some(m=>m.extruding),'Dobot program lacks deposition or a synchronized relay-off ending.');
  const reconstructed={schema:'saampath/1',initialPosition:c.initialPositionMm,actions:moves.map(m=>({kind:'move',to:m.to,speedMmS:m.speedMmS,volumeMm3:m.volumeMm3}))};
  checkMachinePath(reconstructed,plan,machine);
  return {moves,events,seconds,volumeMm3:volume,finalPosition:inverse(controllerPosition,c),
    language:'dobot-lua',notice:`Experimental CP=0 stroke relay output. Commanded volume ${volume.toFixed(2)} mm³; modeled relay-rate estimate ${estimate.toFixed(2)} mm³ (difference ${(estimate-volume).toFixed(2)} mm³). Neither is measured deposition. Robot reachability, kinematics and collision clearance are unchecked.`,checks:['strict-lua-execution','archive-integrity','configured-cartesian-workspace','fixed-frame-orientation','relay-state','commanded-volume-intent-round-trip'],
    limitations:DOBOT_LIMITATIONS,code:Object.entries(files).map(([name,text])=>`-- FILE ${name}\n${text}`).join('\n'),
    summary:{moves:moves.length,extrusionMoves:moves.filter(m=>m.extruding).length,volumeMm3:volume,commandedVolumeMm3:volume,
      estimatedRelayVolumeMm3:estimate,relayEstimateDifferenceMm3:estimate-volume,filamentMm:null,motionSeconds:seconds,materialModel:'relay-estimate',
      coordinateFrame:'Displayed XYZ are inverse-calibrated SAAM design coordinates; controller coordinates are retained per move.',
      startup:'External positioning and heating are required, not simulated. No startup motion, prime or dwell is added.',
      timing:'Estimated rest-to-rest motion from configured controller speed/acceleration; relay and queue latency are unmodeled.',
      clearance:'Robot reachability, kinematics and collision clearance are not checked.'}};
}
