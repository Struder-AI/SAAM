import {access,mkdtemp,rm,readFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkMeshCapacity} from './mesh-capacity.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export const nativeMeshExecutable=join(root,'build','mesh-repair','saam-mesh-repair'+(process.platform==='win32'?'.exe':''));
async function checkInstallation(){
  try{await access(nativeMeshExecutable);const build=JSON.parse(await readFile(join(dirname(nativeMeshExecutable),'build.json'),'utf8'));
    const source=createHash('sha256').update(await readFile(new URL('./native/mesh-repair.cpp',import.meta.url))).digest('hex');
    if(build.sourceSha256!==source||build.cgal!=='6.2.1')throw Error('stale');
  }catch{throw Object.assign(Error('CGAL mesh repair is not built for this checkout. Run npm run setup:mesh. Exact cleanup remains available.'),{code:'MESH_BACKEND_UNAVAILABLE'});}
}
async function* offChunks(mesh){yield `OFF\n${mesh.vertices.length} ${mesh.triangles.length} 0\n`;let chunk='';for(const p of mesh.vertices){chunk+=p.join(' ')+'\n';if(chunk.length>=65536){yield chunk;chunk='';}}for(const t of mesh.triangles){chunk+='3 '+t.join(' ')+'\n';if(chunk.length>=65536){yield chunk;chunk='';}}if(chunk)yield chunk;}
async function readOff(path,{signal,progress}){
  const stream=createReadStream(path),lines=createInterface({input:stream,crlfDelay:Infinity});let header=0,nv=0,nf=0;const vertices=[],triangles=[];
  try{for await(const line of lines){signal?.throwIfAborted();const words=line.trim().split(/\s+/);if(!line.trim()||words[0].startsWith('#'))continue;
    if(header===0){if(words[0]!=='OFF')throw Error('Invalid native mesh response');header++;continue;}
    if(header===1){nv=Number(words[0]);nf=Number(words[1]);checkMeshCapacity(nv,nf);header++;continue;}
    if(vertices.length<nv){const p=words.map(Number);if(p.length!==3||!p.every(Number.isFinite))throw Error('Invalid native vertex');vertices.push(p);}
    else{if(words.length!==4||words[0]!=='3')throw Error('Invalid native triangle');const t=words.slice(1).map(Number);if(!t.every(v=>Number.isInteger(v)&&v>=0&&v<nv))throw Error('Invalid native triangle indices');triangles.push(t);if(triangles.length%4096===0)progress({stage:'read-result',completed:triangles.length,total:nf,percent:100*triangles.length/nf});}
  }}finally{lines.close();stream.destroy();}
  if(vertices.length!==nv||triangles.length!==nf||nv<4||nf<4)throw Error('Truncated native repair result');return {vertices,triangles};
}
// Elapsed time never refuses a repair: the child runs until it finishes, fails
// or is cancelled through signal. The pinned helper reports only at stage
// boundaries, so silence is not evidence of a stalled child; see native-repair.md.
export async function repairMeshNative(mesh,{maxHoleEdges=0,maxHoleDiameterMm=0,signal,progress=()=>{}}={}){
  if(!Number.isSafeInteger(maxHoleEdges)||maxHoleEdges<0||maxHoleEdges>100000||!Number.isFinite(maxHoleDiameterMm)||maxHoleDiameterMm<0||((maxHoleEdges===0)!==(maxHoleDiameterMm===0)))throw Error('Hole filling requires both positive maxHoleEdges and maxHoleDiameterMm, or both zero.');
  signal?.throwIfAborted();await checkInstallation();
  const temporary=await mkdtemp(join(tmpdir(),'saam-mesh-repair-')),input=join(temporary,'input.off'),output=join(temporary,'output.off');
  try{
    await pipeline(offChunks(mesh),createWriteStream(input),{signal});
    const report=await new Promise((yes,no)=>{
      const child=spawn(nativeMeshExecutable,[input,output,String(maxHoleEdges),String(maxHoleDiameterMm)],{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
      let stdout='',stderr='',lines='',failed;
      child.stdout.on('data',data=>{stdout+=data;if(stdout.length>65536){failed=Error('Native repair report is not this helper\'s single line of counts; no result accepted');child.kill();}});
      child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);lines+=data;for(;;){const at=lines.indexOf('\n');if(at<0)break;const line=lines.slice(0,at);lines=lines.slice(at+1);if(line.startsWith('{')){try{progress(JSON.parse(line));}catch(error){failed=error;child.kill();}}}if(lines.length>8192)lines=lines.slice(-8192);});
      child.on('error',error=>{failed=error;});
      child.on('close',code=>{if(failed)return no(failed);if(code!==0)return no(Object.assign(Error(stderr.split('\n').filter(s=>s&&!s.startsWith('{')).join('\n')||`Native mesh repair failed (${code})`),{code:'MESH_REPAIR_FAILED'}));try{yes(JSON.parse(stdout));}catch{no(Error('Invalid native repair report'));}});
    });
    const result=await readOff(output,{signal,progress});return {...result,report};
  }finally{
    // Only this call's freshly created directory under the OS temp root is removed.
    if(dirname(resolve(temporary))!==resolve(tmpdir())||!temporary.startsWith(join(tmpdir(),'saam-mesh-repair-')))throw Error('Unexpected native repair scratch path');
    await rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
}
