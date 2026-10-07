#!/usr/bin/env node
import {startApplication} from './application.mjs';
import {showOpened} from '../studio/browser.mjs';
import {readyInstance,controlRequest} from '../core/application/control.mjs';
import {selectRuntime} from '../core/application/runtime-selection.mjs';
import {pathIdentity} from '../core/application/home.mjs';
import {orchestratorRoot,invocationRoot} from '../core/application/runtime-selection.mjs';

async function launch(){
  const root=await orchestratorRoot();
  if(pathIdentity(root)!==pathIdentity(invocationRoot)){
    const instance=await readyInstance();
    if(!process.argv.includes('--no-open'))await showOpened(await controlRequest(instance,{command:'open',runtime:await selectRuntime(),visibility:'visible',display:'caller'}));
    return;
  }
  const application=await startApplication({openOnStart:!process.argv.includes('--no-open')});
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
