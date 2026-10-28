// Named technique workflows. Runtime supplies only generic job lifecycle;
// Bundle supplies admitted targets/settings snapshots and owns publication.
import {isAbsolute} from 'node:path';
import {applyExtensionEdit,createExtensionBundle} from '../print/extension-edits.mjs';
import {createBlobFieldBundle,updateBlobFieldBundle} from './blob-field.mjs';
import {checkoutExtension,exportExtension,importExtension} from './library.mjs';

export function createExtensionOperations({Bundle,runGeometry,appRoot,dataRoot}){
  const roots={appRoot,...(dataRoot===undefined?{}:{dataRoot})};
  async function apply(bundleId,extensionId,request,options={},kindError='Extensions modify shared shell/mesh prints.',studio){
    const {dir,state}=await Bundle.prepareTarget(bundleId);
    if(state.kind!=='shell')throw Error(kindError);
    const updated=await runGeometry(bundleId,execution=>applyExtensionEdit(dir,extensionId,request,{...roots,...options,...execution}),studio);
    return {...Bundle.summary(bundleId,updated),...(updated.extensionReport?{extensionReport:updated.extensionReport}:{})};
  }
  async function blobField({bundleId,action,request,machineId,expectedRevision,expectedEditRevision,part},studio){
    if(action==='create'){
      const {dir,creation}=await Bundle.prepareTarget(bundleId,{create:true,machineId});
      return Bundle.summary(bundleId,await runGeometry(bundleId,execution=>createBlobFieldBundle(dir,request,{preparedCreation:creation,...execution}),studio));
    }
    if(machineId!==undefined)throw Error('Use the existing print machine for updates.');
    const {dir,state}=await Bundle.prepareTarget(bundleId);
    if(state.kind!=='shell')throw Error('Select a shared shell/mesh print.');
    return Bundle.summary(bundleId,await runGeometry(bundleId,execution=>updateBlobFieldBundle(dir,request,{expectedRevision,expectedEditRevision,part,...execution}),studio));
  }
  // A machine creates a new print from the extension's geometry; otherwise the extension edits the
  // current one. assignments replace the slice list in the same revision, for an edit that removes
  // material they select.
  async function applyExtension({bundleId,extensionId,machineId,expectedRevision,expectedEditRevision,request,part,assignments},studio){
    if(machineId!==undefined){
      const {dir,creation}=await Bundle.prepareTarget(bundleId,{create:true,machineId});
      return Bundle.summary(bundleId,await runGeometry(bundleId,execution=>createExtensionBundle(dir,extensionId,request,{...roots,preparedCreation:creation,...execution}),studio));
    }
    return apply(bundleId,extensionId,request,{expectedRevision,expectedEditRevision,part,...(assignments===undefined?{}:{assignments})},undefined,studio);
  }
  async function extensionLibrary({action,extensionId,packageFile}){
    if(action!=='import'&&!extensionId)throw Error(`Choose the extensionId to ${action}.`);
    if(action!=='checkout'&&!(packageFile&&isAbsolute(packageFile)))throw Error('Choose an absolute packageFile path.');
    if(action==='checkout')return checkoutExtension(extensionId,roots);
    if(action==='export')return exportExtension(extensionId,packageFile,roots);
    return importExtension(packageFile,roots);
  }
  return Object.freeze({blobField,applyExtension,extensionLibrary});
}
