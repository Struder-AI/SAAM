import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {defaults,normalize,INTRO_SECONDS,animationAt} from './design.mjs';
import {createRecipeFactory} from './recipe.mjs';
// The portable viewer reads presentation assets; ordinary Slice recipes remain editable.
export function createSliceAnimation({Geometry,Toolpath}){
  const cache={index:null,chunks:new Map()},sliceRecipe=createRecipeFactory(Geometry,Toolpath.recipeDefaults);
  async function preview(input){
    const d=normalize(input);
    cache.index??=readFile(new URL('./ui/preview.index.json',import.meta.url),'utf8').then(JSON.parse);
    const index=await cache.index;
    if(JSON.stringify({...d,frame:0})!==JSON.stringify(index.design))throw Error('Rebuild the presentation frames for this changed design using the source preparation command.');
    const chunk=index.chunks.find(chunk=>d.frame>=chunk.first&&d.frame<=chunk.last);
    if(!chunk)throw Error('The presentation cache has no frame '+d.frame);
    if(!cache.chunks.has(chunk.file)){
      cache.chunks.clear();cache.chunks.set(chunk.file,readFile(new URL('./ui/'+chunk.file,import.meta.url)).then(bytes=>JSON.parse(gunzipSync(bytes))));
    }
    const data=await cache.chunks.get(chunk.file),frame=data.frames.find(frame=>frame.frame===d.frame);
    if(!frame)throw Error('The presentation cache has no frame '+d.frame);return frame;
  }
  async function construct(input){
    const animation=animationAt(input.frame/30);if(animation.gyroidMix>0&&animation.gyroidMix<1)throw Error('The field blend is a presentation transition. Save a rectilinear or full gyroid endpoint.');
    const {plan,spec,design}=await sliceRecipe(input);
    return {plan,source:{extension:'slice-surface-animation',design,surface:spec},requirements:{sliceCount:1},report:{frame:design.frame,construction:design.frame/30-INTRO_SECONDS>=25&&design.frame/30-INTRO_SECONDS<42?'One native normal-band cladding Slice.':design.frame/30-INTRO_SECONDS>=48&&design.frame/30-INTRO_SECONDS<57?'One native surface-domain bridge Slice.':'Ordinary Slice stack; following slice beyond cube bounds.'}};
  }
  return {defaults,normalize,preview,pieces:()=>[{id:'slice-snapshot',name:'Selected slice'}],construct};
}
