#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {root,loadModel,regionContext} from './dev-map/model.mjs';

const [command='build',key]=process.argv.slice(2);
const model=await loadModel();
if (command==='read') console.log(JSON.stringify(regionContext(model,key),null,2));
else if(command==='check') console.log(`Checked ${model.pages.length} pages, ${model.pages.reduce((n,p)=>n+p.nodes.length,0)} nodes.`);
else if(command==='build') {
  const out=resolve(root,'dev-map');await mkdir(out,{recursive:true});
  const child=spawn(process.env.PYTHON??'python',[resolve(root,'scripts/dev-map/render.py'),out],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  child.stdin.end(JSON.stringify(model));
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`Map renderer exited ${code}`)));});
  await writeFile(resolve(out,'context.json'),JSON.stringify(Object.keys(model.specs).map(source=>regionContext(model,source)),null,2)+'\n');
} else throw Error('Use: node scripts/dev-map.mjs build|check|read [PAGE]');
