#!/usr/bin/env node
import {startApplication} from './application.mjs';
import {homePaths} from '../core/application/home.mjs';
import {appendFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

startApplication({openOnStart:!process.argv.includes('--no-open')}).then(application=>{
  if(application.existing)return;
  const stop=()=>void application.stop().catch(error=>console.error(error.message));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('SIGHUP',stop);
}).catch(async error=>{
  process.exitCode=1;console.error('SAAM could not start:',error.message);
  const logs=resolve(homePaths().state,'logs');await mkdir(logs,{recursive:true}).catch(()=>{});
  await appendFile(resolve(logs,'saam.log'),new Date().toISOString()+' '+(error.stack??error.message)+'\n').catch(()=>{});
});
