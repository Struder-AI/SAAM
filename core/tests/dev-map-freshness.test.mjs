import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {runInNewContext} from 'node:vm';
import {generate,readIndex,storeDir} from '../../scripts/dev-map/store.mjs';
import {readFreshness,writeFreshness,watchFreshness,snapshotIdentity} from '../../scripts/dev-map/freshness.mjs';

async function fixture(t){
  const repo=await mkdtemp(resolve(tmpdir(),'saam-map-freshness-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  const put=async(file,value)=>{await mkdir(dirname(resolve(repo,file)),{recursive:true});await writeFile(resolve(repo,file),value);};
  await put('core/a.mjs','export const a=x=>x;');
  await put('core/b.mjs','export const b=x=>x+1;');
  return {repo,put,generate:()=>generate({repo}),index:()=>readIndex(storeDir(repo))};
}

test('live heartbeat detects source edits and deletion without changing the stored snapshot',async t=>{
  const f=await fixture(t);await f.generate();
  const original=await readFile(resolve(storeDir(f.repo),'index.json'),'utf8');
  const current=await writeFreshness({repo:f.repo});
  assert.equal(current.state,'current');assert.equal(current.stale,null);
  assert.equal(current.snapshotId,snapshotIdentity(await f.index()));
  assert.ok(Number.isFinite(Date.parse(current.checkedAt)));assert.equal(current.validForMs,10000);
  await f.put('core/a.mjs','export const a=x=>x+2;');
  const changed=await writeFreshness({repo:f.repo});
  assert.equal(changed.state,'stale');assert.deepEqual(changed.stale.changed,['core/a.mjs']);
  assert.equal(changed.snapshotId,current.snapshotId);
  await rm(resolve(f.repo,'core/a.mjs'));
  const deleted=await writeFreshness({repo:f.repo});
  assert.equal(deleted.state,'stale');assert.deepEqual(deleted.stale.deleted,['core/a.mjs']);
  assert.equal(await readFile(resolve(storeDir(f.repo),'index.json'),'utf8'),original,'status reads must not regenerate');
  let payload;
  runInNewContext(await readFile(resolve(f.repo,'dev-map/view/freshness.js'),'utf8'),{freshnessAt:value=>{payload=value;}});
  assert.deepEqual(JSON.parse(JSON.stringify(payload)),deleted);
});

test('same-date regeneration changes snapshot identity and concurrent generation is never current',async t=>{
  const f=await fixture(t);await f.generate();
  const first=await f.index(),before=await readFreshness({repo:f.repo});
  await f.put('core/a.mjs','export const a=x=>x+3;');await f.generate();
  const second=await f.index(),after=await readFreshness({repo:f.repo});
  assert.equal(after.state,'current');assert.equal(after.generated,before.generated);
  assert.notEqual(after.snapshotId,before.snapshotId);
  let reads=0;
  const switching=await readFreshness({repo:f.repo,readSnapshot:async()=>++reads===1?first:second});
  assert.equal(switching.state,'changing');assert.equal(switching.snapshotId,null);
});

test('missing or unreadable generation state reports explicit failure instead of current',async t=>{
  const f=await fixture(t);
  const missing=await writeFreshness({repo:f.repo});
  assert.equal(missing.state,'missing');assert.equal(missing.snapshotId,null);
  await f.generate();
  await f.put('dev-map/store/index.json','{broken');
  const broken=await writeFreshness({repo:f.repo});
  assert.equal(broken.state,'error');assert.ok(broken.error.message);assert.equal(broken.snapshotId,null);
  const denied=await readFreshness({repo:f.repo,readSnapshot:async()=>{throw Object.assign(Error('read denied'),{code:'EACCES'});}});
  assert.equal(denied.state,'error');assert.equal(denied.error.code,'EACCES');
});

test('watcher checks sequentially, supports shutdown and bounds the requested interval',async t=>{
  const f=await fixture(t);await f.generate();
  const controller=new AbortController();let completed=0;
  await watchFreshness({repo:f.repo,intervalMs:250,signal:controller.signal,onStatus:status=>{
    completed++;assert.equal(status.state,'current');controller.abort();
  }});
  assert.equal(completed,1);
  await assert.rejects(()=>watchFreshness({repo:f.repo,intervalMs:0}),/interval/);
});
