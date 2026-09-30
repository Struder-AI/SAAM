// A process selects one map set; every reader, scanner and renderer shares it.
// The default remains the full product map. Named sets author scope and nesting.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2),at=args.indexOf('--set');
export const setName=at<0?'default':args[at+1];
if(!/^[a-z][a-z0-9-]*$/.test(setName??''))throw Error('Expected --set NAME (lowercase letters, digits and hyphens).');
export const setRoot=setName==='default'?'dev-map':`dev-map/sets/${setName}`;
export const setInput=setName==='default'?null:`${setRoot}/map.json`;
export const mapSet=setInput?JSON.parse(readFileSync(fileURLToPath(new URL(`../../${setInput}`,import.meta.url)),'utf8')):null;
if(mapSet&&(!Array.isArray(mapSet.scope)||!mapSet.scope.length||mapSet.scope.some(p=>typeof p!=='string'||!p.includes('::'))))
  throw Error('A named map set needs a nonempty scope of declaration paths.');
if(mapSet?.scanFiles&&(!Array.isArray(mapSet.scanFiles)||mapSet.scanFiles.some(p=>typeof p!=='string'||!p.endsWith('.mjs')||p.includes('..')||p.startsWith('/'))))
  throw Error('scanFiles must contain repository-relative .mjs paths.');
export const setFile=file=>`${setRoot}/${file}`;
export const commandArgs=at<0?args:args.filter((_,i)=>i!==at&&i!==at+1);
