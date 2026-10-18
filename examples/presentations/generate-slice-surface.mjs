// Source-only presentation preparation. All section/layout/mapping work uses SAAM's ordinary Slice pipeline.
import {readFile,writeFile,mkdir,cp,rename} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {geometryOperations} from '../../core/geom/operations.mjs';
import {recipeDefaults,compileRecipe} from '../../core/print/plan.mjs';
import {preparePathGeometry} from '../../core/print/generate.mjs';
import {prepareSliceContexts} from '../../core/print/slice-material.mjs';
import {prepareReferenceSliceStack} from '../../core/print/slice-stacks.mjs';
import {evaluateSurface} from '../../core/geom/surface-evaluation.mjs';
import {prepareSliceLayer} from '../../core/print/slice-preparation.mjs';
import {layerStrokes,mapSliceStrokes} from '../../core/region/layer-strokes.mjs';
import {defaults,poseAt} from './slice-surface/design.mjs';
import {blendedInfill} from './intro-field.mjs';
import {createRecipeFactory} from './slice-surface/recipe.mjs';
const Geometry=geometryOperations(),sliceRecipe=createRecipeFactory(Geometry,recipeDefaults);
const output=resolve(process.argv[2]??'.local/presentations/slice-surface/preview.index.json'),cache=join(dirname(output),'native-frames');
await mkdir(cache,{recursive:true});
async function writeFrame(file,frame){const temporary=file+'.tmp';await writeFile(temporary,gzipSync(JSON.stringify(frame)));await rename(temporary,file);}
const first=Number(process.argv[3]??0),stride=Number(process.argv[4]??1);
if(!Number.isInteger(first)||!Number.isInteger(stride)||first<0||stride<=0)throw Error('Invalid frame partition.');
const introLayers=new Map(),poses=new Map(),layouts=new Map(),last=defaults.durationSeconds*defaults.fps;
for(let index=first;index<=last;index+=stride){
  const file=join(cache,String(index).padStart(4,'0')+'.json.gz');
  const saved=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(saved)continue;
  const design={...defaults,frame:index},{plan:source,spec,animation}=await sliceRecipe(design),pose=poseAt(index/30);
  const key=JSON.stringify([spec,source.slices,animation.gyroidMix??0]);
  if(poses.has(key)){
    const frame={...poses.get(key),frame:index,pose,animation};await writeFrame(file,frame);continue;
  }
  const layoutKey=JSON.stringify([spec,source.slices.assignments[0].loops,animation.density===1]);
  let layer=layouts.get(layoutKey);
  if(!layer){
  const plan=compileRecipe(source).plan,geometry=await preparePathGeometry(plan);
  const prepared=prepareSliceContexts({plan,...geometry});
  if(prepared.notes.length)throw Error(prepared.notes.join('\n'));
  if(prepared.contexts.length!==1||prepared.contexts[0].spec.layers.length!==1)throw Error('Expected exactly one native Slice layer at frame '+index);
  const record=prepareReferenceSliceStack(prepared.contexts[0]);layer=prepareSliceLayer(record.spec,record.context,record.spec.layers[0]);
  layouts.clear();layouts.set(layoutKey,layer);
  }
  layer={...layer,strokeSettings:{...layer.strokeSettings,fillDensity:animation.density,fillAngleDeg:animation.angle,patternAngleDeg:animation.angle,fillPattern:source.slices.assignments[0].fillPattern}};
  const morph=animation.gyroidMix>0&&animation.gyroidMix<1;
  const strokes=layerStrokes(layer.region,{...layer.strokeSettings,...(morph?{fillDensity:0}:{}),preparedLayout:layer.preparedLayout});
  if(morph)strokes.infill=blendedInfill(layer,animation.gyroidMix);
  const mapped=mapSliceStrokes([...strokes.walls,...strokes.infill,...strokes.fill],layer.slice,{sampleStepMm:defaults.sampleStepMm});
  const paths=mapped.map(({points,closed,role})=>({points,closed:Boolean(closed),role}));
  if(!paths.length||paths.some(path=>path.points.some(point=>point.some(n=>!Number.isFinite(n)))))throw Error('Invalid generated slice '+index);
  const boundary=mapSliceStrokes(layer.region.map(points=>({points,closed:true})),layer.slice,{sampleStepMm:defaults.sampleStepMm}).map(curve=>curve.points);
  const previousPaths=animation.mode==='intro'&&animation.layerIndex>0?(introLayers.get(animation.layerIndex-1)??[]):[];
  if(animation.mode==='intro'&&animation.layerIndex>=0)introLayers.set(animation.layerIndex,paths);
  const contextGeometry=[];
  if(animation.mode==='cladding'&&animation.cylinderContext>0){
    const slice=Geometry.patchSlice(Geometry.buildGeometry({shape:'spline',patches:[spec]}).patches[0]);
    for(let j=0;j<=24;j++)contextGeometry.push({points:Array.from({length:97},(_,i)=>evaluateSurface(slice,[i/96,j/24]).point),alpha:(j===0||j===24?.42:.18)*animation.cylinderContext});
    for(let i=0;i<12;i++)contextGeometry.push({points:Array.from({length:33},(_,j)=>evaluateSurface(slice,[i/12,j/32]).point),alpha:.23*animation.cylinderContext});
  }
  const frame={frame:index,pose,paths,boundary,spec,animation,contextGeometry,previousPaths,sizeMm:defaults.sizeMm,method:'SAAM ordinary Slice stack → prepareSliceLayer → layerStrokes → mapSliceStrokes',sliceCount:1,stackSpacingMm:source.slices.assignments[0].stack.layerMm};
  poses.clear();poses.set(key,frame);await writeFrame(file,frame);
  if(index%10===0){await writeFile(join(dirname(output),'native-progress-'+first+'.json'),JSON.stringify({frame:index,total:last+1}));console.log('Native Slice frames: '+(index+1)+' / '+(last+1));}
}
if(stride===1&&first===0){
const chunks=[],chunkDirectory=join(dirname(output),'chunks');await mkdir(chunkDirectory,{recursive:true});
for(let start=0;start<=last;start+=60){
  const frames=[];for(let i=start;i<=Math.min(last,start+59);i++)frames.push(JSON.parse(gunzipSync(await readFile(join(cache,String(i).padStart(4,'0')+'.json.gz')))));
  const name=String(chunks.length).padStart(3,'0')+'.json.gz';
  await writeFile(join(chunkDirectory,name),gzipSync(JSON.stringify({schema:'saam-slice-animation/1',design:defaults,frames}),{level:6}));chunks.push({file:'chunks/'+name,first:start,last:Math.min(last,start+59)});
}
await writeFile(output,JSON.stringify({schema:'saam-slice-animation-index/1',design:defaults,chunks}));
await writeFile(join(dirname(output),'native-progress.json'),JSON.stringify({frame:last,total:last+1,complete:true}));
const extension=join(dirname(output),'extension');
await cp(new URL('./slice-surface/',import.meta.url),extension,{recursive:true});
await cp(join(dirname(output),'chunks'),join(extension,'ui/chunks'),{recursive:true});
await cp(output,join(extension,'ui/preview.index.json'));
await cp(new URL('../../studio/camera.mjs',import.meta.url),join(extension,'ui/camera.mjs'));
const playback=await readFile(new URL('../../studio/playback.mjs',import.meta.url),'utf8');
const encoderStart=playback.indexOf('// Video time is independent');
if(encoderStart<0)throw Error('SAAM movie encoder source boundary changed.');
await writeFile(join(extension,'ui/movie.mjs'),playback.slice(encoderStart));
console.log('NATIVE_FRAMES_SAVED');
}else console.log('FRAME_PARTITION_DONE '+first);
