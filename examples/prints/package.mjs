// Maintainer-only preparation. First-run users never execute slicing here.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {loadBundle} from '../../core/print/bundle.mjs';
import {decodeSource} from '../../studio/source-player.mjs';
import {buildMaterialScene} from '../../studio/material-view.mjs';
import {encodePreview} from '../../studio/preview-cache.mjs';
import {TOUR_DEMOS,TOUR_VERSION} from '../../studio/tour-catalog.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function packageDemo(id,sourceRoot=resolve(root,'Prints/tour')){
  if(!TOUR_DEMOS.some(d=>d.id===id))throw Error('Unknown demo');
  const source=resolve(sourceRoot,id),destination=resolve(root,'examples/prints',id,'prepared');
  const state=await loadBundle(source,{program:'source',allSources:true});
  if(state.programError||!state.program)throw Error(state.programError??'Generate the demo first');
  if(state.geometryApproved||state.planApproved||state.toolpathApproved)throw Error('Use an unapproved demo workspace');
  const program=decodeSource(state.sources,state.plan,state.machine),scene=await buildMaterialScene(program.moves,state.plan,state.geometry,{yieldTask:async()=>{}});
  const display=gzipSync(encodePreview({program:{...program,moves:undefined},moves:program.moves.snapshot(),material:{...scene,moves:undefined,plan:undefined,geometry:undefined}}),{level:9});
  await mkdir(destination,{recursive:true});await writeFile(resolve(destination,'display.bin.gz'),display);
  delete state.code;delete state.sources;delete state.dir;state.review.approvals={};
  const snapshot=JSON.stringify(state);await writeFile(resolve(destination,'state.json'),snapshot);
  const files={};
  async function copy(folder=''){
    for(const entry of await readdir(resolve(source,folder),{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const name=folder?folder+'/'+entry.name:entry.name;
      if(entry.isDirectory()){await copy(name);continue;}
      const bytes=await readFile(resolve(source,name));files[name]=hash(bytes);
      await mkdir(dirname(resolve(destination,'bundle',name)),{recursive:true});await writeFile(resolve(destination,'bundle',name),bytes);
    }
  }
  await copy();
  await writeFile(resolve(destination,'manifest.json'),JSON.stringify({version:TOUR_VERSION,id,files,stateHash:hash(snapshot),displayHash:hash(display)},null,2)+'\n');
  console.log(JSON.stringify({id,files:Object.keys(files).length,displayMB:Math.round(display.length/1048576*10)/10}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))for(const demo of TOUR_DEMOS.filter(d=>!process.argv[2]||process.argv[2]==='all'||d.id===process.argv[2]))await packageDemo(demo.id,process.argv[3]);
