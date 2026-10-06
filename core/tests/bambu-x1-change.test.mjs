import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {x1ColourFixture} from './fixtures/bambu-x1-colours.mjs';
import {generatePath} from '../print/generate.mjs';
import {preparePath} from '../export/registry.mjs';
import {exportProgram} from '../export/registry.mjs';
import {unpackZip,packZip} from '../export/zip.mjs';
import {pathPreview} from '../../studio/path-preview.mjs';
import {auditBambu} from '../../scripts/bambu-audit.mjs';

const release={generatorVersion:'test',buildDate:'2026-09-21'};
test('X1 white-grey-black makes exactly two same-nozzle AMS changes, with checked retraction and three colour bands',async()=>{
  const {plan,machine}=x1ColourFixture();
  plan.setup.bambu.filaments[1].process={retractMm:0.6};
  plan.setup.bambu.filaments[2].process={retractMm:1};
  const path=await generatePath(plan,machine),prepared=(await preparePath(path,plan,machine));
  assert.deepEqual(path.actions.filter(a=>a.kind==='toolChange').map(a=>a.filament),[1,2]);
  assert.deepEqual(prepared.actions.filter(a=>a.kind==='toolChange').map(a=>[a.tool,a.filament]),[[0,1],[0,2]]);
  const {bytes,report}=(await exportProgram(path,plan,machine,release)),program=pathPreview(prepared,{plan});
  assert.deepEqual(report.envelope.job.filamentSequence,[0,1,2]);
  const code=unpackZip(bytes).get('Metadata/plate_1.gcode').toString();
  for(const [id,zMin,zMax]of [[0,0.2,0.6],[1,0.8,1.2],[2,1.4,1.8]]){
    const moves=program.moves.filter(m=>m.extruding&&m.filament===id);
    assert.ok(moves.length);assert.ok(moves.every(m=>m.tool===0&&m.to[2]>=zMin-1e-5&&m.to[2]<=zMax+1e-5));
  }
  assert.deepEqual(auditBambu(bytes).plates[0].changes.issues,[]);
  assert.equal((code.match(/;SAAM_CHUTE_FLUSH_MM3:300/g)??[]).length,2);
  for(const chunk of code.split(';SAAM_CHUTE_FLUSH_MM3:300\n').slice(1)){
    const lengths=[...chunk.split('M400')[0].matchAll(/^G1 E([\d.]+)/gm)].map(m=>Number(m[1]));
    assert.ok(Math.abs(lengths.reduce((a,b)=>a+b,0)*Math.PI*(1.75/2)**2-300)<1e-3,'Actual chute extrusion agrees with the declared volume');
  }
  assert.equal(report.envelope.job.materialChanges.count,2);
  assert.doesNotMatch(code,/H-1|Prime tower/);
  assert.match(code,/M620 S1A[\s\S]*T1\n[\s\S]*M621 S1A/);
  assert.match(code,/M620 S2A[\s\S]*T2\n[\s\S]*M621 S2A/);
  assert.match(code,/G1 E-0.6 F1800/);assert.match(code,/G1 E-1 F1800/);
  const seq=JSON.parse(unpackZip(bytes).get('Metadata/filament_sequence.json')).plate_1;
  assert.deepEqual(seq.sequence,[1,2,3]);assert.deepEqual(seq.nozzle_sequence,[0,0,0]);
});

test('X1 automatic changes reject external feed and missing clearance contract',async()=>{
  const {plan,machine}=x1ColourFixture(),path=await generatePath(plan,machine);
  plan.setup.bambu.filaments[1].source={type:'external'};
  await assert.rejects(()=>exportProgram(path,plan,machine,release),/require AMS feeds/);
  plan.setup.bambu.filaments[1].source={type:'auto'};
  const unsupported=structuredClone(machine);
  unsupported.outputs.find(o=>o.id===plan.output).constraints.toolChangeLiftMm=0;
  await assert.rejects(()=>exportProgram(path,plan,unsupported,release),/clearance contract/);
});
