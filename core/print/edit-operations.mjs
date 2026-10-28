import {geometryTree,COMPILED_GEOMETRY_TOOLS} from '../../skills/records.mjs';
import {resolvePlanPatch} from './resolve-plan.mjs';
import {canonicalJson} from '../canonical-json.mjs';
import {SETTINGS_FIELDS,selectSettings} from '../machine/settings.mjs';
import {adjustSettings,changeMachine,recordExtensionDependency as saveExtensionDependency} from './settings-edits.mjs';
import {applySlice} from './slice-edit.mjs';
import {applyModulation} from './modulation.mjs';
import {summary} from './summary.mjs';
import {combineGeometry} from './geometry-tools.mjs';
import {recoverBundleInstance} from './studio-ownership.mjs';
import {admitMachineSetupStore} from '../machine/query-operations.mjs';
import {requireEditRevision} from './edit-identity.mjs';
import {loadBundle} from './bundle.mjs';
import {createPart,editPart} from '../application/part-execution.mjs';
import {editedPlacementOrigins} from './placement-intent.mjs';

async function changedCompiledGeometry(plan,patch){
  const {geometryTemplate}=await import('./plan.mjs'),compiled=geometry=>geometryTree(geometry).filter(node=>COMPILED_GEOMETRY_TOOLS[node.shape]||node.shape==='extension');
  const saved=new Set(compiled(plan.geometry).map(canonicalJson));
  return compiled(resolvePlanPatch(plan,patch,{geometryTemplate}).geometry).find(node=>!saved.has(canonicalJson(node)));
}

// Chat-driven adjustment: the command resolves its patch against the saved
// recipe and Bundle publishes the full next plan; dependent output becomes
// stale. A misspelled setting is ignored and named in the recipe notes.
// Runtime's part execution builds any changed geometry before Bundle stores it.
export async function adjustRecipe(directory,patch,{expectedRevision,expectedEditRevision}={}){
  patch=structuredClone(patch);
  const state=await loadBundle(directory,{program:false});
  requireEditRevision(state,{expectedRevision,expectedEditRevision},{optional:true});
  const {geometryTemplate}=await import('./plan.mjs');
  return editPart(directory,resolvePlanPatch(state.plan,patch,{geometryTemplate}),state.revision,
    {expectedEditRevision,placementOrigins:editedPlacementOrigins(state.placementOrigins,patch.placement)});
}

// Only path admission comes from the caller. Recipe decisions,
// revisioned writes and projection of legacy associated views belong to Bundle.
export function createBundleEditOperations({directory,runGeometry,machineSetupsPath,commandResults,appRoot,dataRoot}){
  const roots={appRoot,dataRoot};
  async function locate(bundleId){const dir=await directory(bundleId),bundle=await import('./bundle.mjs');return{dir,bundle};}
  function complete(operation,bundleId,state,report=summary(bundleId,state),invocationId){
    const outcome={status:'completed',revision:state.revision,editRevision:state.editRevision,geometryId:state.geometryId,outputId:state.outputId??null};
    return commandResults.complete({operation,bundleId,outcome,report,invocationId});
  }
  return {
    async recoverBundleInstance({bundleId}){
      return {bundleId,...await recoverBundleInstance(await directory(bundleId))};
    },
    async changeMachine({bundleId,machineId,expectedRevision,expectedEditRevision}){
      const {dir}=await locate(bundleId);
      return changeMachine(dir,machineId,{...roots,expectedRevision,expectedEditRevision,machineSetups:await admitMachineSetupStore(machineSetupsPath)});
    },
    async createBundle({bundleId,machineId,plan},studio){
      const preparedSelection=machineId?await selectSettings(machineId,{...roots,machineSetups:machineSetupsPath?await admitMachineSetupStore(machineSetupsPath):undefined}):undefined;
      const dir=await directory(bundleId,{create:true});
      await runGeometry(bundleId,options=>createPart(dir,plan,{machineId,preparedSelection,...options,...roots}),studio);
      return {status:'completed',bundleId,kind:'shell'};
    },
    async migrateBundle({bundleId},{invocationId}={}){
      const dir=await directory(bundleId),bundle=await import('./bundle.mjs');
      const report={bundleId,...await bundle.migrateBundle(dir)};
      return commandResults.complete({operation:'migrate_bundle',bundleId,invocationId,
        outcome:{status:'completed',...(report.verification?.revision?{revision:report.verification.revision}:{})},report});
    },
    async setStlUnits({bundleId,units,expectedRevision,expectedEditRevision},{invocationId}={}){
      const {setSTLUnits}=await import('../application/import-stl.mjs');
      const state=await setSTLUnits(await directory(bundleId),units,{expectedRevision,expectedEditRevision});
      return complete('set_stl_units',bundleId,state,summary(bundleId,state),invocationId);
    },
    async combineGeometry({bundleId,expectedRevision,expectedEditRevision,request},{invocationId}={}){
      const {dir,bundle}=await locate(bundleId),state=await bundle.loadBundle(dir,{program:false});
      if(state.kind!=='shell')throw new Error('Booleans combine shared shell/mesh prints.');
      const next=await combineGeometry(dir,request,{expectedRevision,expectedEditRevision});
      return complete('combine_geometry',bundleId,next,summary(bundleId,next),invocationId);
    },
    async setPhaseColours({bundleId,expectedRevision,phaseColours}){
      const {dir,bundle}=await locate(bundleId);
      return {bundleId,...await bundle.setPhaseColours(dir,{phaseColours,expectedRevision})};
    },
    async adjustRecipe({bundleId,expectedRevision,expectedEditRevision,patch},{invocationId}={}){
      const {dir,bundle}=await locate(bundleId),state=await bundle.loadBundle(dir,{program:false});
      const compiled=patch.geometry&&(patch.geometry.shape??state.plan.geometry?.shape)===state.plan.geometry?.shape&&await changedCompiledGeometry(state.plan,patch);
      if(compiled)throw new Error(compiled.shape==='extension'?`This print's ${compiled.extension} geometry changes only through apply_extension with extensionId ${compiled.extension}.`
        :`This print's ${compiled.shape} geometry changes only through ${COMPILED_GEOMETRY_TOOLS[compiled.shape]}.`);
      const options={expectedRevision,expectedEditRevision};
      const next=Object.keys(patch).every(key=>SETTINGS_FIELDS.includes(key))
        ?await adjustSettings(dir,patch,options):await adjustRecipe(dir,patch,options);
      return complete('adjust_recipe',bundleId,next,summary(bundleId,next),invocationId);
    },
    async slice({bundleId,expectedRevision,expectedEditRevision,...request},{invocationId}={}){
      const {dir}=await locate(bundleId),result=await applySlice(dir,request,{expectedRevision,expectedEditRevision});
      return complete('slice',bundleId,result.state,{...summary(bundleId,result.state),edit:result.edit},invocationId);
    },
    async modulate({bundleId,expectedRevision,expectedEditRevision,...request},{invocationId}={}){
      const {dir}=await locate(bundleId),result=await applyModulation(dir,request,{expectedRevision,expectedEditRevision});
      return complete('modulate',bundleId,result.state,{...summary(bundleId,result.state),edit:result.edit},invocationId);
    },
    async restoreRevision({bundleId,expectedRevision,direction},{invocationId}={}){
      const {dir,bundle}=await locate(bundleId),state=await bundle.restoreRevision(dir,{direction,expectedRevision});
      return complete('restore_revision',bundleId,state,summary(bundleId,state),invocationId);
    },
    async recordExtensionDependency({bundleId,extensionId,configuration,expectedRevision,expectedEditRevision},{invocationId}={}){
      const state=await saveExtensionDependency(await directory(bundleId),extensionId,configuration,{expectedRevision,expectedEditRevision});
      return complete('record_extension_dependency',bundleId,state,summary(bundleId,state),invocationId);
    },
    async setDeferredSetupSave({bundleId,expectedRevision,defer},{invocationId}={}){
      const {dir,bundle}=await locate(bundleId),saved=await bundle.setDeferredSetupSave(dir,{defer,expectedRevision});
      return commandResults.complete({operation:'set_deferred_setup_save',bundleId,invocationId,outcome:{status:'completed',revision:saved.revision},report:{bundleId,...saved}});
    }
  };
}
