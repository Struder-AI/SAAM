import {requireThat} from '../../../core/private/extensions/numeric.mjs';

import {ordinarySliceAssignment} from '../../../core/print/slice-settings.mjs';
export const SKIN_DEFAULTS=Object.freeze({spacingFactor:1,layers:2,pitchMm:.2,strokeAngleDeg:0,sampleStepMm:.5,surveyStepMm:.5,maxAngleDegOverride:null});
export function skinAssignment({id,...options}){
  const a={part:null,filament:null,process:null,after:[],supportFrom:null,...SKIN_DEFAULTS,...options};
  requireThat(!Object.hasOwn(options,'normalMm'),'Use pitchMm for the target mean normal gap.');
  return ordinarySliceAssignment({id,part:a.part,filament:a.filament,process:{planarSpeedMmS:10,firstLayerSpeedMmS:10,...a.process},loops:0,fillDensity:1,solidTop:0,solidBottom:0,
    spacingFactor:a.spacingFactor,sampleStepMm:a.sampleStepMm,fillAnglesDeg:[a.strokeAngleDeg],rotateFill:false,
    surface:{kind:'roof',offsetMm:0},stack:{firstLayerMm:a.pitchMm,layerMm:a.pitchMm},
    within:[{kind:'surface-domain',loopsUv:null,fromLayer:-a.layers,toLayer:0,maxSlopeDeg:a.maxAngleDegOverride??90,sampleStepMm:a.surveyStepMm}],
    contact:{source:a.supportFrom},dependencies:{afterParts:[],beforeParts:[],after:a.after},description:'Roof courses with a target mean normal gap.'});
}
