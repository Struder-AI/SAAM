// A single migration boundary used by both installers before app replacement.
// Legacy sources stay recoverable until the caller activates the verified app.
import {mkdir,readdir,lstat,readFile,copyFile,link,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homePaths} from '../core/application/home.mjs';

async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function preserve(source,target,report){
  const sourceStat=await exists(source);if(!sourceStat)return;
  if(sourceStat.isSymbolicLink())throw Error(`Migration cannot follow symbolic link ${source}; resolve it before installing.`);
  if(!sourceStat.isDirectory()&&!sourceStat.isFile())throw Error(`Migration cannot copy special entry ${source}.`);
  const targetStat=await exists(target);
  if(targetStat?.isSymbolicLink())throw Error(`Migration cannot write through symbolic link ${target}; resolve it before installing.`);
  if(sourceStat.isDirectory()&&(!targetStat||targetStat.isDirectory())){
    await mkdir(target,{recursive:true});
    for(const entry of await readdir(source))await preserve(join(source,entry),join(target,entry),report);
    return;
  }
  if(targetStat){
    if(sourceStat.isFile()&&targetStat.isFile()){
      const [a,b]=await Promise.all([readFile(source),readFile(target)]);
      if(a.equals(b))return;
    }
    throw Object.assign(Error(`Migration collision: ${target} already contains different data from ${source}. Nothing was overwritten; resolve the collision before installing.`),{code:'MIGRATION_COLLISION'});
  }
  await mkdir(dirname(target),{recursive:true});
  const staged=target+'.migrating-'+randomUUID();
  await copyFile(source,staged,constants.COPYFILE_EXCL);
  try{await link(staged,target);report.copied++;}
  finally{await unlink(staged);}
}

export async function migrateHome({home,legacyData,legacyApp}={}){
  if(!home)throw Error('Migration requires the SAAM home.');
  const root=resolve(home),paths=homePaths(root),report={home:root,copied:0,sources:[]};
  for(const path of [root,paths.local,paths.prints,paths.extensions,paths.machineSetups,paths.state]){
    const info=await exists(path);
    if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw Error('Migration target must be an ordinary directory: '+path);
  }
  for(const path of [paths.prints,paths.extensions,paths.machineSetups,paths.state])await mkdir(path,{recursive:true});
  for(const source of [legacyData,legacyApp].filter(Boolean)){
    const from=resolve(source),sourceInfo=await exists(from);if(from===root||!sourceInfo)continue;
    if(!sourceInfo.isDirectory()||sourceInfo.isSymbolicLink())throw Error('Migration source must be an ordinary directory: '+from);
    // Retain every legacy data entry, including credentials, logs and unknown
    // user additions. Program data is selected explicitly; program files stay
    // in the recoverable old install until replacement succeeds.
    const names=from===resolve(legacyData??root)?await readdir(from):['Prints','extensions','.studio-requests','.local','state'];
    for(const name of names){
      if(name==='Prints'||name==='extensions'){
        // Keep a current home's old paths usable through app replacement.
        // The new application moves these only while it owns the home lease.
        const old=join(root,name),local=name==='Prints'?paths.prints:paths.extensions;
        await preserve(join(from,name),await exists(old)?old:local,report);
      }else if(name==='state'&&(await exists(join(from,name)))?.isDirectory()){
        if((await exists(join(from,name))).isSymbolicLink())throw Error('Migration cannot follow symbolic link '+join(from,name));
        for(const entry of await readdir(join(from,name))){
          const old=join(paths.state,entry),target=entry==='machine-setups'&&!await exists(old)?paths.machineSetups:old;
          await preserve(join(from,name,entry),target,report);
        }
      }else await preserve(join(from,name),join(paths.state,name),report);
    }
    report.sources.push(from);
  }
  await writeFile(join(root,'state','migration.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  migrateHome({home:process.argv[2],legacyData:process.argv[3],legacyApp:process.argv[4]})
    .then(report=>console.log(JSON.stringify(report))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
