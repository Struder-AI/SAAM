import {readFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
import {defaults,normalize} from './design.mjs';
export function createSliceAnimation(){
 let index;const cache=new Map();
 async function preview(input){const d=normalize(input);index??=JSON.parse(await readFile(new URL('./ui/preview.index.json',import.meta.url),'utf8'));if(JSON.stringify({...d,frame:0})!==JSON.stringify(index.design))throw Error('Rebuild the native frames for a changed design.');const id=index.canonical[d.frame];if(!cache.has(id)){cache.clear();cache.set(id,JSON.parse(gunzipSync(await readFile(new URL('./ui/frames/'+String(id).padStart(4,'0')+'.json.gz',import.meta.url)))));}return cache.get(id);}
 return {defaults,normalize,preview,pieces:()=>[],construct:()=>{throw Error('This presentation workspace exports video and images.');}};
}
