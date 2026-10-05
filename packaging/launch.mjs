#!/usr/bin/env node
import {startApplication} from './application.mjs';
import {background} from '../studio/browser.mjs';

startApplication(background?{autoOpen:false,openOnStart:false,tray:false}:{openOnStart:!process.argv.includes('--no-open')}).then(application=>{
  if(application.existing)return;
  const stop=()=>void application.stop().catch(error=>console.error(error.message));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
}).catch(error=>{
  process.exitCode=1;console.error('SAAM could not start:',error.message);
});
