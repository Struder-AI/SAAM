// Nominal ownership selects enclosure slices. Actual whole-slice access bounds
// decide whether completion is sufficient; unresolved slices retain the exact
// material-volume requirement for fine inspection before any hard edge exists.
import {boundsOverlap,convexBounds,convexIntersects} from '../geom/convex-clearance.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {sliceNozzleProofs,prepareRangeScene} from './physical-order.mjs';
import {prepareSourceUnits} from './compose.mjs';
import {reduceManufacturing} from './manufacturing.mjs';

export function resolveMaterialReadiness(source,reader,materials){
  if(!materials.length)return;
  const key=(part,layerId)=>JSON.stringify([part??null,layerId??null]),known=new Map();
  for(const material of materials){
    if(!source.layers[material.layerId])continue;
    const id=key(material.part,material.layerId),prior=known.get(id);
    if(!prior)known.set(id,{...material,parts:[...material.parts]});
    else {
      prior.parts.push(...material.parts);
      if(material.bounds)prior.bounds=prior.bounds?{min:prior.bounds.min.map((v,k)=>Math.min(v,material.bounds.min[k])),max:prior.bounds.max.map((v,k)=>Math.max(v,material.bounds.max[k]))}:material.bounds;
    }
  }
  const proofs=sliceNozzleProofs(source,{reader}),refined=new Set(),summary={slicePrerequisites:0,refinedSlices:0,requirements:0};
  let scene,units;
  const access=new Map();
  function wholeSliceClear(operation,layerId){
    const id=key(operation.id,layerId);if(access.has(id))return access.get(id);
    let clear=proofs.stationaryClear(operation.injection.at,operation.injection.pose,layerId);
    if(!clear){
      // Inconclusive bounds request geometric inspection, not a dependency or
      // execution split. Only an actual nozzle/material contact keeps this
      // slice's enclosure requirement at finer granularity.
      if(!scene){units=prepareSourceUnits(source,reader);scene=prepareRangeScene(source,reader,units.units);}
      const injector=units.units.find(unit=>unit.sourceOperation===operation.id);
      clear=scene.nozzleHits(injector,id=>units.byId.get(id)?.layerId===layerId).next().done;
    }
    access.set(id,clear);return clear;
  }

  for(const operation of Object.values(source.operations)){
    if(operation.kind!=='inject'||!operation.requiredMaterial?.length)continue;
    const remaining=[];
    for(const requirement of operation.requiredMaterial){
      const bounds=convexBounds(requirement.volume),fine=new Set();
      const unknown=new Set(Object.values(source.operations).filter(other=>other.id!==operation.id&&(other.part??null)===(requirement.part??null)&&!known.has(key(other.part,other.layerId))).map(other=>other.layerId));
      for(const material of known.values()){
        if(material.part!==(requirement.part??null)||!material.bounds||!boundsOverlap(bounds,material.bounds,ROUNDING_MM))continue;
        if(!material.parts.some(part=>convexIntersects(part,requirement.volume,ROUNDING_MM)))continue;
        if(wholeSliceClear(operation,material.layerId)){
          operation.after.push(source.layers[material.layerId].completionId);
        }else {fine.add(material.layerId);refined.add(key(operation.id,material.layerId));}
      }
      for(const layerId of unknown)fine.add(layerId);
      if(fine.size)remaining.push({...requirement,layerIds:[...fine]});
      summary.requirements++;
    }
    operation.requiredMaterial=remaining;
  }
  reduceManufacturing(source);
  summary.slicePrerequisites=Object.values(source.operations).filter(operation=>operation.kind==='inject').reduce((sum,operation)=>sum+operation.after.filter(id=>source.completions[id]?.kind==='slice').length,0);
  summary.refinedSlices=refined.size;
  source.summary.materialReadiness=summary;
}
