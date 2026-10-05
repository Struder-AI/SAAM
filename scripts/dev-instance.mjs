#!/usr/bin/env node
// Development tool: run `saam` against a background instance of this checkout.
// Its own home (SAAM_DATA, default under the OS temp folder), no tray, no browser.
//   node scripts/dev-instance.mjs [--home DIR] <saam arguments...>
//   node scripts/dev-instance.mjs [--home DIR] reload   (this checkout's runtime takes up its current code)
//   node scripts/dev-instance.mjs [--home DIR] stop
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);
const at=args.indexOf('--home');
const home=at>=0?resolve(args.splice(at,2)[1]):join(tmpdir(),'saam-dev-'+createHash('sha256').update(root).digest('hex').slice(0,8));
if(args[0]==='stop')args[0]='quit';
if(args[0]==='reload')args[0]='reload-runtime';
const result=spawnSync(process.execPath,[join(root,'scripts','saam.mjs'),...args],{stdio:'inherit',env:{...process.env,SAAM_DATA:home,SAAM_BACKGROUND:'1'}});
process.exitCode=result.status??1;
