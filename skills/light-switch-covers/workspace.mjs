import {readFile} from 'node:fs/promises';
import {initialDesign,normalizeDesign} from './design.mjs';
import {buildCover} from './model.mjs';

function centeredGeometry(geometry,origin){
  if(geometry.shape==='assembly')return {...geometry,parts:geometry.parts.map(part=>({...part,geometry:centeredGeometry(part.geometry,origin)}))};
  return {...geometry,vertices:geometry.vertices.map(point=>point.map((value,i)=>value-origin[i]))};
}
async function coverResources(){
  return {initialDesign,catalog:JSON.parse(await readFile(new URL('./catalog.json',import.meta.url),'utf8'))};
}
async function coverHandoff(design,pieceId,interfaces){
  if(pieceId!=='cover')throw Error('Unknown switch-cover piece.');
  const result=await buildCover(design,interfaces),base=interfaces.Toolpath.recipeDefaults();
  const origin=[result.width/2,result.height/2,0],geometry=centeredGeometry(result.geometry,origin),body=base.slices.assignments[0];
  const twoColor=design.treatment.startsWith('two-color');
  // Logical material setup is selected later in Studio; keep both components
  // editable without inventing a machine's filaments at workspace handoff.
  const assignments=twoColor?[{...structuredClone(body),id:'plate',part:'plate',filament:null,fillDensity:1},{...structuredClone(body),id:'labels',part:'labels',filament:null,fillDensity:1}]:[{...structuredClone(body),fillDensity:1}];
  return {plan:{...base,geometry,slices:{...base.slices,assignments}},
    source:{kind:'light-switch-covers',version:1,design:result.design,originMm:origin,font:{name:'Abel Regular',sha256:result.fontHash,license:'SIL-OFL-1.1'},referenceCatalog:'catalog.json'},
    requirements:{orientation:'face-'+result.printFace,materialRoles:twoColor?[{part:'plate',filament:0,color:design.plateColor},{part:'labels',filament:1,color:design.textColor}]:[{part:null,filament:0,color:design.plateColor}],fitStatus:'unverified',fireSafetyResponsibility:'Users are responsible for the fire safety of their covers.',supportNotes:result.warnings},
    report:{widthMm:result.width,heightMm:result.height,printFace:result.printFace,materials:result.materials.map(part=>part.id),warnings:result.warnings}};
}
export function createCoverWorkspace(interfaces){
  return {defaults:initialDesign,normalize:normalizeDesign,
    preview:design=>buildCover(design,interfaces),pieces:()=>[{id:'cover',name:'Light switch cover'}],
    resources:coverResources,construct:(design,pieceId)=>coverHandoff(design,pieceId,interfaces)};
}
