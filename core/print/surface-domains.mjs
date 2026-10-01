// Resolve unbounded roof domains before shared Slice ownership allocation.
import {heightReferenceMetric} from '../geom/height-slice.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {surveyRoofRegion} from '../region/roof-region.mjs';

export function surveySurfaceDomain({assignment,shell}) {
  const domain=assignment.within.find(v=>v.kind==='surface-domain'),pitchMm=assignment.stack.layerMm,limit=domain.maxSlopeDeg??90;
  const metric=heightReferenceMetric({kind:'roof',geometry:shell},{sampleStepMm:domain.sampleStepMm??assignment.sampleStepMm}),translationStepMm=pitchMm/metric.meanProjection;
  const survey=surveyRoofRegion(shell,{layers:-domain.fromLayer,pitchMm,surveyStepMm:domain.sampleStepMm??assignment.sampleStepMm,translationStepMm},limit);
  requireThat(Number.isFinite(survey.maxMm),'The roof survey found no surface.');
  return {...survey,translationStepMm,meanProjection:metric.meanProjection,minProjectedGapMm:translationStepMm*metric.minProjection,maxProjectedGapMm:translationStepMm*metric.maxProjection,targetGapMm:pitchMm};
}

export function resolveSurfaceDomain({assignment,survey}) {
  return {...assignment,
    within:assignment.within.map(v=>v.kind==='surface-domain'?{kind:v.kind,loopsUv:survey.skinRegion,fromLayer:v.fromLayer,toLayer:v.toLayer}:v)};
}
