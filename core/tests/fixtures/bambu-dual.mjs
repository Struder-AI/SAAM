import {loadMachine} from '../../machine/profile.mjs';
import {defaults} from '../../print/plan.mjs';
import {boxMesh} from './mesh.mjs';

export function mixedNozzleFixture(){
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  Object.assign(plan.setup,{tool:0,nozzleMm:0.4,core:'Hardened steel 0.4',nozzleC:215,ams:null});
  Object.assign(plan.setup.bambu,{otherNozzleMm:0.8,filament:0,amsConnections:[{unit:1,tool:1}],filaments:[
    {id:'GFA00',colour:'#FFFF00',tool:0,source:{type:'external'}},
    {id:'GFA00',colour:'#00AE42',tool:1,source:{type:'auto'},nozzleC:225,process:{lineWidthMm:0.8,firstLayerMm:0.3,layerMm:0.3}},
  ]});
  plan.geometry={shape:'assembly',parts:['left-part','right-part'].map((id,i)=>({id,xMm:i*20,yMm:0,zMm:0,geometry:{shape:'box',runMm:8,widthMm:8,heightMm:1.2}}))};
  plan.placement={xMm:120,yMm:110};plan.process.minimumLayerSeconds=0;
  plan.composition.regions=['left-part','right-part'].map((part,filament)=>({id:part,part,filament,zStartMm:0,zEndMm:null,lowerSurfaceFrom:null,skills:{'full-fill':{mode:'body'}}}));
  return {plan,machine};
}

// Exact geometry/setup of the physically successful DUAL-12 control.
// This reproduces its executable, not its foreign project-settings entry.
export function dualNozzleVerificationFixture(){
  const fixture=mixedNozzleFixture(),{plan}=fixture;
  plan.setup.bambu.fast_start=true;
  plan.setup.bambu.filaments[0].colour='#808080'; // display placeholder, external PLA
  plan.setup.bambu.filaments[1].colour='#0000FF';
  plan.placement={xMm:169,yMm:154};
  for(const [i,part]of plan.geometry.parts.entries()){
    part.xMm=i*60;part.geometry=boxMesh(12,12,i?0.3:0.4);
  }
  return fixture;
}
