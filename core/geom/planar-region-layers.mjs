// Construct horizontal material regions from an authored per-height source.
// Geometry owns section queries, polygon union and obstacle clearance; the
// caller owns the meaning of each source region and the deposition policy.
import {horizontalSlice,sliceFamily} from './slice.mjs';
import {prepareSection,section} from '../region/section.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {union,intersect} from '../region/intersection.mjs';
import {regionArea} from '../region/region2d.mjs';

export function planarRegionLayers({baseZ=0,topZ,process,shells=[],clearanceMm=0,regionsAt}){
  if(typeof regionsAt!=='function')throw Error('Planar region construction needs a regionsAt height query.');
  const family=sliceFamily({base:horizontalSlice(baseZ),pitchMm:process.layerMm,firstLayerMm:process.firstLayerMm},
    {min:[0,0,baseZ],max:[0,0,topZ]});
  const obstacles=shells.map(shell=>({shell,part:prepareSection(shell,family.base)}));
  const layers=family.layers.map(layer=>{
    const z=layer.slice.origin[2];
    const region=(regionsAt(z)??[]).reduce((merged,part)=>union(merged,part),[]);
    for(const {shell,part} of obstacles){
      if(z<shell.bounds.min[2]-1e-8||z>shell.bounds.max[2]+1e-8||!region.length)continue;
      const obstacle=offsetRegion(section(part,layer.slice).loops,clearanceMm);
      if(regionArea(intersect(region,obstacle))>=1e-8)
        throw Error(`Authored planar region meets part clearance at Z ${z.toFixed(3)} mm; revise its source.`);
    }
    return {...layer,region};
  });
  return {...family,layers};
}
