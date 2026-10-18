// Nominal ownership selects enclosure slices. Actual whole-slice access bounds
// decide whether completion is sufficient; unresolved slices retain the exact
// material-volume requirement for fine inspection before any hard edge exists.
import {sliceMaterialVolumeContact} from '../geom/slice-material.mjs';
import {boundsOverlap,convexBounds,convexIntersects} from '../geom/convex-clearance.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {sliceNozzleProofs,prepareRangeScene} from './physical-order.mjs';
import {prepareSourceUnits} from './compose.mjs';
import {reduceManufacturing,constructionHistory} from './manufacturing.mjs';

export function resolveMaterialReadiness(source,reader,materials){
  if(!Object.values(source.operations).some(operation=>operation.kind==='inject'&&operation.requiredMaterial?.length))return;
  const key=(part,layerId)=>JSON.stringify([part??null,layerId??null]),known=new Map();
  for(const material of materials){
    if(!source.layers[material.layerId])continue;
    const id=key(material.part,material.layerId),prior=known.get(id);
    if(!prior)known.set(id,{...material,parts:[...material.parts],queries:material.material?[material.material]:[]});
    else {
      prior.parts.push(...material.parts);if(material.material)prior.queries.push(material.material);
      if(material.bounds)prior.bounds=prior.bounds?{min:prior.bounds.min.map((v,k)=>Math.min(v,material.bounds.min[k])),max:prior.bounds.max.map((v,k)=>Math.max(v,material.bounds.max[k]))}:material.bounds;
    }
  }
  const proofs=sliceNozzleProofs(source,{reader}),declared=constructionHistory(source),refined=new Set(),summary={slicePrerequisites:0,refinedSlices:0,requirements:0};
  let scene,units;
  const access=new Map();
  function ensureScene(){
    if(!scene){units=prepareSourceUnits(source,reader);scene=prepareRangeScene(source,reader,units.units);}
    return scene;
  }
  function actualMaterial(requirement,layerId){
    return ensureScene().requiredHits(requirement,id=>units.byId.get(id)?.layerId===layerId).length>0;
  }
  function wholeSliceClear(operation,layerId){
    const id=key(operation.id,layerId);if(access.has(id))return access.get(id).clear;
    let clear=proofs.stationaryClear(operation.injection.at,operation.injection.pose,layerId),witness;
    if(!clear){
      // Inconclusive bounds request geometric inspection, not a dependency or
      // execution split. Only an actual nozzle/material contact keeps this
      // slice's enclosure requirement at finer granularity.
      ensureScene();
      const injector=units.units.find(unit=>unit.sourceOperation===operation.id);
      const contact=scene.nozzleHits(injector,id=>units.byId.get(id)?.layerId===layerId).next();
      clear=contact.done;witness=contact.value?.witness;
    }
    access.set(id,{clear,witness});return clear;
  }

  for(const operation of Object.values(source.operations)){
    if(operation.kind!=='inject'||!operation.requiredMaterial?.length)continue;
    const remaining=[];let matched=false;
    for(const requirement of operation.requiredMaterial){
      const bounds=convexBounds(requirement.volume),fine=new Set();
      const unknown=new Set(Object.values(source.operations).filter(other=>other.id!==operation.id&&(other.part??null)===(requirement.part??null)&&!known.has(key(other.part,other.layerId))).map(other=>other.layerId));
      for(const material of known.values()){
        if(material.part!==(requirement.part??null)||!material.bounds||!boundsOverlap(bounds,material.bounds,ROUNDING_MM))continue;
        let contact=material.parts.some(part=>convexIntersects(part,requirement.volume,ROUNDING_MM)),unknown=false;
        if(!contact)for(const query of material.queries){const hit=sliceMaterialVolumeContact(query,requirement.volume);if(hit===true){contact=true;break;}if(hit===null)unknown=true;}
        if(!contact&&!unknown)continue;
        if(wholeSliceClear(operation,material.layerId)){
          if(contact||actualMaterial(requirement,material.layerId)){operation.after.push(source.layers[material.layerId].completionId);matched=true;}
        }else if(actualMaterial(requirement,material.layerId)){fine.add(material.layerId);refined.add(key(operation.id,material.layerId));matched=true;}
      }
      for(const layerId of unknown){
        if(!actualMaterial(requirement,layerId))continue;
        matched=true;
        if(layerId&&wholeSliceClear(operation,layerId))operation.after.push(source.layers[layerId].completionId);
        else {fine.add(layerId);if(layerId)refined.add(key(operation.id,layerId));}
      }
      for(const layerId of fine)if(layerId&&declared.covers(source.layers[layerId].completionId,operation.id))
        throw Object.assign(Error('Required whole-slice completion blocks injection access for '+operation.id+'. Select enclosure material before its closing work.'),
          {code:'MATERIAL_ACCESS_CONFLICT',operation:operation.id,layerId,witness:access.get(key(operation.id,layerId))?.witness});
      if(fine.size)remaining.push({...requirement,layerIds:[...fine]});
      summary.requirements++;
    }
    if(!matched)throw Object.assign(Error('Required enclosure material resolves to no produced material for '+operation.id+'.'),
      {code:'MISSING_REQUIRED_MATERIAL',operation:operation.id});
    operation.requiredMaterial=remaining;
  }
  reduceManufacturing(source);
  summary.slicePrerequisites=Object.values(source.operations).filter(operation=>operation.kind==='inject').reduce((sum,operation)=>sum+operation.after.filter(id=>source.completions[id]?.kind==='slice').length,0);
  summary.refinedSlices=refined.size;
  source.summary.materialReadiness=summary;
}
