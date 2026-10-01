// The extension owns fitting, pattern repetition and boundary transitions.
// Trace receives only resolved spatial curves and their deposition settings.
import {requireThat} from '../../../core/geom/tolerance.mjs';
import {traceResult} from '../../../core/print/curves.mjs';
import {contactCurveGaps} from '../../../core/path/contact-curves.mjs';
import {prepareContourSleeve} from './contour-sleeve.mjs';
import {mappedSleevePatternCurves} from './sleeve-pattern.mjs';

export function advancedVaseResult({shell,assignment,process,machine,after=assignment.after,zStartMm=null,zEndMm=null,foundationSegments=[],maxBeadHeightMm=Infinity,substrateAdaptation=false,onProgress}){
  requireThat(assignment.pattern!==null,'Advanced vase requires an authored repeated pattern.');
  const reference=prepareContourSleeve({shell,assignment,process,machine,zStartMm,zEndMm,onProgress});
  const {base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm}=reference;
  const mapped=mappedSleevePatternCurves({settings:assignment,process,base,start,end,firstHeight,referenceLengthMm,mapping,mappingErrorMm,onProgress});
  const parts=[];
  for(const {layerIdSuffix,...source} of mapped.courses){
    const curves=substrateAdaptation&&foundationSegments.length?contactCurveGaps(source.curves,{segments:foundationSegments,maxHeightMm:maxBeadHeightMm}):source.curves;
    const course={...source,curves,layerId:assignment.id+layerIdSuffix};
    parts.push(traceResult({id:assignment.id,filament:assignment.filament,after:parts.at(-1)?.operations.map(op=>op.id)??after},{courses:[course],process}));
  }
  const operations=parts.flatMap(part=>part.operations),strokes=operations.flatMap(op=>op.strokes),level=mapped.levelBoundary;
  const measures=Object.fromEntries(['strokes','lengthMm','volumeMm3'].map(key=>[key,parts.reduce((sum,part)=>sum+part.report[key],0)]));
  return {id:assignment.id,operations,family:{...reference.family(),name:`${assignment.id} sleeve`},
    report:{...mapped.report,...reference.report(),construction:'sleeve',part:assignment.part,depositionFamily:'trace',extension:'advanced-vase-wall',...measures},
    ...(level?{levelBoundary:{zMm:level.zMm,widthMm:level.widthMm,strokes:strokes.slice(-level.tailCount)}}:{})};
}
