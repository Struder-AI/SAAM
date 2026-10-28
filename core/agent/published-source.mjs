// Context's source-navigation responsibility: read the selected publication.
// No source is executed here.
import {readFile,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {publishedSourceFile,PUBLISHED_SOURCE_MANIFEST} from '../contracts/publication.mjs';

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const runFile=promisify(execFile);
const sourceError=(message,statusCode)=>Object.assign(Error(message),{statusCode});
async function containedSourcePath(base,file){
  const path=await realpath(resolve(base,file)),within=relative(base,path);
  if(isAbsolute(within)||within==='..'||within.startsWith('..\\')||within.startsWith('../'))throw sourceError('Source is outside the selected publication.',403);
  return path;
}

// Enumeration is explicit. Installed publications need neither Git nor a
// writable checkout.
export async function publishedSourceFiles(root=sourceRoot){
  const base=await realpath(root);
  try{
    await lstat(resolve(base,PUBLISHED_SOURCE_MANIFEST));
    const manifest=JSON.parse(await readFile(await containedSourcePath(base,PUBLISHED_SOURCE_MANIFEST),'utf8'));
    if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.some(file=>!publishedSourceFile(file)))throw sourceError('Invalid published source manifest.',403);
    return [...new Set(manifest.files)].sort();
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try{await lstat(resolve(base,'.git'));}catch(error){
    if(error.code!=='ENOENT')throw error;
    throw sourceError('Published source manifest is unavailable in the selected installation.',404);
  }
  const options={cwd:base,encoding:'utf8',maxBuffer:Infinity,windowsHide:true};
  const top=(await runFile('git',['rev-parse','--show-toplevel'],options)).stdout.trim();
  if(await realpath(top)!==base)throw sourceError('Source root must select the complete checkout.',403);
  const {stdout}=await runFile('git',['ls-files','--cached','--full-name','-z'],options);
  return [...new Set(stdout.split('\0').filter(publishedSourceFile))].sort();
}

export async function architectureSourceReader(root=sourceRoot){
  const base=await realpath(root),files=new Set(await publishedSourceFiles(base));
  return async file=>{
    if(!publishedSourceFile(file))throw sourceError('Source is outside the published application files.',403);
    if(!files.has(file))throw sourceError('Source is not published by this version.',404);
    const path=await containedSourcePath(base,file),target=relative(base,path).replaceAll('\\','/');
    if(!publishedSourceFile(target)||!files.has(target))throw sourceError('Source target is not published by this version.',403);
    return {file,text:await readFile(path,'utf8')};
  };
}
export async function readArchitectureSource({root=sourceRoot,file}){
  return (await architectureSourceReader(root))(file);
}
