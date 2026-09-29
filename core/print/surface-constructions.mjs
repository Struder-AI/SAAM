// Common surface-course and seeded-front assignments. The stages return data:
// reserve/survey -> chart curves -> mapping -> local gaps -> deposition.
// Callers finalize/modulate strokes before publishing any supporting boundary.
import {heightSlice,heightSlicePoint,heightReferencePatch,referenceHeight} from '../geom/height-slice.mjs';
import {patchSlice} from '../geom/slice.mjs';
import {validateSplineSolid} from '../geom/spline-solid.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {surveyRoofRegion} from '../region/roof-region.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {directedFillStrokes,mapSliceStrokes} from '../region/layer-strokes.mjs';
import {surfaceGapCurves} from '../region/surface-curves.mjs';
import {seededSurfaceFronts,connectSurfacePasses} from '../region/seeded-fronts.mjs';
import {depositCurves,maximumPathAngle} from '../path/deposition.mjs';
import {surfacePolicy} from '../path/builder.mjs';
import {lineSpacing} from '../path/spacing.mjs';
import {assignmentPlan} from './assignment-process.mjs';

export const SKIN_DEFAULTS=Object.freeze({spacingFactor:1,layers:2,normalMm:.2,strokeAngleDeg:0,sampleStepMm:.5,surveyStepMm:.5,maxAngleDegOverride:null});
export const FRONT_DEFAULTS=Object.freeze({lineSpacingMm:.3,beadHeightMm:.2,speedMmS:5,fanPercent:100,toleranceMm:.01,sampleStepMm:.5,propagationStepMm:.1});
export const skinAssignment=({id,...options})=>structuredClone({id,construction:'skin',part:null,filament:null,process:null,after:[],supportFrom:null,...SKIN_DEFAULTS,...options});
export const frontAssignment=({id,...options})=>structuredClone({id,construction:'fronts',filament:null,process:null,after:[],surface:null,domainUv:[],seedUv:[],afterParts:[],beforeParts:[],reason:'',...FRONT_DEFAULTS,...options});

export function validateSurfaceConstruction(a,{parts,lineWidthMm}) {
  const expected=a.construction==='skin'?Object.keys(skinAssignment({id:a.id})):Object.keys(frontAssignment({id:a.id}));
  requireThat(['skin','fronts'].includes(a.construction)&&Object.keys(a).sort().join()===expected.sort().join(),'Invalid surface construction assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid surface assignment id.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Surface filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Surface after lists operation ids.');
  for(const key of a.construction==='skin'?['normalMm','sampleStepMm','surveyStepMm']:['lineSpacingMm','beadHeightMm','speedMmS','toleranceMm','sampleStepMm','propagationStepMm'])
    requireThat(Number.isFinite(a[key])&&a[key]>0,`Surface ${key} must be positive and finite.`);
  if(a.construction==='skin') {
    requireThat(a.supportFrom===null||typeof a.supportFrom==='string'&&/^[a-z][a-z0-9-]*$/.test(a.supportFrom)&&a.supportFrom!==a.id,'Skin supportFrom must name a different deposited assignment or be null.');
    requireThat(a.part===null||parts?.includes(a.part),'Skin names an unknown part.');
    requireThat(Number.isInteger(a.layers)&&a.layers>0,'Skin layers must be a positive whole number.');
    requireThat(Number.isFinite(a.strokeAngleDeg)&&a.strokeAngleDeg>=-180&&a.strokeAngleDeg<=180,'Skin stroke angle must be -180–180 degrees.');
    requireThat(a.maxAngleDegOverride===null||Number.isFinite(a.maxAngleDegOverride)&&a.maxAngleDegOverride>0&&a.maxAngleDegOverride<90,'Skin angle override must be null or between 0 and 90 degrees.');
    lineSpacing(lineWidthMm,a);return;
  }
  requireThat(Number.isFinite(a.fanPercent)&&a.fanPercent>=0&&a.fanPercent<=100,'Front fanPercent must be 0–100.');
  requireThat(typeof a.reason==='string'&&a.reason.trim().length>0,'Describe the front seed support and material assignment.');
  for(const key of ['afterParts','beforeParts'])requireThat(Array.isArray(a[key])&&a[key].every(part=>parts?.length?parts.includes(part):part===null),'Front part dependencies must name existing components, or null for a single solid.');
  for(const key of ['domainUv','seedUv'])requireThat(Array.isArray(a[key])&&a[key].length>0&&a[key].every(loop=>Array.isArray(loop)&&loop.length>=3&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))),`Front ${key} needs closed UV loops.`);
  if(a.surface?.kind==='patch')requireThat(Object.keys(a.surface).sort().join()==='kind,part,patch'&&typeof a.surface.patch==='string'&&(parts?.length?parts.includes(a.surface.part):a.surface.part===null),'Native front reference needs an existing part and named patch.');
  else {
    requireThat(a.surface?.kind==='spline'&&Object.keys(a.surface).sort().join()==='kind,offsetMm,patch'&&Number.isFinite(a.surface.offsetMm),'Front reference needs an authored spline or a selected native patch.');
    validateSplineSolid({shape:'spline',patches:[a.surface.patch]});
  }
}

export function fixedAxisSurfaceLimit(machine) {
  const limit=machine.nonplanar?.maxAngleDeg;
  requireThat(machine.capabilities?.includes('nonplanar')&&Number.isFinite(limit)&&limit>0&&limit<90,'The machine must declare its fixed-axis nonplanar angle limit.');
  return limit;
}

export function surveySkinAssignment({assignment,shell,machine}) {
  const declaredLimitDeg=fixedAxisSurfaceLimit(machine),limit=assignment.maxAngleDegOverride??declaredLimitDeg;
  const survey=surveyRoofRegion(shell,assignment,limit);
  requireThat(Number.isFinite(survey.maxMm),'The roof survey found no surface to skin.');
  return {...survey,declaredLimitDeg,experimentalOverride:Boolean(machine.nonplanar?.experimental)||(assignment.maxAngleDegOverride!==null&&assignment.maxAngleDegOverride!==declaredLimitDeg)};
}

// A horizontal body's last available grid plane below a reserved reference.
export const stackTopAt=(reserveZ,process,originZ=0)=>originZ+process.firstLayerMm+Math.max(0,Math.floor((reserveZ-originZ-process.firstLayerMm+1e-9)/process.layerMm))*process.layerMm;

export function constructSkinCurves({assignment,shell,process,survey,supportTopAt=null}) {
  const width=process.lineWidthMm,region=offsetRegion(survey.skinRegion,-width/2);
  requireThat(region.length,'No surface remains for skin: the allowed roof is narrower than one bead or exceeds its fixed-axis angle limit.');
  const reference={kind:'roof',geometry:shell},courses=[];
  const reserve=heightSlice(reference,{normalDepthMm:assignment.layers*assignment.normalMm,sampleStepMm:assignment.sampleStepMm});
  for(let index=0;index<assignment.layers;index++) {
    const depth=(assignment.layers-index-1)*assignment.normalMm;
    const slice=heightSlice(reference,{normalDepthMm:depth,sampleStepMm:assignment.sampleStepMm});
    const lower=heightSlice(reference,{normalDepthMm:depth+assignment.normalMm,sampleStepMm:assignment.sampleStepMm});
    const chart=directedFillStrokes(region,{spacingMm:lineSpacing(width,assignment),angleDeg:assignment.strokeAngleDeg,reverseRows:index%2===1,role:'skin'});
    const mapped=mapSliceStrokes(chart,slice,{frames:true});
    const lowerHeightsMm=mapped.map(curve=>curve.points.map(point=>{
      if(index)return heightSlicePoint(lower,point)[2];
      const reservedZ=heightSlicePoint(reserve,point)[2];
      return supportTopAt?supportTopAt(point[0],point[1],reservedZ):stackTopAt(reservedZ,process,shell.bounds.min[2]);
    }));
    const gaps=surfaceGapCurves(mapped,{slice,lowerHeightsMm,maxAngleDeg:survey.limitDeg});
    courses.push({index,slice,curves:gaps.curves,report:gaps.report});
  }
  return {courses,region:survey.skinRegion};
}

export function skinResult({assignment,shell,process,machine,survey,after=[],supportTopAt=null}) {
  const {courses,region}=constructSkinCurves({assignment,shell,process,survey,supportTopAt});
  const operations=[],id=assignment.id;
  for(const {index,slice,curves} of courses) {
    const surfaceZ=(x,y)=>{const top=referenceHeight(slice.reference,x,y);return !top||top.patch==='bottom'||top.slopeDeg>survey.limitDeg+1e-6?null:heightSlicePoint(slice,[x,y])[2];};
    const strokes=depositCurves(curves,{widthMm:process.lineWidthMm,heightMm:assignment.normalMm,speedMmS:process.skinSpeedMmS});
    operations.push({id:`${id}:${index}`,layerId:`${id}:${index}`,phase:'skin',layer:index,rank:shell.bounds.max[2]+index+1,slice,region,
      after:index?[`${id}:${index-1}`]:[...new Set([...assignment.after,...after])],strokes,order:'nearest-cells',connectNearby:true,
      travelPolicy:surfacePolicy(region,{surfaceZ,maxZ:shell.bounds.max[2],maxCombMm:process.maxCombMm,lineWidthMm:process.lineWidthMm,liftMm:process.liftMm,
        sampleStepMm:assignment.sampleStepMm,sagMm:Math.min(.05,assignment.normalMm/4)}),...(assignment.filament===null?{}:{filament:assignment.filament})});
  }
  const reports=courses.map(course=>course.report);
  return {id,operations,report:{construction:'skin',skinLayers:courses.length,strokes:operations.reduce((n,op)=>n+op.strokes.length,0),excludedFraction:survey.steepFraction,
    maxSlopeDeg:survey.maxSlopeDeg,limitDeg:survey.limitDeg,skinAreaMm2:survey.skinAreaMm2,minGapMm:Math.min(...reports.map(r=>r.minGapMm)),maxGapMm:Math.max(...reports.map(r=>r.maxGapMm)),
    minNormalGapMm:Math.min(...reports.map(r=>r.minNormalGapMm)),maxNormalGapMm:Math.max(...reports.map(r=>r.maxNormalGapMm)),maxMappedSlopeDeg:Math.max(...reports.map(r=>r.maxMappedSlopeDeg)),gapMetric:'local-normal-projection'},
    boundaryRequest:{shell,startMm:shell.bounds.min[2],endMm:shell.bounds.max[2],boundary:'top',maxSlopeDeg:survey.limitDeg}};
}

export function frontReference(assignment,{placement,placed,componentShells}) {
  if(assignment.surface.kind==='patch') {
    const shell=componentShells?componentShells.get(assignment.surface.part):placed;
    const patch=shell?.patches?.find(p=>p.name===assignment.surface.patch);
    requireThat(patch,'A native front needs an existing spline patch; a mesh needs an independent authored reference.');
    return patch;
  }
  return heightReferencePatch(assignment.surface.patch,[placement.xMm,placement.yMm,assignment.surface.offsetMm]);
}

export function frontResult({assignment,patch,process,machine,after=[]}) {
  const generated=seededSurfaceFronts(patch,assignment.domainUv,assignment.seedUv,assignment);
  const connected=connectSurfacePasses(patch,generated.waves,assignment.domainUv,assignment,process.lineWidthMm);
  requireThat(connected.passes.length===1,`Front ${assignment.id} needs ${connected.passes.length} separate passes; a continuous assignment cannot contain branch restarts. Revise domain or seed.`);
  const pass=connected.passes[0],limit=fixedAxisSurfaceLimit(machine);
  const maxSlopeDeg=pass.normals.reduce((highest,normal)=>Math.max(highest,Math.acos(Math.min(1,Math.abs(normal[2])))*180/Math.PI),maximumPathAngle(pass.points));
  requireThat(maxSlopeDeg<=limit+1e-7,'Front surface exceeds the selected machine nonplanar angle limit.');
  const maxZ=pass.points.reduce((z,p)=>Math.max(z,p[2]),-Infinity);
  const normals=pass.normals.map(normal=>normal[2]<0?normal.map(v=>-v):normal);
  const curves=[{role:'wave-front',closed:false,points:pass.points,normals,
    segmentMetadata:pass.points.slice(1).map((_,i)=>({beadHeightMm:assignment.beadHeightMm,surfaceNormal:normals[i]}))}];
  const strokes=depositCurves(curves,{widthMm:process.lineWidthMm,heightMm:assignment.beadHeightMm,speedMmS:assignment.speedMmS});
  const operations=[{id:`${assignment.id}:0`,layerId:assignment.id,rank:maxZ,layer:0,phase:'fronts',slice:patchSlice(patch),after:[...new Set([...assignment.after,...after])],strokes,order:'given',fanPercent:assignment.fanPercent,
    travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>maxZ,constantClearanceZ:maxZ},...(assignment.filament===null?{}:{filament:assignment.filament})}];
  return {id:assignment.id,operations,report:{construction:'fronts',reason:assignment.reason,...generated.report,maxSlopeDeg,
    evaluations:generated.report.evaluations+connected.report.evaluations,points:generated.report.points+connected.report.points,continuity:connected.report}};
}

export function frontResults({assignments,plan,machine,placed,componentShells,modelResults}) {
  const modelOps=modelResults.flatMap(r=>r.operations),results=[],dependencyChanges=[];
  const belongs=(op,part)=>part===null||op.id.startsWith(part+':')||op.part===part;
  for(const assignment of assignments) {
    const patch=frontReference(assignment,{placement:plan.placement,placed,componentShells});
    const process=assignmentPlan(plan,machine,assignment).process;
    for(const part of assignment.afterParts)requireThat(modelOps.some(op=>belongs(op,part)),'Front seed dependency has no deposited operations: '+part);
    const after=[...results.flatMap(r=>r.operations.map(op=>op.id)),...modelOps.filter(op=>assignment.afterParts.some(part=>belongs(op,part))).map(op=>op.id)];
    const result=frontResult({assignment,patch,process,machine,after});results.push(result);
    for(const part of assignment.beforeParts) {
      const successors=modelOps.filter(op=>belongs(op,part));
      requireThat(successors.length,'Front successor has no deposited operations: '+part);
      for(const op of successors)dependencyChanges.push({operationId:op.id,after:result.operations.map(op=>op.id),mode:'append'});
    }
  }
  return {results,dependencyChanges};
}
