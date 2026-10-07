import {requireThat,distance} from '../private/toolpath/numeric.mjs';
// Query and offset a completed producer's terminal boundary.
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {loopArea} from '../region/region2d.mjs';

import {horizontalSlice} from '../geom/slice.mjs';
import {section as geometrySection} from '../region/section.mjs';

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
