#!/usr/bin/env node
// Building, auditing and checking the generated map. Agents read it with
// `node scripts/agent-toolkit.mjs read-map INDEX|DECLARATION [--code]`; this script never reads
// a page for an agent and never scans except through `regenerate`.
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {repoRoot as root} from './lib/store.mjs';

const usage='Use: node dev-map/cli.mjs build | regenerate [INDEX] | flow-evidence INDEX|DECLARATION | check [--json] | watch-freshness [--once] [--interval-ms 2000]';
const [command='build',...args]=process.argv.slice(2);
if(!['build','check','regenerate','flow-evidence','watch-freshness'].includes(command))throw Error(usage);

if(command==='watch-freshness') {
  const {values}=parseArgs({args,options:{once:{type:'boolean'},'interval-ms':{type:'string',default:'2000'}}});
  const {writeFreshness,watchFreshness}=await import('./lib/freshness.mjs');
  if(values.once)console.log(JSON.stringify(await writeFreshness({repo:root})));
  else {
    const controller=new AbortController(),stop=()=>controller.abort();
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    let previous;
    try{await watchFreshness({repo:root,intervalMs:Number(values['interval-ms']),signal:controller.signal,onStatus:status=>{
      const key=JSON.stringify([status.state,status.snapshotId,status.stale,status.error]);
      if(key!==previous){console.log(JSON.stringify(status));previous=key;}
    }});}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }
  process.exit(0);
}

if(command==='flow-evidence') {
  const {loadFlow,flowPacket}=await import('./lib/flow.mjs');
  const {readIndex,storeDir}=await import('./lib/store.mjs');
  const held=await readIndex(storeDir(root));
  const target=args[0]??'';
  const path=held?.nodes[target]?.path??target;
  console.log(JSON.stringify(flowPacket(await loadFlow(),path,{evidence:true}),null,1));
  process.exit(0);
}

if(command==='regenerate') {
  const {generate}=await import('./lib/store.mjs');
  const index=args[0];
  const result=await generate({repo:root,region:index===undefined||index==='0'?null:String(index).split('.')[0]});
  const {drawView}=await import('./lib/generated-view.mjs');
  console.log(JSON.stringify({...result,view:await drawView({repo:root})},null,1));
  process.exit(0);
}

// The whole stored map drawn for a person. It reads the store and never scans. A store behind
// the source is still drawn, with the pages that moved marked on their own drawings, so the
// map stays readable while code is being changed; only a missing store is a failure here.
if(command==='build') {
  if(args.length)throw Error(usage);
  const {buildGeneratedView,regenerate}=await import('./lib/generated-view.mjs');
  let result;
  try {result=await buildGeneratedView({repo:root,out:resolve(root,'dev-map/view')});}
  catch(error){console.error(error.message);process.exit(1);}
  console.log(`${result.index}: ${result.pages} pages, ${result.files} files, ${result.bytes.toLocaleString('en-US')} bytes, ${result.ms} ms`);
  if(result.stale) {
    console.log(`${result.stale} pages are stale; generation dependencies changed or lack a matching fingerprint:`);
    for(const file of [...result.changed,...result.changedInputs??[]])console.log(`  ${file}`);
    console.log(`Run: ${regenerate}`);
  }
  process.exit(0);
}

const {values:options}=parseArgs({args,options:{json:{type:'boolean'}}});
const {storeStatus}=await import('./lib/store.mjs');
const {regenerate}=await import('./lib/generated-view.mjs');
const status=await storeStatus({repo:root});
const result={store:status.dir,generated:status.generated??null,missing:status.missing,
  stale:status.missing?null:status.stale,totals:status.missing?null:status.totals,
  unreached:status.missing?[]:status.unreached,orphanFacts:status.orphanFacts,
  factErrors:status.facts.errors};
const failed=status.missing||!!status.stale||status.facts.errors.length>0;

if(options.json)console.log(JSON.stringify(result,null,1));
else if(status.missing)console.log(`No stored map at ${status.dir}. Run: ${regenerate}`);
else {
  console.log(`Stored ${status.generated}: ${status.totals.regions} regions, ${status.totals.files} files, ${status.totals.pages} pages.`);
  console.log(`Links: ${status.totals.linked} linked, ${status.totals.unresolved} unresolved, ${status.totals.external} external.`);
  if(status.stale) {
    console.log(`Stale: ${status.stale.reason}. ${status.stale.files.length} source files; ${status.stale.inputs?.length??0} generator/configuration inputs changed.`);
    for(const file of [...status.stale.files,...status.stale.inputs??[]])console.log(`  ${file}`);
    console.log(`Run: ${regenerate} ${status.stale.regenerate}`);
  }
  console.log(`Unreached: ${status.unreached.length}`);
  for(const node of status.unreached)console.log(`  ${node.index} ${node.path} (${node.lines} lines)`);
  console.log(`Orphan facts: ${status.orphanFacts.length}`);
  for(const row of status.orphanFacts)console.log(`  ${row.line}\t${row.declaration}\t${row.kind}\t${row.fact}\t${row.source}\t${row.date}`);
  if(status.facts.errors.length) {
    console.log(`Malformed facts: ${status.facts.errors.length}`);
    for(const error of status.facts.errors)console.log(`  dev-map/facts.tsv:${error.line}: ${error.reason}\n    ${error.row}`);
  }
}
if(failed)process.exit(1);
