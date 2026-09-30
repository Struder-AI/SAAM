// Nominal finished boundaries carry ownership and prerequisites independently
// of the deposition strategy. They are not measured bead-surface reconstructions.
import {surfaceRegion} from '../geom/surface-region.mjs';
import {createSectionQuery,topAt} from '../geom/query.mjs';
import {pointSegmentDistance,loopArea} from '../region/region2d.mjs';
import {requireThat} from '../geom/tolerance.mjs';

export function publishFinishedBoundary(result,{shell,startMm=shell.bounds.min[2],endMm=shell.bounds.max[2],boundary='shell',coverage='nominal',toleranceMm=.02,maxSlopeDeg=90,contains=null}){
  const sourceOperationIds=result.operations.filter(op=>op.strokes.length).map(op=>op.id);
  // Owned state of this boundary test: the section query is built on first side
  // use, and the loops it returns are cached by Z.
  const sideState={sectionAt:null},sections=new Map();
  const onBoundary=contains??(e=>{
    if(boundary==='top'){const top=topAt(shell,e.point[0],e.point[1]);return top&&top.slopeDeg<=maxSlopeDeg+1e-8&&Math.abs(top.zMm-e.point[2])<=toleranceMm;}
    if(boundary!=='side')return true;
    // A hollow wall publishes its exterior, not the unprinted cap or center.
    sideState.sectionAt??=createSectionQuery(shell);
    const z=e.point[2];let loops=sections.get(z);
    if(!loops){loops=sideState.sectionAt(z).loops.filter(loop=>loopArea(loop)>0);if(sections.size>=256)sections.clear();sections.set(z,loops);}
    return loops.some(loop=>loop.some((p,i)=>pointSegmentDistance(e.point,p,loop[(i+1)%loop.length])<=toleranceMm));
  });
  const finishedSurfaces=sourceOperationIds.length?[{shell,startMm,endMm,coverage,contains:onBoundary,sourceOperationIds}]:[];
  return {...result,finishedSurfaces};
}

export function consumeFinishedSurface({shell,selection,results}){
  const sources=results.flatMap(result=>result.finishedSurfaces??[]).filter(source=>source.shell===shell);
  requireThat(sources.length,'Selected cladding surface has no finished material producer. Select a printed component or publish its finished boundary.');
  const chart=surfaceRegion(shell,selection),sourceOperationIds=[...new Set(sources.flatMap(source=>source.sourceOperationIds))];
  const at=(u,v)=>{
    const e=chart.at(u,v),z=e.point[2];
    requireThat(sources.some(source=>z>=source.startMm-1e-7&&z<=source.endMm+1e-7&&source.contains(e)),
      `Selected cladding surface is not produced at Z ${z.toFixed(4)} mm; select a finished surface within the printed region.`);
    return e;
  };
  return {...chart,at,sourceOperationIds,coverage:[...new Set(sources.map(source=>source.coverage))]};
}
