import {requireThat,distance} from '../private/export/numeric.mjs';

import {validateDensoConfiguration} from './denso.mjs';
import {validateTemperatureC,authoredNozzleTargets} from '../private/export/temperature.mjs';
import {checkedFilamentPlan as filamentPlan} from './filaments.mjs';

export const toolFor=(machine,index)=>{
  const tool=machine.tools.find(t=>t.index===index);
  requireThat(tool,'Selected tool is not declared by this machine.');return tool;
};
export const toolBounds=(machine,index)=>toolFor(machine,index).bounds??machine.bounds;
// Default XY placement that centers a footprint on a cartesian build plate.
// Placement is the part's near-corner offset (local geometry has its minimum
// XY at the origin), so centering subtracts half the footprint from the plate
// centre. Robot arms (denso, dobot) have no rectangular plate to centre on and
// return null; those callers keep their own near-origin default.
export function centeredPlacement(machine,index,{runMm,widthMm}){
  if(!machine.kinematics?.startsWith('cartesian'))return null;
  const b=toolBounds(machine,index);
  return {xMm:(b.min[0]+b.max[0])/2-runMm/2,yMm:(b.min[1]+b.max[1])/2-widthMm/2};
}
// Read the approved default without changing saved machine snapshot identity.
export const planarWallTolerance=machine=>machine?.planarWallToleranceMm===undefined?0.01:machine.planarWallToleranceMm;

export function validateSetup(plan,machine,{required=false}={}) {
  requireThat(machine.schema==='saam-machine/1'&&machine.units==='mm','Unsupported machine schema or units.');
  requireThat(Number.isFinite(planarWallTolerance(machine))&&planarWallTolerance(machine)>=0,'Machine planar wall tolerance must be finite and nonnegative.');
  const s=plan.setup,p=plan.process,t=toolFor(machine,s.tool);
  if(machine.id==='denso-vs068a4-rc8a')validateDensoConfiguration(plan,{required});
  requireThat(machine.capabilities?.includes('xyz-extrusion'),'Machine does not support XYZ extrusion.');
  requireThat(t.cores?.includes(s.core)&&t.nozzleDiametersMm?.includes(s.nozzleMm),'Nozzle/core not supported by the selected tool.');
  requireThat(s.filamentMm===machine.filamentDiameterMm,'Filament diameter does not match the machine.');
  for(const target of [s.nozzleC,s.bedC,s.buildVolumeC])validateTemperatureC(target);
  requireThat(machine.outputs.some(o=>o.id===plan.output),'Output is not declared by the machine.');
  const output=machine.outputs.find(o=>o.id===plan.output);
  if(output.constraints?.chamberC!==undefined)requireThat(s.buildVolumeC===output.constraints.chamberC,'This output profile requires no chamber heating (buildVolumeC: 0).');
  if(plan.output==='griffin-gcode')requireThat(/^[a-f0-9-]{36}$/i.test(s.materialGuid),'A material GUID is required for Griffin.');
  else requireThat(s.materialGuid===null||typeof s.materialGuid==='string','Invalid material identity.');
  // Spool identity is a mapping hint, not a guarantee of physical AMS selection.
  // The Bambu exporter separately records logical filament and requested tray.
  requireThat(s.filamentColor==null||/^#[0-9a-f]{6}$/i.test(s.filamentColor),'Filament color must be a six-digit hex color such as #28A090.');
  feederSelector(plan,machine);
  if(machine.id==='dobot-mg400'){
    validateDobotConfiguration(plan,machine,{required});
    requireThat(p.retractMm===0&&p.fanPercent===0,'Dobot relay output cannot retract or control a fan; set retractMm and fanPercent to zero.');
  }
}

// Optional spool choice from the profile's declared feeder units. No request
// keeps the first filament path, which a printer without a feeder also uses.
// This flattens physical tray intent only. It must never be emitted as a
// logical filament ID. Printer/job dispatch owns that mapping; see bambu.md.
export function feederSelector(plan,machine){
  const request=plan.setup.ams,feeder=machine.ams;
  if(request==null)return 0;
  requireThat(feeder,'This machine profile declares no AMS.');
  requireThat([[request.unit,feeder.units],[request.slot,feeder.slotsPerUnit]].every(([value,count])=>Number.isInteger(value)&&value>=1&&value<=count),
    `AMS choice must be unit 1–${feeder.units} and slot 1–${feeder.slotsPerUnit}.`);
  return (request.unit-1)*feeder.slotsPerUnit+request.slot-1;
}

// Machine-instance values are locked by the same setup/plan hash as the recipe.
// Null means unresolved, permitting geometry review but never machine export.
export function validateDobotConfiguration(plan,machine,{required=false}={}){
  const c=plan.setup.dobot,template=machine.defaultSetup.dobot;
  requireThat(c&&Object.keys(c).sort().join()===Object.keys(template).sort().join(),'Invalid Dobot instance configuration fields.');
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
  return {configured:missing.length===0,missing};
}

export const startupPosition=(machine,plan)=>plan.setup.denso?.initialPositionMm??plan.setup.dobot?.initialPositionMm??[...toolFor(machine,plan.setup.tool).startupXY,machine.startup.zAfterStartupMm];

// Some startups hand over with the preceding job's final withdrawal still
// outstanding; the profile's startup block says so (the S5 does, the H2D does
// not). A plan can override it; relay machines have no filament axis.
export const startupRetracted=(machine,plan)=>plan.process.retractMm>0
  && (plan.process.startupRetracted??machine.startup.handsOverRetracted===true);

export const sameNozzleMaterialChanges=machine=>machine.outputs.some(o=>o.id==='bambu-gcode'&&o.constraints?.materialChangeMode==='single-nozzle-ams');

export function requireProcessControl(machine){
  requireThat(machine.outputs?.some(o=>['griffin-gcode','bambu-gcode'].includes(o.id)),
    'Stationary metered extrusion and operation temperature control require a supported filament-axis G-code output; relay robot outputs are not implemented.');
}

export function requireMachine(machine,capabilities,skill) {
  for(const capability of capabilities) requireThat(machine.capabilities?.includes(capability),`${skill} requires machine capability ${capability}.`);
}

// Validate SAAMpath independently of the chosen machine-program language.
export function checkMachinePath(path,plan,machine) {
  const temperatures=authoredNozzleTargets(plan,path.completion?.authoredNozzleTemperatures);
  let selected=plan,bounds=toolBounds(machine,plan.setup.tool);
  let from=path.initialPosition;
  const point=p=>requireThat(Array.isArray(p)&&p.length===3&&p.every((v,i)=>Number.isFinite(v)&&v>=bounds.min[i]-1e-7&&v<=bounds.max[i]+1e-7),'SAAMpath exceeds selected tool bounds.');
  point(from);
  for(const action of path.actions){
    if(action.kind==='toolChange'){
      selected=filamentPlan(plan,machine,action.filament);validateSetup(selected,machine);
      requireThat(action.tool===selected.setup.tool,'Tool-change action disagrees with its filament.');
      bounds=toolBounds(machine,selected.setup.tool);point(from);continue;
    }
    if(action.kind==='move'){
      point(action.to);const length=distance(from,action.to),seconds=action.durationSeconds??length/action.speedMmS;
      requireThat(seconds>0&&Number.isFinite(seconds)&&Number.isFinite(action.volumeMm3)&&action.volumeMm3>=0,'Invalid machine motion.');
      for(let i=0;i<3;i++)requireThat(Math.abs(action.to[i]-from[i])/seconds<=machine.maxFeedMmS['xyz'[i]]+1e-7,'Machine axis feed exceeded.');
      from=action.to;
    } else if(action.kind==='extrude'){
      requireProcessControl(machine);point(from);
      requireThat(Number.isFinite(action.volumeMm3)&&action.volumeMm3>0&&Number.isFinite(action.flowMm3S)&&action.flowMm3S>0,'Invalid stationary extrusion.');
    } else if(action.kind==='temperature'){
      requireProcessControl(machine);validateTemperatureC(action.targetC);
      requireThat(temperatures.has(action.targetC),'Unplanned operation temperature; supply the saved neutral SAAMpath target inventory.');
    } else if(['retract','recover'].includes(action.kind)&&machine.id==='dobot-mg400')requireThat(action.filamentMm===0,'Relay retraction unsupported.');
    else if(action.kind==='fan'&&machine.id==='dobot-mg400')requireThat(action.percent===0,'Dobot output has no fan control.');
  }
  return {machine:machine.id,tool:plan.setup.tool,bounds,checks:['tool-bounds','axis-feed','finite-deposition'],...(machine.id==='dobot-mg400'?{configuration:validateDobotConfiguration(plan,machine),coverage:'Proposed design envelope and commanded volume only; robot kinematics, measured extrusion and collision clearance are unchecked.'}:{})};
}
