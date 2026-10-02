// One mid-height contour in the normal workbench, before full generation.
import {readFile} from 'node:fs/promises';
import {buildOrbitBundle} from './build-orbit-bundle.mjs';
const [root,source,target,optionsFile]=process.argv.slice(2);
if(!target)throw Error('Usage: node preview-orbit-bundle.mjs SAAM_ROOT SOURCE_BUNDLE PREVIEW_BUNDLE [OPTIONS_JSON]');
const options=optionsFile?JSON.parse(await readFile(optionsFile,'utf8')):{};
console.log(JSON.stringify(await buildOrbitBundle(root,source,target,{...options,preview:true}),null,2));
