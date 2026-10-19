import {readFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
import {defaults,normalize} from './design.mjs';import {createRecipeFactory} from './recipe.mjs';
export function createSliceAnimation({Geometry,Toolpath}){
 let index;const cache=new Map(),reference=createRecipeFactory(Geometry,Toolpath.recipeDefaults);
 async function preview(input){const d=normalize(input);index??=JSON.parse(await readFile(new URL('./ui/preview.index.json',import.meta.url),'utf8'));if(JSON.stringify({...d,frame:0})!==JSON.stringify(index.design))throw Error('Rebuild the native frames for a changed design.');const id=index.canonical[d.frame];if(!cache.has(id)){cache.clear();cache.set(id,JSON.parse(gunzipSync(await readFile(new URL('./ui/frames/'+String(id).padStart(4,'0')+'.json.gz',import.meta.url)))));}return cache.get(id);}
 async function construct(input){const {plan,spec,design}=await reference({...input,frame:0});return {plan,source:{extension:'slice-surface-animation',design,surface:spec},requirements:{sliceCount:1},report:{construction:'Flat reference: ordinary native Slice stack; following layer beyond the cube.'}};}
 return {defaults,normalize,preview,pieces:()=>[{id:'flat-reference',name:'Flat cube slice reference'}],construct};
}
