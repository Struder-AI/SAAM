// Context layers: which manuals an agent starts with, the index of gated sections, the hint a
// machine change carries, and machine-dependent guidance.
// The markers and their assembly are owned by manuals.mjs.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gatedSections, prepareManual, assembleManual, machineOpens } from './manuals.mjs';
import { SKILL_IDS, GUIDANCE_IDS, EXTENSION_IDS } from '../../skills/catalog.mjs';
import {listExtensions} from '../extensions/library.mjs';

// The maker's starting context, for both clients: the index (the digest) and the maker flow and
// print tools, plus their script sections for a script client. GEOMETRY.md, like a skill manual,
// is read by section when a form is written; MAKERS.md indexes its forms.
export const MAKER_MANUALS = ['MAKERS.md', 'GEOMETRY.md', 'core/print/USAGE.md'];
export const ONBOARDING = ['MAKERS.md', 'skills/DIGEST.md', 'core/print/USAGE.md'];
const skillManual = id => `skills/${id}/SKILL.md`;

// Selected workspaces are discoverable whether bundled or imported; skill
// extensions already in the digest only need a note for local overrides.
// Extensions that could not be read are named with their reasons.
export async function extensionDiscovery(root,{readTool,openTool,dataRoot}){
  const {extensions,skipped}=await listExtensions({appRoot:root,dataRoot});
  const selected=extensions.filter(item=>item.origin==='local'||item.manifest.kind==='workspace');
  const notes=[...selected.length?['Selected extensions: '+selected.map(item=>item.id+' ('+(item.manifest.kind??'skill')+', '+item.origin+')').join(', ')+'. Read each manual by ID with '+readTool+'. Open a workspace by extension ID with '+openTool+'; its new bundles return to Studio for review.']:[],
    ...skipped.length?['Skipped extensions, not loaded: '+skipped.map(item=>item.extension+' ('+item.origin+'): '+item.reason).join('; ')]:[]];
  return notes.length?{guidanceId:'extensions',path:'extensions',text:notes.join('\n')}:null;
}

export async function prepareOnboardingSources(root,options={}){return Promise.all(ONBOARDING.map(id=>prepareManual(root,id,options)));}
export async function assembleOnboardingSources(root,prepared,context,{dataRoot}={}){
  const documents=prepared.map(reference=>{
    const {guidanceId,path,text}=assembleManual(reference,context);
    return { guidanceId, path, text };
  });
  const discovery=await extensionDiscovery(root,{readTool:'read_skill',openTool:'open_workspace',dataRoot});
  if(discovery)documents.push(discovery);
  return documents;
}
export async function onboardingSources(root,context,options={}){return assembleOnboardingSources(root,await prepareOnboardingSources(root,options),context,options);}

// A skill section is named `ID#heading` (read_skill takes it); any other `PATH#heading`.
export const sectionName = guidanceId => guidanceId.replace(/^skills\/([^/]+)\/SKILL\.md#/, '$1#');

// Every gated section of the maker manuals and skill manuals, in catalog order. A manual that
// cannot be read, and a marker line that cannot, is left out and named in `unreadable`.
export async function gatedIndex(root, ids = [...MAKER_MANUALS, ...[...SKILL_IDS,...GUIDANCE_IDS,...EXTENSION_IDS].map(skillManual)]) {
  const lists = await Promise.all(ids.map(path => readFile(resolve(root, path), 'utf8').then(markdown => gatedSections(markdown, path),
    error => ({ sections: [], unreadable: [error.message] }))));
  return { sections: lists.flatMap(list => list.sections),
    unreadable: lists.flatMap((list, index) => list.unreadable.map(reason => `${ids[index]}: ${reason}`)) };
}
export const indexLine = section => `- ${section.title}: ${section.gate}; ${sectionName(section.guidanceId)}`;

// Capabilities select available guidance independently of any print recipe.
export async function machineHint(root, { from = null, to }) {
  if(!to)return null;
  const opensNow = machineOpens(to), opensBefore = machineOpens(from);
  const sections = (await gatedIndex(root)).sections
    .filter(section => section.requires.some(opensNow) && !section.requires.some(opensBefore));
  return sections.length ? `This printer opens ${sections.map(section => `"${section.title}" (${sectionName(section.guidanceId)})`)
    .join(', ')}: read ${sections.length > 1 ? 'them' : 'it'} by name when the print uses ${sections.length > 1 ? 'them' : 'it'}.` : null;
}
