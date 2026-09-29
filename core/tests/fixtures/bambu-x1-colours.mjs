import {loadMachine} from '../../machine/profile.mjs';
import {defaults} from '../../print/plan.mjs';
import {sliceAssignment} from '../../print/slices.mjs';
import {splineBox} from './spline-shapes.mjs';

export function x1ColourFixture(){
  const machine=loadMachine('bambu-x1-carbon'),plan=defaults(machine);
  plan.geometry=splineBox({runMm:18,widthMm:12,heightMm:1.8});
  plan.placement={xMm:119,yMm:122};
  plan.setup.bambu.fast_start=true;
  plan.setup.bambu.amsConnections=[{unit:1,tool:0}];
  plan.setup.bambu.filaments=['#FFFFFF','#808080','#000000'].map(colour=>({id:'GFA00',colour,tool:0,source:{type:'auto'}}));

  plan.slices.assignments=['white','grey','black'].map((id,i)=>sliceAssignment({id,filament:i,fillDensity:1,
    within:[{kind:'slab',fromMm:[0,0.6,1.2][i],toMm:[0.6,1.2,null][i]}]}));
  return {plan,machine};
}
