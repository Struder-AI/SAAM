import {createWingDesign} from './design.mjs';
import {createWingConstruction} from './construct.mjs';
import {createAirfoils} from './airfoils.mjs';
import {prepareWingBundle} from './handoff.mjs';

export function createWingWorkspace({Geometry,Toolpath}){
  const airfoils=createAirfoils(Geometry),design=createWingDesign(Geometry,airfoils);
  const {wingDefaults,wingSections}=design,{airfoilCatalog}=airfoils;
  const {wingPreview,wingHandoff,validateWingDesign}=createWingConstruction(Geometry,design,airfoils);
  return {
    defaults:wingDefaults,normalize:validateWingDesign,preview:wingPreview,
    pieces:design=>wingSections(design).pieces,resources:airfoilCatalog,
    construct:async(design,pieceId)=>prepareWingBundle(await wingHandoff(design,pieceId,Geometry),Toolpath)
  };
}
