import {ordinarySliceAssignment} from '../../../core/print/slice-settings.mjs';
export function rimAssignment({id,part=null,filament=null,process=null,after=[],source=null,steps=[2],minFeatureMm=.4}){
  return ordinarySliceAssignment({id,part,filament,process,loops:steps,fillDensity:0,solidTop:0,solidBottom:0,
    surface:{kind:'terminal',assignment:source,minFeatureMm},contact:{source},dependencies:{afterParts:[],beforeParts:[],after}});
}

