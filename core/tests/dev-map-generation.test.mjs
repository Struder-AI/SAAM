import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {loadModel,regionContext,root} from '../../scripts/dev-map/model.mjs';

const source=target=>`export function start(){${target}();external.callback();}
export function first(){} export function second(){} export function outside(){first();}`;
const map=`# Generated fixture
\`\`\`saam-components
shared | @core/test.mjs::first | none | none | No state or effects.
\`\`\`
\`\`\`saam-page 0_system
title 0 — Generation fixture
ext input | request
box start | 1 | start | @core/test.mjs::start
box first | 2 | first use | $shared
box second | 3 | second operation | @core/test.mjs::second
box again | 4 | another use | $shared
input > start | request | io
start > first | original semantic claim | data
first > second | unsupported ordering | gate
second > again | unsupported return | data
\`\`\`
\`\`\`saam-scope
core/ | Shared fixture responsibilities
\`\`\`
\`\`\`saam-references
fixture | maps/reference/fixture.md | Fixture behavior
\`\`\`
\`\`\`saam-responsibilities
fixture | core/test.mjs, core/unmapped.mjs, core/native.cpp | fixture#changing-fixture | core/tests/example.test.mjs
\`\`\`
`;
async function run(command,args,input) {
  const child=spawn(command,args,{cwd:root,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.stdin.end(input);
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(stderr||stdout)));});
  return stdout;
}

test('code-only edit changes rendered SVG and agent region from the same model; claims cannot keep old wires',async t=>{
  const repo=await mkdtemp(join(tmpdir(),'saam-generated-map-'));
  t.after(()=>rm(repo,{recursive:true,force:true}));
  for(const dir of ['core/tests','maps/reference','out','skills/example'])await mkdir(join(repo,dir),{recursive:true});
  await writeFile(join(repo,'core/native.cpp'),'void native() {}');
  await writeFile(join(repo,'core/unmapped.mjs'),'export function unmapped(){}');
  await writeFile(join(repo,'core/style.css'),'body {}');
  await writeFile(join(repo,'core/tests/example.test.mjs'),'// verification');
  await writeFile(join(repo,'skills/example/main.mjs'),'export function skill(){}');
  await writeFile(join(repo,'skills/example/BUILDER.md'),'# Skill development');
  await writeFile(join(repo,'maps/0_test.md'),map);
  await writeFile(join(repo,'maps/reference/fixture.md'),'# Fixture\n## Changing fixture\n'+
    ['core/test.mjs','core/unmapped.mjs','core/native.cpp','core/tests/example.test.mjs'].map(file=>`[${file}](../../${file})`).join('\n')+
    '\n**Contract.** Invoke the selected operation.\n\n**Failures.** Dynamic calls remain unresolved.\n\n**Change together.** Callers and operation grouping.\n\n**Verification.** Compare before/after edges and containment.\n');
  async function build(target) {
    await writeFile(join(repo,'core/test.mjs'),source(target));
    const model=await loadModel({repo}),context=regionContext(model,'0_system',{evidence:true});
    await run(process.env.PYTHON??'python',[resolve(root,'scripts/dev-map/render.py'),join(repo,'out')],JSON.stringify(model));
    return {model,context,svg:await readFile(join(repo,'out/0_system.svg'),'utf8'),html:await readFile(join(repo,'out/index.html'),'utf8')};
  }
  const before=await build('first'),after=await build('second');
  const has=(result,to)=>result.context.pages[0].edges.some(e=>e.origin==='code'&&e.src==='start'&&e.dst===to);
  assert.ok(has(before,'first'));assert.ok(!has(before,'second'));
  assert.ok(has(after,'second'));assert.ok(!has(after,'first'));
  assert.match(before.svg,/class="fm-edge" data-a="start" data-b="first"/);
  assert.doesNotMatch(after.svg,/class="fm-edge" data-a="start" data-b="first"/);
  assert.match(after.svg,/class="fm-edge" data-a="start" data-b="second"/);
  assert.ok(after.context.pages[0].claims.some(c=>c.label==='original semantic claim'));
  assert.match(after.html,/original semantic claim/);
  assert.ok(after.context.pages[0].analysis.unresolved.some(g=>g.examples.some(s=>s.text==='external.callback()')));
  assert.match(after.html,/dynamic-member/);
  assert.match(after.html,/Code containment/);
  assert.match(after.html,/href="#reference_fixture\/changing-fixture">Change contract: fixture/);
  assert.equal(after.context.responsibilities[0].contract,'fixture#changing-fixture');
  assert.match(after.html,/core\/test.mjs<\/strong> — <b>Map representation required/);
  assert.match(after.html,/core\/native.cpp<\/code> — <b>Map representation required/);
  assert.match(after.html,/core\/style.css<\/code> — <b>No implementation box required/);
  assert.match(after.html,/core\/tests\/example.test.mjs<\/code> — <b>No implementation box required/);
  assert.match(after.html,/skills\/example\/main.mjs<\/code> — <b>Map representation not required/);
  assert.match(after.html,/href="\.\.\/skills\/example\/BUILDER.md"/);
  const ordered=['core/native.cpp</code>','core/unmapped.mjs</strong>','core/test.mjs</strong>',
    'core/style.css</code>','core/tests/example.test.mjs</code>','skills/example/main.mjs</code>'];
  const positions=ordered.map(label=>after.html.indexOf(label));
  assert.ok(positions.every((position,i)=>position>=0&&(!i||position>positions[i-1])), 'required gaps precede references, verification and excluded components');
  assert.match(after.html,/"doc": true/);
  assert.ok(after.model.containment[0].declarations.some(d=>d.name==='outside'&&d.status==='unrepresented'));
  const shared=after.context.pages[0].nodes.filter(n=>n.component==='shared');
  assert.deepEqual(shared.map(n=>n.shared.map(s=>s.address)),[['4'],['2']]);
  assert.match(after.svg,/data-num="2"[^>]*data-co="4"/);
  assert.match(after.svg,/data-num="4"[^>]*data-co="2"/);
  assert.match(after.svg,/marker-end="url\(#l-co\)"/);
  assert.ok(after.context.analysis.sharedUses.find(s=>s.anchor==='core/test.mjs::first').unmappedCallers.some(c=>c.status==='unrepresented'));
  const edge=after.context.pages[0].edges.find(e=>e.origin==='code');
  assert.ok(edge.derivation.exampleSites.some(s=>s.file==='core/test.mjs'&&s.line===1));
  assert.ok(edge.derivation.relationIds.every(id=>after.model.graph.relations.some(r=>r.id===id)));
});

test('real toolkit CLI consumes generated relationships across the complete existing map scope',async()=>{
  const model=await loadModel();
  assert.ok(model.pages.length>=40);
  // Independent public operations can share a responsibility without calling
  // one another. Never invent a wire to make an inventory page look connected.
  assert.ok(model.pages.some(p=>p.edges.some(e=>e.origin==='code')));
  assert.ok(model.pages.every(p=>p.edges.every(e=>e.origin==='code'||e.origin==='authored-boundary')));
  for(const key of ['6_output','7b_source']) {
    const cli=JSON.parse(await run(process.execPath,[resolve(root,'scripts/agent-toolkit.mjs'),'read-map',key]));
    assert.equal(cli.ok,true);
    assert.deepEqual(cli.maps[0],regionContext(model,key));
  }
  const output=model.pages.find(p=>p.key==='6_output');
  assert.ok(output.edges.some(e=>e.src==='pipeline'&&e.dst==='robot'&&e.relationships.includes('call')));
  assert.ok(!output.edges.some(e=>e.src==='cartesian'&&e.dst==='robot'&&e.relationships.includes('value-flow')));
  const worker=model.pages.find(p=>p.key==='7b_source');
  for(const [src,dst,kind] of [['session','worker','worker-handoff'],['worker','session','worker-handoff'],['decode','program','state-write'],['program','bind','state-read']])assert.ok(worker.edges.some(e=>e.src===src&&e.dst===dst&&e.relationships.includes(kind)));
  assert.ok(model.coverage.inventory.some(d=>d.status==='enclosed'));
  assert.ok(model.coverage.inventory.some(d=>d.status==='unrepresented'));
});
