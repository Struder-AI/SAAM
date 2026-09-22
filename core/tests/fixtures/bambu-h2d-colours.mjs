import {loadMachine} from '../../machine/profile.mjs';
import {defaults} from '../../print/plan.mjs';

export function h2dColourFixture(){
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  Object.assign(plan.setup,{tool:1,nozzleMm:0.8,core:'Hardened steel 0.8',nozzleC:225,ams:null});
  Object.assign(plan.process,{lineWidthMm:0.8,firstLayerMm:0.3,layerMm:0.3,minimumLayerSeconds:0});
  Object.assign(plan.setup.bambu,{otherNozzleMm:0.4,fast_start:true,filament:0,amsConnections:[{unit:1,tool:1}],
    filaments:['#0000FF','#FF8000'].map(colour=>({id:'GFA00',colour,tool:1,source:{type:'auto'}}))});
  plan.geometry={shape:'box',runMm:24,widthMm:16,heightMm:1.8};
  plan.placement={xMm:163,yMm:152};
  plan.composition.regions=['blue-base','orange-middle','blue-top'].map((id,i)=>({id,part:null,filament:i%2,
    zStartMm:[0,0.6,1.2][i],zEndMm:[0.6,1.2,null][i],lowerSurfaceFrom:i?['blue-base','orange-middle'][i-1]:null,
    skills:{'full-fill':{mode:'body'}}}));
  return {plan,machine};
}
