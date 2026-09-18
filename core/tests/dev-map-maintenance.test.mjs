import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadModel,regionContext} from '../../scripts/dev-map/model.mjs';
import {inputSnapshot,buildFreshness,recordBuild,compareChanges} from '../../scripts/dev-map/maintenance.mjs';

const oldSource=`export function start(){first();}
export function first(){return 1;}
export function second(){}
export function obsolete(){}`;
const map=`# Fixture
\`\`\`saam-page 0_system
box start | 1 | start | @core/main.mjs::start
box first | 2 | first | @core/main.mjs::first
box second | 3 | second | @core/main.mjs::second
start > first | value
first > second | old claim
\`\`\`
`;
async function fixture(t) {
  const repo=await mkdtemp(join(tmpdir(),'saam-map-maintenance-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  for(const dir of ['core','maps','dev-map','scripts/dev-map'])await mkdir(join(repo,dir),{recursive:true});
  await writeFile(join(repo,'core/main.mjs'),oldSource);
  await writeFile(join(repo,'maps/0_system.md'),map);
  await writeFile(join(repo,'scripts/dev-map/render.py'),'# renderer');
  return repo;
}
const readModel=async repo=>({...await loadModel({repo}),readSource:file=>readFile(join(repo,file),'utf8')});

test('change review distinguishes mapped changes, enclosed helpers, new omissions and removed declarations',async t=>{
  const repo=await fixture(t);
  await writeFile(join(repo,'core/main.mjs'),`export function start(){first();function helper(){second();}helper();}
export function first(){return 2;} export function second(){} export function overlooked(){}`);
  await writeFile(join(repo,'core/new.mjs'),'export function newBoundary(){}');
  const model=await readModel(repo);
  const report=await compareChanges(model,new Map([['core/main.mjs',oldSource],['core/new.mjs',null],['core/deleted.mjs','export function gone(){}']]));
  const declarations=report.changes.flatMap(f=>f.declarations);
  assert.ok(declarations.some(d=>d.anchor==='core/main.mjs::first'&&d.change==='modified'&&d.representation==='direct'&&d.uses[0].address==='2'));
  assert.ok(declarations.some(d=>d.anchor.endsWith('::helper')&&d.change==='added'&&d.representation==='enclosed'&&d.enclosing[0].address==='1'));
  assert.ok(declarations.some(d=>d.anchor.endsWith('::overlooked')&&d.representation==='unrepresented'));
  assert.ok(declarations.some(d=>d.anchor.endsWith('::obsolete')&&d.change==='removed'));
  assert.ok(declarations.some(d=>d.anchor==='core/deleted.mjs::gone'&&d.change==='removed'));
  assert.ok(declarations.some(d=>d.anchor==='core/new.mjs::newBoundary'&&d.representation==='unrepresented'));
  const inventory=model.containment.find(f=>f.file==='core/new.mjs');
  assert.equal(inventory.counts.unrepresented,1);
  assert.equal(inventory.counts.direct,0);
  assert.ok(regionContext(model,'0_system',{inventory:true}).containment.some(f=>f.file==='core/new.mjs'));
});

test('review ignores formatting but retains ASI and changes outside named map entities',async t=>{
  const repo=await fixture(t);
  await writeFile(join(repo,'core/main.mjs'),'// comment\n'+oldSource.replaceAll('{}','{ }'));
  assert.deepEqual((await compareChanges(await readModel(repo),new Map([['core/main.mjs',oldSource]]))).changes,[]);
  await writeFile(join(repo,'core/main.mjs'),oldSource.replace('return 1','return\n1'));
  assert.ok((await compareChanges(await readModel(repo),new Map([['core/main.mjs',oldSource]]))).changes[0].declarations.some(d=>d.anchor.endsWith('::first')));
  await writeFile(join(repo,'core/main.mjs'),oldSource+'\nexternal.onChange(()=>external.refresh());');
  const changes=(await compareChanges(await readModel(repo),new Map([['core/main.mjs',oldSource]]))).changes;
  assert.equal(changes.length,1);assert.equal(changes[0].declarations.length,0);
  assert.match(changes[0].moduleReview,/callbacks/);
});

test('freshness includes new source, region and tooling edits, missing outputs and output corruption',async t=>{
  const repo=await fixture(t);
  const outputs=['index.html','context.json'];
  const build=async()=>{
    for(const file of outputs)await writeFile(join(repo,'dev-map',file),'generated');
    const snapshot=await inputSnapshot(repo);await recordBuild(repo,snapshot,outputs);return snapshot;
  };
  assert.equal((await buildFreshness(repo,await inputSnapshot(repo))).fresh,false);
  let snapshot=await build();assert.equal((await buildFreshness(repo,snapshot)).fresh,true);
  await writeFile(join(repo,'core/new.mjs'),'export function newThing(){}');
  assert.deepEqual((await buildFreshness(repo,await inputSnapshot(repo))).files,['core/new.mjs']);
  await build();await writeFile(join(repo,'maps/0_system.md'),map+'\nUpdated contract.');
  assert.ok((await buildFreshness(repo,await inputSnapshot(repo))).files.includes('maps/0_system.md'));
  await build();await writeFile(join(repo,'scripts/dev-map/render.py'),'# changed renderer');
  assert.ok((await buildFreshness(repo,await inputSnapshot(repo))).files.includes('scripts/dev-map/render.py'));
  snapshot=await build();await writeFile(join(repo,'dev-map/index.html'),'damaged');
  assert.deepEqual((await buildFreshness(repo,snapshot)).files,['index.html']);
  snapshot=await build();await rm(join(repo,'dev-map/context.json'));
  assert.deepEqual((await buildFreshness(repo,snapshot)).files,['context.json']);
});

test('a build cannot record freshness if its inputs changed during rendering',async t=>{
  const repo=await fixture(t),snapshot=await inputSnapshot(repo);
  await writeFile(join(repo,'core/main.mjs'),oldSource+'\nexport function another(){}');
  await assert.rejects(recordBuild(repo,snapshot,[]),/inputs changed during/);
});
