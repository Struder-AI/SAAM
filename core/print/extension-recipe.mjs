// Toolpath combines geometry and deposition contributions into one proposed
// recipe. It has no bundle directory, persistence or revision ownership.
import {DEPOSITION_EDITORS} from '../../skills/edits.mjs';
import {prepareExtensionGeometry} from '../geom/extension-edit.mjs';

export async function prepareExtensionRecipe(source,extension,request,options={}){
  const input=structuredClone({geometry:source.geometry,slices:source.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  const editor=DEPOSITION_EDITORS[extension];
  const contribution=editor&&!options.create?await editor(input,request,options)
    :await prepareExtensionGeometry(input,extension,request,options);
  const {geometry,assignments,placement,report}=contribution;
  // Only the declared engine outputs can alter the proposal. Setup, output,
  // versions and other bundle fields never come back from extension code.
  const plan={...source,...(geometry===undefined?{}:{geometry}),
    ...(assignments===undefined?{}:{slices:{...source.slices,assignments}}),
    ...(placement===undefined?{}:{placement})};
  return {plan,report};
}
