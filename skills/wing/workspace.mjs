import {wingDefaults,wingSections} from './design.mjs';
import {wingPreview,wingHandoff,validateWingDesign} from './construct.mjs';
import {airfoilCatalog} from './airfoils.mjs';
import {prepareWingBundle} from './handoff.mjs';

export function createWingWorkspace({Geometry,Toolpath}){
  return {
    defaults:wingDefaults,normalize:validateWingDesign,preview:wingPreview,
    pieces:design=>wingSections(design).pieces,resources:airfoilCatalog,
    construct:async(design,pieceId)=>prepareWingBundle(await wingHandoff(design,pieceId,Geometry),Toolpath)
  };
}
