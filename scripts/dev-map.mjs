#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {root,loadModel,regionContext} from './dev-map/model.mjs';
import {inputSnapshot,buildFreshness,recordBuild,changedSince,changesText} from './dev-map/maintenance.mjs';

const [command='build',...args]=process.argv.slice(2);
if(!['build','check','regenerate','flow-evidence'].includes(command))throw Error('Use: node scripts/dev-map.mjs build [--force] [--flow DECLARATION] | check [--since REF] [--built] [--json] | regenerate [INDEX] | flow-evidence INDEX|DECLARATION');
// Auditing and regeneration of the generated map live here, not on the agent CLI.
if(command==='flow-evidence') {
  const {loadFlow,flowPacket}=await import('./dev-map/flow.mjs');
  const {readIndex,storeDir}=await import('./dev-map/store.mjs');
  const held=await readIndex(storeDir(root));
  const target=args[0]??'';
  const path=held?.nodes[target]?.path??target;
  console.log(JSON.stringify(flowPacket(await loadFlow(),path,{evidence:true}),null,1));
  process.exit(0);
}
if(command==='regenerate') {
  const {generate}=await import('./dev-map/store.mjs');
  const index=args[0];
  console.log(JSON.stringify(await generate({repo:root,region:index===undefined||index==='0'?null:String(index).split('.')[0]}),null,1));
  process.exit(0);
}
const {values:options}=parseArgs({args,options:command==='build'?{force:{type:'boolean'},flow:{type:'string',multiple:true}}
  :{since:{type:'string'},built:{type:'boolean'},json:{type:'boolean'}}});
// Flow pages are a separate generated view with their own output; they touch no authored map.
if(command==='build'&&options.flow?.length) {
  const {buildFlow}=await import('./dev-map/flow.mjs');
  const out=resolve(root,'dev-map/flow');
  console.log(await buildFlow(options.flow,out));
  process.exit(0);
}
const snapshot=await inputSnapshot(root);
const freshness=await buildFreshness(root,snapshot);
if(command==='build'&&freshness.fresh&&!options.force) {
  console.log('Developer maps are current; reused the checked build.');
  process.exit(0);
}
const model=await loadModel();
// Agents read a region with `agent-toolkit.mjs read-map PAGE`; this script builds and checks.
if(command==='check') {
  const review=options.since?await changedSince(model,root,options.since):undefined;
  const result={pages:model.pages.length,nodes:model.pages.reduce((n,p)=>n+p.nodes.length,0),freshness,
    documentation:{references:model.references.length,responsibilities:model.responsibilities.length,
      implementationFiles:model.resources.filter(r=>r.requirement.expectation==='required').length},
    containment:model.coverage.summary.declarations,review};
  if(options.json)console.log(JSON.stringify(result,null,2));
  else {
    console.log(`Checked ${result.pages} pages, ${result.nodes} nodes. Structural consistency is not semantic approval.`);
    console.log(`Change contracts: ${result.documentation.implementationFiles} implementation files, ${result.documentation.responsibilities} responsibilities, ${result.documentation.references} map-owned references.`);
    console.log(`Containment: ${Object.entries(result.containment).map(([k,n])=>`${n} ${k}`).join(', ')}. See Code containment in the viewer.`);
    console.log(freshness.fresh?'Viewer build is current.':`Viewer needs rebuilding: ${freshness.reason}`);
    if(review)console.log(changesText(review));
  }
  if(options.built&&!freshness.fresh)process.exitCode=1;
}
else if(command==='build') {
  const out=resolve(root,'dev-map');await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'graph.json'),JSON.stringify(model.graph,null,2)+'\n');
  await writeFile(resolve(out,'coverage.json'),JSON.stringify(model.coverage,null,2)+'\n');
  await writeFile(resolve(out,'containment.json'),JSON.stringify(model.containment,null,2)+'\n');
  const child=spawn(process.env.PYTHON??'python',[resolve(root,'scripts/dev-map/render.py'),out],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  const {graph,coverage,analysis,...view}=model;
  child.stdin.end(JSON.stringify(view));
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`Map renderer exited ${code}`)));});
  await writeFile(resolve(out,'context.json'),JSON.stringify(model.pages.map(page=>regionContext(model,page.key)),null,2)+'\n');
  await recordBuild(root,snapshot,['index.html','context.json','graph.json','coverage.json','containment.json',...model.pages.map(p=>`${p.key}.svg`)]);
}
