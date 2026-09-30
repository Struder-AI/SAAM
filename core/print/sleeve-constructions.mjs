// Sleeve assignment records and terminal-boundary geometry; Slice/Trace own deposition.
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {loopArea} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';
import {validateSleevePattern} from '../path/sleeve-pattern.mjs';
import {section as geometrySection,horizontalSlice} from '../geom/slice.mjs';

export const SLEEVE_DEFAULTS={zStartMm:0,zEndMm:null,endTransition:'level',pattern:null,pathMode:'continuous',meshSleeve:null,sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,sleeveToleranceMm:0.08};
export const sleeveAssignment=({id,...options})=>structuredClone({id,construction:'sleeve',part:null,filament:null,process:null,after:[],...SLEEVE_DEFAULTS,...options});
export const RIM_DEFAULTS={steps:[2],minFeatureMm:.4};
export const rimAssignment=({id,...options})=>structuredClone({id,construction:'rim',part:null,filament:null,process:null,after:[],source:null,...RIM_DEFAULTS,...options});

export function validateRimAssignment(a,{parts}={}){
  requireThat(a&&a.construction==='rim'&&Object.keys(a).sort().join()===Object.keys(rimAssignment({id:a.id})).sort().join(),'Invalid rim assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid rim assignment id.');
  requireThat(a.part===null||parts?.includes(a.part),'Rim names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Rim filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Rim after lists operation ids.');
  requireThat(typeof a.source==='string'&&/^[a-z][a-z0-9-]*$/.test(a.source)&&a.source!==a.id,'Rim source names a separate sleeve assignment.');
  requireThat(Array.isArray(a.steps)&&a.steps.length>=1&&a.steps.every(n=>Number.isSafeInteger(n)&&n>=1),'Rim steps need a nonempty list of positive whole numbers of loops.');
  requireThat(Number.isFinite(a.minFeatureMm)&&a.minFeatureMm>=.05&&a.minFeatureMm<=5,'Rim minimum section feature must be .05–5 mm.');
}

export function validateSleeveAssignment(a,{parts}={}){
  requireThat(a&&a.construction==='sleeve'&&Object.keys(a).sort().join()===Object.keys(sleeveAssignment({id:a.id})).sort().join(),'Invalid sleeve assignment fields.');
  requireThat(typeof a.id==='string'&&/^[a-z][a-z0-9-]*$/.test(a.id),'Invalid sleeve assignment id.');
  requireThat(a.part===null||parts?.includes(a.part),'Sleeve names an unknown part.');
  requireThat(a.filament===null||Number.isInteger(a.filament)&&a.filament>=0,'Sleeve filament must be null or a filament index.');
  requireThat(Array.isArray(a.after)&&a.after.every(id=>typeof id==='string'&&id.length),'Sleeve after lists operation ids.');
  requireThat(['continuous','segmented'].includes(a.pathMode),'Sleeve path mode must be continuous or segmented.');
  validateSleevePattern(a.pattern,a.pathMode);
  requireThat(a.pattern!==null||a.pathMode==='continuous','Segmented mode requires a sleeve pattern.');
  requireThat(['spiral','level'].includes(a.endTransition),'Sleeve ending transition must be spiral or level.');
  requireThat(Number.isFinite(a.zStartMm)&&a.zStartMm>=0&&(a.zEndMm===null||Number.isFinite(a.zEndMm)&&a.zEndMm>a.zStartMm),'Sleeve needs nonnegative start and null or greater end height.');
  const bounds={sampleStepMm:[.1,5],toleranceMm:[.002,.05],boundaryToleranceMm:[.002,.05],minFeatureMm:[.05,5],sleeveToleranceMm:[0,.5]};
  for(const [key,[low,high]] of Object.entries(bounds))requireThat(Number.isFinite(a[key])&&a[key]>=low&&a[key]<=high,`Sleeve ${key} must be ${low}–${high}.`);
  if(a.meshSleeve===null)return;
  const fit=a.meshSleeve;
  requireThat(fit&&Object.keys(fit).sort().join()==='circumferentialControls,contactSide,detailToleranceMm,fidelity,heightControls','Invalid mesh sleeve settings.');
  requireThat(Number.isFinite(fit.fidelity)&&fit.fidelity>=0&&fit.fidelity<=1&&['inside','outside'].includes(fit.contactSide),'Mesh sleeve needs fidelity 0–1 and inside/outside contact.');
  requireThat(Number.isInteger(fit.circumferentialControls)&&fit.circumferentialControls>=8&&fit.circumferentialControls<=48&&Number.isInteger(fit.heightControls)&&fit.heightControls>=4&&fit.heightControls<=32,'Mesh sleeve controls must be 8–48 circumferential and 4–32 along height.');
  requireThat(Number.isFinite(fit.detailToleranceMm)&&fit.detailToleranceMm>=.005&&fit.detailToleranceMm<=.5,'Mesh sleeve detail tolerance must be .005–.5 mm.');
}
// Ten-nanometer integer grid: independent of contour/chord and boundary
// tolerances; shared Clipper2 offsets use this same grid by default.
const OFFSET_PRECISION_MM=0.00001;
export function terminalBoundaryReference({shell,assignment,sourceAssignment,sourceResult,substrateAdaptation=false}) {
  requireThat(sourceAssignment?.id===assignment.source&&sourceAssignment.part===assignment.part,'A rim must name a source assignment on the same part.');
  requireThat(sourceResult?.levelBoundary,'A rim needs an explicit terminal boundary from its source.');
  const sourceWidth=sourceResult.levelBoundary.widthMm;
  requireThat(sourceWidth>0,'A rim source needs a deposited width.');
  const modified=substrateAdaptation&&!!sourceResult.report?.modulation?.changed;
  let boundary,baselineInsetMm,zStartMm=sourceResult.levelBoundary.zMm;
  if(!modified){
    const cut=geometrySection(shell,horizontalSlice(zStartMm),{minFeatureMm:assignment.minFeatureMm});
    boundary=cut.loops.filter(loop=>loopArea(loop)>0);baselineInsetMm=sourceWidth/2;
    requireThat(boundary.length,'Rim reference has no outer contour.');
  }else{
    const strands=[];
    for(const op of sourceResult.operations)for(const stroke of op.strokes)for(let i=1;i<stroke.points.length;i++)if(stroke.segmentMetadata?.[i-1]?.boundaryRole==='rim'&&(stroke.volumesMm3?.[i-1]??1)>0){
      if(!strands.length)strands.push(stroke.points[i-1]);
      requireThat(distance(strands.at(-1),stroke.points[i-1])<1e-6,'Final terminal boundary has disconnected strands; select a continuous boundary before constructing a rim.');strands.push(stroke.points[i]);
    }
    requireThat(strands.length>=4,'Finalized source has no reconstructible terminal curve.');
    const projected=cleanPlanarLoop(strands.map(p=>p.slice(0,2)),.001);
    boundary=[loopArea(projected)>0?projected:projected.toReversed()];baselineInsetMm=0;
    zStartMm=Math.max(...strands.map(p=>p[2]));
  }
  return {boundary,baselineInsetMm,zStartMm,sourceWidth,modified};
}

// Offset fields on the terminal region; they carry no operations or publication.
export function boundaryOffsetField(reference,{count,index,widthMm,minFeatureMm}){
  const {boundary,baselineInsetMm}=reference,strokes=[];
  for(let i=0;i<count;i++){
    const inset=baselineInsetMm+(i-(count-1)/2)*widthMm;
    const loops=offsetRegion(boundary,-inset,{precisionMm:OFFSET_PRECISION_MM,arcToleranceMm:minFeatureMm/4});
    requireThat(loops.length,'Requested rim offset collapsed; reduce the loop count or width.');
    strokes.push(...loops.map(loop=>({role:`lip-step-${index}`,closed:true,points:cleanPlanarLoop(loop)})));
  }
  const region=count>1?offsetRegion(boundary,(count-1)/2*widthMm,{precisionMm:OFFSET_PRECISION_MM}):boundary;
  return {strokes,region};
}
