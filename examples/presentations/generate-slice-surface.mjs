// Source-only presentation preparation. All section/layout/mapping work uses SAAM's ordinary Slice pipeline.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {geometryOperations} from '../../core/geom/operations.mjs';
import {recipeDefaults,compileRecipe} from '../../core/print/plan.mjs';
import {preparePathGeometry} from '../../core/print/generate.mjs';
import {prepareSliceContexts} from '../../core/print/slice-material.mjs';
import {prepareSliceLayer} from '../../core/print/slice-preparation.mjs';
import {layerStrokes,mapSliceStrokes} from '../../core/region/layer-strokes.mjs';
import {defaults,poseAt} from './slice-surface/design.mjs';
import {createRecipeFactory} from './slice-surface/recipe.mjs';
const Geometry=geometryOperations(),sliceRecipe=createRecipeFactory(Geometry,recipeDefaults);
const output=resolve(process.argv[2]??'.local/presentations/slice-surface/native.frames.json.gz'),cache=join(dirname(output),'native-frames');
await mkdir(cache,{recursive:true});
const first=Number(process.argv[3]??0),stride=Number(process.argv[4]??1);
if(!Number.isInteger(first)||!Number.isInteger(stride)||first<0||stride<=0)throw Error('Invalid frame partition.');
const frames=[],poses=new Map(),last=defaults.durationSeconds*defaults.fps;
for(let index=first;index<=last;index+=stride){
  const file=join(cache,String(index).padStart(4,'0')+'.json.gz');
  const saved=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(saved){frames.push(JSON.parse(gunzipSync(saved)));continue;}
  const design={...defaults,frame:index},{plan:source,spec}=await sliceRecipe(design),pose=poseAt(index/30);
  const key=JSON.stringify(spec);
  if(poses.has(key)){
    const frame={...poses.get(key),frame:index,pose};frames.push(frame);await writeFile(file,gzipSync(JSON.stringify(frame)));continue;
  }
  const plan=compileRecipe(source).plan,geometry=await preparePathGeometry(plan);
  const prepared=prepareSliceContexts({plan,...geometry});
  if(prepared.notes.length)throw Error(prepared.notes.join('\n'));
  if(prepared.contexts.length!==1||prepared.contexts[0].spec.layers.length!==1)throw Error('Expected exactly one native Slice layer at frame '+index);
  const record=prepared.contexts[0],layer=prepareSliceLayer(record.spec,record.context,record.spec.layers[0]);
  const strokes=layerStrokes(layer.region,{...layer.strokeSettings,preparedLayout:layer.preparedLayout});
  const mapped=mapSliceStrokes([...strokes.walls,...strokes.infill,...strokes.fill],layer.slice,{sampleStepMm:defaults.sampleStepMm});
  const paths=mapped.map(({points,closed,role})=>({points,closed:Boolean(closed),role}));
  if(!paths.length||paths.some(path=>path.points.some(point=>point.some(n=>!Number.isFinite(n)))))throw Error('Invalid generated slice '+index);
  const boundary=mapSliceStrokes(layer.region.map(points=>({points,closed:true})),layer.slice,{sampleStepMm:defaults.sampleStepMm}).map(curve=>curve.points);
  const frame={frame:index,pose,paths,boundary,spec,sizeMm:defaults.sizeMm,method:'SAAM ordinary Slice stack → prepareSliceLayer → layerStrokes → mapSliceStrokes',sliceCount:1,stackSpacingMm:defaults.sizeMm*40};
  frames.push(frame);poses.set(key,frame);await writeFile(file,gzipSync(JSON.stringify(frame)));
  if(index%10===0){await writeFile(join(dirname(output),'native-progress-'+first+'.json'),JSON.stringify({frame:index,total:last+1}));console.log('Native Slice frames: '+(index+1)+' / '+(last+1));}
}
if(stride===1&&first===0){
await writeFile(output,gzipSync(JSON.stringify({schema:'saam-slice-animation/1',design:defaults,frames}),{level:6}));
await writeFile(join(dirname(output),'native-progress.json'),JSON.stringify({frame:last,total:last+1,complete:true}));
const extension=join(dirname(output),'extension');
await cp(new URL('./slice-surface/',import.meta.url),extension,{recursive:true});
await cp(output,join(extension,'ui/preview.frames.json.gz'));
await cp(new URL('../../studio/camera.mjs',import.meta.url),join(extension,'ui/camera.mjs'));
const playback=await readFile(new URL('../../studio/playback.mjs',import.meta.url),'utf8');
const encoderStart=playback.indexOf('// Video time is independent');
if(encoderStart<0)throw Error('SAAM movie encoder source boundary changed.');
await writeFile(join(extension,'ui/movie.mjs'),playback.slice(encoderStart));
console.log('NATIVE_FRAMES_SAVED');
}else console.log('FRAME_PARTITION_DONE '+first);
