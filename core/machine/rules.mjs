import {requireThat} from '../private/export/numeric.mjs';

import {validateTemperatureC} from '../private/export/temperature.mjs';

export const toolFor=(machine,index)=>{
  const tool=machine.tools.find(t=>t.index===index);
  requireThat(tool,'Selected tool is not declared by this machine.');return tool;
};
export const toolBounds=(machine,index)=>toolFor(machine,index).bounds??machine.bounds;
// Read the approved default without changing saved machine snapshot identity.
export const planarWallTolerance=machine=>machine?.planarWallToleranceMm===undefined?0.01:machine.planarWallToleranceMm;

// Common setup fields, then the selected adapter's own block (plan.setup[settings.key])
// through its settings.validate. Null installation fields permit geometry
// review; required (export) makes the adapter name what is missing.
export function validateSetup(plan,machine,{required=false,adapter={}}={}) {
  requireThat(machine.schema==='saam-machine/1'&&machine.units==='mm','Unsupported machine schema or units.');
  requireThat(Number.isFinite(planarWallTolerance(machine))&&planarWallTolerance(machine)>=0,'Machine planar wall tolerance must be finite and nonnegative.');
  const s=plan.setup,key=adapter.settings?.key;
  const common=['tool','core','material','firmwareVersion','nozzleMm','filamentMm','nozzleC','bedC','buildVolumeC','startupVerified','materialGuid'];
  const allowed=[...common,'filamentColor','ams',...key?[key]:[]];
  requireThat(s&&typeof s==='object'&&!Array.isArray(s)&&common.every(k=>Object.hasOwn(s,k))&&Object.keys(s).every(k=>allowed.includes(k)),'Invalid export setup fields.');
  requireThat(typeof s.material==='string'&&typeof s.firmwareVersion==='string','Material and firmware version must be text.');
  requireThat(typeof s.startupVerified==='boolean','Startup verification must be a boolean.');
  if(key)requireThat(s[key]&&typeof s[key]==='object'&&!Array.isArray(s[key]),`Invalid ${key} configuration fields.`);
  const t=toolFor(machine,s.tool);
  requireThat(machine.capabilities?.includes('xyz-extrusion'),'Machine does not support XYZ extrusion.');
  requireThat(t.cores?.includes(s.core)&&t.nozzleDiametersMm?.includes(s.nozzleMm),'Nozzle/core not supported by the selected tool.');
  requireThat(s.filamentMm===machine.filamentDiameterMm,'Filament diameter does not match the machine.');
  for(const target of [s.nozzleC,s.bedC,s.buildVolumeC])validateTemperatureC(target);
  requireThat(machine.outputs.some(o=>o.id===plan.output),'Output is not declared by the machine.');
  const output=machine.outputs.find(o=>o.id===plan.output);
  if(output.constraints?.chamberC!==undefined)requireThat(s.buildVolumeC===output.constraints.chamberC,'This output profile requires no chamber heating (buildVolumeC: 0).');
  requireThat(s.materialGuid===null||typeof s.materialGuid==='string','Invalid material identity.');
  requireThat(s.filamentColor==null||/^#[0-9a-f]{6}$/i.test(s.filamentColor),'Filament color must be a six-digit hex color such as #28A090.');
  adapter.settings?.validate?.({machine,setup:s,process:plan.process,output:plan.output},{required});
}

// The adapter block may state where the installation hands over (initialPositionMm);
// otherwise the selected tool's startup position.
export const startupPosition=(machine,plan,block)=>block?.initialPositionMm??[...toolFor(machine,plan.setup.tool).startupXY,machine.startup.zAfterStartupMm];

// Some startups hand over with the preceding job's final withdrawal still
// outstanding; the profile's startup block says so (the S5 does, the H2D does
// not). A plan can override it; relay machines have no filament axis.
export const startupRetracted=(machine,plan)=>plan.process.retractMm>0
  && (plan.process.startupRetracted??machine.startup.handsOverRetracted===true);
