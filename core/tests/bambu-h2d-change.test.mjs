import test from 'node:test';
import assert from 'node:assert/strict';
import {h2dColourFixture} from './fixtures/bambu-h2d-colours.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {checkMachinePath} from '../machine/profile.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {unpackZip,packZip} from '../export/zip.mjs';
import {decodeSource} from '../../studio/source-player.mjs';
import {auditBambu} from '../../scripts/bambu-audit.mjs';

const release={generatorVersion:'test',buildDate:'2026-09-21'};
test('H2D blue-orange-blue changes logical filament twice while retaining right 0.8 and checked layer heights',async()=>{
  const {plan,machine}=h2dColourFixture();
  plan.setup.bambu.filaments[1].process={retractMm:0.6};
  const path=generatePath(plan,machine,await rhino());checkMachinePath(path,plan,machine);
  assert.deepEqual(path.actions.filter(a=>a.kind==='toolChange').map(a=>[a.tool,a.filament]),[[1,1],[1,0]]);
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine),code=program.code;
  assert.deepEqual(program.filamentSequence,[0,1,0]);
  const source=decodeSource({program:code},plan,machine);
  assert.deepEqual(source.moves.map(m=>[m.tool,m.filament,m.to]),program.moves.map(m=>[m.tool,m.filament,m.to]));
  const deposits=program.moves.filter(m=>m.extruding);
  assert.ok(deposits.length);
  assert.ok(deposits.every(m=>m.tool===1));
  assert.ok(Math.abs(deposits[0].to[2]-0.3)<1e-5);
  for(const m of deposits)assert.equal(m.filament,m.to[2]>0.6+1e-5&&m.to[2]<=1.2+1e-5?1:0);
  const changes=[...code.matchAll(/;SAAM_TOOL_CHANGE \d+\n([\s\S]*?);SAAM_TOOL_CHANGE_END/g)].map(m=>m[1]);
  assert.equal(changes.length,2);
  for(const change of changes){
    const flushes=[...change.matchAll(/^M620\.10 A[01] .* L([\d.]+) H([\d.]+)/gm)];
    assert.equal(flushes.length,2);
    for(const f of flushes){assert.ok(Math.abs(Number(f[1])*Math.PI*(1.75/2)**2-300)<1e-3);assert.equal(Number(f[2]),0.8);}
    assert.doesNotMatch(change,/^G1 E/gm,'H2D firmware owns flushing; no second explicit flush');
    assert.match(change,/SYNC T5/);
    assert.match(change,/SYNC T5\nSYNC T7.5\nSYNC T4.16667/);
    const outgoing=[...change.matchAll(/^M620\.11 .* I\d+ B(-?\d+)/gm)];
    assert.equal(outgoing.length,3);
    assert.ok(outgoing.every(m=>m[1]==='-1'),'Every same-nozzle outgoing selector retains firmware remapping');
  }
  assert.match(changes[0],/T1 H-1/);assert.match(changes[1],/T0 H-1/);
  assert.match(changes[0],/M620\.10 R0.6/);
  assert.equal(program.envelope.job.materialChanges.count,2);
  const entries=unpackZip(bytes),project=JSON.parse(entries.get('Metadata/project_settings.config'));
  assert.deepEqual(project.nozzle_diameter,['0.4','0.8']);
  assert.deepEqual(project.filament_map,['2','2']);
  assert.deepEqual(JSON.parse(entries.get('Metadata/filament_sequence.json')).plate_1.nozzle_sequence,[1,1,1]);
  assert.deepEqual(auditBambu(bytes).plates[0].changes.issues,[]);
  const boundary=code.indexOf(';SAAM_TOOL_CHANGE ');
  for(const [before,after]of [['L124.72551','L0'],['T1 H-1','T0 H-1'],['M620.10 R0.6','M620.10 R0'],['I1 B-1','I1 B1']]){
    const altered=code.slice(0,boundary)+code.slice(boundary).replace(before,after);assert.notEqual(altered,code);
    const z=new Map(entries);z.set('Metadata/plate_1.gcode',Buffer.from(altered));
    assert.throws(()=>interpretProgram(packZip(z),plan,machine),/tool-change block/);
  }
});

test('the requested 0.8/0.8 ALT changes only installed-nozzle declarations, not right-nozzle body or service commands',async()=>{
  const {plan,machine}=h2dColourFixture(),r=await rhino();
  const path=generatePath(plan,machine,r),normal=interpretProgram(exportProgram(path,plan,machine,release),plan,machine);
  plan.setup.bambu.otherNozzleMm=0.8;
  const alt=interpretProgram(exportProgram(generatePath(plan,machine,r),plan,machine,release),plan,machine);
  const executable=code=>code.slice(code.indexOf('; EXECUTABLE_BLOCK_START'));
  assert.equal(executable(alt.code),executable(normal.code));
  assert.deepEqual(alt.envelope.job.nozzleDiametersMm,[0.8,0.8]);
  assert.deepEqual(alt.moves,normal.moves);
});

test('H2D automatic colour switching rejects external feed',async()=>{
  const {plan,machine}=h2dColourFixture(),path=generatePath(plan,machine,await rhino());
  plan.setup.bambu.filaments[1].source={type:'external'};
  assert.throws(()=>exportProgram(path,plan,machine,release),/require AMS feeds/);
});
