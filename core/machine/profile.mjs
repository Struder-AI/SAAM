import { readFileSync } from 'node:fs';
import { requireThat,distance } from '../geom/tolerance.mjs';

export const MACHINE_IDS=['ultimaker-s5','bambu-h2d'];
export function loadMachine(id='ultimaker-s5') {
  requireThat(MACHINE_IDS.includes(id),'Unknown machine profile.');
  return JSON.parse(readFileSync(new URL(`../../machines/${id}.json`,import.meta.url),'utf8'));
}
export const toolFor=(machine,index)=>{
  const tool=machine.tools.find(t=>t.index===index);
  requireThat(tool,'Selected tool is not declared by this machine.');return tool;
};
export const toolBounds=(machine,index)=>toolFor(machine,index).bounds??machine.bounds;
const range=(v,limits,name)=>requireThat(Number.isFinite(v)&&Array.isArray(limits)&&v>=limits[0]&&v<=limits[1],`${name} outside profile limits.`);

export function validateSetup(plan,machine) {
  requireThat(machine.schema==='saam-machine/1'&&machine.units==='mm','Unsupported machine schema or units.');
  const s=plan.setup,p=plan.process,t=toolFor(machine,s.tool),profile=machine.materials?.[s.material];
  requireThat(machine.capabilities?.includes('xyz-extrusion'),'Machine does not support XYZ extrusion.');
  requireThat(t.cores?.includes(s.core)&&t.nozzleDiametersMm?.includes(s.nozzleMm),'Nozzle/core not supported by the selected tool.');
  requireThat(s.filamentMm===machine.filamentDiameterMm,'Filament diameter does not match the machine.');
  requireThat(profile,'Material has no declared process profile.');
  range(s.nozzleC,profile.nozzleC,'Material nozzle temperature');range(s.bedC,profile.bedC,'Material bed temperature');
  range(s.nozzleC,machine.temperatureLimitsC.nozzle,'Machine nozzle temperature');range(s.bedC,machine.temperatureLimitsC.bed,'Machine bed temperature');
  range(s.buildVolumeC,[0,machine.temperatureLimitsC.chamberMax??50],'Build-volume temperature');
  range(p.maxFlowMm3S,[0.1,profile.maxFlowMm3S],'Material flow');
  range(p.retractMm,[0,profile.maxRetractMm],'Retraction');range(p.retractSpeedMmS,[1,machine.maxFeedMmS.e],'Retraction speed');
  range(p.firstLayerMm,t.layerHeightMm,'First layer');range(p.layerMm,t.layerHeightMm,'Layer height');
  range(p.lineWidthMm,[s.nozzleMm*0.75,s.nozzleMm*2],'Line width');
  requireThat(machine.outputs.some(o=>o.id===plan.output),'Output is not declared by the machine.');
  if(plan.output==='griffin-gcode')requireThat(/^[a-f0-9-]{36}$/i.test(s.materialGuid),'A material GUID is required for Griffin.');
  else requireThat(s.materialGuid===null||typeof s.materialGuid==='string','Invalid material identity.');
}

export function requireMachine(machine,capabilities,skill) {
  for(const capability of capabilities) requireThat(machine.capabilities?.includes(capability),`${skill} requires machine capability ${capability}.`);
}

// Validate SAAMpath independently of the chosen machine-program language.
export function checkMachinePath(path,plan,machine) {
  const bounds=toolBounds(machine,plan.setup.tool),area=Math.PI*(plan.setup.filamentMm/2)**2;
  let from=path.initialPosition;
  const point=p=>requireThat(Array.isArray(p)&&p.length===3&&p.every((v,i)=>Number.isFinite(v)&&v>=bounds.min[i]-1e-7&&v<=bounds.max[i]+1e-7),'SAAMpath exceeds selected tool bounds.');
  point(from);
  for(const action of path.actions){
    if(action.kind==='move'){
      point(action.to);const length=distance(from,action.to),seconds=length/action.speedMmS;
      requireThat(seconds>0&&Number.isFinite(seconds)&&Number.isFinite(action.volumeMm3)&&action.volumeMm3>=0,'Invalid machine motion.');
      for(let i=0;i<3;i++)requireThat(Math.abs(action.to[i]-from[i])/seconds<=machine.maxFeedMmS['xyz'[i]]+1e-7,'Machine axis feed exceeded.');
      requireThat(action.volumeMm3/seconds<=plan.process.maxFlowMm3S+1e-7&&action.volumeMm3/area/seconds<=machine.maxFeedMmS.e+1e-7,'Machine/material extrusion feed exceeded.');
      from=action.to;
    } else if(['retract','recover'].includes(action.kind))requireThat(action.speedMmS<=machine.maxFeedMmS.e,'Machine extruder feed exceeded.');
  }
  return {machine:machine.id,tool:plan.setup.tool,bounds,checks:['tool-bounds','axis-feed','material-flow']};
}
