// Finalized Paath enters the ordinary construction graph without Trace sampling.
// Geometry and anchors remain the sole authority; queries use the shared reader.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareCurvePath} from '../path/curve-path.mjs';
import {validateProfile,depositionAspectAdvisories} from '../path/curve-profiles.mjs';
import {validateStationaryAction} from '../path/injection.mjs';
import {operationPrerequisite} from './operation-references.mjs';

export function paathAssignment({id,...options}){
  return structuredClone({id,construction:'paath',part:null,filament:null,toolIndex:null,process:null,after:[],entities:[],natives:[],description:'',...options});
}
export function validatePaathAssignment(assignment){
  requireThat(assignment?.construction==='paath'&&Object.keys(assignment).sort().join()===Object.keys(paathAssignment({})).sort().join(),'Invalid finalized Paath assignment fields.');
  requireThat(typeof assignment.id==='string'&&/^[a-z][a-z0-9-]*$/.test(assignment.id),'Invalid Paath assignment id.');
  requireThat(Array.isArray(assignment.after)&&assignment.after.every(operationPrerequisite),'Paath prerequisites name manufactured work.');
  requireThat(assignment.toolIndex===null||Number.isSafeInteger(assignment.toolIndex)&&assignment.toolIndex>=0,'Paath toolIndex must be null or a neutral logical index.');
  requireThat(Array.isArray(assignment.entities)&&assignment.entities.length>0&&Array.isArray(assignment.natives),'Paath needs entities and optional native slice declarations.');
  const ids=new Set(),layers=new Set();
  for(const layer of assignment.natives){
    requireThat(typeof layer.id==='string'&&!layers.has(layer.id)&&typeof layer.stackId==='string'&&Number.isSafeInteger(layer.index)&&layer.index>=0&&Number.isSafeInteger(layer.sequence)&&layer.sequence>=0,'Invalid Paath native slice identity.');layers.add(layer.id);
  }
  for(const entity of assignment.entities){
    requireThat(entity&&Object.keys(entity).every(key=>['id','geometry','profiles','stationary','toolIndex','layerId','after','interruptible','directionRequired','seamRequired','role','provenance'].includes(key)),'Unknown finalized Paath entity field.');
    requireThat(typeof entity.id==='string'&&entity.id.length&&!ids.has(entity.id),'Paath entity IDs must be distinct.');ids.add(entity.id);
    requireThat(entity.layerId===undefined||layers.has(entity.layerId),'Paath entity selects an undeclared native slice.');
    requireThat(entity.toolIndex===undefined||Number.isSafeInteger(entity.toolIndex)&&entity.toolIndex>=0,'Paath entity toolIndex must be a neutral logical index.');
    if(entity.stationary){
      requireThat(entity.geometry?.kind==='point'&&Array.isArray(entity.geometry.point)&&entity.geometry.point.length===3&&entity.geometry.point.every(Number.isFinite),'Stationary Paath needs one point geometry.');
      requireThat(Object.keys(entity.profiles??{}).join()==='toolAxis'&&Object.keys(entity.stationary).every(key=>['volumeMm3','flowMm3S','holdSeconds'].includes(key)),'Stationary Paath has tool axis, dose, flow and hold channels.');
      validateProfile(entity.profiles?.toolAxis,'toolAxis');
      const action=entity.stationary;
      validateStationaryAction(action);
    }else{
      requireThat(entity.profiles?.toolAxis!==undefined&&entity.profiles?.rateMm3PerMm!==undefined,'Finalized moving Paath needs canonical anchors.');
      prepareCurvePath({curves:{entity:{geometry:entity.geometry,profiles:entity.profiles}}});
    }
  }
  for(const entity of assignment.entities)requireThat(entity.after===undefined||Array.isArray(entity.after)&&entity.after.every(previous=>ids.has(previous)&&previous!==entity.id),'Entity after names distinct local entities.');
  return assignment;
}
export function canonicalPaathResult(assignment,{process}){
  validatePaathAssignment(assignment);
  const advisories=assignment.entities.flatMap(entity=>entity.stationary?[]:depositionAspectAdvisories(entity.profiles,
    {label:'Finalized Paath '+assignment.id+' / '+entity.id,scope:{assignmentId:assignment.id,entityId:entity.id}}));
  const operationId=id=>assignment.id+':'+id;
  const nativeLayers=new Map(assignment.natives.map(layer=>[layer.id,{...layer,id:assignment.id+':'+layer.id,stackId:assignment.id+':'+layer.stackId}]));
  const operations=assignment.entities.map(entity=>({id:operationId(entity.id),order:'given',strokes:[],canonicalEntity:entity,
    process,...((entity.toolIndex??assignment.toolIndex??assignment.filament)===null||
      (entity.toolIndex??assignment.toolIndex??assignment.filament)===undefined?{}:{toolIndex:entity.toolIndex??assignment.toolIndex??assignment.filament}),
    layerId:entity.layerId===undefined?null:nativeLayers.get(entity.layerId).id,
    ...(entity.layerId===undefined?{}:{nativeLayer:nativeLayers.get(entity.layerId)}),
    after:[...assignment.after,...(entity.after??[]).map(operationId)],interruptible:entity.stationary?false:entity.interruptible??true,
    layer:entity.layerId===undefined?0:nativeLayers.get(entity.layerId).index,
    phase:entity.stationary?'inject':'deposit',part:assignment.part}));
  return {id:assignment.id,operations,nativeLayers:[...nativeLayers.values()],logicalAfter:[...assignment.after],depositionFinalized:true,report:{owner:assignment.id,construction:'paath',depositionFamily:'paath',entities:operations.length,exactCanonicalInput:true,
    ...(advisories.length?{advisories,notes:advisories.map(item=>item.message)}:{})}};
}
