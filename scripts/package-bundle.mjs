// Build on the target platform; optional native dependencies are platform-specific.
import {readFile,writeFile,mkdir,mkdtemp,copyFile,lstat,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,run} from './setup.mjs';

export async function runtimeSpec(){
  const rows=(await readFile(join(root,'scripts/runtime.tsv'),'utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>line.split(/\s+/));
  const row=rows.find(([,platform,arch])=>platform===process.platform&&arch===process.arch);
  if(!row)throw new Error(`No runtime for ${process.platform}/${process.arch}.`);
  const [version,platform,arch,archive,sha256]=row;
  return {version,platform,arch,archive,sha256,directory:archive.replace(/\.(zip|tar\.gz)$/,'')};
}
export async function copySource(destination){
  const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of files){
    if(/^(\.git|\.local|\.saam|Prints|runtime|node_modules|dist|build)(\/|$)/i.test(file))throw new Error(`Private or generated file is tracked: ${file}`);
    const source=join(root,file),target=join(destination,file);
    if(!(await lstat(source)).isFile())throw new Error(`Package source must be a regular file: ${file}`);
    await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
  }
}
export function launcher(directory,args,options={}){
  return process.platform==='win32'
    ?run(join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',join(directory,'saam.ps1'),...args],{cwd:directory,...options})
    :run('/bin/sh',[join(directory,'saam.sh'),...args],{cwd:directory,...options});
}
export async function packageBundle({development=false}={}){
  if(!development)execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root});
  const spec=await runtimeSpec(),out=join(root,'dist');await mkdir(out,{recursive:true});
  const workspace=await mkdtemp(join(out,'.package-')),folder=join(workspace,'SAAM');
  try{
    await copySource(folder);
    // Fresh verified download: never package an arbitrary local runtime tree.
    await launcher(folder,['setup']);
    await rm(join(folder,'.saam'),{recursive:true,force:true});
    const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    await writeFile(join(folder,'bundle.json'),JSON.stringify({schema:'saam-bundle/1',commit,development,runtime:spec,builtAt:new Date().toISOString()},null,2)+'\n');
    const name=`SAAM-${process.platform}-${process.arch}${development?'-development':''}`;
    const archive=join(out,name+(process.platform==='win32'?'.zip':'.tar.gz'));
    if(process.platform==='win32')await run('tar.exe',['-a','-cf',archive,'-C',workspace,'SAAM']);
    else await run('tar',['-czf',archive,'-C',workspace,'SAAM']);
    const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
    await writeFile(archive+'.sha256',`${hash.digest('hex')}  ${basename(archive)}\n`);
    console.log(`Prepared repository download: ${archive}`);return archive;
  }finally{await rm(workspace,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.slice(2).some(arg=>arg!=='--development'))throw new Error('Usage: node scripts/package-bundle.mjs [--development]');
    await packageBundle({development:process.argv.includes('--development')});
  }catch(error){console.error(`SAAM packaging failed: ${error.message}`);process.exitCode=1;}
}
