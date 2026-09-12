// Integration test of a downloaded folder. Uses no agent or manufacturing approvals.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,delimiter} from 'node:path';
import {performance} from 'node:perf_hooks';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {copySource} from './package-bundle.mjs';
import {root,run} from './setup.mjs';

export async function testFirstRun({archive,source=false}={}){
  assert.ok(source||archive,'Pass --archive <file> or --source.');
  // Outside the checkout: Node cannot accidentally resolve its parent dependencies.
  const workspace=await mkdtemp(join(tmpdir(),'saam-first-run-'));
  const folder=join(workspace,'download with spaces'),timings={};
  let viewer;
  try{
    await mkdir(folder);
    if(source)await copySource(folder);
    else {
      const start=performance.now();await run(process.platform==='win32'?'tar.exe':'tar',['-xf',resolve(archive),'-C',workspace]);
      const {rename}=await import('node:fs/promises');await rm(folder,{recursive:true});await rename(join(workspace,'SAAM'),folder);
      timings.extractMs=Math.round(performance.now()-start);
    }
    await assert.rejects(access(join(folder,'.git')));
    await assert.rejects(access(join(folder,'.saam')));
    if(source){await assert.rejects(access(join(folder,'runtime')));await assert.rejects(access(join(folder,'node_modules')));}
    const blockers=join(workspace,'blocked-tools');await mkdir(blockers);
    for(const tool of ['node','npm','npx','git']){
      await writeFile(join(blockers,tool),`#!/bin/sh\necho 'Unexpected system ${tool} use' >&2\nexit 97\n`,{mode:0o755});
      await writeFile(join(blockers,tool+'.cmd'),`@echo Unexpected system ${tool} use 1>&2\r\n@exit /b 97\r\n`);
    }
    const windows=process.platform==='win32',systemRoot=process.env.SystemRoot??'C:/Windows';
    const env={...process.env};delete env.NODE_PATH;delete env.NODE_OPTIONS;
    // PowerShell 7's inherited module paths must not disable Windows PowerShell's built-ins.
    if(windows)delete env.PSModulePath;
    // No user/runtime caches. Poison outbound npm/proxies for prepared archives.
    env.PATH=[blockers,...(windows?[join(systemRoot,'System32'),join(systemRoot,'System32/WindowsPowerShell/v1.0')]:['/usr/bin','/bin'])].join(delimiter);
    env.npm_config_cache=join(workspace,'empty-npm-cache');env.npm_config_update_notifier='false';
    if(!source){env.npm_config_offline='true';env.HTTPS_PROXY='http://127.0.0.1:1';env.HTTP_PROXY=env.HTTPS_PROXY;env.ALL_PROXY=env.HTTPS_PROXY;}
    const command=windows?join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'/bin/sh';
    const base=windows?['-NoProfile','-ExecutionPolicy','Bypass','-File',join(folder,'saam.ps1')]:[join(folder,'saam.sh')];
    const invoke=async(args)=>{
      const started=performance.now();
      await run(command,[...base,...args],{cwd:folder,env});return Math.round(performance.now()-started);
    };
    timings.setupMs=await invoke(['setup']);
    await invoke(['node','-e',"if(process.versions.node.split('.')[0]<22)process.exit(1)"]);
    const first=await readFile(join(folder,'.saam/setup.json'),'utf8');
    timings.cachedSetupMs=await invoke(['setup']);
    assert.equal(await readFile(join(folder,'.saam/setup.json'),'utf8'),first,'cached setup must not rerun the smoke check');
    const print=join(folder,'Prints','first part');
    const previewStart=performance.now();
    await invoke(['node','skills/wedge-demo/scripts/cli.mjs','init',print]);
    viewer=spawn(command,[...base,'studio',print],{cwd:folder,env,stdio:['pipe','pipe','pipe']});
    const exit=once(viewer,'exit');let output='';
    const origin=await new Promise((done,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Studio did not start: ${output}`)),30000);
      viewer.once('error',error=>{clearTimeout(timer);reject(error);});
      viewer.once('exit',code=>{clearTimeout(timer);reject(new Error(`Studio exited (${code}): ${output}`));});
      viewer.stderr.on('data',data=>{output+=data;});
      viewer.stdout.on('data',data=>{output+=data;const url=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(url){clearTimeout(timer);done(url[0]);}});
    });
    const response=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);
    const state=await response.json();assert.ok(state.geometry);assert.equal(state.geometryApproved,false);assert.equal(state.program,undefined);
    timings.previewMs=Math.round(performance.now()-previewStart);
    // A real viewer connection owns server lifetime, including the shell's child.
    const html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
    const connection=await fetch(origin+'/api/viewer?token='+token,{signal:AbortSignal.timeout(10000)});
    assert.equal(connection.status,200);
    await connection.body.cancel();
    await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Launcher did not stop.')),10000).unref())]);
    viewer=null;
    const report={platform:process.platform,arch:process.arch,kind:source?'source':'prepared',...timings,smoke:JSON.parse(first),scope:'OS launcher, extracted folder, no usable system Node/npm/Git, empty setup cache, geometry HTTP preview; desktop client permission UI and physical printing are not exercised.'};
    await mkdir(join(root,'dist'),{recursive:true});
    await writeFile(join(root,'dist',`first-run-${report.kind}-${process.platform}-${process.arch}.json`),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));return report;
  }finally{viewer?.kill('SIGTERM');await rm(workspace,{recursive:true,force:true,maxRetries:4,retryDelay:250});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(!(args.length===1&&args[0]==='--source')&&!(args.length===2&&args[0]==='--archive'))throw new Error('Usage: node scripts/test-first-run.mjs --source | --archive <file>');
    await testFirstRun({source:args[0]==='--source',archive:args[1]});
  }catch(error){console.error(error);process.exitCode=1;}
}
