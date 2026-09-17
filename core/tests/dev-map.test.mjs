import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {declarations,loadModel,parseRegion,regionContext} from '../../scripts/dev-map/model.mjs';

const fixtureSource='export function shared(value) { return value; }\nexport function other() {}\n';
const fixtureMap=`# Test region
\`\`\`saam-components
shared | @core/test.mjs::shared | value | value | Pure identity.
\`\`\`
\`\`\`saam-page 0_system
title 0 - System
ext input | input
box a | 1 | first use | $shared
box b | 2 | second use | $shared
box child | 3 | subflow | >child
input > a | value
a > b | value
b > child | value
\`\`\`
\`\`\`saam-page child
title 3 - Subflow
parent 0_system child
in value
port input | value
box c | 3.1 | third use | $shared
box d | 3.2 | fourth use | $shared
box e | 3.3 | finish | @core/test.mjs::other
input > c | value
c > d | value
d > e | value
\`\`\`
`;
async function fixture(t, text=fixtureMap) {
  const repo=await mkdtemp(join(tmpdir(),'saam-map-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  await mkdir(join(repo,'maps'));await mkdir(join(repo,'core'));
  await writeFile(join(repo,'core/test.mjs'),fixtureSource);
  await writeFile(join(repo,'maps/0_test.md'),text);
  return {repo};
}

test('shared uses include every other occurrence on the same and different pages',async t=>{
  const model=await loadModel(await fixture(t));
  const uses=model.pages.flatMap(p=>p.nodes).filter(n=>n.component==='shared');
  assert.equal(uses.length,4);
  for(const node of uses) assert.deepEqual(node.shared.map(u=>u.address),uses.filter(n=>n!==node).map(n=>n.num));
  const context=regionContext(model,'child');
  assert.equal(context.components.length,1);
  assert.equal(context.pages[1].nodes[1].shared.length,3);
  assert.equal(context.pages[1].nodes[1].anchor,'core/test.mjs::shared');
});

test('map checks reject drift in anchors, reuse, hierarchy and boundaries',async t=>{
  for(const [name,source,pattern] of [
    ['missing declaration',fixtureMap.replace('::other','::removed'),/Missing or ambiguous/],
    ['raw reuse',fixtureMap.replace('first use | $shared','first use | @core/test.mjs::shared'),/Repeated anchor/],
    ['contract alias',fixtureMap.replace('```saam-components','```saam-components\notherContract | @core/test.mjs::shared | different | value | Different semantics.').replace('first use | $shared','first use | $otherContract'),/Repeated anchor/],
    ['parent boundary',fixtureMap.replace('in value','in wrong'),/boundary mismatch/],
    ['undeclared port',fixtureMap.replace('port input | value','port extra | surprise\nport input | value').replace('input > c | value','extra > c | surprise\ninput > c | value'),/undeclared input/],
    ['two-node page',fixtureMap.replace('box e | 3.3 | finish | @core/test.mjs::other\n','').replace('d > e | value\n',''),/fewer than three/],
    ['manual red links',fixtureMap.replace('in value','in value\nco c | 1'),/unknown directive/],
    ['unsafe key',fixtureMap.replace('saam-page child','saam-page ../child'),/Invalid page key/],
    ['invalid address',fixtureMap.replace('3.1 | third','wrong | third'),/invalid address/],
  ]) await t.test(name,async st=>await assert.rejects(loadModel(await fixture(st,source)),pattern));
});

test('map reads recalculate declaration locations and all-use references after source edits',async t=>{
  const options=await fixture(t);
  const before=regionContext(await loadModel(options),'child');
  await writeFile(join(options.repo,'core/test.mjs'),'\n\n'+fixtureSource);
  await writeFile(join(options.repo,'maps/0_test.md'),fixtureMap.replace('box d | 3.2 | fourth use | $shared\n','').replace('c > d | value\nd > e | value','c > e | value').replace('box e | 3.3','box extra | 3.4 | another use | $shared\nbox e | 3.3').replace('c > e | value','c > extra | value\nextra > e | value'));
  const after=regionContext(await loadModel(options),'child');
  const a=before.pages[0].nodes.find(n=>n.id==='a'),b=after.pages[0].nodes.find(n=>n.id==='a');
  assert.equal(b.line,a.line+2);
  assert.ok(b.shared.some(use=>use.address==='3.4'));
  assert.ok(!b.shared.some(use=>use.address==='3.2'));
});

test('anchors resolve declarations rather than strings, comments or guessed line numbers',()=>{
  const source=`// function fake() {}
const text = 'function pretend() {}';
export function outer() { const arrow = x => x; function inside() {} }
export class Thing { method() {} }
`;
  const index=declarations(source,'core/test.mjs');
  assert.ok(index.has('core/test.mjs::outer::inside'));
  assert.ok(index.has('core/test.mjs::outer::arrow'));
  assert.ok(index.has('core/test.mjs::Thing::method'));
  assert.ok(!index.has('core/test.mjs::fake'));
  assert.ok(!index.has('core/test.mjs::pretend'));
  assert.equal(index.get('core/test.mjs::outer').a,3);
  assert.equal(index.get('core/test.mjs::outer::inside').t,'function inside() {}');
  assert.throws(()=>parseRegion('```saam-page broken\ntitle Broken','test.md'),/unclosed/);
});

test('checked-in maps resolve and expose shared contracts to agent reads',async()=>{
  const model=await loadModel();
  assert.ok(model.pages.length>=30);
  const region=regionContext(model,'4d_perimeters');
  const walls=region.pages.find(p=>p.key==='4d_perimeters');
  for(const node of walls.nodes.filter(n=>n.component==='offset')) {
    assert.ok(node.shared.some(use=>use.page==='4a_offset'));
    assert.equal(node.shared.filter(use=>use.page==='4d_perimeters').length,2);
  }
});
