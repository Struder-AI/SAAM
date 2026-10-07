// Construct horizontal material regions from an authored per-height source.
// Geometry owns section queries, polygon union and obstacle clearance; the
// caller owns the meaning of each source region and the deposition policy.
import {horizontalSlice,sliceStack} from './slice.mjs';
import {prepareSection,section} from '../region/section.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {union,intersect} from '../region/intersection.mjs';
import {positiveClaimRegion} from '../region/ownership.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

export function planarRegionLayers({baseZ=0,topZ,process,shells=[],clearanceMm=0,regionsAt}){
  if(typeof regionsAt!=='function')throw Error('Planar region construction needs a regionsAt height query.');
  const referenceStack=sliceStack({base:horizontalSlice(baseZ),pitchMm:process.layerMm,firstLayerMm:process.firstLayerMm},
    {min:[0,0,baseZ],max:[0,0,topZ]});
  const obstacles=shells.map(shell=>({shell,part:prepareSection(shell,referenceStack.base)}));
  const layers=referenceStack.layers.map(layer=>{
    const z=layer.slice.origin[2];
    const region=(regionsAt(z)??[]).reduce((merged,part)=>union(merged,part),[]);
    for(const {shell,part} of obstacles){
      if(z<shell.bounds.min[2]-PRINT_RESOLUTION_MM||z>shell.bounds.max[2]+PRINT_RESOLUTION_MM||!region.length)continue;
      const obstacle=offsetRegion(section(part,layer.slice).loops,clearanceMm);
      if(positiveClaimRegion(intersect(region,obstacle),PRINT_RESOLUTION_MM))
        throw Error(`Authored planar region meets part clearance at Z ${z.toFixed(3)} mm; revise its source.`);
    }
    return {...layer,region};
  });
  return {...referenceStack,layers};
}
