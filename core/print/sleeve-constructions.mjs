// Sleeve assignment records and terminal-boundary geometry; Slice/Trace own deposition.
import {ordinarySliceAssignment} from './slice-settings.mjs';
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {loopArea} from '../region/region2d.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {requireThat,distance} from '../geom/tolerance.mjs';
import {validateSleevePattern} from '../path/sleeve-pattern.mjs';
import {section as geometrySection,horizontalSlice} from '../geom/slice.mjs';

export const SLEEVE_DEFAULTS={zStartMm:0,zEndMm:null,endTransition:'level',pattern:null,pathMode:'continuous',meshSleeve:null,sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,sleeveToleranceMm:0.08};
export const sleeveAssignment=({id,...options})=>structuredClone({id,construction:'sleeve',part:null,filament:null,process:null,after:[],...SLEEVE_DEFAULTS,...options});
export const RIM_DEFAULTS={steps:[2],minFeatureMm:.4};
export function rimAssignment({id,part=null,filament=null,process=null,after=[],source=null,steps=[2],minFeatureMm=.4}){
  return ordinarySliceAssignment({id,part,filament,process,loops:steps,fillDensity:0,solidTop:0,solidBottom:0,
    surface:{kind:'terminal',assignment:source,minFeatureMm},contact:{source},dependencies:{afterParts:[],beforeParts:[],after}});
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
  for(const key of ['sampleStepMm','toleranceMm','boundaryToleranceMm','minFeatureMm'])requireThat(Number.isFinite(a[key])&&a[key]>0,`Sleeve ${key} must be positive.`);
  requireThat(Number.isFinite(a.sleeveToleranceMm)&&a.sleeveToleranceMm>=0,'Sleeve fit tolerance must be nonnegative.');
  if(a.meshSleeve===null)return;
  const fit=a.meshSleeve;
  requireThat(fit&&Object.keys(fit).sort().join()==='circumferentialControls,contactSide,detailToleranceMm,fidelity,heightControls','Invalid mesh sleeve settings.');
  requireThat(Number.isFinite(fit.fidelity)&&fit.fidelity>=0&&fit.fidelity<=1&&['inside','outside'].includes(fit.contactSide),'Mesh sleeve needs fidelity 0–1 and inside/outside contact.');
  requireThat(Number.isSafeInteger(fit.circumferentialControls)&&fit.circumferentialControls>=8&&Number.isSafeInteger(fit.heightControls)&&fit.heightControls>=4,'Mesh sleeve needs at least 8 circumferential and 4 height controls.');
  requireThat(Number.isFinite(fit.detailToleranceMm)&&fit.detailToleranceMm>0,'Mesh sleeve detail tolerance must be positive.');
}
// Ten-nanometer integer grid: independent of contour/chord and boundary
// tolerances; shared Clipper2 offsets use this same grid by default.
const OFFSET_PRECISION_MM=0.00001;
export function terminalBoundaryReference({shell,assignment,sourceAssignment,sourceResult,substrateAdaptation=false}) {
  requireThat(sourceAssignment?.id===assignment.surface.assignment&&sourceAssignment.part===assignment.part,'A rim must name a source assignment on the same part.');
  requireThat(sourceResult?.operations?.length,'A terminal boundary needs completed source deposition.');
  if(!sourceResult.levelBoundary){
    const all=sourceResult.operations.flatMap(op=>op.strokes),zStartMm=Math.max(...all.flatMap(stroke=>stroke.points.map(p=>p[2])));
    const closed=all.filter(stroke=>stroke.points.length>=4&&stroke.points.every(p=>Math.abs(p[2]-zStartMm)<1e-8)&&(stroke.closed||distance(stroke.points[0],stroke.points.at(-1))<1e-8));
    requireThat(closed.length,'The source has no closed, level terminal curve; author one explicitly before offset boundary courses.');
    const boundary=closed.map(stroke=>cleanPlanarLoop(stroke.points.map(p=>p.slice(0,2)),.001)).map(loop=>loopArea(loop)>0?loop:loop.toReversed());
    const sourceWidth=Math.max(...closed.map(stroke=>stroke.beadWidthMm??stroke.segmentMetadata?.[0]?.beadWidthMm??0));
    requireThat(sourceWidth>0,'A terminal curve needs a deposited width.');
    return {boundary,baselineInsetMm:0,zStartMm,sourceWidth,modified:Boolean(sourceResult.report?.modulation?.changed)};
  }
  const sourceWidth=sourceResult.levelBoundary.widthMm;
  requireThat(sourceWidth>0,'A rim source needs a deposited width.');
  const modified=substrateAdaptation&&!!sourceResult.report?.modulation?.changed;
  let boundary,baselineInsetMm,zStartMm=sourceResult.levelBoundary.zMm;
  if(!modified){
    const cut=geometrySection(shell,horizontalSlice(zStartMm),{minFeatureMm:assignment.surface.minFeatureMm});
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
