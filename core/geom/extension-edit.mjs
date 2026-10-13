// Geometry owns extension geometry authoring. Hybrid editors also return
// deposition assignments; Toolpath incorporates those in the same proposal.
import {readExtension,loadExtensionEntry} from '../extensions/library.mjs';
import {rhino} from './runtime.mjs';
import {matchCurveControls} from './curve-controls.mjs';
import {ribbon} from './curve-material.mjs';
import {buildShell} from './build.mjs';
import {constructSolids} from './solid-operations.mjs';
import {mappedTextMaterial} from './mapped-text-material.mjs';
import {topAt,createSectionQuery} from './query.mjs';
import {closeMeshPatchToPlane} from './mesh-patch-solid.mjs';
import {horizontalSlice,sliceStack} from './slice.mjs';
import {section,prepareSection} from '../region/section.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {difference,intersect,union} from '../region/intersection.mjs';
import {regionArea,loopArea} from '../region/region2d.mjs';
import {clipLineToRegion,clipPlanarCurveToRegion} from './curve-region.mjs';
import {intersectSurfaceSheet,offsetSliceRegion,strokeSliceRegion,clipSliceCurves} from '../region/surface-operations.mjs';

export async function prepareExtensionGeometry(source,extension,request,options={}){
  const entry=options.create?'geometry-create':'geometry-edit';
  const selected=await readExtension(extension);
  if(!selected)throw Error(`Required extension ${extension} is missing. Import it before editing.`);
  if(!selected.manifest.entries[entry])return null; // This extension may instead author deposition.
  const editor=await loadExtensionEntry(extension,entry);
  const compileText=selected.manifest.dependencies.some(dependency=>dependency.id==='text')
    ?await loadExtensionEntry('text','geometry-compile'):undefined;
  const input=structuredClone({geometry:source.geometry,slices:source.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  const r=await rhino();
  const {geometry,placement,assignments,assignmentRequests,report}=await editor(input,request,{...options,buildGeometry:geometry=>buildShell(r,geometry),constructSolids,mappedTextMaterial,topAt,createSectionQuery,
    closeMeshPatchToPlane,matchCurveControls,ribbon,horizontalSlice,sliceStack,section,prepareSection,offsetRegion,difference,intersect,union,regionArea,loopArea,clipLineToRegion,clipPlanarCurveToRegion,intersectSurfaceSheet,offsetSliceRegion,strokeSliceRegion,clipSliceCurves,...(compileText?{compileText}:{})});
  return {plan:{...source,...(geometry===undefined?{}:{geometry}),
    ...(placement===undefined?{}:{placement})},assignments,assignmentRequests,report};
}
