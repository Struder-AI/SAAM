// Agent -> Settings -> Bundle: resolve outside storage, commit exact values
// against the read revision. Bundle retains review/invalidation ownership.
import {loadBundle,applySettingsSnapshot} from '../print/bundle.mjs';
import {selectSettings,resolveMachineSettings,resolveSettingsPatch,saveSetup} from './settings.mjs';
import {requireThat} from '../private/settings/numeric.mjs';
import {EXTENSION_CONFIGURATION_IDS} from '../../skills/catalog.mjs';

export async function changeMachine(directory,machineId,{expectedRevision,setupFile}={}){
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing the printer.');
  const selection=await selectSettings(machineId,{setupFile});
  const settings=resolveMachineSettings(state.plan,state.machine,selection);
  return applySettingsSnapshot(directory,{machine:selection.machine,settings},state.revision);
}

export async function rememberSetup(directory,options={}){
  const state=await loadBundle(directory,{program:false});
  return saveSetup(state.machine,state.plan.setup,options);
}

export async function adjustSettings(directory,patch,{expectedRevision,setupFile}={}){
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing settings.');
  const settings=resolveSettingsPatch(state.plan,patch);
  const updated=await applySettingsSnapshot(directory,{machine:state.machine,settings},state.revision);
  if(patch.setup&&updated.machine)await saveSetup(updated.machine,updated.plan.setup,{setupFile});
  return updated;
}

// Recording dependency configuration is data-only. Existing recipe references
// remain authoritative; later consuming operations decide availability/validity.
export async function recordExtensionDependency(directory,id,configuration,{expectedRevision}={}){
  requireThat(EXTENSION_CONFIGURATION_IDS.includes(id),'This extension has no named recipe configuration. Use its geometry or construction record; supported named configurations are '+EXTENSION_CONFIGURATION_IDS.join(', ')+'.');
  requireThat(configuration===null||configuration&&typeof configuration==='object'&&!Array.isArray(configuration),'Supply extension configuration, or null to remove it.');
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===state.revision,'This review is stale. Reload before recording the dependency.');
  const skills=structuredClone(state.plan.skills??{});
  if(configuration===null)delete skills[id];else skills[id]=structuredClone(configuration);
  return applySettingsSnapshot(directory,{machine:state.machine,settings:{skills}},state.revision);
}
