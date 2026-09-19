import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadFlow,flowPacket} from '../../scripts/dev-map/flow.mjs';
import {model,numberRegion} from '../../scripts/dev-map/regions.mjs';
import {composePages} from '../../scripts/dev-map/composition.mjs';
import {presentationPage} from '../../scripts/dev-map/presentation.mjs';

export async function studioComposition() {
  const context=await loadFlow(),m=model(context.graph,context.projection),index=new Map(),pages=new Map();
  for(const region of m.regions){
    const numbered=numberRegion(m,region);
    for(const [path,at] of numbered.index)index.set(path,at);
    for(const file of numbered.files){index.set(file.file,file.index);if(region.path==='studio')pages.set(file.file,{kind:'file',path:file.file,file:file.file,index:file.index,line:1,endLine:context.graph.files.find(f=>f.file===file.file).lines});}
    if(region.path==='studio')pages.set('studio',{kind:'region',path:'studio',index:region.index,files:region.files});
  }
  for(const n of context.projection.nodes.values())if(index.has(n.path))n.handle=index.get(n.path);
  const packets=new Map(m.nodes.filter(n=>n.file.startsWith('studio/')).map(n=>[n.path,flowPacket(context,n.path)]));
  for(const [path,packet] of packets)pages.set(path,packet);
  const config=JSON.parse(await readFile(new URL('../../maps/flows/studio.json',import.meta.url),'utf8'));
  return {context,m,index,packets,config,...composePages(pages,config,{model:m,index,packets})};
}
export const loaded=studioComposition();
test('Studio compositions cover every source file and retain canonical identities',async()=>{
  const {m,config,pages,groupPages,index}=await loaded;
  const studio=m.regions.find(r=>r.path==='studio'),region=config.flows.find(f=>f.path==='studio');
  assert.deepEqual(region.groups.flatMap(g=>g.members).sort(),[...studio.files].sort());
  assert.equal(region.groups.length,6);
  const endpoints=new Set([...groupPages.keys(),...index.values()]);
  for(const page of [...pages.values(),...groupPages.values()]){
    const local=new Set([...(page.components??[]).map(c=>c.index),...(page.inputs??[]).map(p=>p.port),...(page.outputs??[]).map(p=>p.port)]);
    for(const c of page.components??[])assert.ok(endpoints.has(c.index),`canonical/group endpoint ${c.path}`);
    for(const op of page.operators??[])local.add(op.id);
    for(const w of page.wires??[]){assert.ok(local.has(w.from),`from ${page.path}: ${w.from}`);assert.ok(local.has(w.to),`to ${page.path}: ${w.to}`);if(page.structural)assert.ok(w.evidence,`generated evidence ${page.path}`);}
  }
  const all=new Set([...groupPages.values()].flatMap(p=>p.components.map(c=>c.path)));
  for(const n of m.nodes.filter(n=>n.file.startsWith('studio/')))assert.ok(all.has(n.path),`declaration retained ${n.path}`);
  for(const file of studio.files)if(!m.nodes.some(n=>n.file===file))assert.ok(all.has(file),`module-only source remains available: ${file}`);
  assert.ok(all.has('studio/toolpath-view.mjs::toolpathPresentation'));
  assert.ok(all.has('studio/request-index.mjs::createRequestIndex::reconcileRecords'));
  assert.ok(all.has('studio/request-index.mjs::createRequestIndex::refresh'));
});
test('Studio authored groups contain no semantic edges or prose and nested scopes stay contained',async()=>{
  const {config}=await loaded;
  const check=(groups,parent)=>{const seen=new Set();for(const g of groups){
    assert.deepEqual(Object.keys(g).filter(k=>!['id','label','members','groups'].includes(k)),[]);
    assert.ok(g.members.length);for(const member of g.members){assert.ok(!seen.has(member),member);seen.add(member);if(parent)assert.ok(parent.some(p=>member===p||member.startsWith(p+'::')),member);}
    if(g.groups)check(g.groups,g.members);
  }};
  for(const spec of config.flows)check(spec.groups);
});

test('Studio drawing retains separate projection invocations and valid endpoints through composition',async()=>{
  const {packets,pages,groupPages}=await loaded,path='studio/app.mjs::draw';
  const raw=packets.get(path),shown=presentationPage(raw),project=raw.components.find(c=>c.label==='createProjection::project');
  const calls=raw.callBindings.filter(c=>c.callee==='studio/camera.mjs::createProjection::project');
  const instances=shown.components.filter(c=>c.index===project.index);
  assert.ok(calls.length>2);assert.equal(instances.length,calls.length);
  assert.equal(new Set(instances.map(c=>c.id)).size,calls.length);
  assert.equal(new Set(instances.map(c=>`${c.invocation.file}:${c.invocation.line}:${c.invocation.column}`)).size,calls.length);
  const variants=[pages.get(path),...groupPages.values()].filter(p=>p.path===path||p.owner===path);
  for(const page of variants){
    const view=presentationPage(page),ends=new Set([...view.components.map(c=>c.id??c.index),...(view.operators??[]).map(o=>o.id),...view.inputs.map(p=>p.port),...view.outputs.map(p=>p.port)]);
    for(const wire of view.wires){assert.ok(ends.has(wire.from),`${page.path}: ${wire.from}`);assert.ok(ends.has(wire.to),`${page.path}: ${wire.to}`);}
    assert.ok(![...view.inputs,...view.outputs].some(p=>p.port.startsWith('untraced:')),`${page.path}: known site evidence retained`);
  }
  assert.ok(![...groupPages.values()].some(p=>p.owner===path&&['geometry','material'].includes(p.path.split('/').at(-1))),'single source boxes have no redundant composition page');
});

test('refresh decision results connect to explicit host application stages',async()=>{
  const {packets,index,m}=await loaded,refresh=packets.get('studio/app.mjs::refresh');
  const stages=['studio/refresh-plan.mjs::planProgramPresentation','studio/app.mjs::applyProgramPresentation',
    'studio/refresh-plan.mjs::planRefreshNavigation','studio/app.mjs::applyRefreshNavigation'];
  for(let i=0;i<stages.length-1;i++)assert.ok(refresh.wires.some(w=>w.from===index.get(stages[i])&&w.to===index.get(stages[i+1])),`${stages[i]} → ${stages[i+1]}`);
  assert.ok(!m.nodes.some(n=>n.path==='studio/app.mjs::refresh::staleForMoves'),'old captured-state decision helper removed');
});

test('state response assembly receives loaded state and drives the current preparation consumer',async()=>{
  const {packets,index}=await loaded,server=packets.get('studio/server.mjs::createStudio');
  const loadedState=index.get('studio/server.mjs::readStableBundle'),assembly=index.get('studio/state-response.mjs::composeStudioState'),prepare=index.get('studio/server.mjs::createStudio::prepare');
  assert.ok(server.wires.some(w=>w.from===loadedState&&w.to===assembly),'loaded state enters assembly');
  assert.ok(server.wires.some(w=>w.from===assembly&&w.to===prepare),'returned preparation values enter the existing effect');
});
