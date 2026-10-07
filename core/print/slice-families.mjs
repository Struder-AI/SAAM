// Resolve reference geometry into ordinary course regions. No strokes,
// deposition, travel or scheduling is constructed at this boundary.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {intersect} from '../region/intersection.mjs';
import {volumeSection} from '../region/layer-region.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import {offsetSurfaceChart} from '../geom/offset-chart.mjs';
import {consumeFinishedSurface} from '../path/finished-surface.mjs';
import {terminalBoundaryReference} from './terminal-boundary.mjs';
import {combineFinalizedResults} from './finalize.mjs';

export function referenceSliceContext({assignment,shell,process,volumes},plan){
  const source=assignment.surface.kind==='terminal'?assignment.surface.assignment:assignment.contact?.source??null;
  const stack=assignment.stack??process,band=assignment.within.find(v=>v.kind==='normal-band');
  let layers=[];
  if(band){
    for(let from=band.fromMm,index=0;from<band.toMm-1e-9;index++){
      const gap=Math.min(index===0?stack.firstLayerMm:stack.layerMm,band.toMm-from);
      requireThat(from+gap>from,'Reference-family pitch is below coordinate precision.');
      layers.push({index,offsetMm:from+gap/2,heightMm:gap,region:[[[0,0],[1,0],[1,1],[0,1]]]});from+=gap;
    }
  }else{
    const count=assignment.courses?.length??(Array.isArray(assignment.loops)?assignment.loops.length:1);
    layers=Array.from({length:count},(_,index)=>({index,heightMm:index===0?stack.firstLayerMm:stack.layerMm}));
  }
  const id=assignment.id;
  return {spec:{id,settings:assignment,layers,filament:assignment.filament,totalLayerCount:layers.length},
    reference:{source,selection:assignment.surface,volumes:assignment.within.map((v,i)=>v.kind==='slab'?{...v,fromMm:(shell?.bounds.min[2]??0)+v.fromMm,toMm:v.toMm===null?Infinity:(shell?.bounds.min[2]??0)+v.toMm}:v.kind==='geometry'?{kind:'geometry',geometry:volumes?.get(assignment.id)?.[i]}:v)},family:{layers},familyId:id,
    context:{shell,process,startMm:shell?.bounds.min[2]??0,endMm:shell?.bounds.max[2]??0,
      report:{owner:id,part:assignment.part,referenceFamily:band?'normal':'terminal'}},
    owner:{id,assignment,part:assignment.part},layerOrder:layers.map(layer=>({index:layer.index,rank:(shell?.bounds.max[2]??0)+(band?0:(layer.index+1)*stack.layerMm)})),
    sourceAssignment:plan.slices.assignments.find(a=>a.id===source)};
}

export function resolveSliceFamily(record,results,{substrateAdaptation=false}={}){
  if(!record.reference)return record;
  const assignment=record.spec.settings,{shell,process}=record.context,selection=record.reference.selection;
  const sources=results.filter(result=>record.reference.source===null?result.report?.owner!==record.owner.assignment.id:result.report?.owner===record.reference.source||result.id===record.reference.source);
  if(record.resolvedFamily&&record.resolvedAdaptation===substrateAdaptation&&sources.length===record.resolvedSources.length&&sources.every((source,i)=>source===record.resolvedSources[i]))return record.resolvedFamily;
  record.resolvedSources=sources;record.resolvedAdaptation=substrateAdaptation;
  requireThat(sources.length,'Reference family '+record.spec.id+' needs completed source deposition on the selected part.');
  if(selection.kind==='terminal'){
    const sourceResult=combineFinalizedResults({...sources.at(-1),levelBoundary:sources.find(result=>result.levelBoundary)?.levelBoundary},sources);
    const reference=terminalBoundaryReference({shell,assignment,sourceAssignment:record.sourceAssignment,sourceResult,substrateAdaptation});
    let z=reference.zStartMm;
    const layers=record.spec.layers.map(layer=>{
      z+=layer.heightMm;
      const loops=assignment.courses?.[layer.index]?.loops??(Array.isArray(assignment.loops)?assignment.loops[layer.index%assignment.loops.length]:assignment.loops);
      const slice=horizontalSlice(z),points=reference.boundary.flat(),extent={min:[0,1].map(k=>Math.min(...points.map(p=>p[k]))-process.lineWidthMm*loops),max:[0,1].map(k=>Math.max(...points.map(p=>p[k]))+process.lineWidthMm*loops)};
      let region=reference.boundary;for(const volume of record.reference.volumes){const cut=volumeSection(volume,{slice},extent);if(cut!==null)region=intersect(region,cut);}
      return {...layer,slice,region:loops>1?offsetRegion(region,(loops-1)*process.lineWidthMm/2,{precisionMm:.00001}):region,loopBoundary:region,nominalThickness:true,onSubstrate:true,
        settings:{loops,roles:assignment.roles??{perimeter:'lip-step-'+layer.index,'perimeter-inner':'lip-step-'+layer.index},loopInsetMm:assignment.loopInsetMm??reference.baselineInsetMm-(loops-1)*process.lineWidthMm/2,wallToleranceMm:.001,
          order:'nearest',connectNearby:true,offsetOptions:{precisionMm:.00001,arcToleranceMm:selection.minFeatureMm/4}},
        contactPlacement:substrateAdaptation?{sourceOperationIds:sourceResult.operations.map(op=>op.id),gapMm:layer.heightMm,
          sampleStepMm:Math.min(process.lineWidthMm/2,.2),toleranceMm:Math.min(.01,process.lineWidthMm/20),footprintRadiusMm:process.lineWidthMm/2}:null};
    });
    return record.resolvedFamily={...record,spec:{...record.spec,layers},family:{...record.family,layers},context:{...record.context,startMm:reference.zStartMm,
      endMm:z,report:{...record.context.report,startMm:reference.zStartMm,topMm:z,reconstructedContact:reference.modified}}};
  }
  const chart=consumeFinishedSurface({shell,selection,results:sources,substrateAdaptation});
  const nominal=substrateAdaptation?consumeFinishedSurface({shell,selection,results:sources,substrateAdaptation:false}):chart;
  const depth=assignment.within[0].toMm,tightness=assignment.stack?.offsetTightness??assignment.fillOrder?.offsetTightness??1;
  const layoutReference=offsetSurfaceChart(nominal,depth,{shell,selection,tightness});
  const layers=record.spec.layers.map(layer=>({...layer,slice:{...offsetSurfaceChart(chart,layer.offsetMm,{shell,selection,tightness}),kind:'surface-chart',domainU:[0,1],domainV:[0,1]},
    layoutReference,nominalThickness:true,settings:{fillDirection:assignment.fillOrder?.directions?.[layer.index%assignment.fillOrder.directions.length]??'axial',order:'given',continuous:true,connectNearby:(assignment.fillOrder?.directions?.[layer.index%assignment.fillOrder.directions.length]??'axial')==='axial'},
    sourceOperationIds:chart.sourceOperationIds}));
  return record.resolvedFamily={...record,spec:{...record.spec,layers},family:{...record.family,layers},context:{...record.context,report:{...record.context.report,
    substrate:{sourceOperationIds:chart.sourceOperationIds,coverage:chart.coverage,part:record.owner.part}}}};
}
