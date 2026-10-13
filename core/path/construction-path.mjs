// The constructed SAAMpath is an operation graph, with no execution state.
import {saamPath} from './saampath.mjs';
import {materialGeometryValue,heightGeometryValue} from '../geom/material-envelope.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';


function savedMaterial(material,geometry,identities){
  requireThat(material&&['planar','surface','bounds'].includes(material.kind),'Deposition needs explicit material geometry.');
  if(material.kind!=='surface')return materialGeometryValue(material);
  const surface=material.surface;
  if(surface.kind!=='height-field')return materialGeometryValue(material);
  const reference=surface.reference;
  if(reference.kind!=='roof')return materialGeometryValue(material);
  if(!identities.has(reference.geometry)){
    identities.set(reference.geometry,geometry.length);geometry.push(heightGeometryValue(reference.geometry));
  }
  return materialGeometryValue({...material,surface:{...surface,reference:{kind:'roof',geometryId:identities.get(reference.geometry)}}});
}

export function constructionPath({results,planning,composition,summary,generatorVersion}){
  const geometry=[],identities=new WeakMap();
  const operations=results.flatMap((result,resultIndex)=>result.operations.map(operation=>{
    requireThat(operation.order==='given'&&!operation.connectNearby,'Deposition must be finalized before publication.');
    return {id:operation.id,layerId:operation.layerId,phase:operation.phase,
      layer:operation.layer,layerIndex:operation.layerIndex,layerCount:operation.layerCount,
      rank:operation.rank,nominalRank:operation.nominalRank,order:operation.order,after:operation.after,
      process:operation.process,filament:operation.filament,fanPercent:operation.fanPercent,
      nozzleC:operation.nozzleC,restoreNozzleC:operation.restoreNozzleC,continuous:operation.continuous,
      regionId:operation.regionId,part:operation.part,stackDirection:operation.stackDirection,
      construction:result.id,constructionRank:resultIndex,
      strokes:operation.strokes.map(stroke=>({points:stroke.points,closed:stroke.closed,role:stroke.role,
        beadWidthMm:stroke.beadWidthMm,beadHeightMm:stroke.beadHeightMm,beadAreaMm2:stroke.beadAreaMm2,
        speedMmS:stroke.speedMmS,volumesMm3:stroke.volumesMm3,segmentMetadata:stroke.segmentMetadata,
        poses:stroke.poses,normals:stroke.normals,stationaryExtrusion:stroke.stationaryExtrusion})),
      materialGeometry:savedMaterial(operation.materialGeometry,geometry,identities)};
  }));
  return saamPath({schema:'saampath/1',generatorVersion,units:'mm',materialUnits:'mm3',
    operations,geometry,planning:{process:planning.process,selection:planning.selection,selections:planning.selections},composition,summary});
}
