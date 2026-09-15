import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {defaults} from '../../../core/print/plan.mjs';
import {buildShell} from '../../../core/print/generate.mjs';
import {rhino} from '../../../core/print/geometry.mjs';
import {loadBundle,deliver,adjustBundle} from '../../../core/print/bundle.mjs';
import {readGuidance} from '../../../adapters/mcp/src/manuals.mjs';
import {recipeRows} from '../../../studio/settings.mjs';
const run=promisify(execFile);

test('public CLI creates and generates a native-patch wave bundle, MCP reads its manual, and Studio sees the settings',async t=>{
  const scratch=await mkdtemp(resolve(tmpdir(),'saam-wave-development-'));
  t.after(()=>rm(scratch,{recursive:true,force:true}));
  const plan=defaults();
  plan.geometry={shape:'box',runMm:5,widthMm:5,heightMm:1};
  plan.skills['full-fill'].enabled=false;plan.skills['draped-skin'].enabled=false;
  const patch=buildShell(await rhino(),plan.geometry).patches.find(p=>p.name==='top');
  const [u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
  const rectangle=(a,b)=>[[a,v0],[b,v0],[b,v1],[a,v1]];
  plan.skills['wave-overhangs']={...plan.skills['wave-overhangs'],enabled:true,lineSpacingMm:0.5,propagationStepMm:0.25,
    slices:[{id:'native',reason:'Synthetic pre-existing anchor; software workflow fixture.',surface:{part:null,patch:'top'},
      domainUv:[rectangle(u0,u1)],seedUv:[rectangle(u0,u0+0.4*(u1-u0))],afterParts:[],beforeParts:[]}]};
  plan.process.minimumLayerSeconds=0;
  const recipe=resolve(scratch,'recipe.json'),dir=resolve(scratch,'print');
  await writeFile(recipe,JSON.stringify(plan));
  await run(process.execPath,['core/print/cli.mjs','init',dir,recipe]);
  await run(process.execPath,['core/print/cli.mjs','demo',dir]);
  const state=await loadBundle(dir);
  assert.ok(state.skills.includes('wave-overhangs'));
  assert.ok(state.program.moves.some(m=>m.phase==='wave-overhangs'));
  assert.ok(state.pathSummary.waveOverhangs[0].waves>0);
  assert.deepEqual(state.review.approvals,{});
  assert.equal(state.review.generation.mode,'development');
  assert.ok(recipeRows(state.plan).some(([label])=>label.includes('Wave slice')));
  await assert.rejects(deliver(dir),/approval/);
  const previous=state.planHash;
  await adjustBundle(dir,{skills:{'wave-overhangs':{lineSpacingMm:0.25}}});
  assert.notEqual((await loadBundle(dir,{program:false})).planHash,previous);
  const manual=await readGuidance(resolve('.'),'skills/wave-overhangs/SKILL.md');
  assert.ok(JSON.stringify(manual).includes('lineSpacingMm'));
});
