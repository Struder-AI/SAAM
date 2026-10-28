// Slice owns skin policy; Geometry owns the region Boolean calculations.
import {union,intersect,difference} from './intersection.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';

// Values never refer back to their grid. Weak keys let completed preparation
// release this derived lookup without a global history of source arrays.
const immutableIndexes=new WeakMap();
function materialIndex(layers){
  if(immutableIndexes.has(layers))return immutableIndexes.get(layers);
  const regions=new Map(),positions=new Map();
  for(const [position,layer] of layers.entries()){
    regions.set(layer.index,layer.region);positions.set(layer.index,position);
  }
  const fixed=Object.isFrozen(layers)&&layers.every(layer=>Object.isFrozen(layer)&&
    ['index','region'].every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(layer,key)??{},'value')));
  const index={regions,positions};
  if(fixed)immutableIndexes.set(layers,index);
  return index;
}

// The supplied sequence establishes neighbours in one shared chart; a member's
// identity need not equal its position. Missing members beyond either end are
// empty material. The caller supplies body material, before owner allocation.
export function solidMasks(layers, k, { bottomLayers, topLayers }) {
  requireThat(Number.isInteger(bottomLayers) && bottomLayers >= 0 && Number.isInteger(topLayers) && topLayers >= 0, 'Solid masks need whole bottom and top layer counts.');
  const {regions,positions} = materialIndex(layers),position=positions.get(k);
  const region = regions.get(k);
  requireThat(region, `Layer ${k} has no region to mask.`);
  let supported = region, covered = region;
  for (let n = 1; n <= bottomLayers && supported.length; n++) supported = intersect(supported, layers[position - n]?.region ?? []);
  for (let n = 1; n <= topLayers && covered.length; n++) covered = intersect(covered, layers[position + n]?.region ?? []);
  const bottom = difference(region, supported), top = difference(region, covered);
  return { bottom, top, solid: union(bottom, top) };
}
