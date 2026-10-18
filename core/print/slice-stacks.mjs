// Resolve reference geometry into ordinary slice regions. No strokes,
// deposition, travel or scheduling is constructed at this boundary.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {intersect} from '../region/intersection.mjs';
import {volumeSection} from '../region/layer-region.mjs';
import {translateSlice} from '../geom/slice.mjs';
import {mappedSurface} from '../geom/surface-evaluation.mjs';
import {surfaceChartBounds} from '../region/surface-operations.mjs';
import {normalize} from '../private/toolpath/numeric.mjs';
import {offsetSurfaceChart} from '../geom/offset-chart.mjs';
import {surfaceRegion} from '../geom/surface-region.mjs';
import {surfaceNeighborhood} from '../geom/surface-neighborhood.mjs';
import {preparedSurfaceReference} from './prepared-surface.mjs';

export function referenceSliceContext({assignment,shell,process,volumes}){
  const source=assignment.surface.kind==='slice'?assignment.surface.assignment:null;
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
      report:{owner:id,part:assignment.part,referenceStackKind:band?'normal':'slice'}},
    owner:{id,assignment,part:assignment.part},layerOrder:layers.map(layer=>({index:layer.index,rank:(shell?.bounds.max[2]??0)+(band?0:(layer.index+1)*stack.layerMm)})),
    };

}

export function prepareReferenceSliceStack(record,{source,references={}}={}){
  if(!record.reference)return record;
  const assignment=record.spec.settings,{shell,process}=record.context,selection=record.reference.selection;
  if(selection.kind==='slice'){
    const reference=preparedSurfaceReference({assignment,source,references});
    const bounds=surfaceChartBounds(reference.slice,reference.region.flat());
    const direction=stackDirection(assignment.stack?.direction??reference.direction??reference.slice.normal);
    const native=reference.slice.patch??(reference.slice.cp?reference.slice:null);
    const depths=record.spec.layers.reduce((values,layer)=>[...values,layer.offsetMm??values.at(-1)+layer.heightMm],[0]);
    const tightness=assignment.stack?.offsetTightness??assignment.fillOrder?.offsetTightness??1;
    const neighborhood=native&&!direction?surfaceNeighborhood(native,{boundsUv:bounds,
      reachMm:offsetReachMm(assignment,process.lineWidthMm),tightness,
      normalRangeMm:[Math.min(...depths),Math.max(...depths)]}):null;
    const chartBounds=neighborhood?.boundsUv??bounds,chart=mappedSurface(neighborhood?.surface??reference.slice,chartBounds,chartBounds);
    const advance={depth:0};
    const layers=record.spec.layers.map(layer=>{
      advance.depth+=layer.heightMm;
      const depth=layer.offsetMm??advance.depth,slice=direction?translateSlice(reference.slice,direction.map(value=>value*depth)):
        {...offsetSurfaceChart(chart,depth,{nativePatch:native,tightness}),kind:'surface-chart'};
      const extent={min:bounds.map(b=>b[0]),max:bounds.map(b=>b[1])};
      const material={region:reference.region};
      for(const volume of record.reference.volumes)if(volume.kind!=='normal-band'){
        const cut=volumeSection(volume,{slice},extent);if(cut!==null)material.region=intersect(material.region,cut);
      }
      return {...layer,slice,region:material.region,...(direction?{direction,translationMm:layer.heightMm}:{}),gap:{normalMm:layer.heightMm},onSubstrate:true};
    });
    return {...record,prerequisites:reference.prerequisites,spec:{...record.spec,layers},referenceStack:{...record.referenceStack,layers},
      layerOrder:layers.map((layer,ordinal)=>({index:layer.index,rank:ordinal}))};
  }
  const band=assignment.within.find(v=>v.kind==='normal-band'),depth=band.toMm,tightness=assignment.stack?.offsetTightness??assignment.fillOrder?.offsetTightness??1;
  const reachMm=offsetReachMm(assignment,process.lineWidthMm);
  const chart=surfaceRegion(shell,selection,selection.kind==='spline'?{reachMm,normalRangeMm:[band.fromMm,band.toMm],tightness}:null);
  const layoutReference=offsetSurfaceChart(chart,depth,{shell,selection,tightness});
  const layers=record.spec.layers.map(layer=>{
    const slice={...offsetSurfaceChart(chart,layer.offsetMm,{shell,selection,tightness}),kind:'surface-chart'};
    const clipped={region:chart.regionUv?intersect(layer.region,chart.regionUv):layer.region};
    for(const volume of record.reference.volumes)if(volume.kind!=='normal-band'){
      const cut=volumeSection(volume,{slice},{min:[0,0],max:[1,1]});if(cut!==null)clipped.region=intersect(clipped.region,cut);
    }
    return {...layer,slice,region:clipped.region,layoutReference,gap:{normalMm:layer.heightMm},onSubstrate:true,
      settings:{fillDirection:assignment.fillOrder?.directions?.[layer.index%assignment.fillOrder.directions.length],order:'given'}};
  });
  return {...record,spec:{...record.spec,layers},referenceStack:{...record.referenceStack,layers}};
}
function stackDirection(direction){return direction&&direction!=='normal'?normalize(direction):null;}
function offsetReachMm(assignment,widthMm){return Math.max(widthMm,...[assignment,...(assignment.sliceOverrides??[])].map(settings=>
  -(settings.loopInsetMm??assignment.loopInsetMm??widthMm/2)+widthMm/2));}
