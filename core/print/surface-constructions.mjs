// Surface presets lower to ordinary family and ownership data. The shared
// course scheduler constructs, connects and finalizes their deposition.
import {heightReferenceMetric} from '../geom/height-slice.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {surveyRoofRegion} from '../region/roof-region.mjs';
import {lineSpacing} from '../path/spacing.mjs';
import {ordinarySliceAssignment} from './slice-settings.mjs';

export const SKIN_DEFAULTS=Object.freeze({spacingFactor:1,layers:2,pitchMm:.2,strokeAngleDeg:0,sampleStepMm:.5,surveyStepMm:.5,maxAngleDegOverride:null});
export const FRONT_DEFAULTS=Object.freeze({lineSpacingMm:.3,beadHeightMm:.2,speedMmS:5,fanPercent:100,toleranceMm:.01,sampleStepMm:.5,propagationStepMm:.1});
export function skinAssignment({id,...options}){
  const a={part:null,filament:null,process:null,after:[],supportFrom:null,...SKIN_DEFAULTS,...options};
  requireThat(!Object.hasOwn(options,'normalMm'),'Use pitchMm for the target mean normal gap.');
  return ordinarySliceAssignment({id,part:a.part,filament:a.filament,process:{planarSpeedMmS:10,firstLayerSpeedMmS:10,...a.process},loops:0,fillDensity:1,solidTop:0,solidBottom:0,
    spacingFactor:a.spacingFactor,sampleStepMm:a.sampleStepMm,fillAnglesDeg:[a.strokeAngleDeg],rotateFill:false,
    surface:{kind:'roof',offsetMm:0},stack:{firstLayerMm:a.pitchMm,layerMm:a.pitchMm},
    within:[{kind:'surface-domain',loopsUv:null,fromLayer:-a.layers,toLayer:0,maxSlopeDeg:a.maxAngleDegOverride??90,sampleStepMm:a.surveyStepMm}],
    contact:{source:a.supportFrom},dependencies:{afterParts:[],beforeParts:[],after:a.after},description:'Roof courses with a target mean normal gap.'});
}
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

export function surveySkinAssignment({assignment,shell,machine}) {
  const domain=assignment.within.find(v=>v.kind==='surface-domain'),pitchMm=assignment.stack.layerMm,limit=domain.maxSlopeDeg??90;
  const metric=heightReferenceMetric({kind:'roof',geometry:shell},{sampleStepMm:domain.sampleStepMm??assignment.sampleStepMm}),translationStepMm=pitchMm/metric.meanProjection;
  const survey=surveyRoofRegion(shell,{layers:-domain.fromLayer,pitchMm,surveyStepMm:domain.sampleStepMm??assignment.sampleStepMm,translationStepMm},limit);
  requireThat(Number.isFinite(survey.maxMm),'The roof survey found no surface.');
  return {...survey,translationStepMm,meanProjection:metric.meanProjection,minProjectedGapMm:translationStepMm*metric.minProjection,maxProjectedGapMm:translationStepMm*metric.maxProjection,targetGapMm:pitchMm};
}

// Presets stop at ordinary family data; ownership and deposition stay shared.
export function lowerSkinAssignment({assignment,survey,process}) {
  return {...assignment,
    within:assignment.within.map(v=>v.kind==='surface-domain'?{kind:v.kind,loopsUv:survey.skinRegion,fromLayer:v.fromLayer,toLayer:v.toLayer}:v)};
}
