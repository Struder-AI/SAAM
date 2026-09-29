// Nominal finished boundaries carry ownership and prerequisites independently
// of the deposition strategy. They are not measured bead-surface reconstructions.
import {surfaceRegion} from '../geom/surface-region.mjs';
import {topAt} from '../geom/query.mjs';
import {section,prepareSection,horizontalSlice} from '../geom/slice.mjs';
import {pointSegmentDistance,loopArea} from '../region/region2d.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {depositedBeadSegments,depositedBeadsContain,depositedBeadBounds} from './deposited-curves.mjs';
import {depositedContactChart} from './contact-curves.mjs';

export function publishFinishedBoundary(result,{shell,startMm=shell.bounds.min[2],endMm=shell.bounds.max[2],boundary='shell',coverage='nominal',toleranceMm=.02,maxSlopeDeg=90,contains=null}){
  const sourceOperationIds=result.operations.filter(op=>op.strokes.length).map(op=>op.id);
  // Owned state of this boundary test: the section search data is built on first side
  // use, and the loops it returns are cached by Z.
  const sideState={prepared:null},sections=new Map();
  const onBoundary=contains??(e=>{
    if(boundary==='top'){const top=topAt(shell,e.point[0],e.point[1]);return top&&top.slopeDeg<=maxSlopeDeg+1e-8&&Math.abs(top.zMm-e.point[2])<=toleranceMm;}
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

export function consumeFinishedSurface({shell,selection,results}){
  requireThat(!results.some(result=>result.modulationPendingPublication),
    'A deposited boundary changed; finalize its bead coverage before constructing a dependent surface.');
  const sources=results.flatMap(result=>result.finishedSurfaces??[]).filter(source=>source.shell===shell);
  requireThat(sources.length,'Selected cladding surface has no finished material producer. Select a printed component or publish its finished boundary.');
  const chart=surfaceRegion(shell,selection),sourceOperationIds=[...new Set(sources.flatMap(source=>source.sourceOperationIds))];
  if(sources.some(source=>source.depositedSegments)){
    const selected=new Set(sourceOperationIds);
    const segments=depositedBeadSegments(results.flatMap(result=>result.operations.filter(op=>selected.has(op.id))));
    return {...depositedContactChart(chart,segments),sourceOperationIds,coverage:['final-deposited-beads']};
  }
  const at=(u,v)=>{
    const e=chart.at(u,v),z=e.point[2];
    requireThat(sources.some(source=>z>=source.startMm-1e-7&&z<=source.endMm+1e-7&&source.contains(e)),
      `Selected cladding surface is not produced at Z ${z.toFixed(4)} mm; select a finished surface within the printed region.`);
    return e;
  };
  return {...chart,at,sourceOperationIds,coverage:[...new Set(sources.map(source=>source.coverage))]};
}

// Preserve chart identity and publish final beads. Consumers reconstruct contact
// on those beads; a displaced substrate is not mistaken for absent material.
export function republishDepositedBoundary(result,{widthMm}={}){
  const segments=depositedBeadSegments(result.operations,{widthMm});
  const sourceOperationIds=[...new Set(segments.map(segment=>segment.operationId))];
  const bounds=depositedBeadBounds(segments),startMm=bounds.min[2],endMm=bounds.max[2];
  return {...result,modulationPendingPublication:false,finishedSurfaces:(result.finishedSurfaces??[]).map(surface=>({
    ...surface,startMm,endMm,sourceOperationIds,coverage:'sparse',depositedSegments:segments,
    contains:e=>depositedBeadsContain(segments,e.point)
  }))};
}
