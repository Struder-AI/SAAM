import {readFile,writeFile,mkdir,rm,access,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function identity(directory=root){
  const files=await Promise.all(['package.json','package-lock.json'].map(file=>readFile(join(directory,file))));
  return digest(Buffer.concat([...files,Buffer.from(`${process.version}/${process.platform}/${process.arch}`)]));
}
async function json(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}}
async function save(file,value){await mkdir(dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file);}
export function run(command,args,options={}){
  return new Promise((done,reject)=>{
    const child=spawn(command,args,{cwd:root,stdio:'inherit',...options});
    child.once('error',reject);child.once('exit',(code,signal)=>code===0?done():reject(new Error(`${command} failed (${signal??code}).`)));
  });
}
export async function setup({force=false}={}){
  const started=performance.now();
  const installedFile=join(root,'node_modules/.saam-install.json');
  const readyFile=join(root,'.saam/setup.json');
  const lock=join(root,'.saam/setup.lock');
  await mkdir(join(root,'.saam'),{recursive:true});
  // Protect cached readiness too: a concurrent forced install replaces dependencies.
  try{await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw new Error('Another setup owns .saam/setup.lock. Wait for it; if it was interrupted, remove that lock directory and rerun setup.');throw error;}
  try{
    const stamp=await identity();
    const checkHash=digest(await readFile(new URL('./setup-check.mjs',import.meta.url)));
    const installed=await json(installedFile),ready=await json(readyFile);
    const packageLock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
    // Detect interrupted/deleted package folders without walking thousands of files.
    let complete=true;
    for(const [name,entry] of Object.entries(packageLock.packages)){
      if(!name||entry.optional)continue;
      try{await access(join(root,name,'package.json'));}catch{complete=false;break;}
    }
    if(!force&&complete&&installed?.identity===stamp&&ready?.identity===stamp&&ready.checkHash===checkHash){
      console.log('SAAM is ready (cached setup).');return {cached:true,totalMs:Math.round(performance.now()-started)};
    }
    await rm(readyFile,{force:true});
    if(force||!complete||installed?.identity!==stamp){
      console.log('Preparing SAAM: installing locked dependencies...');
      const bin=dirname(process.execPath);
      let npm=process.platform==='win32'?join(bin,'node_modules/npm/bin/npm-cli.js'):resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js');
      try{await access(npm);}catch(error){
        if(error.code!=='ENOENT'||!process.env.npm_execpath)throw error;
        npm=process.env.npm_execpath;
      }
      await access(npm);
      await run(process.execPath,[npm,'ci','--ignore-scripts','--no-audit','--no-fund','--cache',join(root,'.saam/npm-cache')],{env:{...process.env,PATH:bin+(process.platform==='win32'?';':':')+(process.env.PATH??'')}});
      await save(installedFile,{identity:stamp});
    }
    // Preserve the existing setup-check CLI's deadline when calling its API.
    const deadline=setTimeout(()=>{console.error('SAAM setup check timed out after 30 seconds.');process.exit(1);},30000).unref();
    let result;
    try{const {checkSetup}=await import('./setup-check.mjs');result=await checkSetup();}
    finally{clearTimeout(deadline);}
    await save(readyFile,{identity:stamp,checkHash,checkedAt:new Date().toISOString(),...result});
    return {cached:false,...result,totalMs:Math.round(performance.now()-started)};
  }finally{await rm(lock,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.slice(2).some(arg=>arg!=='--force'))throw new Error('Usage: setup [--force]');
    await setup({force:process.argv.includes('--force')});
  }catch(error){console.error(`SAAM setup failed: ${error.message}`);process.exitCode=1;}
}
