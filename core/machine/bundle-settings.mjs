// Agent -> Settings -> Bundle: resolve outside storage, commit exact values
// against the read revision. Bundle retains review/invalidation ownership.
import {loadBundle,applySettingsSnapshot} from '../print/bundle.mjs';
import {requireEditRevision} from '../print/edit-identity.mjs';
import {selectSettings,resolveMachineSettings,resolveSettingsPatch} from './settings.mjs';
import {requireThat} from '../private/settings/numeric.mjs';
import {EXTENSION_CONFIGURATION_IDS} from '../../skills/catalog.mjs';

export async function changeMachine(directory,machineId,{expectedRevision,expectedEditRevision,machineSetups}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const selection=await selectSettings(machineId,{machineSetups});
  const settings=resolveMachineSettings(state.plan,state.machine,selection,{boundsMm:state.geometry?.boundsMm});
  return applySettingsSnapshot(directory,{machine:selection.machine,settings},state.revision,{expectedEditRevision});
}

export async function adjustSettings(directory,patch,{expectedRevision,expectedEditRevision}={}){
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const settings=resolveSettingsPatch(state.plan,patch);
  const updated=await applySettingsSnapshot(directory,{machine:state.machine,settings},state.revision,{expectedEditRevision});
  return updated;
}

// Recording dependency configuration is data-only. Existing recipe references
// remain authoritative; later consuming operations decide availability/validity.
export async function recordExtensionDependency(directory,id,configuration,{expectedRevision,expectedEditRevision}={}){
  requireThat(EXTENSION_CONFIGURATION_IDS.includes(id),'This extension has no named recipe configuration. Use its geometry or construction record; supported named configurations are '+EXTENSION_CONFIGURATION_IDS.join(', ')+'.');
  requireThat(configuration===null||configuration&&typeof configuration==='object'&&!Array.isArray(configuration),'Supply extension configuration, or null to remove it.');
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision});
  const skills=structuredClone(state.plan.skills??{});
  if(configuration===null)delete skills[id];else skills[id]=structuredClone(configuration);
  return applySettingsSnapshot(directory,{machine:state.machine,settings:{skills}},state.revision,{expectedEditRevision});
}
