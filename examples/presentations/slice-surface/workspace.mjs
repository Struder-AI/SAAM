import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {defaults,normalize} from './design.mjs';
import {createRecipeFactory} from './recipe.mjs';
// The portable viewer reads presentation assets; ordinary Slice recipes remain editable.
export function createSliceAnimation({Geometry,Toolpath}){
  const cache={data:null},sliceRecipe=createRecipeFactory(Geometry,Toolpath.recipeDefaults);
  async function preview(input){
    const d=normalize(input);
    cache.data??=readFile(new URL('./ui/preview.frames.json.gz',import.meta.url)).then(bytes=>JSON.parse(gunzipSync(bytes)));
    const data=await cache.data;
    if(JSON.stringify({...d,frame:0})!==JSON.stringify(data.design))throw Error('Rebuild the presentation frames for this changed design using the source preparation command.');
    const frame=data.frames.find(frame=>frame.frame===d.frame);
    if(!frame)throw Error('The presentation cache has no frame '+d.frame);return frame;
  }
  async function construct(input){
    const {plan,spec,design}=await sliceRecipe(input);
    return {plan,source:{extension:'slice-surface-animation',design,surface:spec},requirements:{sliceCount:1},report:{frame:design.frame,construction:'Ordinary Slice stack; following slice beyond cube bounds.'}};
  }
  return {defaults,normalize,preview,pieces:()=>[{id:'slice-snapshot',name:'Selected slice'}],construct};
}
