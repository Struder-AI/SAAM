import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {combRoute,prepareCombRouteNodes,searchCombRoute,sampleCombEdge} from '../path/comb.mjs';
import {combFixtures,traceCombPolicy} from './fixtures/comb-stages.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('prepared route nodes stay reusable and frozen while search owns its ledger',()=>{
  for(const name of ['plane-40-false','surface-40-false','plane-40-true']){
    const f=combFixtures().find(f=>f.name===name),policy=freeze(traceCombPolicy(f.policy,[]));
    freeze(f.from);freeze(f.to);
    const prepared=freeze(prepareCombRouteNodes(f.from,f.to,policy)),before=structuredClone(prepared);
    const first=searchCombRoute(prepared,policy);freeze(first);
    assert.deepEqual(searchCombRoute(prepared,policy),first);
    assert.deepEqual(combRoute(f.from,f.to,policy),first);
    assert.deepEqual(prepared,before);
  }
});

test('direct routes avoid corner preparation and edge checks remain lazy',()=>{
  const f=combFixtures().find(f=>f.name==='direct'),trace=[];
  const policy={...traceCombPolicy(f.policy,trace),combCorners(){throw Error('eager corners');}};
  assert.deepEqual(combRoute(f.from,f.to,policy),[f.to]);
  const edge=sampleCombEdge(f.from,f.to,policy);assert.deepEqual(edge,{points:[f.to],length:9});
  const blocked=combFixtures().find(f=>f.name==='plane-40-false');
  const searched=[];const checked=traceCombPolicy(blocked.policy,searched);
  const prepared=freeze(prepareCombRouteNodes(blocked.from,blocked.to,checked));
  assert.equal(searched.filter(x=>x[0]==='inCorridor').length,0,'preparation samples nodes without checking all edges');
  searchCombRoute(prepared,checked);
  const checkedEdges=searched.filter(x=>x[0]==='inCorridor').length;
  assert.ok(checkedEdges>0&&checkedEdges<prepared.nodes.length**2,'search checks only explored edges');
});

test('comb entry exposes checked direct edge, candidate preparation and search',async()=>{
  const file='core/path/comb.mjs',source=await readFile(new URL('../path/comb.mjs',import.meta.url),'utf8');
  const context=await loadFlow({repo:'',files:[file],readSource:()=>source}),page=flowPacket(context,`${file}::combRoute`);
  const node=name=>page.components.find(c=>c.label===name)?.index;
  assert.ok(node('sampleCombEdge')&&node('prepareCombRouteNodes')&&node('searchCombRoute'));
  assert.ok(page.wires.some(w=>w.from===node('prepareCombRouteNodes')&&w.to===node('searchCombRoute')&&w.label==='prepared'));
});
