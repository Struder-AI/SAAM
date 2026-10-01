import {ordinarySliceAssignment} from '../../../core/print/slice-settings.mjs';
export const FRONT_DEFAULTS=Object.freeze({lineSpacingMm:.3,beadHeightMm:.2,speedMmS:5,fanPercent:100,toleranceMm:.01,sampleStepMm:.5,propagationStepMm:.1});
export function frontAssignment({id,...options}) {
  const a={filament:null,process:null,after:[],surface:null,domainUv:[],seedUv:[],afterParts:[],beforeParts:[],reason:'',layers:1,...FRONT_DEFAULTS,...options};
  const native=a.surface?.kind==='patch';
  return ordinarySliceAssignment({id,part:native?a.surface.part??null:a.part??null,filament:a.filament,
    process:{planarSpeedMmS:a.speedMmS,firstLayerSpeedMmS:a.speedMmS,fanPercent:a.fanPercent,...a.process},
    loops:0,fillDensity:1,solidTop:0,solidBottom:0,sampleStepMm:a.sampleStepMm,
    surface:native?{kind:'patch',patch:a.surface.patch,offsetMm:a.surface.offsetMm??0}:a.surface,
    stack:{firstLayerMm:a.beadHeightMm,layerMm:a.beadHeightMm,...(a.direction?{direction:a.direction}:{})},
    within:[{kind:'surface-domain',loopsUv:a.domainUv,fromLayer:-a.layers,toLayer:0}],
    fillOrder:{kind:'fronts',seedUv:a.seedUv?.length?a.seedUv:null,lineSpacingMm:a.lineSpacingMm,propagationStepMm:a.propagationStepMm,toleranceMm:a.toleranceMm},
    dependencies:{afterParts:a.afterParts,beforeParts:a.beforeParts,after:a.after},description:a.reason});
}

