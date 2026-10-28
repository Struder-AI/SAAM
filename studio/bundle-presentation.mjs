// Studio's presentation of a stored Bundle read. Bundle returns saved state
// with a machine label; Settings resolves that label to the installed profile
// and presents the recipe on it, the recipe query names its skills, and a
// curve/point recipe without a solid gets display geometry.
import {machinePresentation} from '../core/machine/settings-rows.mjs';
import {installedMachine} from '../core/machine/profile.mjs';
import {recipeSkills} from '../core/print/summary.mjs';
import {normalizeSpatialPlan} from '../core/print/spatial-inputs.mjs';

async function displayGeometry(plan,descriptor){
  if(plan.geometry?.shape==='spatial'||plan.geometry&&!(plan.slices?.assignments??[]).some(a=>['curves','inject'].includes(a.construction)))return descriptor;
  const normalized=normalizeSpatialPlan(plan);
  if(normalized.geometry?.shape!=='spatial')return descriptor;
  const {createSpatialGeometry}=await import('../core/print/geometry.mjs');
  return (await createSpatialGeometry(normalized.geometry,descriptor?{descriptor,bytes:null}:null)).descriptor;
}

// A label for a machine not installed here still reads and edits; only its program waits.
const unavailableMachine=(machineId,machine)=>machineId&&!machine?`The ${machineId} machine is not installed here; install it to write its program.`:null;

export async function presentBundle(state){
  const machine=installedMachine(state.machineId),geometry=await displayGeometry(state.plan,state.geometry),settings=machinePresentation(state.plan,machine,geometry);
  const presented={...state,machine,geometry,skills:recipeSkills(state.plan),settingsRows:settings.settingsRows,setupBasis:settings.setupBasis,
    exportName:settings.exportName,outputAvailability:state.outputAvailability??unavailableMachine(state.machineId,machine)??settings.outputAvailability,
    limitations:[...new Set([...settings.limitations,...state.limitations??[]])]};
  Object.defineProperty(presented,'geometryArtifact',{value:state.geometryArtifact,enumerable:false});
  const output=state.completedOutput;
  if(output){
    const outputMachine=output.machineId===state.machineId?machine:installedMachine(output.machineId);
    const outputGeometry=await displayGeometry(output.plan,output.geometry),shown=machinePresentation(output.plan,outputMachine,outputGeometry);
    presented.completedOutput={...output,machine:outputMachine,geometry:outputGeometry,settingsRows:shown.settingsRows,exportName:shown.exportName};
    presented.exportName=shown.exportName;
  }
  return presented;
}
