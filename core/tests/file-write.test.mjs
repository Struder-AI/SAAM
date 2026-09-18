import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {replaceFile} from '../file-write.mjs';

test('concurrent replacements use separate temporary files and leave a complete value',async t=>{
  const root=await fs.mkdtemp(resolve(tmpdir(),'saam-file-write-')),file=resolve(root,'record.json');
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const values=Array.from({length:32},(_,n)=>JSON.stringify({n,payload:String(n).repeat(4000)}));
  await Promise.all(values.map(value=>replaceFile(file,value)));
  assert.ok(values.includes(await fs.readFile(file,'utf8')));assert.deepEqual(await fs.readdir(root),['record.json']);
});

test('Windows replacement retries sharing conflicts and preserves the previous file on permanent failure',{skip:process.platform!=='win32'},async t=>{
  const root=await fs.mkdtemp(resolve(tmpdir(),'saam-file-retry-')),file=resolve(root,'record.json');
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));await replaceFile(file,'before');
  const rename=fs.rename;let attempts=0;
  fs.rename=async(...args)=>{if(attempts++<2)throw Object.assign(Error('Synthetic sharing conflict'),{code:'EPERM'});return rename(...args);};
  syncBuiltinESMExports();t.after(()=>{fs.rename=rename;syncBuiltinESMExports();});
  await replaceFile(file,'after');assert.equal(attempts,3);assert.equal(await fs.readFile(file,'utf8'),'after');
  fs.rename=async()=>{throw Object.assign(Error('Synthetic permanent failure'),{code:'EIO'});};syncBuiltinESMExports();
  await assert.rejects(replaceFile(file,'lost'),{code:'EIO'});assert.equal(await fs.readFile(file,'utf8'),'after');
  assert.deepEqual(await fs.readdir(root),['record.json']);
});
