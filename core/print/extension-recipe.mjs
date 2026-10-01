// Toolpath combines geometry and deposition contributions into one proposed
// recipe. It has no bundle directory, persistence or revision ownership.
import {DEPOSITION_EDITORS} from '../../skills/edits.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';

export async function prepareExtensionRecipe(source,extension,request,{geometryContribution,...options}={}){
  if(geometryContribution){
    const {plan,assignments,report}=geometryContribution;
    return {plan:{...plan,slices:{...source.slices,assignments}},report};
  }
  const input=structuredClone({geometry:source.geometry,slices:source.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  const editor=DEPOSITION_EDITORS[extension];
  requireThat(editor&&!options.create,`No deposition editor for extension ${extension}.`);
  const contribution=await editor(input,request,options);
  const {geometry,assignments,placement,report}=contribution;
  // Only the declared engine outputs can alter the proposal. Setup, output,
  // versions and other bundle fields never come back from extension code.
  const plan={...source,...(geometry===undefined?{}:{geometry}),
    ...(assignments===undefined?{}:{slices:{...source.slices,assignments}}),
    ...(placement===undefined?{}:{placement})};
  return {plan,report};
}
