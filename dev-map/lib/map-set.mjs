// A process selects one map set; every reader, scanner and renderer shares it.
// The default remains the full product map. Named sets author scope and nesting.
// `--set-dir DIR` selects a set kept outside dev-map/sets, such as a generated preview in an
// ignored folder; its name is the folder's.
import {readFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2),at=args.indexOf('--set'),dirAt=args.indexOf('--set-dir');
if(at>=0&&dirAt>=0)throw Error('Choose --set NAME or --set-dir DIR.');
export const setDir=dirAt<0?null:resolve(args[dirAt+1]??'');
export const setName=setDir?basename(setDir):at<0?'default':args[at+1];
if(!/^[a-z0-9][a-z0-9-]*$/.test(setName??''))throw Error('Expected --set NAME (lowercase letters, digits and hyphens).');
export const setRoot=setDir??(setName==='default'?'dev-map':`dev-map/sets/${setName}`);
export const setInput=setName==='default'&&!setDir?null:`${setRoot}/map.json`;
export const mapSet=setInput?JSON.parse(readFileSync(setDir?setInput:fileURLToPath(new URL(`../../${setInput}`,import.meta.url)),'utf8')):null;
if(mapSet&&!['design','influence'].includes(mapSet.mode)&&(!Array.isArray(mapSet.scope)||!mapSet.scope.length||mapSet.scope.some(p=>typeof p!=='string'||!p.includes('::'))))
  throw Error('A named map set needs a nonempty scope of declaration paths.');
if(mapSet?.scanFiles&&(!Array.isArray(mapSet.scanFiles)||mapSet.scanFiles.some(p=>typeof p!=='string'||!p.endsWith('.mjs')||p.includes('..')||p.startsWith('/'))))
  throw Error('scanFiles must contain repository-relative .mjs paths.');
export const setFile=file=>`${setRoot}/${file}`;
const flag=Math.max(at,dirAt);
export const commandArgs=flag<0?args:args.filter((_,i)=>i!==flag&&i!==flag+1);
