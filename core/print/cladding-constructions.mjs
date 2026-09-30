// Guidance preset: normal stacks and periodic cell fill are ordinary Slice data.
import {ordinarySliceAssignment} from './slice-settings.mjs';
export function claddingAssignment({id,part=null,filament=null,process=null,after=[],source=null,pattern='axial-hoop',spacingFactor=1,shells=4,normalMm=.2,sampleStepMm=1,toleranceMm=.01,surface=null,offsetTightness=1,toolPose=null}){
  if(!['axial-hoop','crossed-helices'].includes(pattern))throw Error('Choose axial-hoop or crossed-helices.');
  return ordinarySliceAssignment({id,part,filament,process:{planarSpeedMmS:10,firstLayerSpeedMmS:10,...process},loops:0,fillDensity:1,solidTop:0,solidBottom:0,spacingFactor,sampleStepMm,
    surface,stack:{firstLayerMm:normalMm,layerMm:normalMm,direction:'normal'},within:[{kind:'normal-band',fromMm:0,toMm:shells*normalMm}],
    fillOrder:{kind:'surface-cells',directions:pattern==='axial-hoop'?['axial','circumferential']:['forward','reverse'],toleranceMm,offsetTightness},
    contact:{source},toolPose,dependencies:{afterParts:[],beforeParts:[],after}});
}
