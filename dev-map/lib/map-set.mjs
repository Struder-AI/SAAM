// A process selects one map set; every reader and renderer shares it. `--set NAME` names a set
// under dev-map/sets (default 030-influence); `--set-dir DIR` selects one kept elsewhere, such as
// a generated preview in an ignored folder, named by its folder.
import {readFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),at=args.indexOf('--set'),dirAt=args.indexOf('--set-dir');
if(at>=0&&dirAt>=0)throw Error('Choose --set NAME or --set-dir DIR.');
export const setDir=dirAt<0?null:resolve(args[dirAt+1]??'');
export const setName=setDir?basename(setDir):at<0?'030-influence':args[at+1];
if(!/^[a-z0-9][a-z0-9-]*$/.test(setName??''))throw Error('Expected --set NAME (lowercase letters, digits and hyphens).');
const setRoot=setDir??`dev-map/sets/${setName}`;
export const mapSet=JSON.parse(readFileSync(setDir?`${setRoot}/map.json`:resolve(repoRoot,setRoot,'map.json'),'utf8'));
if(!['design','influence'].includes(mapSet.mode))throw Error(`${setRoot}/map.json: mode is design or influence.`);
export const setFile=file=>`${setRoot}/${file}`;
const flag=Math.max(at,dirAt);
export const commandArgs=flag<0?args:args.filter((_,i)=>i!==flag&&i!==flag+1);
