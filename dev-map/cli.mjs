#!/usr/bin/env node
// Reading, regenerating, drawing and checking a map set (dev-map/README.md#commands). Agents read
// with `node scripts/agent-toolkit.mjs read-map ADDRESS`, or `read --set NAME`.
import {parseArgs} from 'node:util';
import {repoRoot as root,commandArgs,mapSet} from './lib/map-set.mjs';

const [command='build',...args]=commandArgs;
if(command==='read') {
  const {positionals}=parseArgs({args,allowPositionals:true,options:{}});
  if(positionals.length>1)throw Error('Read one map or contract address.');
  const {readMap}=await import('./lib/read.mjs');
  console.log(JSON.stringify(await readMap(positionals[0]??'0',{repo:root}),null,1));
  process.exit(0);
}
// A solved influence set (influence/solved-set.mjs) is written whole by its generator; a design
// set (lib/design.mjs) is authored. Each owns its other commands.
if(mapSet.mode==='influence') {
  const {influenceCommand}=await import('./influence/solved-set.mjs');
  await influenceCommand(command,args);
}
else {
  const {designCommand}=await import('./lib/design.mjs');
  await designCommand(command,args,{repo:root});
}
process.exit();
