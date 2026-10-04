// Soundness check for the influence analysis (plans/dev-maps.md#analysis): traces from real SAAM
// runs must show no influence the map lacks. Usage:
//   node dev-map/influence/trace/trace.mjs check
//       instrument every in-scope file and confirm the result still parses
//   node dev-map/influence/trace/trace.mjs run --dir DIR [WORKFLOW...]
//       run workflows (workflows.mjs; default all) in fresh Node processes with every in-scope
//       module instrumented, workers and child Node processes included; traces land in DIR
//   node dev-map/influence/trace/trace.mjs compare --dir DIR --analysis FILE [--out FILE] [--examples N]
//       compare the traces with `node dev-map/influence/run.mjs --out FILE all`
// Instrumentation: register.mjs (preload and load hook), instrument.mjs (source rewrite),
// runtime.mjs (recorder). Comparison: compare.mjs.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {mkdtempSync} from 'node:fs';
import {instrument,parse,inScope} from './instrument.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,'../../..');
const argv=process.argv.slice(2);
const option=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};
const positional=argv.slice(1).filter((a,i,all)=>!a.startsWith('--')&&!(i>0&&all[i-1].startsWith('--')));
const command=argv[0];

if(command==='check') {
  const files=execFileSync('git',['ls-files'],{cwd:repo,encoding:'utf8'}).split('\n').filter(inScope);
  let n=0,fns=0,sites=0;const failures=[];
  for(const file of files) {
    const text=readFileSync(resolve(repo,file),'utf8');
    try{parse(text);}catch{continue;}// scripts the analysis also parses as scripts are not instrumented
    let id=0;
    try {
      const {code,counts}=instrument(text,file,{fn:()=>++id,site:()=>++id});
      parse(code);n++;fns+=counts.functions;sites+=counts.sites;
    } catch(error){failures.push({file,error:error.message});}
  }
  console.log(JSON.stringify({instrumented:n,functions:fns,callSites:sites,failures},null,1));
  if(failures.length)process.exitCode=1;
} else if(command==='run') {
  const {workflows}=await import('./workflows.mjs');
  const dir=resolve(option('--dir')??'trace-out');
  const chosen=positional.length?positional:Object.keys(workflows);
  const preload=pathToFileURL(join(here,'register.mjs')).href;
  for(const name of chosen) {
    if(!workflows[name])throw Error(`Unknown workflow ${name}. Choose from ${Object.keys(workflows).join(', ')}.`);
    const out=join(dir,name);rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
    const home=mkdtempSync(join(tmpdir(),'saam-trace-'));
    const started=Date.now();
    const run=spawnSync(process.execPath,[join(here,'workflows.mjs'),name,home],{cwd:repo,encoding:'utf8',maxBuffer:256*1024*1024,
      env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import ${preload}`.trim(),SAAM_TRACE_DIR:out,SAAM_DATA:join(home,'saam-home')}});
    rmSync(home,{recursive:true,force:true,maxRetries:3});
    const status={workflow:name,exit:run.status,seconds:Math.round((Date.now()-started)/100)/10,stdout:run.stdout.trim().split('\n').slice(-5),stderr:run.stderr.trim().split('\n').slice(-8)};
    writeFileSync(join(out,'status.json'),JSON.stringify(status,null,1));
    console.log(JSON.stringify(status));
  }
} else if(command==='compare') {
  const {compare}=await import('./compare.mjs');
  const dir=resolve(option('--dir')??'trace-out');
  const analysis=option('--analysis');if(!analysis)throw Error('--analysis FILE (from run.mjs --out) is required.');
  const report=compare(JSON.parse(readFileSync(analysis,'utf8')),dir,{examples:+(option('--examples')??5)});
  const out=option('--out');
  if(out)writeFileSync(out,JSON.stringify(report,null,1));
  console.log(JSON.stringify(report.summary,null,1));
} else {
  console.log('Usage: trace.mjs check | run --dir DIR [WORKFLOW...] | compare --dir DIR --analysis FILE [--out FILE]');
}
