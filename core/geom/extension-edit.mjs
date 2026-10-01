// Geometry owns extension geometry authoring. Hybrid editors also return
// deposition assignments; Toolpath incorporates those in the same proposal.
import {GEOMETRY_EDITORS,GEOMETRY_CREATORS} from '../../skills/edits.mjs';
import {rhino} from './runtime.mjs';
import {buildShell} from './build.mjs';

export async function prepareExtensionGeometry(source,extension,request,options={}){
  const editor=(options.create?GEOMETRY_CREATORS:GEOMETRY_EDITORS)[extension];
  if(!editor)return null; // This extension may instead author deposition.
  const input=structuredClone({geometry:source.geometry,slices:source.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  const r=await rhino();
  const {geometry,placement,assignments,report}=await editor(input,request,{...options,buildGeometry:geometry=>buildShell(r,geometry)});
  return {plan:{...source,...(geometry===undefined?{}:{geometry}),
    ...(placement===undefined?{}:{placement})},assignments,report};
}
