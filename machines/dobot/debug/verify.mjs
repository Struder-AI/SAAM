import {createHash} from 'node:crypto';
import {LuaRuntime,LuaTable,LuaSubsetError} from './dobot-lua-subset.mjs';
import {requireThat,distance,num,config,transform,inverse,equal,motionProfile,WAIT_COMMAND_MS} from '../dobot.mjs';
// Debug-only machine verification (machine-verify): executes the written Lua in
// a bounded subset runtime. Generation, reopen, Studio and delivery never load
// it; scripts/machine-verify.mjs runs it. Delete it after a physical trial.
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function verify(bytes,plan,machine,Export){
  const c=config(plan,machine),entries=Export.unpackZip(bytes);
  requireThat([...entries.keys()].sort().join()==='global.lua,manifest.json,src0.lua,src1.lua','Dobot bundle must contain exactly global.lua, src1.lua, src0.lua and manifest.json.');
  const manifest=JSON.parse(entries.get('manifest.json').toString('utf8'));
  requireThat(manifest.schema==='saam-dobot-program/1'&&manifest.machineId===machine.id&&manifest.entry==='src0.lua'&&manifest.setupHash===digest(plan.setup)&&manifest.machineHash===digest(machine),'Dobot manifest does not match the locked machine/setup.');
  requireThat(equal(manifest.initialPositionMm??[],c.initialPositionMm)&&manifest.relayPolicy===c.relayPolicy,'Dobot manifest start/policy mismatch.');
  return {...interpretDobotFiles(Object.fromEntries(['global.lua','src1.lua','src0.lua'].map(name=>[name,entries.get(name).toString('utf8')])),plan,machine),limitations:manifest.limitations??[]};
}


function interpretDobotFiles(files,plan,machine,moves=[]) {
  const c=config(plan,machine);
  requireThat(Object.keys(files).sort().join()==='global.lua,src0.lua,src1.lua'&&Object.values(files).every(s=>typeof s==='string'),'Missing Dobot Lua source files.');
  const sourceLines=Object.fromEntries(Object.entries(files).map(([name,text])=>[name,text.split(/\r?\n/)]));
  let controllerPosition=transform(c.initialPositionMm,c),seconds=0,relay=null,volume=0,estimate=0;
  const events=[],estimated=Number.isFinite(c.extrusionRateMm3S)&&c.extrusionRateMm3S>0;
  const fail=(message,site)=>{throw new LuaSubsetError(message,site);};
  const need=(condition,message,site)=>{if(!condition)fail(message,site);};
  const host={
    DO:(args,site)=>{
      need(args.length===2&&String(args[0])===c.extrusionOutput&&[0,1].includes(args[1]),'Unexpected relay output or value.',site);
      relay=args[1]===1;events.push({kind:relay?'extrusion-on':'extrusion-off',startSeconds:seconds,line:site.line,file:site.file});
    },
    Sync:(args,site)=>need(args.length===0,'Sync takes no arguments.',site),
    Wait:(args,site)=>{
      // What one Wait can express, not how long a path may pause: the writer
      // splits a longer pause into consecutive commands.
      need(args.length===1&&Number.isFinite(args[0])&&args[0]>=0&&args[0]<=WAIT_COMMAND_MS,'Invalid Wait milliseconds.',site);
      need(relay===false,'Dwell requires relay off.',site);
      events.push({kind:'dwell',startSeconds:seconds,seconds:args[0]/1000,line:site.line,file:site.file});seconds+=args[0]/1000;
    },
    MovL:(args,site)=>{
      need(args.length===2&&args[0] instanceof LuaTable&&args[1] instanceof LuaTable,'MovL requires an explicit point and options.',site);
      const point=args[0],coordinates=point.get('coordinate'),options=args[1];
      need([...point.map.keys()].sort().join()==='coordinate,tool,user'&&point.get('tool')===c.toolFrame&&point.get('user')===c.userFrame,'Unexpected point fields or tool/user frame.',site);
      need(coordinates instanceof LuaTable&&coordinates.map.size===4&&coordinates.toArray().length===4,'MovL requires exactly XYZ and fixed R.',site);
      // R and AccL are written literally as num(setting) and parse back exactly.
      const values=coordinates.toArray();need(values.every(Number.isFinite)&&values[3]===num(c.rDeg),'Unsupported orientation or nonfinite point.',site);
      need([...options.map.keys()].sort().join()==='AccL,CP,SpeedL'&&options.get('CP')===0,'Only explicit SpeedL/AccL and unblended CP=0 are supported.',site);
      const speedPercent=options.get('SpeedL'),accelPercent=options.get('AccL');
      need(Number.isFinite(speedPercent)&&speedPercent>0&&speedPercent<=100&&accelPercent===num(c.accelerationPercent),'Invalid speed or changed acceleration.',site);
      need(relay!==null,'Unknown initial relay state.',site);
      const to=values.slice(0,3);
      // Points come from written numbers by the same arithmetic, so a repeated point is exactly zero apart.
      const length=distance(controllerPosition,to);need(length>0,'Zero-length MovL is unsupported.',site);
      const speed=speedPercent/100*c.maxLinearSpeedMmS,acceleration=accelPercent/100*c.maxLinearAccelMmS2;
      const timing=motionProfile(length,speed,acceleration);
      const match=/-- SAAM (\{.*\})\s*$/.exec(sourceLines[site.file]?.[site.line-1]??'');
      need(match,'MovL is missing its commanded-intent annotation.',site);
      const label=JSON.parse(match[1]);
      need(typeof label.phase==='string'&&Number.isFinite(label.layer)&&Number.isFinite(label.commandedVolumeMm3)&&label.commandedVolumeMm3>=0,'Invalid commanded intent.',site);
      const fromDesign=inverse(controllerPosition,c),toDesign=inverse(to,c),designLength=distance(fromDesign,toDesign);
      const moveEstimate=estimated?(relay?c.extrusionRateMm3S*timing.durationS:0):null;
      moves.push({line:site.line,file:site.file,from:fromDesign,to:toDesign,controllerFrom:[...controllerPosition],controllerTo:to,
        extruding:relay,volumeMm3:label.commandedVolumeMm3,commandedVolumeMm3:label.commandedVolumeMm3,estimatedRelayVolumeMm3:moveEstimate,
        phase:label.phase,layer:label.layer,operation:label.operation,fan:0,speedMmS:speed*designLength/length,
        startSeconds:seconds,durationSeconds:timing.durationS,controllerLengthMm:length,controllerSpeedMmS:speed,
        accelerationMmS2:acceleration,peakSpeedMmS:timing.peakSpeedMmS,interpolation:'rest-to-rest-linear',blend:0});
      volume+=label.commandedVolumeMm3;if(estimated)estimate+=moveEstimate;seconds+=timing.durationS;controllerPosition=to;
    }
  };
  const runtime=new LuaRuntime({host});
  for(const name of ['global.lua','src1.lua','src0.lua'])runtime.load(files[name],name);
  return {moves,events,seconds,volumeMm3:volume,finalPosition:inverse(controllerPosition,c),
    language:'dobot-lua',notice:`Commanded volume ${volume.toFixed(2)} mm³; ${estimated?`modeled relay-rate estimate ${estimate.toFixed(2)} mm³ (difference ${(estimate-volume).toFixed(2)} mm³)`:'relay-material estimate unavailable'}. Neither is measured deposition.`,checks:['strict-lua-execution','archive-integrity','fixed-frame-orientation','relay-state','commanded-volume-intent-round-trip'],
    sources:files,code:Object.entries(files).map(([name,text])=>`-- FILE ${name}\n${text}`).join('\n'),
    summary:{moves:moves.length,extrusionMoves:moves.filter(m=>m.extruding).length,volumeMm3:volume,commandedVolumeMm3:volume,
      estimatedRelayVolumeMm3:estimated?estimate:null,relayEstimateDifferenceMm3:estimated?estimate-volume:null,filamentMm:null,motionSeconds:seconds,materialModel:estimated?'relay-estimate':'relay-estimate-unavailable',
      coordinateFrame:'Displayed XYZ are inverse-calibrated SAAM design coordinates; controller coordinates are retained per move.',
      startup:'External positioning and heating are required, not simulated. No startup motion, prime or dwell is added.',
      timing:'Estimated rest-to-rest motion from configured controller speed/acceleration; relay and queue latency are unmodeled.',
      clearance:'Robot reachability, kinematics and collision clearance are not checked.'}};
}

