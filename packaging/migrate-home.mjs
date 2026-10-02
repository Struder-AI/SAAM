// A single migration boundary used by both installers before app replacement.
// Legacy sources stay recoverable until the caller activates the verified app.
import {mkdir,readdir,lstat,readFile,copyFile,rename,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function preserve(source,target,recovery,report){
  const sourceStat=await exists(source);if(!sourceStat)return;
  if(sourceStat.isSymbolicLink())throw Error(`Migration cannot follow symbolic link ${source}; resolve it before installing.`);
  const targetStat=await exists(target);
  if(sourceStat.isDirectory()&&(!targetStat||targetStat.isDirectory())){
    await mkdir(target,{recursive:true});
    for(const entry of await readdir(source))await preserve(join(source,entry),join(target,entry),join(recovery,entry),report);
    return;
  }
  if(targetStat){
    if(sourceStat.isFile()&&targetStat.isFile()){
      const [a,b]=await Promise.all([readFile(source),readFile(target)]);
      if(a.equals(b))return;
    }
    report.conflicts.push({source,target,recovery});
    await preserve(source,recovery,recovery+'.conflict',report);return;
  }
  await mkdir(dirname(target),{recursive:true});
  const staged=target+'.migrating-'+randomUUID();
  await copyFile(source,staged,constants.COPYFILE_EXCL);
  await rename(staged,target);report.copied++;
}

export async function migrateHome({home,legacyData,legacyApp}={}){
  if(!home)throw Error('Migration requires the SAAM home.');
  const root=resolve(home),report={home:root,copied:0,conflicts:[],sources:[]};
  for(const name of ['Prints','extensions','state'])await mkdir(join(root,name),{recursive:true});
  for(const source of [legacyData,legacyApp].filter(Boolean)){
    const from=resolve(source);if(from===root||!await exists(from))continue;
    const key=createHash('sha256').update(from).digest('hex').slice(0,12);
    const recovery=join(root,'state','migration',key);
    // Retain every legacy data entry, including credentials, logs and unknown
    // user additions. Program data is selected explicitly; program files stay
    // in the recoverable old install until replacement succeeds.
    const names=from===resolve(legacyData??root)?await readdir(from):['Prints','extensions','.studio-requests','.local','state'];
    for(const name of names){
      const destination=['Prints','extensions'].includes(name)?join(root,name):name==='state'?join(root,'state'):join(root,'state',name);
      await preserve(join(from,name),destination,join(recovery,name),report);
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
