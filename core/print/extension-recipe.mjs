// Toolpath combines geometry and deposition contributions into one proposed
// recipe. It has no bundle directory, persistence or revision ownership.
import {loadExtensionEntry} from '../extensions/library.mjs';
import {requireThat} from '../private/toolpath/numeric.mjs';
import {ordinarySliceAssignment} from './slice-settings.mjs';
import {curveAssignment} from './curves.mjs';
import {defaultSlices} from './slices.mjs';
import {depositionAssignment} from './assignment-records.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {detectMeshSleeveInterval} from '../geom/sleeve/mesh-sleeve.mjs';
import {horizontalSlice,sliceFamily} from '../geom/slice.mjs';
import {strokeTopology} from '../geom/stroke-topology.mjs';

const editEngines={Geometry:{makeMesh,detectMeshSleeveInterval,horizontalSlice,sliceFamily,strokeTopology},
  Toolpath:{defaultSlices,curveAssignment,depositionAssignment}};

export async function prepareExtensionRecipe(source,extension,request,{geometryContribution,...options}={}){
  if(geometryContribution){
    const {plan,assignments,assignmentRequests,report}=geometryContribution;
    requireThat(!(assignments&&assignmentRequests),'An extension must return either assignments or assignmentRequests.');
    return {plan:{...plan,slices:{...source.slices,assignments:assignmentRequests
      ?assignmentRequests.map(request=>request.construction==='curves'?curveAssignment(request):ordinarySliceAssignment(request)):assignments}},report};
  }
  const input=structuredClone({geometry:source.geometry,slices:source.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  requireThat(!options.create,`No deposition creator for extension ${extension}.`);
  const editor=await loadExtensionEntry(extension,'deposition-edit');
  const contribution=await editor(input,request,{...options,...editEngines});
  const {geometry,assignments,placement,report}=contribution;
  // Only the declared engine outputs can alter the proposal. Setup, output,
  // versions and other bundle fields never come back from extension code.
  const plan={...source,...(geometry===undefined?{}:{geometry}),
    ...(assignments===undefined?{}:{slices:{...source.slices,assignments}}),
    ...(placement===undefined?{}:{placement})};
  return {plan,report};
}
