import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('setup reuses successful evidence and removes it after a failed recheck without touching prints',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-setup-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const directory of ['scripts','node_modules','Prints'])await mkdir(join(root,directory));
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module',dependencies:{}}));
  await writeFile(join(root,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{}}));
  await writeFile(join(root,'Prints/keep.txt'),'A saved print must survive setup.');
  await copyFile(new URL('../../scripts/setup.mjs',import.meta.url),join(root,'scripts/setup.mjs'));
  const check=join(root,'scripts/setup-check.mjs');
  await writeFile(check,`import {access,appendFile} from 'node:fs/promises';
export async function checkSetup(){
  await appendFile(new URL('../checks.txt',import.meta.url),'checked\\n');
  let fail=false;try{await access(new URL('../fail',import.meta.url));fail=true;}catch{}
  if(fail)throw new Error('Synthetic broken kernel');
  return {totalMs:1};
}`);
  const module=await import(pathToFileURL(join(root,'scripts/setup.mjs')));
  const original=await module.identity();
  await writeFile(join(root,'node_modules/.saam-install.json'),JSON.stringify({identity:original}));
  assert.equal((await module.setup()).cached,false);
  const ready=await readFile(join(root,'.saam/setup.json'),'utf8');
  assert.equal((await module.setup()).cached,true);
  assert.equal(await readFile(join(root,'.saam/setup.json'),'utf8'),ready);
  assert.equal(await readFile(join(root,'checks.txt'),'utf8'),'checked\n');
  await mkdir(join(root,'.saam/setup.lock'));
  await assert.rejects(module.setup(),/Another setup owns/,'cached readiness must respect an active install');
  await rm(join(root,'.saam/setup.lock'),{recursive:true});
  // A new check version must not trust the old successful result.
  await writeFile(check,(await readFile(check,'utf8'))+'\n// Updated smoke check version.\n');
  await writeFile(join(root,'fail'),'synthetic failure');
  await assert.rejects(module.setup(),/Synthetic broken kernel/);
  await assert.rejects(access(join(root,'.saam/setup.json')),{code:'ENOENT'});
  await assert.rejects(access(join(root,'.saam/setup.lock')),{code:'ENOENT'});
  await rm(join(root,'fail'));
  assert.equal((await module.setup()).cached,false);
  assert.equal(await readFile(join(root,'Prints/keep.txt'),'utf8'),'A saved print must survive setup.');
  await writeFile(join(root,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{},changed:true}));
  assert.notEqual(await module.identity(),original,'lockfile changes invalidate installation identity');
  // Another setup owns the install; this invocation must not delete its lock.
  await mkdir(join(root,'.saam/setup.lock'));
  await assert.rejects(module.setup(),/Another setup owns/);
  await access(join(root,'.saam/setup.lock'));
});
