import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow} from '../lib/flow.mjs';

const file='core/returned-record-probe.mjs';
const scan=source=>loadFlow({repo:'',files:[file],readSource:()=>source});

test('branch-local callbacks returned in record fields remain correlated possible targets',async()=>{
  const context=await scan(`
    function unused(){return 'decoy';}
    function mechanism(kind){
      if(kind==='left'){
        const solve=()=>1,sourcePose=()=>2;
        return {solve,sourcePose};
      }
      const solve=()=>3,sourcePose=()=>4;
      return {solve,sourcePose};
    }
    function sample(record){const {solve,sourcePose}=record;return [solve(),sourcePose()];}
    export function main(kind){return sample(mechanism(kind));}`);
  const declarations=new Map(context.graph.declarations.map(d=>[d.id,d]));
  const sample=context.graph.declarations.find(d=>d.anchor===`${file}::sample`);
  const calls=context.graph.relations.filter(r=>r.kind==='call'&&r.from===sample.id);
  const targets=call=>calls.filter(r=>r.evidence[0].text===call).map(r=>({anchor:declarations.get(r.to).anchor,possible:r.possible}));
  for(const call of ['solve()','sourcePose()']){
    const found=targets(call);
    assert.equal(found.length,2);
    assert.ok(found.every(target=>target.possible));
    assert.ok(!found.some(target=>target.anchor.endsWith('::unused')));
  }
  assert.ok(!context.graph.callSites.unresolved.some(u=>u.from===sample.id));
});

test('mutable non-exhaustive callback selection remains unresolved',async()=>{
  const context=await scan(`
    function mechanism(enabled){let solve;if(enabled)solve=()=>1;return {solve};}
    function sample(record){const {solve}=record;return solve();}
    export function main(enabled){return sample(mechanism(enabled));}`);
  const sample=context.graph.declarations.find(d=>d.anchor===`${file}::sample`);
  assert.ok(!context.graph.relations.some(r=>r.kind==='call'&&r.from===sample.id));
  assert.deepEqual(context.graph.callSites.unresolved.filter(u=>u.from===sample.id).map(u=>[u.site.text,u.reason]),
    [['solve()','unresolved-local-value']]);
});
