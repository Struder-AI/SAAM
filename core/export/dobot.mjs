// Bounded Dobot adapter, sharing SAAMpath, ZIP integrity and bundle lifecycle.
// The adopted Lua runtime executes the actual delivered helper/entry/body files.
// Cartesian command space only: this is not robot IK or a measured flow model.
import {createHash} from 'node:crypto';
import {packZip,unpackZip} from './zip.mjs';
import {interpretDobotFiles,DOBOT_LIMITATIONS,config,num,transform,inside,equal} from './dobot-player.mjs';
export {motionProfile,DOBOT_LIMITATIONS} from './dobot-player.mjs';
import {validatePath} from './griffin.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

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
  return interpretDobotFiles(files,plan,machine);
}
