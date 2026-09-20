import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
const file='core/nested-loop-probe.mjs';
const helpers='export const read=(item,line,source)=>({source,command:item});export const step=(state,item)=>({state,moves:[item],events:[item]});';
async function packet(body,params='initial,items,writer') {
  return flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>helpers+`export function main(${params}){${body}}`}),`${file}::main`,{evidence:true});
}
const iteration=(p,name)=>(p.operators??[]).find(o=>o.kind==='iteration'&&o.binding===name);
const at=(p,name)=>p.components.find(c=>c.label===name)?.index;

test('unaffected outer bindings retain zero-path, transition and final connections beside nested emissions',async()=>{
  const p=await packet('const events=[];let state=initial,source=initial,line=0;for(const item of items){const parsed=read(item,++line,source);source=parsed.source;if(parsed.command){const next=step(state,parsed.command);state=next.state;for(const move of next.moves)writer.push(move);for(const event of next.events)events.push(event);}}return {state,source,line,writer,events};');
  const state=iteration(p,'state'),source=iteration(p,'source'),line=iteration(p,'line');
  for(const op of [state,source,line]) {
    assert.ok(op);assert.equal(op.minIterations,0);assert.equal(op.exceptionalControlUnknown,true);assert.equal(op.backedge,'normal-completion');
    assert.ok(p.wires.some(w=>w.to===op.id&&w.toPort==='next'&&w.provenance==='ast-normal-backedge'));
    assert.ok(p.wires.some(w=>w.from===op.id&&w.fromPort==='final'&&w.to==='out1'));
  }
  assert.ok(p.wires.some(w=>w.from==='in1'&&w.to===state.id&&w.toPort==='initial'));
  assert.ok(p.wires.some(w=>w.from===source.id&&w.fromPort==='current'&&w.to===at(p,'read')));
  assert.ok(p.wires.some(w=>w.from===state.id&&w.fromPort==='current'&&w.to===at(p,'step')));
  const choice=p.operators.find(o=>o.kind==='choice'&&o.binding==='state');assert.ok(choice);
  assert.ok(p.wires.some(w=>w.from===state.id&&w.to===choice.id&&w.toPort==='false'));
  assert.ok(p.wires.some(w=>w.from===at(p,'step')&&w.to===choice.id&&w.toPort==='true'));
  assert.ok(p.wires.some(w=>w.from===choice.id&&w.to===state.id&&w.toPort==='next'));
  assert.equal(iteration(p,'events'),undefined);
  assert.ok(p.uncertainty.some(u=>u.kind==='nested-collection-effect'&&u.receiver==='events'&&u.ownership==='local'&&u.collection==='array'));
  assert.ok(p.uncertainty.some(u=>u.kind==='nested-receiver-effect'&&u.receiver==='writer'&&u.ownership==='parameter'&&u.effectUnknown));
  assert.ok(!p.operators.some(o=>o.kind==='collection'&&o.binding==='writer'));
});

test('nested writes, receiver effects and alias escapes exclude the affected carried binding',async()=>{
  for(const nested of [
    'for(const child of item.children)state=step(state,child).state;',
    'for(const child of item.children)state.consume(child);',
    'for(const child of item.children)unknown(initial,child);',
    'const alias=state;for(const child of item.children)unknown(alias,child);',
    'const alias={state};for(const child of item.children)unknown(alias);',
    'for(const child of item.children){const alias=state;unknown(alias);}',
  ]) {
    const p=await packet(`let state=initial;for(const item of items){state=step(state,item).state;${nested}}return state;`);
    assert.ok(!p.operators?.some(o=>o.kind==='iteration'&&o.binding==='state'&&o.test==='of items'),nested);
    assert.ok(p.uncertainty.some(u=>u.kind==='loop-data-flow'&&u.binding==='state'),nested);
    assert.ok(!p.wires.some(w=>w.fromPort==='final'&&w.to==='out1'),nested);
  }
});

test('nested calls to captured writers cannot hide their effects behind a named closure',async()=>{
  for(const declare of ['function change(){state=unknown();}','const change=()=>{state=unknown();};']) {
    const p=await packet(`let state=initial;${declare}for(const item of items){state=step(state,item).state;for(const child of item.children)change();}return state;`);
    assert.equal(iteration(p,'state'),undefined,declare);
    assert.ok(p.uncertainty.some(u=>u.kind==='loop-data-flow'&&u.binding==='state'));
  }
  for(const declaration of ['const change=()=>{state=unknown();};','function change(){state=unknown();}']) {
    const p=await packet(`let state=initial;for(const item of items){${declaration}const alias=change;state=step(state,item).state;for(const child of item.children)alias();}return state;`);
    assert.ok(!p.operators?.some(o=>o.kind==='iteration'&&o.binding==='state'&&o.test==='of items'),declaration);
    assert.ok(!p.wires.some(w=>w.fromPort==='final'&&w.to==='out1'),declaration);
  }
});

test('unrelated outer counter survives when nested state mutation is rejected per binding',async()=>{
  const p=await packet('let state=initial,count=0;for(const item of items){count++;for(const child of item.children)state=step(state,child).state;}return {state,count};');
  assert.equal(iteration(p,'state'),undefined);assert.ok(iteration(p,'count'));
  assert.ok(p.wires.some(w=>w.from===iteration(p,'count').id&&w.fromPort==='final'&&w.to==='out1'&&w.label==='count'));
});

test('unsupported nested transfer and exception structures retain conservative loop uncertainty',async()=>{
  for(const nested of [
    'for(const child of item.children){if(child)break;writer.push(child);}',
    'for(const child of item.children){if(child)continue;writer.push(child);}',
    'for(const child of item.children){try{writer.push(child);}catch(error){}}',
    'for(const child of item.children){if(child)throw Error();}',
    'while(item.more)writer.push(item);',
    'for(let i=0;i<2;i++)writer.push(item);',
  ]) {
    const p=await packet(`let state=initial;for(const item of items){state=step(state,item).state;${nested}}return state;`);
    assert.equal(iteration(p,'state'),undefined,nested);assert.ok(p.uncertainty.some(u=>u.kind==='loop-data-flow'),nested);
  }
  const returned=await packet('for(let count=0;count<3;count++){for(const item of items){if(item.stop)return count;}}return initial;');
  assert.equal(iteration(returned,'count'),undefined,'a nested return has no certified outer continuation gate');
});

test('actual Griffin interpreter preserves state/source feedback while emission effects remain explicit',async()=>{
  const model=await loadFlow({files:['core/export/griffin.mjs','core/export/gcode-lines.mjs']}),p=flowPacket(model,'core/export/griffin.mjs::interpretGcodeLines');
  for(const [binding,callee] of [['source','readGcodeLine'],['state','applyGcodeCommand']]) {
    const op=iteration(p,binding);assert.ok(op);
    assert.ok(p.wires.some(w=>w.from===op.id&&w.fromPort==='current'&&w.to===at(p,callee)));
    assert.ok(p.wires.some(w=>w.to===op.id&&w.toPort==='next'));
    assert.ok(p.wires.some(w=>w.from===op.id&&w.fromPort==='final'&&w.label===binding&&w.to==='out1'));
  }
  assert.ok(iteration(p,'line'));assert.equal(iteration(p,'events'),undefined);
  assert.ok(p.uncertainty.some(u=>u.receiver==='moves'&&u.ownership==='parameter'&&u.effectUnknown));
  assert.ok(p.uncertainty.some(u=>u.receiver==='events'&&u.ownership==='local'));
  assert.ok(p.uncertainty.some(u=>u.kind==='return-origin'&&u.field==='events'));
});
