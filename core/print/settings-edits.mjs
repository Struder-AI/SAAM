// Settings computes values; Bundle owns revision checks and publication.
import {loadBundle,applySettingsSnapshot} from './bundle.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {resolveSettingsPatch,selectSettings,resolveMachineSettings} from '../machine/settings.mjs';
import {requireThat} from '../private/settings/numeric.mjs';
import {editedPlacementOrigins} from './placement-intent.mjs';
import {installedMachine} from '../machine/profile.mjs';

export async function adjustSettings(directory,patch,{expectedRevision,expectedEditRevision}={}){
  patch=structuredClone(patch);
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const settings=resolveSettingsPatch(state.plan,patch);
  return applySettingsSnapshot(directory,{settings,placementOrigins:editedPlacementOrigins(state.placementOrigins,patch.placement)},state.revision,{expectedEditRevision});
}

export async function changeMachine(directory,machineId,{expectedRevision,expectedEditRevision,machineSetups,appRoot,dataRoot}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const selection=await selectSettings(machineId,{machineSetups,appRoot,dataRoot});
  // The previous machine's profile, when installed, maps settings onto the new one.
  const settings=resolveMachineSettings(state.plan,installedMachine(state.machineId,{appRoot,dataRoot}),selection,{boundsMm:state.geometry?.boundsMm,placementOrigins:state.placementOrigins});
  return applySettingsSnapshot(directory,{machineId:selection.machine.id,settings,notes:selection.notes},state.revision,{expectedEditRevision});
}

// Dependency configuration is data-only; no extension is discovered or run.
export async function recordExtensionDependency(directory,id,configuration,{expectedRevision,expectedEditRevision}={}){
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Extension configuration needs a valid extension ID.');
  requireThat(configuration===null||configuration&&typeof configuration==='object'&&!Array.isArray(configuration),'Supply extension configuration, or null to remove it.');
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const skills=structuredClone(state.plan.skills??{});
  if(configuration===null)delete skills[id];else skills[id]=structuredClone(configuration);
  return applySettingsSnapshot(directory,{settings:{skills}},state.revision,{expectedEditRevision});
}
