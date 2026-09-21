import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFlow,flowPacket} from '../lib/flow.mjs';

const file='core/parameter-default-probe.mjs';
const scan=source=>loadFlow({repo:'',files:[file],readSource:()=>source});

test('function-valued parameter defaults use stable local binding identities',async()=>{
  const before='export const record=x=>x;export function main(value,onProgress=()=>record(value),{task:yieldTask=async()=>record(value)}={}){onProgress(value);yieldTask(value);}';
  const after='\n\n'+before;
  for(const source of [before,after]) {
    const context=await scan(source),anchors=context.graph.declarations.map(d=>d.anchor).filter(Boolean);
    assert.ok(anchors.includes(`${file}::main::@default/onProgress`));
    assert.ok(anchors.includes(`${file}::main::@default/yieldTask`));
    const progress=flowPacket(context,`${file}::main::@default/onProgress`);
    assert.equal(progress.callBindings.length,1);
    assert.equal(progress.callBindings[0].callee,`${file}::record`);
    const declaration=context.graph.declarations.find(d=>d.anchor===progress.path);
    assert.match(declaration.text,/record\(value\)/);
  }
});

test('parameter calls remain unknown because a passed callback can replace the default',async()=>{
  const source='export const record=x=>x;export function main(value,onProgress=()=>record(value)){onProgress(value);onProgress(value+1);}';
  const context=await scan(source),owner=context.graph.declarations.find(d=>d.anchor===`${file}::main`);
  const sites=context.graph.unresolved.filter(site=>site.from===owner.id&&site.reason==='parameter-target');
  assert.equal(sites.length,2);
  assert.equal(new Set(sites.map(site=>site.site.start)).size,2);
  const implementation=context.graph.declarations.find(d=>d.anchor===`${file}::main::@default/onProgress`);
  assert.ok(!context.graph.relations.some(relation=>['call','construct'].includes(relation.kind)&&relation.from===owner.id&&relation.to===implementation.id));
});

test('local defaults stay positional and nested owners keep default names distinct',async()=>{
  const source='export function first(cb=()=>1){const {local=()=>2}={};return [cb,local];}export function second(cb=()=>3){return cb;}export function pattern({other}=()=>4){return other;}';
  const context=await scan(source),declarations=context.graph.declarations;
  assert.ok(declarations.some(d=>d.anchor===`${file}::first::@default/cb`));
  assert.ok(declarations.some(d=>d.anchor===`${file}::second::@default/cb`));
  assert.ok(!declarations.some(d=>d.anchor?.includes('@default/local')));
  assert.ok(!declarations.some(d=>d.anchor?.includes('@default/other')),'a function used as the destructured container is not bound to its property');
});
