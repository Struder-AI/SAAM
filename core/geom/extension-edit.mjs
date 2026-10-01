// Geometry owns extension geometry authoring. Hybrid editors also return
// deposition assignments; Toolpath incorporates those in the same proposal.
import {GEOMETRY_EDITORS,GEOMETRY_CREATORS} from '../../skills/edits.mjs';
import {rhino} from '../print/geometry.mjs';
import {buildShell} from './build.mjs';
import {requireThat} from './tolerance.mjs';

export async function prepareExtensionGeometry(source,extension,request,options={}){
  const editor=(options.create?GEOMETRY_CREATORS:GEOMETRY_EDITORS)[extension];
  requireThat(typeof editor==='function',`No geometry editor for extension ${extension}.`);
  const r=await rhino();
  return editor(source,request,{...options,buildGeometry:geometry=>buildShell(r,geometry)});
}
