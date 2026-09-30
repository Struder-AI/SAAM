import {loadMachine} from '../../machine/profile.mjs';
import {defaults} from '../../print/plan.mjs';

export function x1ColourFixture(){
  const machine=loadMachine('bambu-x1-carbon'),plan=defaults(machine);
  plan.geometry={shape:'box',runMm:18,widthMm:12,heightMm:1.8};
  plan.placement={xMm:119,yMm:122};
  plan.setup.bambu.fast_start=true;
  plan.setup.bambu.amsConnections=[{unit:1,tool:0}];
  plan.setup.bambu.filaments=['#FFFFFF','#808080','#000000'].map(colour=>({id:'GFA00',colour,tool:0,source:{type:'auto'}}));
  plan.composition.regions=['white','grey','black'].map((id,i)=>({id,part:null,filament:i,
    zStartMm:[0,0.6,1.2][i],zEndMm:[0.6,1.2,null][i],lowerSurfaceFrom:i?['white','grey'][i-1]:null,skills:{'full-fill':{mode:'body'}}}));
  return {plan,machine};
}
