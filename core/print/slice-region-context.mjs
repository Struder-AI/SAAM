// Adapt a supplied Geometry region family to ordinary preset Slice work.
// No extension-specific branch, contour or placement policy lives here.
import {ordinarySliceAssignment} from './slice-settings.mjs';
import {assignmentFilament} from './assignment-process.mjs';

export function prepareSliceRegionContext({plan,id,preset,processForAssignment,family,endMm,report,validateResult}){
  const assignment=ordinarySliceAssignment({id,preset,filament:assignmentFilament(plan,{id})});
  const process=processForAssignment(assignment),layers=family.layers;
  return {validateResult,spec:{id,layers,material:new Map(layers.map(layer=>[layer.index,layer.region])),settings:assignment,
      filament:assignment.filament,totalLayerCount:layers.length},
    context:{process,shell:{bounds:{min:[0,0,family.base.origin[2]],max:[0,0,endMm]}},startMm:family.base.origin[2],endMm,report},
    family,familyId:id,owner:{id,kind:preset,part:null,assignment},
    layerOrder:layers.map(layer=>({index:layer.index,rank:layer.slice.origin[2]}))};
}
