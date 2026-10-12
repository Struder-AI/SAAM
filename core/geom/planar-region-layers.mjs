// Construct horizontal material regions from an authored per-height source.
// Geometry owns polygon union; the caller owns the meaning of each source
// region and the deposition policy.
import {horizontalSlice,sliceStack} from './slice.mjs';
import {union} from '../region/intersection.mjs';

export function planarRegionLayers({baseZ=0,topZ,process,regionsAt}){
  if(typeof regionsAt!=='function')throw Error('Planar region construction needs a regionsAt height query.');
  const referenceStack=sliceStack({base:horizontalSlice(baseZ),pitchMm:process.layerMm,firstLayerMm:process.firstLayerMm},
    {min:[0,0,baseZ],max:[0,0,topZ]});
  const layers=referenceStack.layers.map(layer=>({...layer,region:(regionsAt(layer.slice.origin[2])??[]).reduce((merged,part)=>union(merged,part),[])}));
  return {...referenceStack,layers};
}
