import {requireThat,distance} from '../geom/tolerance.mjs';
import {validateDensoConfiguration} from './denso.mjs';
import {requireProcessControl,validateNozzleC,plannedNozzleTemperatures} from '../path/process-controls.mjs';

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
const range=(v,limits,name)=>requireThat(Number.isFinite(v)&&Array.isArray(limits)&&v>=limits[0]&&v<=limits[1],`${name} outside profile limits.`);
// Read the approved default without changing saved machine snapshot identity.
export const planarWallTolerance=machine=>machine?.planarWallToleranceMm===undefined?0.01:machine.planarWallToleranceMm;

export function validateSetup(plan,machine,{required=false}={}) {
  requireThat(machine.schema==='saam-machine/1'&&machine.units==='mm','Unsupported machine schema or units.');
  requireThat(Number.isFinite(planarWallTolerance(machine))&&planarWallTolerance(machine)>=0,'Machine planar wall tolerance must be finite and nonnegative.');
  const s=plan.setup,p=plan.process,t=toolFor(machine,s.tool),profile=machine.materials?.[s.material];
  if(machine.id==='denso-vp6242-rc8')validateDensoConfiguration(plan,{required});
  requireThat(machine.capabilities?.includes('xyz-extrusion'),'Machine does not support XYZ extrusion.');
  requireThat(t.cores?.includes(s.core)&&t.nozzleDiametersMm?.includes(s.nozzleMm),'Nozzle/core not supported by the selected tool.');
  requireThat(s.filamentMm===machine.filamentDiameterMm,'Filament diameter does not match the machine.');
  requireThat(profile,'Material has no declared process profile.');
  range(s.nozzleC,profile.nozzleC,'Material nozzle temperature');range(s.bedC,profile.bedC,'Material bed temperature');
  range(s.nozzleC,machine.temperatureLimitsC.nozzle,'Machine nozzle temperature');range(s.bedC,machine.temperatureLimitsC.bed,'Machine bed temperature');
  range(s.buildVolumeC,[0,machine.temperatureLimitsC.chamberMax??50],'Build-volume temperature');
  const experimental=p.experimentalDeposition;
  requireThat(!experimental||t.experimentalPlanar,'Selected tool has no experimental planar-deposition envelope.');
  range(p.maxFlowMm3S,[0.1,experimental?(profile.experimentalMaxFlowMm3S??profile.maxFlowMm3S):profile.maxFlowMm3S],'Material flow');
  range(p.retractMm,[0,profile.maxRetractMm],'Retraction');range(p.retractSpeedMmS,[1,machine.maxFeedMmS.e],'Retraction speed');
  const layerLimits=experimental?t.experimentalPlanar.layerHeightMm:t.layerHeightMm;
  range(p.firstLayerMm,layerLimits,'First layer');range(p.layerMm,layerLimits,'Layer height');
  range(p.lineWidthMm,lineWidthLimits(plan,machine),'Line width');
  requireThat(machine.outputs.some(o=>o.id===plan.output),'Output is not declared by the machine.');
  const output=machine.outputs.find(o=>o.id===plan.output);
  if(output.constraints?.chamberC!==undefined)requireThat(s.buildVolumeC===output.constraints.chamberC,'This output profile requires no chamber heating (buildVolumeC: 0).');
  if(plan.output==='griffin-gcode')requireThat(/^[a-f0-9-]{36}$/i.test(s.materialGuid),'A material GUID is required for Griffin.');
  else requireThat(s.materialGuid===null||typeof s.materialGuid==='string','Invalid material identity.');
  // A colour only labels the job in the printer's own software; it is optional.
  requireThat(s.filamentColor==null||/^#[0-9a-f]{6}$/i.test(s.filamentColor),'Filament color must be a six-digit hex color such as #28A090.');
  feederSelector(plan,machine);
  if(machine.id==='dobot-mg400'){
    validateDobotConfiguration(plan,machine,{required});
    requireThat(p.retractMm===0&&p.fanPercent===0,'Dobot relay output cannot retract or control a fan; set retractMm and fanPercent to zero.');
  }
}

export function lineWidthLimits(plan,machine){
  const tool=toolFor(machine,plan.setup.tool);
  return plan.process.experimentalDeposition?tool.experimentalPlanar?.lineWidthMm:[plan.setup.nozzleMm*0.75,plan.setup.nozzleMm*2];
}

// Optional spool choice from the profile's declared feeder units. No request
// keeps the first filament path, which a printer without a feeder also uses.
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
    requireThat(c.extrusionRateMm3S<=plan.process.maxFlowMm3S,'Dobot configured relay rate exceeds the locked material flow limit.');
  }
  return {configured:missing.length===0,missing};
}

export const startupPosition=(machine,plan)=>plan.setup.denso?.initialPositionMm??plan.setup.dobot?.initialPositionMm??[...toolFor(machine,plan.setup.tool).startupXY,machine.startup.zAfterStartupMm];

// Some startups hand over with the preceding job's final withdrawal still
// outstanding; the profile's startup block says so (the S5 does, the H2D does
// not). A plan can override it; relay machines have no filament axis.
export const startupRetracted=(machine,plan)=>plan.process.retractMm>0
  && (plan.process.startupRetracted??machine.startup.handsOverRetracted===true);

export function requireMachine(machine,capabilities,skill) {
  for(const capability of capabilities) requireThat(machine.capabilities?.includes(capability),`${skill} requires machine capability ${capability}.`);
}

// Validate SAAMpath independently of the chosen machine-program language.
export function checkMachinePath(path,plan,machine) {
  let bounds=toolBounds(machine,plan.setup.tool);const area=Math.PI*(plan.setup.filamentMm/2)**2;
  let from=path.initialPosition;
  const point=p=>requireThat(Array.isArray(p)&&p.length===3&&p.every((v,i)=>Number.isFinite(v)&&v>=bounds.min[i]-1e-7&&v<=bounds.max[i]+1e-7),'SAAMpath exceeds selected tool bounds.');
  point(from);
  for(const action of path.actions){
    if(action.kind==='move'){
      point(action.to);const length=distance(from,action.to),seconds=length/action.speedMmS;
      requireThat(seconds>0&&Number.isFinite(seconds)&&Number.isFinite(action.volumeMm3)&&action.volumeMm3>=0,'Invalid machine motion.');
      for(let i=0;i<3;i++)requireThat(Math.abs(action.to[i]-from[i])/seconds<=machine.maxFeedMmS['xyz'[i]]+1e-7,'Machine axis feed exceeded.');
      requireThat(action.volumeMm3/seconds<=plan.process.maxFlowMm3S+1e-7&&(machine.id==='dobot-mg400'||action.volumeMm3/area/seconds<=machine.maxFeedMmS.e+1e-7),'Machine/material extrusion feed exceeded.');
      from=action.to;
    } else if(action.kind==='extrude'){
      requireProcessControl(machine);point(from);
      requireThat(Number.isFinite(action.volumeMm3)&&action.volumeMm3>0&&Number.isFinite(action.flowMm3S)&&action.flowMm3S>0&&action.flowMm3S<=plan.process.maxFlowMm3S&&action.flowMm3S/area<=machine.maxFeedMmS.e,'Invalid stationary extrusion or flow exceeded.');
    } else if(action.kind==='temperature'){
      requireProcessControl(machine);validateNozzleC(action.targetC,plan,machine);
      requireThat(plannedNozzleTemperatures(plan).has(action.targetC),'Unplanned operation temperature.');
    } else if(action.kind==='tool'){
      // Later moves are held to the new nozzle's reach; the machine's own sequence leaves the head at the recorded position.
      bounds=toolBounds(machine,action.toTool);if(action.position){point(action.position);from=action.position;}
    } else if(['retract','recover'].includes(action.kind))requireThat(action.speedMmS<=machine.maxFeedMmS.e&&(machine.id!=='dobot-mg400'||action.filamentMm===0),'Machine extruder feed exceeded or relay retraction unsupported.');
    else if(action.kind==='fan'&&machine.id==='dobot-mg400')requireThat(action.percent===0,'Dobot output has no fan control.');
  }
  return {machine:machine.id,tool:plan.setup.tool,bounds,checks:['tool-bounds','axis-feed','material-flow'],...(machine.id==='dobot-mg400'?{configuration:validateDobotConfiguration(plan,machine),coverage:'Proposed design envelope and commanded volume only; robot kinematics, measured extrusion and collision clearance are unchecked.'}:{})};
}
