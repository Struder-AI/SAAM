import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadFlow,flowPacket} from '../lib/flow.mjs';
import {composePages,readCompositions} from '../lib/composition.mjs';
import {compactPage} from '../lib/agent-view.mjs';

const file='core/runtime.mjs',path=`${file}::Runtime`;
const packet=async source=>flowPacket(await loadFlow({repo:'',files:[file],readSource:()=>source}),path);

test('shared fields have exact generated source spans with declaration and constructor precedence',async()=>{
  const source=`export class Runtime {
  #count=0;
  static value=7;
  constructor(){this.value=1;this.#count=2;}
  read(){function foreign(){this.fake=8;}return [this.value,this.#count,this.later];}
  write(){this.value++;this.#count++;this.later=9;}
  static change(){this.value++;}
  static readStatic(){return this.value;}
}`;
  const p=await packet(source),fields=new Map(p.stateFields.map(f=>[f.id,f]));
  const expected=new Map([
    ['field:instance:#count','#count=0;'],['field:static:value','static value=7;'],
    ['field:instance:value','this.value=1'],['field:instance:later','this.later=9']]);
  assert.deepEqual([...fields.keys()].sort(),[...expected.keys()].sort());
  for(const [id,text] of expected){
    const at=fields.get(id).source;
    assert.equal(at.file,file);assert.equal(source.slice(at.start,at.end),text);
    assert.equal(source.split('\n')[at.line-1].slice(at.column-1,at.endColumn-1),text);
  }
  for(const w of p.wires.filter(w=>w.kind==='state'))assert.ok(fields.has(w.stateField));
  assert.equal(new Set(p.stateFields.filter(f=>f.name==='value').map(f=>f.id)).size,2);
  assert.ok(compactPage(p).stateFields.every(f=>f.source),'default CLI retains source access');
});

test('class callers connect only to proved members and keep distinct call sites through grouping',async()=>{
  const source=`export class Runtime {
  constructor(){this.value=1;}
  read(){return this.value;}
}
export function run(){const a=new Runtime();const b=new Runtime();return [a.read(),b];}`;
  const p=await packet(source),caller=p.ports.find(p=>p.label==='run');
  const calls=p.wires.filter(w=>w.from===caller.index);
  assert.equal(calls.filter(w=>w.callKind==='construct').length,2);
  assert.equal(new Set(calls.map(w=>w.source.start)).size,calls.length);
  assert.ok(calls.every(w=>p.components.some(c=>c.index===w.to)));
  assert.ok(calls.every(w=>['new Runtime()','a.read()'].includes(source.slice(w.source.start,w.source.end))));
  const config={schema:1,flows:[{path,groups:[{id:'initialization',members:[`${path}::constructor`]}]}]};
  const grouped=composePages(new Map([[path,p]]),config,{}),parent=grouped.pages.get(path),child=[...grouped.groupPages.values()][0];
  assert.deepEqual(parent.stateFields,p.stateFields);assert.deepEqual(child.stateFields,p.stateFields);
  const callerInputs=child.inputs.filter(input=>input.outside===caller.index);
  assert.equal(callerInputs.length,2);
  assert.ok(callerInputs.every(input=>input.index===caller.index&&input.path===`${file}::run`));
  assert.equal(child.wires.filter(w=>w.callKind==='construct').length,2);
  const implicit=await packet('export class Runtime{read(){return 1;}} export function run(){return new Runtime();}');
  assert.deepEqual(implicit.ports,[],'no invented constructor member for an implicit constructor');
  assert.ok(!implicit.wires.some(w=>w.callKind==='construct'));
});

test('actual Lua runtime fields and interpretDobotFiles caller remain source-addressable after composition',async()=>{
  const repo=fileURLToPath(new URL('../../',import.meta.url)),file='core/export/dobot-lua-subset.mjs',callerFile='core/export/dobot-player.mjs',path=`${file}::LuaRuntime`;
  const context=await loadFlow({repo,files:[file,callerFile]}),p=flowPacket(context,path),source=await readFile(new URL(`../../${file}`,import.meta.url),'utf8');
  const fields=new Map(p.stateFields.map(f=>[f.id,f]));
  assert.ok(fields.size>0);
  for(const w of p.wires.filter(w=>w.kind==='state')){
    const field=fields.get(w.stateField);assert.ok(field);
    assert.ok(source.slice(field.source.start,field.source.end).includes(field.name));
  }
  const caller=p.ports.find(p=>p.label==='interpretDobotFiles');assert.ok(caller);
  const call=p.wires.find(w=>w.from===caller.index&&w.callKind==='construct');assert.ok(call);
  assert.ok(p.components.find(c=>c.index===call.to).label.endsWith('::constructor'));
  const callerSource=await readFile(new URL(`../../${callerFile}`,import.meta.url),'utf8');
  assert.equal(call.source.file,callerFile);assert.match(callerSource.slice(call.source.start,call.source.end),/^new LuaRuntime\(/);
  const config=await readCompositions({repo}),spec=config.flows.find(s=>s.path===path);assert.ok(spec);
  const grouped=composePages(new Map([[path,p]]),{schema:1,flows:[spec]},{});
  for(const page of [grouped.pages.get(path),...grouped.groupPages.values()])
    for(const w of page.wires.filter(w=>w.kind==='state'))assert.deepEqual(page.stateFields.find(f=>f.id===w.stateField),fields.get(w.stateField));
});
