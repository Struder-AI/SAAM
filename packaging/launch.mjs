#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {startApplication} from './application.mjs';
import {background,showOpened} from '../studio/browser.mjs';
import {homePaths} from '../core/application/home.mjs';
import {orchestratorRoot,invocationRoot} from '../core/application/runtime-selection.mjs';

async function launch(){
  const paths=homePaths(),root=await orchestratorRoot(paths);
  if(root!==invocationRoot){
    const child=spawn(resolve(root,'runtime',process.platform==='win32'?'node.exe':'node'),[resolve(root,'packaging/launch.mjs'),...process.argv.slice(2)],{detached:true,stdio:'ignore',windowsHide:true,env:process.env});
    await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail);});child.unref();return;
  }
  const application=await startApplication(background?{autoOpen:false,openOnStart:false,tray:false}:{openOnStart:!process.argv.includes('--no-open')});
  // This process holds the foreground right from the person's launch, so it shows the Studio.
  await showOpened(application.opened);
  if(application.existing)return;
  const stop=()=>void application.stop().catch(error=>console.error(error.message));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
}
// A command that launched this process over IPC hears its startup failure, then is released.
function release(){if(process.connected)process.disconnect();}
launch().then(release,error=>{
  process.exitCode=1;console.error('SAAM could not start:',error.message);
  if(process.connected)process.send({startupFailure:error.message},release);
});
