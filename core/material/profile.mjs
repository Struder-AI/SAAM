import {readFileSync} from 'node:fs';
import {requireThat} from '../geom/tolerance.mjs';

const catalog=JSON.parse(readFileSync(new URL('../../materials/generic.json',import.meta.url),'utf8'));
export const MATERIAL_PROFILES=Object.freeze(catalog.profiles.map(Object.freeze));
export const MATERIAL_IDS=Object.freeze(MATERIAL_PROFILES.map(profile=>profile.id));
export const loadMaterial=id=>{
  const profile=MATERIAL_PROFILES.find(item=>item.id===id);
  requireThat(profile,`Unknown Material profile: ${id}`);return profile;
};

export const hotendFor=(machine,toolIndex,core,nozzleMm)=>{
  const tool=machine.tools.find(item=>item.index===toolIndex);
  requireThat(tool,'Selected tool is not declared by this machine.');
  const hotends=tool.hotends??tool.cores.flatMap(name=>tool.nozzleDiametersMm.map(diameter=>({core:name,nozzleMm:diameter,materialCategories:['standard','engineering','flexible','support','abrasive']})));
  const hotend=hotends.find(item=>item.core===core&&item.nozzleMm===nozzleMm);
  requireThat(hotend,'Nozzle/core combination is not supported by the selected tool.');return hotend;
};

export function normalizeSetup(plan,machine){
  const defaults=machine.defaultSetup;
  if(!Array.isArray(plan.setup.toolSetups)){
    const selected=plan.setup;
    plan.setup.toolSetups=machine.tools.map(tool=>{
      const saved=defaults.toolSetups?.find(item=>item.tool===tool.index);
      const hotend=tool.hotends?.[0];
      return structuredClone(saved??{tool:tool.index,core:hotend?.core??tool.cores[0],nozzleMm:hotend?.nozzleMm??tool.nozzleDiametersMm[0],material:'PLA'});
    });
    const active=plan.setup.toolSetups.find(item=>item.tool===selected.tool);
    if(active)Object.assign(active,{core:selected.core,nozzleMm:selected.nozzleMm,material:selected.material});
  }
  return plan;
}

export function applyToolSelection(plan,machine,{tool,core,nozzleMm,material,nozzleC,bedC,maxFlowMm3S,retractMm,retractSpeedMmS,activate=true}){
  normalizeSetup(plan,machine);
  requireThat(Number.isInteger(tool),'Choose a declared printer tool.');
  const hotend=hotendFor(machine,tool,core,nozzleMm),profile=loadMaterial(material);
  requireThat(hotend.materialCategories.includes(profile.category),`${profile.label} is not supported by ${core}.`);
  requireThat(profile.filamentDiametersMm.includes(machine.filamentDiameterMm),'Material profile does not support this machine filament diameter.');
  requireThat(nozzleMm>=(profile.minNozzleMm??0),`${profile.label} requires at least a ${profile.minNozzleMm} mm nozzle.`);
  const configured={tool,core,nozzleMm,material};
  const index=plan.setup.toolSetups.findIndex(item=>item.tool===tool);
  if(index<0)plan.setup.toolSetups.push(configured);else plan.setup.toolSetups[index]=configured;
  if(!activate)return plan;
  const chosenNozzle=nozzleC??profile.defaultNozzleC,chosenBed=bedC??profile.defaultBedC;
  Object.assign(plan.setup,{tool,core,nozzleMm,material,filamentMm:machine.filamentDiameterMm,nozzleC:chosenNozzle,bedC:chosenBed,
    materialGuid:machine.id==='ultimaker-s5'?profile.export.curaGuid:null});
  Object.assign(plan.process,{firstLayerMm:Number((nozzleMm*.5).toFixed(3)),layerMm:Number((nozzleMm*.5).toFixed(3)),lineWidthMm:nozzleMm,
    maxFlowMm3S:maxFlowMm3S??Math.min(profile.maxFlowMm3S,machine.maxVolumetricFlowMm3S??profile.maxFlowMm3S),
    retractMm:retractMm??Math.min(profile.retraction.defaultMm,machine.defaultProcess?.retractMm??profile.retraction.defaultMm),
    retractSpeedMmS:retractSpeedMmS??profile.retraction.speedMmS});
  return plan;
}
