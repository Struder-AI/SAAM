// Presentation preparation calls the production Slice layout, bead and connection stages.
// It caches deposition for display; manufacturing scheduling/export is not part of this movie.
import {readFile,writeFile,mkdir,cp,readdir,link} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createFrameBuilder,depositionPreview} from './prepare-slice-frame.mjs';
import {defaults,animationAt,surfaceFor,claddingSpec,bridgeSpec,endingPose,surfaceSpec} from './slice-surface/design.mjs';
import {geometryOperations} from '../../core/geom/operations.mjs';
const G=geometryOperations(),output=resolve(process.argv[2]??'.local/presentations/native-showcase/preview.index.json'),directory=dirname(output),frameDirectory=join(directory,'frames');
await mkdir(frameDirectory,{recursive:true});
const last=defaults.durationSeconds*30,canonical=[],keys=new Map(),unique=[];
for(let i=0;i<=last;i++){
 const a=animationAt(i/30),key=JSON.stringify(a);
 if(!keys.has(key)){keys.set(key,i);unique.push(i);}canonical.push(keys.get(key));
}

function surfaceCurves(spec,tube=false){
 const slice=G.patchSlice(G.buildGeometry({shape:'spline',patches:[spec]}).patches[0]),curves=[];
 for(let v=0;v<=12;v++)curves.push({points:Array.from({length:97},(_,i)=>G.evaluateSurface(slice,[i/96,v/12]).point),alpha:v===0||v===12?.42:.16});
 if(tube)for(let u=0;u<12;u++)curves.push({points:Array.from({length:33},(_,v)=>G.evaluateSurface(slice,[u/12,v/32]).point),alpha:.23});
 return curves;
}
const tubeContext=surfaceCurves(claddingSpec(defaults,{wrap:1}),true),bridgeTarget=bridgeSpec(defaults),bridgeSlice=G.patchSlice(G.buildGeometry({shape:'spline',patches:[bridgeTarget]}).patches[0]);
const bridgeRails=[0,1].map(u=>Array.from({length:65},(_,i)=>G.evaluateSurface(bridgeSlice,[u,i/64]).point));
const build=createFrameBuilder();
async function prepare(i){
 const file=join(frameDirectory,String(i).padStart(4,'0')+'.json.gz');try{await readFile(file);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const a=animationAt(i/30),{plan,model}=await build(i);if(model.summary.limitations?.length)throw Error('Frame '+i+': '+model.summary.limitations.join('; '));
 if(new Set(model.results.flatMap(r=>r.operations.map(o=>o.layerId))).size!==1)throw Error('Expected one active slice.');
 const frame={frame:i,sizeMm:24,animation:a,plan,program:depositionPreview(model),contextGeometry:a.context==='tube'?tubeContext:[],bridgeRails:a.context==='bridge'?bridgeRails:[],connections:model.results.reduce((n,r)=>n+(r.report.depositionConnections?.count??0),0),method:'SAAM Slice → native bead deposition → finalizeDepositionResult (including connectors) → unmodified Studio WebGL viewer'};
 await writeFile(file,gzipSync(JSON.stringify(frame),{level:3}));
}
if(process.argv[3]==='worker'){
 const first=Number(process.argv[4]),stride=Number(process.argv[5]),items=unique.filter((_,n)=>n%stride===first);let count=0;
 for(const i of items){await prepare(i);count++;if(count%15===0){await writeFile(join(directory,'progress-'+first+'.json'),JSON.stringify({count,total:items.length,frame:i}));console.log(first,count+'/'+items.length,'frame',i);}}
 await writeFile(join(directory,'progress-'+first+'.json'),JSON.stringify({count,total:items.length,complete:true}));
}else{
 const workers=Number(process.argv[3]??8);
 const tasks=Array.from({length:workers},(_,i)=>new Promise((done,fail)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),output,'worker',String(i),String(workers)],{stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',d=>process.stdout.write(d));child.stderr.on('data',d=>process.stderr.write(d));child.on('exit',code=>code===0?done():fail(Error('Frame worker '+i+' failed: '+code)));}));
 await Promise.all(tasks);
 await writeFile(output,JSON.stringify({schema:'saam-native-slice-animation/2',design:defaults,canonical,uniqueFrames:unique.length}));
 const extension=join(directory,'extension');await cp(new URL('./slice-surface/',import.meta.url),extension,{recursive:true});await mkdir(join(extension,'ui/frames'),{recursive:true});for(const name of await readdir(frameDirectory)){try{await link(join(frameDirectory,name),join(extension,'ui/frames',name));}catch(error){if(error.code!=='EEXIST')throw error;}}await cp(output,join(extension,'ui/preview.index.json'));
 const root=resolve('.'),destination=join(extension,'ui/native'),pending=['studio/viewer-renderer.mjs','studio/playback.mjs','studio/toolpath-view.mjs','studio/material-view.mjs','studio/camera.mjs'],seen=new Set(),manifest=[];
 while(pending.length){const path=pending.pop();if(seen.has(path))continue;seen.add(path);const bytes=await readFile(resolve(root,path)),text=bytes.toString(),file=resolve(destination,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);manifest.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});for(const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))if(match[1].startsWith('.'))pending.push(relative(root,resolve(dirname(resolve(root,path)),match[1])).replaceAll('\\','/'));}
 await writeFile(join(destination,'source-manifest.json'),JSON.stringify(manifest,null,2));console.log('COMPLETE',unique.length,'native frames;',last+1,'animation frames;',manifest.length,'unmodified Studio modules.');
}
