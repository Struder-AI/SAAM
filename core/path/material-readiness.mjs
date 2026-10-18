// Source publication binds enclosure intent to Geometry-owned Slice regions.
// No deposited course, nozzle access scene or execution order is inspected here.
import {sliceMaterialVolumeContact} from '../geom/slice-material.mjs';
import {boundsOverlap,convexBounds,convexIntersects} from '../geom/convex-clearance.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';

export function bindMaterialSlices(source,materials){
  const known=new Map();
  for(const material of materials){
    if(!source.layers[material.layerId])continue;
    const prior=known.get(material.layerId);
    if(!prior)known.set(material.layerId,{...material,parts:[...material.parts],queries:material.material?[material.material]:[]});
    else {
      prior.parts.push(...material.parts);if(material.material)prior.queries.push(material.material);
      if(material.bounds)prior.bounds=prior.bounds?{min:prior.bounds.min.map((v,k)=>Math.min(v,material.bounds.min[k])),max:prior.bounds.max.map((v,k)=>Math.max(v,material.bounds.max[k]))}:material.bounds;
    }
  }
  const scopes=new Set();let requirements=0;
  for(const operation of Object.values(source.operations)){
    if(operation.kind!=='inject'||!operation.requiredMaterial?.length)continue;
    const selected=[];
    for(const requirement of operation.requiredMaterial){
      const bounds=convexBounds(requirement.volume),layerIds=[];
      for(const material of known.values()){
        if(material.part!==(requirement.part??null)||!material.bounds||!boundsOverlap(bounds,material.bounds,ROUNDING_MM))continue;
        let contact=material.parts.some(part=>convexIntersects(part,requirement.volume,ROUNDING_MM)),unresolved=false;
        if(!contact)for(const query of material.queries){const hit=sliceMaterialVolumeContact(query,requirement.volume);if(hit===true){contact=true;break;}if(hit===null)unresolved=true;}
        if(contact||unresolved){layerIds.push(material.layerId);scopes.add(JSON.stringify([operation.id,material.layerId]));}
      }
      // Unlayered consumers do not change the selected native material. Their
      // actual contributions, if any, are resolved independently by scheduling.
      selected.push({...requirement,layerIds});
      requirements++;
    }
    operation.requiredMaterial=selected;
  }
  if(requirements)source.summary.materialReadiness={sliceScopes:scopes.size,requirements};
}
