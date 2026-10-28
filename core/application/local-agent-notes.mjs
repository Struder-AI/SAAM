// Compatibility imports for existing application consumers. Context owns prose.
export {readLocalAgentNotes,updateLocalAgentNotes} from '../agent/local-notes.mjs';
import {readFile} from 'node:fs/promises';
import {checkedPhaseColours} from '../print/phase-colours.mjs';

// Phase colours are private presentation preferences, separate from prose notes.
export async function readLocalPhaseColours(paths){
  const text=await readFile(paths.phaseColours,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  return text===null?null:checkedPhaseColours(JSON.parse(text));
}
