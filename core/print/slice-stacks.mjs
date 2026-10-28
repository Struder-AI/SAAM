// Resolve reference geometry into ordinary slice regions. No strokes,
// deposition, travel or scheduling is constructed at this boundary.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
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
import {isDeepStrictEqual} from 'node:util';
import {surfaceMeanNormal} from '../geom/surface-mean-normal.mjs';

// One generation owns this preparation, including its native geometry lifetime.
// Snapshots contain authored values and strict numerical capability identities;
// neither caller rewrites nor a copied referenceRecord can change a saved key.
export function referenceStackPreparation(){return {entries:new Map(),identities:new WeakMap()};}
function preparationIdentity(value,identities){
  if(!identities.has(value))identities.set(value,Symbol());
  return identities.get(value);
}
function preparationSnapshot(value,identities,seen=new Map()){
  if(value===null||typeof value!=='object'&&typeof value!=='function')return value;
  if(seen.has(value))return seen.get(value);
  if(ArrayBuffer.isView(value)){
    if(Buffer.isBuffer(value))return Buffer.from(value);
    if(value instanceof DataView)return new DataView(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));
    return value.slice();
  }
  if(value instanceof ArrayBuffer)return value.slice(0);
  if(value instanceof Map){
    const result=new Map();seen.set(value,result);
    for(const [key,entry] of value)result.set(preparationSnapshot(key,identities,seen),preparationSnapshot(entry,identities,seen));
    return result;
  }
  if(value instanceof Set){
    const result=new Set();seen.set(value,result);
    for(const entry of value)result.add(preparationSnapshot(entry,identities,seen));
    return result;
  }
  const prototype=Object.getPrototypeOf(value),callable=typeof value==='function';
  if(!callable&&!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)
    return {identity:preparationIdentity(value,identities)}; // immutable native lifetime handles
  const result=callable?{identity:preparationIdentity(value,identities),properties:Object.create(null)}:Array.isArray(value)?Array(value.length):Object.create(prototype);
  seen.set(value,result);
  const target=callable?result.properties:result;
  for(const key of Reflect.ownKeys(value)){
    if(Array.isArray(value)&&key==='length')continue;
    const property=Object.getOwnPropertyDescriptor(value,key);
    const snapshot='value' in property?preparationSnapshot(property.value,identities,seen):
      {get:property.get&&preparationIdentity(property.get,identities),set:property.set&&preparationIdentity(property.set,identities)};
    Object.defineProperty(target,key,{value:snapshot,enumerable:true});
  }
  return result;
}
function ownedRegion(region){return region.map(loop=>loop.map(point=>[...point]));}
function referenceGeometry(record){
  const selected=record.reference.selection.kind==='slice';
  const {layers,...stack}=record.referenceStack;
  return {layers:record.spec.layers.map(layer=>({slice:layer.slice,region:ownedRegion(layer.region),gap:{...layer.gap},onSubstrate:layer.onSubstrate,
    ...(!selected?{layoutReference:layer.layoutReference,settings:{...layer.settings}}:{}),
    ...(selected&&layer.direction?{direction:[...layer.direction],translationMm:layer.translationMm,offsetMm:layer.offsetMm,
      normalOffsetMm:layer.normalOffsetMm,targetGapMm:layer.targetGapMm}:{})})),
    ...(selected?{referenceStack:stack,report:{...record.context.report},prerequisites:structuredClone(record.prerequisites),layerOrder:record.layerOrder.map(layer=>({...layer}))}:{})};
}
function applyReferenceGeometry(record,geometry){
  const layers=record.spec.layers.map((layer,index)=>{
    const prepared=geometry.layers[index];
    return {...layer,...prepared,region:ownedRegion(prepared.region),gap:{...prepared.gap},
      ...(prepared.direction?{direction:[...prepared.direction]}:{}),...(prepared.settings?{settings:{...prepared.settings}}:{})};
  });
  return {...record,spec:{...record.spec,layers},referenceStack:{...record.referenceStack,...geometry.referenceStack,layers},
    ...(geometry.report?{context:{...record.context,report:{...geometry.report}}}:{}),
    ...(geometry.prerequisites?{prerequisites:structuredClone(geometry.prerequisites)}:{}),
    ...(geometry.layerOrder?{layerOrder:geometry.layerOrder.map(layer=>({...layer}))}:{})};
}

export function referenceSliceContext({assignment,shell,process,volumes}){
  const source=assignment.surface.kind==='slice'?assignment.surface.assignment:null;
  const stack={...process,...assignment.stack},band=assignment.within.find(v=>v.kind==='normal-band');
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

export function prepareReferenceSliceStack(record,{source,references={},preparedReferences}={}){
  if(!record.reference)return record;
  // Resolve the selected live producer before consulting preparation. In
  // particular, a missing explicit index still fails and terminal selection
  // follows the surviving geometry and its current completion prerequisite.
  const reference=record.reference.selection.kind==='slice'?preparedSurfaceReference({assignment:record.spec.settings,source,references}):null;
  if(!preparedReferences)return buildReferenceSliceStack(record,reference);
  // A prior Slice supplies its own finite geometry. Shell-relative clips were
  // already resolved by referenceSliceContext; only direct shell references
  // evaluate the part shell during this preparation.
  const inputs=preparationSnapshot({...(!reference?{shellIdentity:record.context.shell&&preparationIdentity(record.context.shell,preparedReferences.identities),
    shell:record.context.shell}:{}),process:record.context.process,settings:record.spec.settings,layers:record.spec.layers,
    reference:record.reference,selected:reference},preparedReferences.identities);
  const prior=preparedReferences.entries.get(record.spec.id);
  // Charts carry functions and native arrays, so a caller could mutate one
  // despite receiving its own layer/region containers. Admit reuse only while
  // that entire prepared projection still matches its owned insertion snapshot.
  if(prior&&isDeepStrictEqual(prior.inputs,inputs)&&
    isDeepStrictEqual(prior.prepared,preparationSnapshot(prior.geometry,preparedReferences.identities)))return applyReferenceGeometry(record,prior.geometry);
  const prepared=buildReferenceSliceStack(record,reference),geometry=referenceGeometry(prepared);
  preparedReferences.entries.set(record.spec.id,{inputs,geometry,prepared:preparationSnapshot(geometry,preparedReferences.identities)});
  return applyReferenceGeometry(record,geometry);
}
function buildReferenceSliceStack(record,reference){
  const assignment=record.spec.settings,{shell,process}=record.context,selection=record.reference.selection;
  if(selection.kind==='slice'){
    const bounds=surfaceChartBounds(reference.slice,reference.region.flat());
    const direction=stackDirection(assignment.stack?.direction??reference.direction??reference.slice.normal);
    const metric=direction?surfaceMeanNormal(reference.slice,reference.region,{boundsUv:bounds,sampleStepMm:assignment.sampleStepMm,direction}):null;
    const meanProjection=metric?metric.meanNormal.reduce((sum,v,k)=>sum+v*direction[k],0):null;
    requireThat(!direction||meanProjection>ROUNDING_RELATIVE,'The stacking direction has no positive mean normal advance.');
    const native=reference.slice.patch??(reference.slice.cp?reference.slice:null);
    let nominalDepth=0,minDepth=0,maxDepth=0;
    for(const layer of record.spec.layers){nominalDepth=layer.normalOffsetMm??layer.offsetMm??nominalDepth+layer.heightMm;minDepth=Math.min(minDepth,nominalDepth);maxDepth=Math.max(maxDepth,nominalDepth);}
    const tightness=assignment.stack?.offsetTightness??assignment.fillOrder?.offsetTightness??1;
    const neighborhood=native&&!direction?surfaceNeighborhood(native,{boundsUv:bounds,
      reachMm:offsetReachMm(assignment,process.lineWidthMm),tightness,
      normalRangeMm:[minDepth,maxDepth]}):null;
    const chartBounds=neighborhood?.boundsUv??bounds,chart=mappedSurface(neighborhood?.surface??reference.slice,chartBounds,chartBounds);
    const advance={depth:0};
    const layers=record.spec.layers.map(layer=>{
      advance.depth+=layer.heightMm;
      const depth=layer.normalOffsetMm??layer.offsetMm??advance.depth,translationMm=direction?layer.heightMm/meanProjection:null,offsetMm=direction?depth/meanProjection:depth;
      requireThat(!direction||Number.isFinite(offsetMm)&&Number.isFinite(translationMm)&&translationMm>0,'Reference-stack translation cannot represent its requested spacing.');
      const slice=direction?translateSlice(reference.slice,direction.map(value=>value*offsetMm)):
        {...offsetSurfaceChart(chart,depth,{nativePatch:native,tightness}),kind:'surface-chart'};
      const extent={min:bounds.map(b=>b[0]),max:bounds.map(b=>b[1])};
      const material={region:reference.region};
      for(const volume of record.reference.volumes)if(volume.kind!=='normal-band'){
        const cut=volumeSection(volume,{slice},extent);if(cut!==null)material.region=intersect(material.region,cut);
      }
      return {...layer,slice,region:material.region,...(direction?{direction,translationMm,offsetMm,normalOffsetMm:depth,targetGapMm:layer.heightMm}:{}),
        gap:direction?{advanceMm:translationMm,direction}:{normalMm:layer.heightMm},onSubstrate:true};
    });
    const stack=direction?{direction,meanProjection,meanNormal:metric.meanNormal,areaMm2:metric.areaMm2,gapMetric:'area-mean-normal-projection',gapEvidence:metric.evidence,
      minSampledProjection:metric.minProjection,maxSampledProjection:metric.maxProjection}:{};
    return {...record,prerequisites:reference.prerequisites,spec:{...record.spec,layers},referenceStack:{...record.referenceStack,...stack,layers},
      context:{...record.context,report:{...record.context.report,...stack}},
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
