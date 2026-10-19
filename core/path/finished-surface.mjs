import {CHORD_TOLERANCE_MM} from '../dimensions.mjs';
import {POSE_RESOLUTION_DEG} from './pose.mjs';
// Nominal finished boundaries carry ownership and prerequisites independently
// of the deposition strategy. They are not measured bead-surface reconstructions.
import {topAt} from '../geom/query.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import {section,prepareSection} from '../region/section.mjs';
import {pointSegmentDistance,loopArea} from '../region/region2d.mjs';

import {depositedBeadSegments,depositedBeadsContain,depositedBeadBounds} from './deposited-curves.mjs';

// Process scale: toleranceMm is the default height slack of a top boundary, a
// twentieth of a 0.4 mm line.
export function publishFinishedBoundary(result,{shell,startMm=shell.bounds.min[2],endMm=shell.bounds.max[2],boundary='shell',coverage='nominal',toleranceMm=CHORD_TOLERANCE_MM,maxSlopeDeg=90,contains=null}){
  const sourceOperationIds=result.operations.filter(op=>op.strokes.length).map(op=>op.id);
  // Owned state of this boundary test: the section search data is built on first side
  // use, and the loops it returns are cached by Z.
  const sideState={prepared:null},sections=new Map();
  const onBoundary=contains??(e=>{
    if(boundary==='top'){const top=topAt(shell,e.point[0],e.point[1]);return top&&top.slopeDeg<=maxSlopeDeg+POSE_RESOLUTION_DEG&&Math.abs(top.zMm-e.point[2])<=toleranceMm;}
    if(boundary!=='side')return true;
    // A hollow wall publishes its exterior, not the unprinted cap or center.
    sideState.prepared??=prepareSection(shell,horizontalSlice(0));
    const z=e.point[2];let loops=sections.get(z);
    if(!loops){loops=section(sideState.prepared,horizontalSlice(z)).loops.filter(loop=>loopArea(loop)>0);if(sections.size>=256)sections.clear();sections.set(z,loops);}
    return loops.some(loop=>loop.some((p,i)=>pointSegmentDistance(e.point,p,loop[(i+1)%loop.length])<=toleranceMm));
  });
  const finishedSurfaces=sourceOperationIds.length?[{shell,startMm,endMm,coverage,contains:onBoundary,sourceOperationIds}]:[];
  return {...result,finishedSurfaces};
}

// Preserve chart identity and publish final beads. Consumers reconstruct contact
// on those beads; a displaced substrate is not mistaken for absent material.
export function republishDepositedBoundary(result,{widthMm}={}){
  if(!result.finishedSurfaces?.length)return {...result,modulationPendingPublication:false};
  const segments=depositedBeadSegments(result.operations,{widthMm});
  const sourceOperationIds=[...new Set(segments.map(segment=>segment.operationId))];
  const bounds=depositedBeadBounds(segments),startMm=bounds.min[2],endMm=bounds.max[2];
  return {...result,modulationPendingPublication:false,finishedSurfaces:(result.finishedSurfaces??[]).map(surface=>({
    ...surface,startMm,endMm,sourceOperationIds,coverage:'sparse',depositedSegments:segments,
    contains:e=>depositedBeadsContain(segments,e.point)
  }))};
}
