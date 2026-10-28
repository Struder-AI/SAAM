// Regions owns restriction of allocated native material before construction.
import {intersect,difference} from './intersection.mjs';

// All resolved Slice geometry crosses this boundary, including normal and
// prepared-surface references. Layout, readiness and Trace sources read these same
// owned regions; masking is never an instruction to a deposition backend.
export function prepareOwnedSliceRegions(record){
  const {settings}=record.spec,material=new Map(record.spec.material??record.spec.layers.map(layer=>[layer.index,layer.material??layer.region]));
  const layers=record.spec.layers.map(layer=>{
    const mask=settings.sliceOverrides?.[layer.characterIndex??layer.index]?.regionUv??settings.regionUv;
    if(mask===undefined)return layer;
    const region=intersect(layer.region,mask),removed=difference(layer.region,region);
    material.set(layer.index,difference(material.get(layer.index)??layer.material??layer.region,removed));
    return {...layer,region,material:difference(layer.material??layer.region,removed)};
  });
  // All masks are resolved before projecting a shared material grid. Its
  // immutable view belongs to this result, not to a cross-request cache.
  const grids=new Map();
  const prepared=layers.map(layer=>{
    if(!layer.materialGrid)return layer;
    const source=layer.materialGrid.layers;
    if(!grids.has(source))grids.set(source,Object.freeze(source.map(entry=>
      Object.freeze({...entry,region:material.get(entry.index)??entry.region}))));
    return {...layer,materialGrid:{...layer.materialGrid,layers:grids.get(source)}};
  });
  const retainedIndexes=new Set(prepared.map(layer=>layer.index));
  return {...record,spec:{...record.spec,layers:prepared,material},
    referenceStack:{...record.referenceStack,layers:prepared},
    layerOrder:record.layerOrder.filter(layer=>retainedIndexes.has(layer.index))};
}
