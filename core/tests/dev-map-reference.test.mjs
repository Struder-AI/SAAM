import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Script,runInNewContext} from 'node:vm';
import {loadModel,regionContext,root} from '../../scripts/dev-map/model.mjs';
import {loadReferences,referenceSection} from '../../scripts/dev-map/reference.mjs';
import {readGuidance} from '../agent/manuals.mjs';
import {inputSnapshot} from '../../scripts/dev-map/maintenance.mjs';

const repository=loadModel();

test('normal map reads are one page; contracts and impact evidence are independently selectable',async()=>{
  const model=await repository;
  const page=regionContext(model,'7b_source');
  assert.equal(page.pages.length,1);
  assert.equal(page.pages[0].key,'7b_source');
  assert.equal(page.analysis,undefined);
  assert.doesNotMatch(page.prose,/## Generated relationships/);
  assert.ok(page.navigation.some(p=>p.key==='7j_playback'));
  const section=regionContext(model,'7_studio',{section:'studio-protocols#source-session-and-stale-replies'});
  assert.equal(section.pages,undefined,'skill callers can read a contract without implementation maps');
  assert.match(section.section.text,/pending RPCs and a model epoch/);
  assert.doesNotMatch(section.section.text,/## Preparation/);
  assert.ok(!section.section.links.some(link=>link.guidanceId==='maps/reference/agent.md'),'section reads must not return unrelated whole-document navigation');
  const isolated=regionContext(model,'7_studio',{section:'studio#changing-studio-import-transactions'});
  assert.deepEqual(isolated.section.links,[],'source/test links stay in text; unrelated manual links are excluded');
  const impact=regionContext(model,'7_studio',{node:'7.4.1',evidence:true});
  assert.equal(impact.pages[0].nodes.length,1);
  assert.match(impact.pages[0].nodes[0].implementation.t,/createAgentRequests/);
  assert.ok(impact.analysis.sharedUses.length);
  assert.throws(()=>regionContext(model,'7_studio',{section:'invented'}),/Unknown contract/);
  assert.throws(()=>regionContext(model,'7_studio',{node:'999'}),/Unknown node/);
});

test('representative development changes resolve their complete contracts from maps',async()=>{
  const model=await repository;
  const routes=[
    ['1_lifecycle','lifecycle#validate-at-the-boundary-that-owns-the-data',/valid/],
    ['7g_generation','studio-protocols#preparation-generation-and-cancellation',/beforeCommit/],
    ['6_output','output#output-compatibility',/adapter/i],
    ['3i_numerics','geometry#precision-belongs-to-a-quantity-and-an-operation',/mm²/],
    ['5_motion','motion#skill-result-composition',/after/],
    ['8_machine','presentation#provider-interface',/interface|type /],
    ['4_regions','region-verification',/reference/i]
  ];
  for(const [page,section,expected] of routes) {
    const result=regionContext(model,page,{section});
    assert.match(result.section.text,expected);
    assert.ok(model.references.some(r=>r.owner===result.page&&r.path===result.section.path));
  }
  assert.ok(regionContext(model,'0_system').references.some(r=>r.id==='testing'));
  for(const old of ['core/geom/README.md#geometry-query-boundary','studio/KINEMATICS.md#provider-interface']) {
    const redirected=await readGuidance(root,old);
    assert.ok(redirected.path.startsWith('maps/reference/'));
    const reference=model.references.find(r=>r.path===redirected.path);
    assert.equal(referenceSection(reference,old.split('#')[1]).trim(),redirected.text.trim());
  }
});

test('ownership includes native and UI resources, while skill callers remain outside implementation scope',async()=>{
  const model=await repository,inventory=regionContext(model,'0_system',{inventory:true});
  for(const [file,owner] of [['core/geom/native/mesh-repair.cpp','3_geometry'],['studio/index.html','7_studio'],['studio/style.css','7_studio']])
    assert.equal(inventory.resources.find(r=>r.file===file)?.owner,owner);
  assert.ok(!inventory.resources.some(r=>r.file.startsWith('skills/')));
  assert.equal(inventory.resources.find(r=>r.file==='core/geom/native/mesh-repair.cpp').requirement.expectation,'required');
  assert.equal(inventory.resources.find(r=>r.file==='studio/app.mjs').requirement.expectation,'required');
  assert.equal(inventory.resources.find(r=>r.file==='studio/style.css').requirement.expectation,'reference-only');
  assert.equal(inventory.resources.find(r=>r.file==='core/tests/workflow.test.mjs').requirement.expectation,'verification-only');
  assert.equal(inventory.externalResources.find(r=>r.file==='skills/wave-overhangs/scripts/wave.mjs').requirement.expectation,'outside-scope');
  assert.ok(inventory.externalResources.some(r=>r.file.startsWith('adapters/')&&r.requirement.expectation==='outside-scope'));
  assert.ok(model.graph.files.some(f=>f.file.startsWith('skills/')),'skill calls remain part of impact evidence');
  assert.ok(model.containment.some(f=>f.counts.unrepresented>0),'ownership never relabels omissions as covered');
  for(const r of model.references)assert.ok(model.pages.some(p=>p.key===r.owner));
});

test('ownership and contract checks reject omissions and stale sections, and freshness includes non-JS resources',async t=>{
  const repo=await mkdtemp(join(tmpdir(),'saam-reference-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  for(const dir of ['maps/reference','studio'])await mkdir(join(repo,dir),{recursive:true});
  await writeFile(join(repo,'studio/style.css'),'body { color: black }');
  const region={source:'maps/0_system.md',pages:[{key:'0_system'}],references:[],scopes:[['studio/','Browser presentation']]};
  assert.equal((await loadReferences(repo,[region])).resources[0].owner,'0_system');
  const before=await inputSnapshot(repo);
  await writeFile(join(repo,'studio/style.css'),'body { color: blue }');
  assert.notEqual((await inputSnapshot(repo)).signature,before.signature);
  await writeFile(join(repo,'maps/reference/test.md'),'# Test\n## Contract\nOne.\n````md\n```\n## Hidden\n```\n````\n## Contract\nTwo.\n');
  await assert.rejects(loadReferences(repo,[region]),/no owning region/);
  region.references=[['test','maps/reference/test.md','Public contract']];
  const refs=await loadReferences(repo,[region]);
  assert.equal(referenceSection(refs.references[0],'contract-1'),'## Contract\nTwo.\n');
  await mkdir(join(repo,'core'));
  await writeFile(join(repo,'core/new.cpp'),'int main() {}');
  await assert.rejects(loadReferences(repo,[region]),/No dev-map owner/);
  region.scopes.push(['core/','Native implementation']);
  await writeFile(join(repo,'maps/reference/test.md'),'# Test\n[Missing](test.md#removed)');
  await assert.rejects(loadReferences(repo,[region]),/missing contract link/);
});

test('viewer preserves contract headings and code, and routes section links to the appropriate pane',async()=>{
  const model=await repository;
  const documents=model.references.map(r=>r.text);
  documents.push('# Example\n## Contract ###\n[Safe](https://example.com) [Unsafe](javascript:alert)\n````js\n```\n## Hidden\nconst x = a < b;\n````\n## Contract\nTwo.');
  const rendered=JSON.parse(execFileSync(process.env.PYTHON??'python',['-c',
    'import sys,json; sys.path.insert(0,"scripts/dev-map"); from viewer import md_to_html,JS; print(json.dumps({"html":[md_to_html(text) for text in json.load(sys.stdin)],"js":JS}))'],
    {cwd:root,input:JSON.stringify(documents),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}));
  for(const [i,reference] of model.references.entries()) {
    const ids=[...rendered.html[i].matchAll(/<h\d id="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(ids,reference.headings.map(h=>h.guidanceId.split('#')[1]),reference.path);
  }
  const html=rendered.html.at(-1);
  assert.match(html,/<h3 id="contract">Contract<\/h3>/);
  assert.match(html,/<h3 id="contract-1">Contract<\/h3>/);
  assert.match(html,/<pre><code>```\n## Hidden\nconst x = a &lt; b;/);
  assert.doesNotMatch(html,/href="javascript:|id="hidden"/);
  new Script(rendered.js);
  const navigation=rendered.js.slice(rendered.js.indexOf('function followMapLink('),rendered.js.indexOf("document.addEventListener('click'"));
  const actions=[];
  const pane=name=>({querySelector:selector=>({scrollIntoView:()=>actions.push([name,selector])})});
  const sandbox={PAGES:{contract:{doc:true},region:{spec:'maps/test.md'}},show:key=>actions.push(key),
    toggleDoc:()=>actions.push('open-doc'),canvas:pane('canvas'),docPane:pane('doc'),CSS:{escape:s=>s}};
  runInNewContext(navigation,sandbox);
  assert.equal(sandbox.followMapLink('#contract/contract'),true);
  assert.equal(sandbox.followMapLink('#region/contract-1'),true);
  assert.equal(sandbox.followMapLink('#missing'),false);
  assert.deepEqual(actions,['contract',['canvas','[id="contract"]'],'region','open-doc',['doc','[id="contract-1"]']]);
});

test('new implementation cannot inherit semantic coverage from a directory owner',async t=>{
  const repo=await mkdtemp(join(tmpdir(),'saam-responsibility-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  for(const dir of ['maps/reference','core/tests'])await mkdir(join(repo,dir),{recursive:true});
  await writeFile(join(repo,'core/main.mjs'),'export function run(){}');
  await writeFile(join(repo,'core/tests/run.test.mjs'),'// owning check');
  const region={source:'maps/0_test.md',pages:[{key:'0_system'}],references:[['test','maps/reference/test.md','Test contract']],scopes:[['core/','Runtime']],responsibilities:[]};
  const contract='# Test\n## Change\n[Source](../../core/main.mjs) [Check](../../core/tests/run.test.mjs)\n\n**Contract.** Run one operation.\n\n**Failures.** Reject invalid input.\n\n**Change together.** Caller and state.\n\n**Verification.** Observe output.\n';
  await writeFile(join(repo,'maps/reference/test.md'),contract);
  await assert.rejects(loadReferences(repo,[region]),/No change contract for core\/main.mjs/);
  region.responsibilities=[['runtime','core/main.mjs','test#change','core/tests/run.test.mjs']];
  const valid=await loadReferences(repo,[region]);
  assert.equal(valid.resources.find(r=>r.file==='core/main.mjs').responsibility.read,'read-map 0_system --section test#change');
  await writeFile(join(repo,'core/new.cpp'),'void another(){}');
  await assert.rejects(loadReferences(repo,[region]),/No change contract for core\/new.cpp/);
  await rm(join(repo,'core/new.cpp'));
  region.responsibilities[0][1]='core/main.mjs, core/main.mjs';
  await assert.rejects(loadReferences(repo,[region]),/duplicate implementation file/);
  region.responsibilities[0][1]='core/main.mjs';
  region.responsibilities[0][2]='test#removed';
  await assert.rejects(loadReferences(repo,[region]),/Unknown section/);
  region.responsibilities[0][2]='test#change';
  await writeFile(join(repo,'maps/reference/test.md'),contract.replace('**Failures.**','**Removed.**'));
  await assert.rejects(loadReferences(repo,[region]),/missing Failures/);
  await writeFile(join(repo,'maps/reference/test.md'),contract.replace('[Source](../../core/main.mjs)','Source omitted'));
  await assert.rejects(loadReferences(repo,[region]),/missing source link/);
  await writeFile(join(repo,'maps/reference/test.md'),contract);
  region.responsibilities.push(['another','core/main.mjs','test#change','core/tests/run.test.mjs']);
  await assert.rejects(loadReferences(repo,[region]),/duplicate responsibility/);
  region.responsibilities.pop();
  await rm(join(repo,'core/tests/run.test.mjs'));
  await assert.rejects(loadReferences(repo,[region]),/ENOENT/);
});

test('every production file has a reachable change contract independent of declaration coverage',async()=>{
  const model=await repository;
  const inventory=regionContext(model,'0_system',{inventory:true});
  for(const resource of inventory.resources.filter(r=>r.requirement.expectation==='required')) {
    assert.ok(resource.responsibility,resource.file);
    const packet=regionContext(model,resource.owner);
    const responsibility=packet.responsibilities.find(r=>r.id===resource.responsibility.id);
    assert.ok(responsibility.files.includes(resource.file),resource.file);
    const section=regionContext(model,resource.owner,{section:responsibility.contract}).section.text;
    assert.ok(section.includes(`](../../${resource.file})`),resource.file);
    assert.ok(responsibility.verification.length,resource.file);
    const contained=model.containment.find(f=>f.file===resource.file);
    if(contained)assert.deepEqual(contained.responsibility,resource.responsibility);
  }
  // Native code has a contract even though the JavaScript extractor cannot assess it.
  assert.ok(!model.containment.some(f=>f.file.endsWith('.cpp')));
  assert.match(inventory.resources.find(r=>r.file.endsWith('mesh-repair.cpp')).responsibility.contract,/mesh-repair/);
});

test('layout keeps unresolved disconnected operations visible without overlapping mapped boxes',()=>{
  const boxes=JSON.parse(execFileSync(process.env.PYTHON??'python',['-c',
    'import sys,json; sys.path.insert(0,"scripts/dev-map"); from leveled import Page; p=Page("test","Test",""); [p.n(key,key) for key in ["a","b","isolated1","isolated2"]]; p.e("a","b"); p.layout(); print(json.dumps([[n.id,n.x,n.y,n.w,n.h] for n in p.nodes]))'],{cwd:root,encoding:'utf8'}));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const [a,x,y,w,h]=boxes[i],[b,u,v,s,t]=boxes[j];
    assert.ok(x+w<=u||u+s<=x||y+h<=v||v+t<=y,`${a} overlaps ${b}`);
  }
});
