// Context owns discovery and published manual assembly. Runtime supplies captured
// machine settings and session notices; this module does not acquire live work.
import {readGuidance,readManual,prepareManual,assembleManual} from './manuals.mjs';
import {prepareOnboardingSources,assembleOnboardingSources,ONBOARDING,extensionDiscovery,gatedIndex} from './layers.mjs';
import {SKILL_IDS,GUIDANCE_IDS,skillMetadata} from '../../skills/catalog.mjs';
import {listExtensions,readExtension} from '../extensions/library.mjs';
import {readLocalAgentNotes} from './local-notes.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

async function publishedVersion(root){
  try{const release=JSON.parse(await readFile(resolve(root,'release.json'),'utf8'));return {kind:'release',version:release.version,...(release.builtAt?{builtAt:release.builtAt}:{})};}
  catch(error){if(error.code!=='ENOENT')throw error;
    const manifest=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));return {kind:'source',version:manifest.version};}
}

export async function builderOnboarding({root,paths,setupProblem,runtime}){
  const ids=[...new Set(['BUILDERS.md',...ONBOARDING,'skills/AUTHORING.md','examples/prints/README.md'])];
  const [documents,notes,discovery,index,publication]=await Promise.all([
    Promise.all(ids.map(id=>readManual(root,id,{all:true,markers:true,dataRoot:paths.home}))),readLocalAgentNotes(paths),
    extensionDiscovery(root,{readTool:'read_skill',openTool:'saam call open_workspace',dataRoot:paths.home}),gatedIndex(root),publishedVersion(root)]);
  return {role:'builder',...(setupProblem?{setupProblem}:{}),...(runtime?{runtime:{id:runtime.id,label:runtime.label,command:runtime.command}}:{}),
    notes,publication,extensionFolder:paths.extensions,documents:[...documents,...(discovery?[discovery]:[])],
    ...(index.unreadable.length?{unreadableMarkers:index.unreadable}:{}),
    nextStep:'Author local extensions in extensionFolder through desktop chat. Use extension_library checkout to start from a selected extension; a local copy overrides the bundled extension with the same ID for desktop and web access to this installation. Reuse these manuals. read_contract_source reads this version’s published source without a writable core checkout. read_skill/read_guidance supply manuals and examples. Core changes require explicit developer authorization, a source checkout and an identified development runtime.'};
}

async function prepareMakerContext({paths,setupProblem,runtime}) {
  return {kind:'maker',dataRoot:paths.home,base:{role:'maker',...(setupProblem&&{setupProblem}),
    ...(runtime&&{runtime:{id:runtime.id,label:runtime.label,command:runtime.command,
      note:'This chat uses this runtime; every result names it. Run each saam command for this chat with runtime.command.'}}),
    notes:await readLocalAgentNotes(paths)}};
}
export async function makerOnboarding({root,prepared,capturedSettings}) {
  return {...prepared.base,sources:await assembleOnboardingSources(root,prepared.manuals,{machine:capturedSettings},{dataRoot:prepared.dataRoot}),
    nextStep:'Reuse these sources. Read skill manuals when the making task needs them. If no operation fits, build an extension; work an extension cannot express is a SAAM bug to report. Core implementation requires explicit developer authorization.'};
}

export async function listSkills({root,paths,localExtension}) {
  const dataRoot=paths?.home;
  const found=[];
  for(const id of [...SKILL_IDS,...GUIDANCE_IDS]) {
    try {
      const {text:manual}=await readGuidance(root,`skills/${id}/SKILL.md`,{dataRoot});
      found.push({...skillMetadata(id,manual),manualTool:'read_skill'});
    } catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  const {extensions,skipped}=await listExtensions({appRoot:root,dataRoot});
  for(const extension of extensions.filter(extension=>extension.manifest.kind!=='machine')) {
    const {text:manual}=await readGuidance(root,`extensions/${extension.id}/SKILL.md`,{dataRoot});
    found.push({...skillMetadata(extension.id,manual),...(extension.manifest.kind&&extension.manifest.kind!=='skill'?{kind:extension.manifest.kind}:{}),
      layer:'extension',origin:extension.origin,digest:extension.digest,manualTool:'read_skill'});
  }
  found.push(...await localExtension.skills?.()??[]);
  return {skills:found.sort((a,b)=>a.id.localeCompare(b.id)),...(skipped.length?{skipped}:{})};
}

export async function discoverWorkspaces({root,paths}) {
  const {listWorkspaces}=await import('../extensions/workspaces.mjs');
  return {workspaces:await listWorkspaces({appRoot:root,dataRoot:paths?.home})};
}

async function selectSkill({root,paths,localExtension,input}) {
  const {skillId:name}=input;
  const [skillId,anchor]=name.split('#');
  const extension=await readExtension(skillId,{appRoot:root,dataRoot:paths.home});
  if(!SKILL_IDS.includes(skillId)&&!GUIDANCE_IDS.includes(skillId)&&!extension) {
    const local=await localExtension.readSkill?.(skillId);if(local)return {kind:'local',result:local};
    throw Error('Unknown skill or guidance manual ID. Use list_skills and its manual links.');
  }
  return {kind:'skill',dataRoot:paths.home,skillId,guidanceId:`${extension?'extensions':'skills'}/${skillId}/SKILL.md${anchor?'#'+anchor:''}`};
}
export function readSkill({prepared,capturedSettings}) {
  const {text:manual,...reference}=assembleManual(prepared.manual,{machine:capturedSettings});
  return {skillId:prepared.skillId,manual,...reference};
}
export function readPublishedGuidance({prepared,capturedSettings}) {
  return assembleManual(prepared.manual,{machine:capturedSettings,headings:true});
}

// Preparation preserves source/local-fallback and notes error precedence without
// giving Context a callback or capability to read Bundle or resolve profiles.
export async function prepareContextRead({operation,root,paths,localExtension,input,setupProblem,runtime}){
  switch(operation){
    case 'maker_onboarding':return prepareMakerContext({paths,setupProblem,runtime});
    case 'read_skill':return selectSkill({root,paths,localExtension,input});
    case 'read_guidance':return {kind:'guidance',dataRoot:paths.home,guidanceId:input.guidanceId};
    default:throw Error('Unknown Context read: '+operation);
  }
}
export async function loadContextRead(root,selection){
  if(selection.kind==='maker')return {...selection,manuals:await prepareOnboardingSources(root,{dataRoot:selection.dataRoot})};
  if(selection.kind==='skill'||selection.kind==='guidance')return {...selection,manual:await prepareManual(root,selection.guidanceId,{dataRoot:selection.dataRoot})};
  throw Error('Context read needs a prepared manual selection.');
}
export async function assembleContextRead({root,prepared,capturedSettings}){
  switch(prepared.kind){
    case 'maker':return makerOnboarding({root,prepared,capturedSettings});
    case 'skill':return readSkill({prepared,capturedSettings});
    case 'guidance':return readPublishedGuidance({prepared,capturedSettings});
    default:throw Error('Context read needs prepared source text.');
  }
}
