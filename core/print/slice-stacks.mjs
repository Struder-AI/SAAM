// Resolve reference geometry into ordinary slice regions. No strokes,
// deposition, travel or scheduling is constructed at this boundary.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {intersect} from '../region/intersection.mjs';
import {volumeSection} from '../region/layer-region.mjs';
import {horizontalSlice} from '../geom/slice.mjs';
import {offsetSurfaceChart} from '../geom/offset-chart.mjs';
import {surfaceRegion} from '../geom/surface-region.mjs';
import {terminalBoundaryReference} from './terminal-boundary.mjs';

export function referenceSliceContext({assignment,shell,process,volumes}){
  const source=assignment.surface.kind==='terminal'?assignment.surface.assignment:null;
  const stack=assignment.stack??process,band=assignment.within.find(v=>v.kind==='normal-band');
  let layers=[];
  if(band){
    for(let from=band.fromMm,index=0;from<band.toMm-PRINT_RESOLUTION_MM;index++){ // a remainder thinner than print resolution is no layer
      const gap=Math.min(index===0?stack.firstLayerMm:stack.layerMm,band.toMm-from);
      requireThat(from+gap>from,'Reference-stack pitch is below coordinate precision.');
      layers.push({index,offsetMm:from+gap,heightMm:gap,region:[[[0,0],[1,0],[1,1],[0,1]]]});from+=gap;
    }
  }else{
    const count=assignment.sliceOverrides?.length??(Array.isArray(assignment.loops)?assignment.loops.length:1);
    layers=Array.from({length:count},(_,index)=>({index,heightMm:index===0?stack.firstLayerMm:stack.layerMm}));
  }
  const id=assignment.id;
  return {spec:{id,settings:assignment,layers,filament:assignment.filament,totalLayerCount:layers.length},
    reference:{source,selection:assignment.surface,volumes:assignment.within.map((v,i)=>v.kind==='slab'?{...v,fromMm:(shell?.bounds.min[2]??0)+v.fromMm,toMm:v.toMm===null?Infinity:(shell?.bounds.min[2]??0)+v.toMm}:v.kind==='geometry'?{kind:'geometry',geometry:volumes?.get(assignment.id)?.[i]}:v)},referenceStack:{layers},stackId:id,
    context:{shell,process,startMm:shell?.bounds.min[2]??0,endMm:shell?.bounds.max[2]??0,
      report:{owner:id,part:assignment.part,referenceStackKind:band?'normal':'terminal'}},
    owner:{id,assignment,part:assignment.part},layerOrder:layers.map(layer=>({index:layer.index,rank:(shell?.bounds.max[2]??0)+(band?0:(layer.index+1)*stack.layerMm)})),
    };

}

export function prepareReferenceSliceStack(record,{source,references={}}={}){
  if(!record.reference)return record;
  const assignment=record.spec.settings,{shell,process}=record.context,selection=record.reference.selection;
  if(selection.kind==='terminal'){
    const reference=terminalBoundaryReference({assignment,source,references});
    let z=reference.zStartMm;
    const layers=record.spec.layers.map(layer=>{
      z+=layer.heightMm;
      const slice=horizontalSlice(z),points=reference.boundary.flat(),extent={min:[0,1].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1].map(k=>Math.max(...points.map(p=>p[k])))};
      let region=reference.boundary;for(const volume of record.reference.volumes){const cut=volumeSection(volume,{slice},extent);if(cut!==null)region=intersect(region,cut);}
      return {...layer,slice,region,gap:{normalMm:layer.heightMm},onSubstrate:true};
    });
    return {...record,prerequisites:reference.prerequisites,spec:{...record.spec,layers},referenceStack:{...record.referenceStack,layers},context:{...record.context,startMm:reference.zStartMm,
      endMm:z,report:{...record.context.report,startMm:reference.zStartMm,topMm:z}},layerOrder:layers.map(layer=>({index:layer.index,rank:layer.slice.origin[2]}))};
  }
  const chart=surfaceRegion(shell,selection);
  const depth=assignment.within[0].toMm,tightness=assignment.stack?.offsetTightness??assignment.fillOrder?.offsetTightness??1;
  const layoutReference=offsetSurfaceChart(chart,depth,{shell,selection,tightness});
  const layers=record.spec.layers.map(layer=>({...layer,slice:{...offsetSurfaceChart(chart,layer.offsetMm,{shell,selection,tightness}),kind:'surface-chart',domainU:[0,1],domainV:[0,1]},
    layoutReference,gap:{normalMm:layer.heightMm},onSubstrate:true,settings:{fillDirection:assignment.fillOrder?.directions?.[layer.index%assignment.fillOrder.directions.length],order:'given'}}));
  return {...record,spec:{...record.spec,layers},referenceStack:{...record.referenceStack,layers}};
}
