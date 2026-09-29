// Common surface-course and seeded-front assignments. The stages return data:
// reserve/survey -> chart curves -> mapping -> local gaps -> deposition.
// Callers finalize/modulate strokes before publishing any supporting boundary.
import {heightSlice,heightSlicePoint,heightReferenceMetric,referenceHeight} from '../geom/height-slice.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {surveyRoofRegion} from '../region/roof-region.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {directedFillStrokes,mapSliceStrokes} from '../region/layer-strokes.mjs';
import {surfaceGapCurves} from '../region/surface-curves.mjs';
import {depositCurves} from '../path/deposition.mjs';
import {surfacePolicy} from '../path/builder.mjs';
import {lineSpacing} from '../path/spacing.mjs';
import {ordinarySliceAssignment} from './slice-settings.mjs';

export const SKIN_DEFAULTS=Object.freeze({spacingFactor:1,layers:2,pitchMm:.2,strokeAngleDeg:0,sampleStepMm:.5,surveyStepMm:.5,maxAngleDegOverride:null});
export const FRONT_DEFAULTS=Object.freeze({lineSpacingMm:.3,beadHeightMm:.2,speedMmS:5,fanPercent:100,toleranceMm:.01,sampleStepMm:.5,propagationStepMm:.1});
export const skinAssignment=({id,...options})=>structuredClone({id,construction:'skin',part:null,filament:null,process:null,after:[],supportFrom:null,...SKIN_DEFAULTS,...options});
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

export function validateSurfaceConstruction(a,{parts,lineWidthMm}) {
  requireThat(a.construction!=='skin'||!Object.hasOwn(a,'normalMm'),'Skin normalMm is obsolete; run explicit bundle migrate to rename it to target mean-normal pitchMm and invalidate generation.');
  requireThat(a.construction!=='fronts','Front construction records are obsolete; run explicit bundle migrate to expand the ordinary slice family preset.');
  const expected=Object.keys(skinAssignment({id:a.id}));
  requireThat(['skin','fronts'].includes(a.construction)&&Object.keys(a).sort().join()===expected.sort().join(),'Invalid surface construction assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid surface assignment id.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Surface filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Surface after lists operation ids.');
  for(const key of a.construction==='skin'?['pitchMm','sampleStepMm','surveyStepMm']:['lineSpacingMm','beadHeightMm','speedMmS','toleranceMm','sampleStepMm','propagationStepMm'])
    requireThat(Number.isFinite(a[key])&&a[key]>0,`Surface ${key} must be positive and finite.`);
  if(a.construction==='skin') {
    requireThat(a.supportFrom===null||typeof a.supportFrom==='string'&&/^[a-z][a-z0-9-]*$/.test(a.supportFrom)&&a.supportFrom!==a.id,'Skin supportFrom must name a different deposited assignment or be null.');
    requireThat(a.part===null||parts?.includes(a.part),'Skin names an unknown part.');
    requireThat(Number.isInteger(a.layers)&&a.layers>0,'Skin layers must be a positive whole number.');
    requireThat(Number.isFinite(a.strokeAngleDeg)&&a.strokeAngleDeg>=-180&&a.strokeAngleDeg<=180,'Skin stroke angle must be -180–180 degrees.');
    requireThat(a.maxAngleDegOverride===null||Number.isFinite(a.maxAngleDegOverride)&&a.maxAngleDegOverride>0&&a.maxAngleDegOverride<90,'Skin angle override must be null or between 0 and 90 degrees.');
    lineSpacing(lineWidthMm,a);return;
  }
}

export function surveySkinAssignment({assignment,shell,machine}) {
  const declaredLimitDeg=machine.nonplanar?.maxAngleDeg??90,limit=assignment.maxAngleDegOverride??90;
  const metric=heightReferenceMetric({kind:'roof',geometry:shell},{sampleStepMm:assignment.surveyStepMm}),translationStepMm=assignment.pitchMm/metric.meanProjection;
  const survey=surveyRoofRegion(shell,{...assignment,translationStepMm},limit);
  requireThat(Number.isFinite(survey.maxMm),'The roof survey found no surface to skin.');
  return {...survey,translationStepMm,meanProjection:metric.meanProjection,minProjectedGapMm:translationStepMm*metric.minProjection,maxProjectedGapMm:translationStepMm*metric.maxProjection,targetGapMm:assignment.pitchMm,declaredLimitDeg,experimentalOverride:Boolean(machine.nonplanar?.experimental)||(assignment.maxAngleDegOverride!==null&&assignment.maxAngleDegOverride!==declaredLimitDeg)};
}

// Presets stop at ordinary family data; ownership and deposition stay shared.
export function lowerSkinAssignment({assignment,survey,process}) {
  return ordinarySliceAssignment({id:assignment.id,part:assignment.part,filament:assignment.filament,
    process:{...assignment.process,planarSpeedMmS:process.skinSpeedMmS,firstLayerSpeedMmS:process.skinSpeedMmS},
    loops:0,fillDensity:1,solidTop:0,solidBottom:0,spacingFactor:assignment.spacingFactor,
    sampleStepMm:assignment.sampleStepMm,fillAnglesDeg:[assignment.strokeAngleDeg],rotateFill:false,
    surface:{kind:'roof',offsetMm:0},stack:{firstLayerMm:assignment.pitchMm,layerMm:assignment.pitchMm},
    within:[{kind:'surface-domain',loopsUv:survey.skinRegion,fromLayer:-assignment.layers,toLayer:0}],
    dependencies:{afterParts:[],beforeParts:[],after:assignment.after},description:'Roof courses with a target mean normal gap.'});
}

// A horizontal body's last available grid plane below a reserved reference.
export const stackTopAt=(reserveZ,process,originZ=0)=>originZ+process.firstLayerMm+Math.max(0,Math.floor((reserveZ-originZ-process.firstLayerMm+1e-9)/process.layerMm))*process.layerMm;

export function constructSkinCurves({assignment,shell,process,survey,supportTopAt=null}) {
  const width=process.lineWidthMm,region=offsetRegion(survey.skinRegion,-width/2);
  requireThat(region.length,'No surface remains for skin: the allowed roof is narrower than one bead or exceeds its fixed-axis angle limit.');
  const reference={kind:'roof',geometry:shell},courses=[];
  const step=survey.translationStepMm,reserve=heightSlice(reference,{offsetMm:-assignment.layers*step,sampleStepMm:assignment.sampleStepMm});
  for(let index=0;index<assignment.layers;index++) {
    const depth=(assignment.layers-index-1)*step;
    const slice=heightSlice(reference,{offsetMm:-depth,sampleStepMm:assignment.sampleStepMm});
    const lower=heightSlice(reference,{offsetMm:-depth-step,sampleStepMm:assignment.sampleStepMm});
    const chart=directedFillStrokes(region,{spacingMm:lineSpacing(width,assignment),angleDeg:assignment.strokeAngleDeg,reverseRows:index%2===1,role:'skin'});
    const mapped=mapSliceStrokes(chart,slice,{frames:true});
    const lowerHeightsMm=mapped.map(curve=>curve.points.map(point=>{
      if(index)return heightSlicePoint(lower,point)[2];
      const reservedZ=heightSlicePoint(reserve,point)[2];
      return supportTopAt?supportTopAt(point[0],point[1],reservedZ):stackTopAt(reservedZ,process,shell.bounds.min[2]);
    }));
    const gaps=surfaceGapCurves(mapped,{slice,lowerHeightsMm,maxAngleDeg:survey.limitDeg});
    courses.push({index,slice,direction:[0,0,1],heightMm:step,translationMm:step,targetGapMm:assignment.pitchMm,region,curves:gaps.curves,report:gaps.report});
  }
  return {courses,region:survey.skinRegion};
}

export function skinResult({assignment,shell,process,machine,survey,after=[],supportTopAt=null}) {
  const {courses,region}=constructSkinCurves({assignment,shell,process,survey,supportTopAt});
  const operations=[],id=assignment.id;
  for(const {index,slice,curves} of courses) {
    const surfaceZ=(x,y)=>{const top=referenceHeight(slice.reference,x,y);return !top||top.patch==='bottom'||top.slopeDeg>survey.limitDeg+1e-6?null:heightSlicePoint(slice,[x,y])[2];};
    const strokes=depositCurves(curves,{widthMm:process.lineWidthMm,heightMm:assignment.pitchMm,speedMmS:process.skinSpeedMmS});
    operations.push({id:`${id}:${index}`,layerId:`${id}:${index}`,phase:'skin',layer:index,layerIndex:index,layerCount:courses.length,stackDirection:[0,0,1],rank:shell.bounds.max[2]+index+1,slice,region,
      after:index?[`${id}:${index-1}`]:[...new Set([...assignment.after,...after])],strokes,order:'nearest-cells',connectNearby:true,
      travelPolicy:surfacePolicy(region,{surfaceZ,maxZ:shell.bounds.max[2],maxCombMm:process.maxCombMm,lineWidthMm:process.lineWidthMm,liftMm:process.liftMm,
        sampleStepMm:assignment.sampleStepMm,sagMm:Math.min(.05,assignment.pitchMm/4)}),...(assignment.filament===null?{}:{filament:assignment.filament})});
  }
  const reports=courses.map(course=>course.report);
  return {id,operations,family:{base:courses[0].slice,direction:[0,0,1],pitchMm:assignment.pitchMm,firstLayerMm:assignment.pitchMm,translationStepMm:survey.translationStepMm,layers:courses},report:{construction:'skin',stackMetric:'target-mean-normal-gap',targetGapMm:assignment.pitchMm,translationStepMm:survey.translationStepMm,meanProjectedGapMm:assignment.pitchMm,minProjectedGapMm:survey.minProjectedGapMm,maxProjectedGapMm:survey.maxProjectedGapMm,skinLayers:courses.length,strokes:operations.reduce((n,op)=>n+op.strokes.length,0),excludedFraction:survey.steepFraction,
    maxSlopeDeg:survey.maxSlopeDeg,limitDeg:survey.limitDeg,skinAreaMm2:survey.skinAreaMm2,minGapMm:Math.min(...reports.map(r=>r.minGapMm)),maxGapMm:Math.max(...reports.map(r=>r.maxGapMm)),
    minNormalGapMm:Math.min(...reports.map(r=>r.minNormalGapMm)),maxNormalGapMm:Math.max(...reports.map(r=>r.maxNormalGapMm)),maxMappedSlopeDeg:Math.max(...reports.map(r=>r.maxMappedSlopeDeg)),gapMetric:'local-normal-projection'},
    boundaryRequest:{shell,startMm:shell.bounds.min[2],endMm:shell.bounds.max[2],boundary:'top',maxSlopeDeg:survey.limitDeg}};
}

