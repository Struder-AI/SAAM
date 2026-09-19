import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
const file='core/loop-exits.mjs';
const helpers='export const sample=count=>({error:count});export const compare=(error,previous)=>error<previous;export const accept=value=>value;';
async function packet(body,params='limit') {
  return flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>helpers+`export function main(${params}){${body}}`}),`${file}::main`,{evidence:true});
}
const index=(p,label)=>p.components.find(c=>c.label===label)?.index;

test('testless retry loop connects count and previous result through only the surviving backedge',async()=>{
  const p=await packet('let previous=Infinity;for(let count=2;;count*=2){const candidate=sample(count);if(candidate.error>limit){compare(candidate.error,previous);previous=candidate.error;}else{return accept(count);}}');
  const iterations=p.operators.filter(o=>o.kind==='iteration'),count=iterations.find(o=>o.binding==='count'),previous=iterations.find(o=>o.binding==='previous');
  assert.ok(count);assert.ok(previous);assert.deepEqual(count.initialConstants,['2']);assert.deepEqual(previous.initialConstants,['Infinity']);
  for(const op of iterations) {
    assert.equal(op.minIterations,1);assert.deepEqual(op.ports.outputs,['current']);assert.equal(op.backedge,'normal-completion');assert.equal(op.exceptionalControlUnknown,true);
    const next=p.wires.find(w=>w.to===op.id&&w.toPort==='next');assert.ok(next);assert.equal(next.provenance,'ast-normal-backedge');
    assert.equal(p.gates[next.gate].text,'candidate.error>limit');
    assert.ok(p.wires.some(w=>w.from===index(p,'sample')&&w.to===op.id&&w.toPort==='control'));
  }
  assert.ok(p.wires.some(w=>w.from===count.id&&w.fromPort==='current'&&w.to===index(p,'sample')));
  assert.ok(p.wires.some(w=>w.from===previous.id&&w.fromPort==='current'&&w.to===index(p,'compare')));
  const update=p.operators.find(o=>o.kind==='update'&&o.binding==='count');assert.equal(p.gates[update.gate].text,'candidate.error>limit');
  assert.equal(p.gates[p.components.find(c=>c.label==='accept').gate].text,'!(candidate.error>limit)');
  assert.ok(!p.wires.some(w=>w.fromPort==='final'));assert.ok(p.uncertainty.some(u=>u.kind==='loop-exception-path'));
});

test('tested loop retains zero-iteration exit and conditional returned current state',async()=>{
  const p=await packet('let state=limit;for(let count=0;count<limit;count++){if(count===2)return accept(state);state=sample(count);}return state;');
  const state=p.operators.find(o=>o.kind==='iteration'&&o.binding==='state');assert.ok(state);assert.equal(state.minIterations,0);
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===state.id&&w.toPort==='initial'));
  assert.ok(p.wires.some(w=>w.from===state.id&&w.fromPort==='current'&&w.to===index(p,'accept')));
  assert.ok(p.wires.some(w=>w.from===state.id&&w.fromPort==='final'&&w.to==='out2'));
  const next=p.wires.find(w=>w.to===state.id&&w.toPort==='next');assert.equal(p.gates[next.gate].text,'!(count===2)');
});

test('abrupt and ambiguous loop paths never acquire certified recurrence',async()=>{
  for(const loop of [
    'for(let count=0;;count++){if(limit)break;state=sample(count);}',
    'for(let count=0;;count++){if(limit)continue;state=sample(count);}',
    'for(let count=0;;count++){try{state=sample(count);}catch(e){return state;}}',
    'for(let count=0;;count++){if(limit)throw state;state=sample(count);}',
    'while(limit){if(limit.stop)return state;state=sample(limit);}',
    'for(let count=0;;count++){if(limit.stop)return state;if(limit.choice)state=sample(count);}',
    'for(let count=0;;count++){if(limit)return state;state=unknown(count);}',
  ]) {
    const p=await packet(`let state=limit;${loop}return state;`);
    assert.ok(!p.wires.some(w=>w.toPort==='next'),loop);
    assert.ok(p.uncertainty.some(u=>u.kind==='loop-data-flow'),loop);
  }
});

test('unconditional loop return creates no update or backedge and Infinity parameters stay inputs',async()=>{
  const p=await packet('for(let count=2;;count*=2){return sample(count);}');
  assert.ok(!p.wires.some(w=>w.toPort==='next'));assert.ok(!p.operators?.some(o=>o.kind==='update'));
  const shadow=await packet('let previous=Infinity;for(let count=2;;count*=2){if(limit)return compare(previous,count);previous=sample(count);}','limit,Infinity');
  const previous=shadow.operators.find(o=>o.kind==='iteration'&&o.binding==='previous');
  assert.equal(previous.initialConstants,undefined);assert.ok(shadow.wires.some(w=>w.from==='in2'&&w.to===previous.id&&w.toPort==='initial'));
});

test('an unknown retry predicate remains explicitly unknown on its normal backedge',async()=>{
  const p=await packet('for(let count=2;;count*=2){if(unknown(count))return accept(count);}');
  const count=p.operators.find(o=>o.kind==='iteration'&&o.binding==='count');assert.ok(count);
  assert.equal(count.backedgeControlUnknown,true);assert.ok(p.uncertainty.some(u=>u.kind==='iteration-backedge-control'));
  assert.ok(!p.wires.some(w=>w.to===count.id&&w.toPort==='control'));
});

test('actual tessellation count feeds both samplers and returned steps through a guarded doubling backedge',async()=>{
  const model=await loadFlow({files:['core/geom/tessellate.mjs','core/geom/tolerance.mjs','core/geom/mesh.mjs']});
  const p=flowPacket(model,'core/geom/tessellate.mjs::tessellateShell'),count=p.operators.find(o=>o.kind==='iteration'&&o.binding==='count');
  assert.ok(count);assert.equal(count.minIterations,1);assert.deepEqual(count.initialConstants,['2']);
  for(const name of ['sampleSharedBoundaries','sampleTessellationCandidate'])assert.ok(p.wires.some(w=>w.from===count.id&&w.fromPort==='current'&&w.to===index(p,name)));
  assert.ok(p.wires.some(w=>w.from===count.id&&w.label==='tessellation.steps'&&w.kind==='return'));
  const next=p.wires.find(w=>w.to===count.id&&w.toPort==='next');assert.equal(p.gates[next.gate].text,'candidate.sampledErrorMm>toleranceMm');
  assert.ok(p.requires.some(r=>r.text.includes('previousError')),'detailed assertion evidence retains the previousError predicate');
  assert.ok(!p.uncertainty.some(u=>u.kind==='argument-origin'&&u.expression==='count'));
});
