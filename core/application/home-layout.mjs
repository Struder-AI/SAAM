// User bundles, extensions and remembered setups share the local folder in one SAAM home.
// The application owns the home lease before moving data; installers leave
// current-home paths in place until the verified replacement starts.
import {lstat,mkdir,readdir,rename,rmdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {homePaths} from './home.mjs';
const LOCAL_DATA={'Prints':'Prints',extensions:'extensions','machine-setups':'state/machine-setups'};

async function entryInfo(path){
  try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function directoryInfo(path){
  const info=await entryInfo(path);
  if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw Error('SAAM data folder must be an ordinary directory: '+path);
  return info;
}
async function ordinaryTree(path){
  const info=await lstat(path);
  if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw Error('SAAM data migration cannot move a linked or special entry: '+path);
  if(info.isDirectory())for(const name of await readdir(path))await ordinaryTree(resolve(path,name));
}
function migrationEntry(home,directory,entry){
  if(!Object.hasOwn(LOCAL_DATA,directory)||typeof entry!=='string'||!entry||entry==='.'||entry==='..'||entry.includes('/')||entry.includes('\\'))
    throw Error('Invalid SAAM data migration entry.');
  const paths=homePaths(home),from=resolve(paths.home,LOCAL_DATA[directory],entry),to=resolve(paths.local,directory,entry);
  return {from,to};
}

export async function migrateLocalData(home){
  const paths=homePaths(home),outcome={home:paths.home,moved:[]},pending=[];
  await directoryInfo(paths.home);await directoryInfo(paths.local);await directoryInfo(paths.state);
  // Preflight all buckets together: a collision changes no existing user data.
  for(const directory of Object.keys(LOCAL_DATA)){
    const from=resolve(paths.home,LOCAL_DATA[directory]),to=resolve(paths.local,directory);
    await directoryInfo(to);
    if(!await directoryInfo(from))continue;
    for(const entry of await readdir(from)){
      const paths=migrationEntry(home,directory,entry);
      if(await entryInfo(paths.to))throw Object.assign(Error('SAAM local data already contains '+paths.to+'; existing data remains at '+paths.from+'. Resolve this collision before starting.'),{code:'LOCAL_DATA_COLLISION'});
      await ordinaryTree(paths.from);pending.push({directory,entry});
    }
  }
  for(const directory of Object.keys(LOCAL_DATA))await mkdir(resolve(paths.local,directory),{recursive:true});
  try{
    for(const record of pending){
      const paths=migrationEntry(home,record.directory,record.entry);
      if(await entryInfo(paths.to))throw Object.assign(Error('SAAM data destination appeared during migration: '+paths.to),{code:'LOCAL_DATA_COLLISION'});
      await rename(paths.from,paths.to);outcome.moved.push(record);
    }
    for(const directory of Object.keys(LOCAL_DATA)){
      const source=resolve(paths.home,LOCAL_DATA[directory]);
      if(await directoryInfo(source))await rmdir(source);
    }
  }catch(error){
    try{await restoreLocalData(outcome);}catch(restoreError){throw new AggregateError([error,restoreError],'SAAM data migration failed; all entries remain at their reported original or local paths.');}
    throw error;
  }
  return outcome;
}

// Startup failure restores the original paths, never overwriting newer files.
export async function restoreLocalData({home,moved}){
  const paths=homePaths(home);await directoryInfo(paths.home);await directoryInfo(paths.local);await directoryInfo(paths.state);
  for(const record of [...moved].reverse()){
    const entry=migrationEntry(home,record.directory,record.entry);
    if(await entryInfo(entry.from))throw Error('Cannot restore SAAM data over '+entry.from+'; migrated data remains at '+entry.to+'.');
    await directoryInfo(dirname(entry.to));await ordinaryTree(entry.to);
    await mkdir(dirname(entry.from),{recursive:true});await rename(entry.to,entry.from);
  }
  return {home:paths.home,restored:moved.length};
}
