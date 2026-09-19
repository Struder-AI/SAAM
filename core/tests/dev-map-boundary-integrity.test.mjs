import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
import {generate,readGenerated} from '../../scripts/dev-map/store.mjs';
import {attachPortReferences} from '../../scripts/dev-map/port-references.mjs';

const sources={
  'core/alpha/target.mjs':'export function target(value,{mode="normal"}={},...rest){return value;}\n',
  'core/beta/call.mjs':"import {target} from '../alpha/target.mjs';\nexport function first(a,b){const left=target(a);const right=target(b,{mode:'fast'});return [left,right];}\nexport function second(x){return target(x);}\n",
  'core/gamma/call.mjs':"import {target} from '../alpha/target.mjs';\nexport function third(x){return target(x);}\n"
};
const context=()=>loadFlow({repo:'',files:Object.keys(sources),readSource:file=>sources[file]});

test('repeated call-boundary evidence remains local to each caller and exact source invocation',async()=>{
  const c=await context(),paths=['core/beta/call.mjs::first','core/beta/call.mjs::second','core/gamma/call.mjs::third'];
  const pages=paths.map(path=>flowPacket(c,path)),calls=pages.flatMap(p=>p.callBindings);
  assert.deepEqual(pages.map(p=>p.callBindings.length),[2,1,1]);
  assert.equal(new Set(calls.map(call=>`${call.file}:${call.start}`)).size,4);
  for(const call of calls) {
    assert.equal(call.callee,'core/alpha/target.mjs::target');
    assert.match(sources[call.file].slice(call.start,call.end),/^target\(/);
    assert.equal(call.resultUses.filter(use=>use.kind==='return').length,1);
  }
  assert.deepEqual(pages[0].callBindings.map(call=>call.arguments[0].producers[0].endpoint),['in1','in2']);
  assert.deepEqual(pages[0].callBindings.map(call=>call.result.expression),['left','right']);
  assert.equal(pages[1].callBindings[0].arguments[0].producers[0].endpoint,'in1');
});

test('destructured defaults and spread calls retain boundary uncertainty instead of fabricated argument positions',async()=>{
  const file='core/arguments.mjs',source='export function target(x,{mode="normal"}={},...rest){return x;}\nexport function main(items,value){target(value);target(value,undefined);return target(value,...items,"tail");}';
  const c=await loadFlow({repo:'',files:[file],readSource:()=>source}),p=flowPacket(c,`${file}::main`),target=flowPacket(c,`${file}::target`);
  assert.equal(target.inputs[1].position,2);assert.equal(target.inputs[1].pattern,'{mode="normal"}');
  assert.equal(target.inputs[1].default,'{}');assert.equal(target.inputs[2].rest,true);
  const [omitted,explicit,spread]=p.callBindings;
  assert.equal(omitted.arguments.length,1);
  assert.equal(explicit.arguments[1].expression,'undefined');assert.equal(explicit.arguments[1].constant,true);
  assert.ok(!spread.arguments[0].positionUnknown);
  assert.equal(spread.arguments[1].spread,true);assert.equal(spread.arguments[1].positionUnknown,true);
  assert.equal(spread.arguments[2].positionUnknown,true);assert.equal(spread.arguments[2].expression,'"tail"');
  const packets=new Map([[p.path,p],[target.path,target]]);
  attachPortReferences(packets,new Map([...packets].map(([path,page])=>[path,page.index])));
  const refs=target.inputs[1].references;
  assert.equal(refs[0].omitted,true);assert.equal(refs[0].defaulted,true);assert.equal(refs[0].expression,'{}');
  assert.equal(refs[1].expression,'undefined');assert.ok(!refs[1].omitted);
  for(const position of [1,2]) {
    const uncertain=target.inputs[position].references[2];
    assert.equal(uncertain.positionUnknown,true);assert.equal(uncertain.unknown,true);
    assert.deepEqual(uncertain.producers,[]);
  }
});

test('returned call values retain their distinct choice and callback operator consumers',async()=>{
  const file='core/consumers.mjs',source='export const make=x=>x;export function main(cb,flag,a,b){cb(make(a));return flag?make(a):make(b);}';
  const c=await loadFlow({repo:'',files:[file],readSource:()=>source}),main=flowPacket(c,`${file}::main`),make=flowPacket(c,`${file}::make`);
  const packets=new Map([[main.path,main],[make.path,make]]);
  attachPortReferences(packets,new Map([...packets].map(([path,page])=>[path,page.index])));
  const refs=make.outputs[0].references;
  assert.equal(refs.length,3);
  assert.equal(new Set(refs.map(ref=>ref.start)).size,3);
  for(const ref of refs) {
    const uses=ref.uses.filter(use=>use.kind==='operator');assert.equal(uses.length,1);
    assert.equal(uses[0].page,main.index);
    const operator=main.operators.find(op=>op.id===uses[0].operator);assert.ok(operator);
    assert.equal(uses[0].site.file,file);assert.equal(uses[0].site.start,operator.start);
    assert.ok(!ref.usesUnknown);
  }
  assert.equal(refs[0].uses[0].port,'arg1');
  assert.deepEqual(refs.slice(1).map(ref=>ref.uses[0].port),['true','false']);
});

test('selecting one object field cannot certify the other field producer as its consumer',async()=>{
  const file='core/fields.mjs';
  for(const select of ['whole.left','left']) {
    const source=`export const source=x=>x;export const use=x=>x;export function main(a,b){const whole={left:source(a),right:source(b)};${select==='left'?'const {left}=whole;':''}return use(${select});}`;
    const c=await loadFlow({repo:'',files:[file],readSource:()=>source}),p=flowPacket(c,`${file}::main`);
    const [left,right]=p.callBindings.filter(call=>call.callee===`${file}::source`);
    const use=p.callBindings.find(call=>call.callee===`${file}::use`);
    assert.ok(!use.arguments[0].producers.some(producer=>producer.site?.start===right.start),select);
    assert.ok(!right.resultUses.some(consumer=>consumer.kind==='argument'&&consumer.site.start===use.start),select);
    assert.ok(use.arguments[0].unknown||use.arguments[0].producers.some(producer=>producer.site?.start===left.start),
      'either prove the selected source or explicitly preserve the uncertainty');
  }
});

async function storedFixture(t,source) {
  const repo=await mkdtemp(resolve(tmpdir(),'saam-boundary-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  const put=async(file,text)=>{await mkdir(dirname(resolve(repo,file)),{recursive:true});await writeFile(resolve(repo,file),text);};
  for(const [file,text] of Object.entries(source))await put(file,text);
  return {repo,put,run:region=>generate({repo,region}),page:path=>readGenerated(path,{repo})};
}

test('stored port references preserve distinct callers and retained source sites through scoped renumbering',async t=>{
  const targetPath='core/alpha/target.mjs::target',callerFile='core/beta/call.mjs',consumerPath=`${callerFile}::consume`;
  const source={...sources,[callerFile]:"import {target} from '../alpha/target.mjs';\nexport const consume=x=>x;\nexport function first(a,b){const left=target(a);const right=target(b,{mode:'fast'});consume(left);return consume(right);}\nexport function second(x){return target(x);}\n"};
  const f=await storedFixture(t,source);await f.run();
  const before=await f.page(targetPath),refs=before.inputs[0].references;
  assert.equal(before.inputs[0].role,'input');assert.equal(refs.length,4);
  assert.equal(new Set(refs.map(ref=>`${ref.path}:${ref.file}:${ref.start}`)).size,4);
  assert.equal(new Set(refs.map(ref=>ref.path)).size,3);
  for(const ref of refs)assert.match(source[ref.file].slice(ref.start,ref.end),/^target\(/);
  const resultRefs=before.outputs[0].references;
  assert.equal(resultRefs.length,4);
  assert.equal(resultRefs.filter(ref=>ref.uses.some(use=>use.kind==='argument'&&use.callee===consumerPath)).length,2);
  // Regenerate only the callee. The changed, unselected caller must retain its old source sites.
  await f.put('core/alpha/target.mjs','export const prefix=x=>x;\n'+source['core/alpha/target.mjs']);
  await f.put(callerFile,'// inserted live line\n'+source[callerFile]);
  await f.run('1');
  const after=await f.page(targetPath),consumer=await f.page(consumerPath);
  assert.notEqual(after.index,before.index);
  assert.deepEqual(after.inputs[0].references,refs);
  assert.deepEqual(after.outputs[0].references,resultRefs);
  assert.deepEqual(after.stale.changed,[callerFile]);
  const produced=consumer.inputs[0].references.flatMap(ref=>ref.producers).filter(ref=>ref.path===targetPath);
  assert.equal(produced.length,2);
  assert.ok(produced.every(ref=>ref.index===after.index));
  assert.ok(produced.every(ref=>source[ref.site.file].slice(ref.site.start,ref.site.end).startsWith('target(')));
});
