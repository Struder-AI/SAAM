// Shared maker, builder and developer notes belong to the selected SAAM home.
import {readFile,mkdir,open,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {homePaths} from './home.mjs';
import {replaceFile} from '../file-write.mjs';

const notesRevision=bytes=>createHash('sha256').update(bytes).digest('hex');
function notesIdentity(){const {home,notes:path}=homePaths();return {home,path};}
async function readNotesFile(identity){
  try{const bytes=await readFile(identity.path);return {...identity,revision:notesRevision(bytes),text:bytes.toString('utf8')};}
  catch(error){if(error.code==='ENOENT')return {...identity,revision:null,text:''};throw error;}
}
export async function readLocalAgentNotes(){return readNotesFile(notesIdentity());}
export async function updateLocalAgentNotes({home,expectedRevision,text}){
  const identity=notesIdentity();
  const sameHome=process.platform==='win32'?resolve(home).toLowerCase()===identity.home.toLowerCase():resolve(home)===identity.home;
  if(!sameHome)throw Object.assign(Error('The SAAM home changed. Read local agent notes from the intended home before updating.'),{code:'SAAM_HOME_CHANGED',currentHome:identity.home});
  if(typeof text!=='string'||!(expectedRevision===null||typeof expectedRevision==='string'&&/^[a-f0-9]{64}$/.test(expectedRevision)))throw TypeError('Supply Markdown text and its expectedRevision (null for a missing notes file).');
  await mkdir(dirname(identity.path),{recursive:true});
  const lock=identity.path+'.lock';
  const handle=await open(lock,'wx').catch(error=>{
    if(error.code==='EEXIST')throw Object.assign(Error('Local agent notes have an active or interrupted writer. Retry after it finishes; inspect '+lock+' before recovering an interrupted writer.'),{code:'LOCAL_AGENT_NOTES_BUSY'});
    throw error;
  });
  try{
    await handle.writeFile(JSON.stringify({pid:process.pid,time:new Date().toISOString()}));
    const current=await readNotesFile(identity);
    if(current.revision!==expectedRevision)throw Object.assign(Error('Local agent notes changed. Read them again and apply your changes to the current Markdown.'),{code:'LOCAL_AGENT_NOTES_CHANGED',currentRevision:current.revision});
    await replaceFile(identity.path,text);
    return {status:'saved',...identity,revision:notesRevision(Buffer.from(text,'utf8'))};
  }finally{await handle.close();await rm(lock);}
}
