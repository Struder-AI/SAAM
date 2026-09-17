import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportProgram,interpretProgram,exportAndInterpretProgram} from '../export/registry.mjs';
import {packZip,unpackZip} from '../export/zip.mjs';
import {initBundle,generateBundle,loadBundle,approve,deliver,adjustBundle} from '../print/bundle.mjs';
import {createStudio} from '../../studio/server.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
const release={generatorVersion:'test',buildDate:'2026-09-09'},GCODE='Metadata/plate_1.gcode';
const actor='SYNTHETIC H2D TEST — not a real approval';
function fixture(tool=0,nozzleMm=0.4){
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);plan.setup.tool=tool;
  plan.setup.nozzleMm=nozzleMm;plan.setup.core=`Hardened steel ${nozzleMm}`;
  if(nozzleMm>=0.6)Object.assign(plan.process,{firstLayerMm:0.3,layerMm:0.3,lineWidthMm:nozzleMm});
  plan.geometry=boxMesh();plan.process.minimumLayerSeconds=0;
  plan.skills['full-fill'].mode='solid-surfaces';plan.skills['planar-infill'].enabled=true;
  return {machine,plan};
}
test('H2D maps logical material zero to either physical nozzle and round trips all three skills',async()=>{
  for(const tool of [0,1]){
    const {machine,plan}=fixture(tool),path=generatePath(plan,machine,await rhino());
    const bytes=exportProgram(path,plan,machine,release),entries=unpackZip(bytes),program=interpretProgram(bytes,plan,machine);
    assert.deepEqual(bytes,exportProgram(path,plan,machine,release),'archive bytes are deterministic');
    const code=entries.get(GCODE).toString();
    const body=code.split(';SAAM_BODY_BEGIN\n')[1].split(';SAAM_BODY_END\n')[0];
    assert.match(body,/^G90\nG21\nM83\nG92 E0\n/,'H2D print body uses the reference firmware relative-extrusion mode');
    assert.doesNotMatch(body,/^M82$/m,'H2D body must not switch back to cumulative extrusion');
    const layerTwo=body.split(';LAYER:1\n')[1].split(';SAAM_PHASE:')[0];
    const layerTwoE=[...layerTwo.matchAll(/^G1 .* E(-?\d+(?:\.\d+)?)/gm)].map(match=>Number(match[1]));
    assert.ok(layerTwoE.length>1&&Math.max(...layerTwoE)<10,'second-layer E words are per-move amounts, not cumulative filament totals');
    assert.match(code,new RegExp(`M104 S215 T${1-tool}\\nG151 P${1-tool} M`));
    assert.ok(code.includes('T0 H-1\n'),'logical material stays zero with remapping enabled');
    assert.match(entries.get('Metadata/model_settings.config').toString(),new RegExp(`key="filament_maps" value="${tool+1}"`));
    assert.deepEqual(JSON.parse(entries.get('Metadata/filament_sequence.json')).plate_1.nozzle_sequence,[tool]);
    assert.equal(entries.get(GCODE+'.md5').toString(),createHash('md5').update(code).digest('hex'));
    const moves=path.actions.filter(a=>a.kind==='move');assert.equal(program.moves.length,moves.length);
    moves.forEach((m,i)=>{m.to.forEach((v,k)=>assert.ok(Math.abs(v-program.moves[i].to[k])<6e-6));assert.ok(Math.abs(m.volumeMm3-program.moves[i].volumeMm3)<1e-4);});
    assert.ok(program.moves.some(m=>m.phase==='draped-skin'));
    assert.equal(program.envelope.simulation,'not simulated');
    assert.ok(program.envelope.endClearanceZ>=path.summary.boundsMm.max[2]+10);
    assert.ok(program.moves.every(m=>/^G[01] /.test(code.split('\n')[m.line-1])),'line numbers refer to actual packaged code');
    assert.ok(!code.includes('wedge.stl')&&!entries.get('Metadata/project_settings.config').toString().includes('machine_start_gcode'),'reference object/settings are not reused');
  }
});
test('H2D 0.8 mm setup uses selected nozzle metadata and round trips on either tool',async()=>{
  for(const tool of [0,1]){
    const {machine,plan}=fixture(tool,0.8);plan.setup.filamentColor='#8B5A2B';plan.setup.amsSlot=4;
    const path=generatePath(plan,machine,await rhino());
    const bytes=exportProgram(path,plan,machine,release),entries=unpackZip(bytes);
    assert.deepEqual(interpretProgram(bytes,plan,machine).moves.length,path.actions.filter(a=>a.kind==='move').length);
    const nozzles=tool===0?['0.8','0.4']:['0.4','0.8'];
    assert.equal(JSON.parse(entries.get('Metadata/plate_1.json')).nozzle_diameter,0.8);
    assert.deepEqual(JSON.parse(entries.get('Metadata/project_settings.config')).nozzle_diameter,nozzles);
    const slice=entries.get('Metadata/slice_info.config').toString();
    assert.match(slice,new RegExp(`key="nozzle_diameters" value="${nozzles.join(',')}"`));
    assert.match(slice,new RegExp(`nozzle id="${tool}" extruder_id="${tool+1}" nozzle_diameter="0.8"`));
    assert.match(slice,/color="#8B5A2B"/);
    const project=JSON.parse(entries.get('Metadata/project_settings.config'));
    assert.deepEqual(project.filament_colour,['#8B5A2B']);
    assert.equal(project.printer_settings_id,tool===0?'Bambu Lab H2D 0.8 nozzle':'Bambu Lab H2D 0.4 nozzle');
    assert.ok(project.nozzle_type.every(type=>type==='hardened_steel'));
    assert.equal(JSON.parse(entries.get('Metadata/saam.json')).requestedAmsSlot,4);
    const code=entries.get(GCODE).toString();
    assert.equal((code.match(/^M620 S3A H-1$/gm)??[]).length,2);
    assert.equal((code.match(/^T3 H-1$/gm)??[]).length,2);
    assert.equal((code.match(/^M621 S3A$/gm)??[]).length,2);
  }
});
test('H2D 0.6 mm setup uses selected right-nozzle metadata and round trips',async()=>{
  const {machine,plan}=fixture(1,0.6),path=generatePath(plan,machine,await rhino());
  const bytes=exportProgram(path,plan,machine,release),entries=unpackZip(bytes);
  assert.deepEqual(interpretProgram(bytes,plan,machine).moves.length,path.actions.filter(a=>a.kind==='move').length);
  assert.equal(JSON.parse(entries.get('Metadata/plate_1.json')).nozzle_diameter,0.6);
  assert.deepEqual(JSON.parse(entries.get('Metadata/project_settings.config')).nozzle_diameter,['0.4','0.6']);
  assert.match(entries.get('Metadata/slice_info.config').toString(),/nozzle id="1" extruder_id="2" nozzle_diameter="0.6"/);
});
test('H2D rejects altered firmware, metadata, print commands, cold state, tool excursions and archive corruption',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino()),bytes=exportProgram(path,plan,machine,release);
  const changeCode=(before,after)=>{const entries=unpackZip(bytes);entries.set(GCODE,Buffer.from(entries.get(GCODE).toString().replace(before,after)));return packZip(entries);};
  assert.throws(()=>interpretProgram(changeCode('M104 S215 T1','M104 S215 T0'),plan,machine),/firmware envelope/);
  assert.throws(()=>interpretProgram(changeCode(';SAAM_BODY_BEGIN\n',';SAAM_BODY_BEGIN\nM999\n'),plan,machine),/modal\/temperature/);
  assert.throws(()=>interpretProgram(changeCode(';SAAM_BODY_END\n','M999\n;SAAM_BODY_END\n'),plan,machine),/Unsupported command/);
  assert.throws(()=>interpretProgram(changeCode(';SAAM_BODY_END\n','G0 X340 Y100 Z20 F600\n;SAAM_BODY_END\n'),plan,machine),/selected tool bounds/);
  assert.throws(()=>interpretProgram(changeCode('M190 S60\nM109 S215\n','M140 S60\nM104 S215\n'),plan,machine),/modal\/temperature/);
  for(const name of ['Metadata/slice_info.config','Metadata/plate_1.gcode.md5','Metadata/plate_1.png']){
    const entries=unpackZip(bytes);entries.set(name,Buffer.from('wrong'));assert.throws(()=>interpretProgram(packZip(entries),plan,machine),/metadata, checksum or thumbnail/);
  }
  const corrupted=Buffer.from(bytes);corrupted[80]^=1;assert.throws(()=>interpretProgram(corrupted,plan,machine));
  const changed=structuredClone(machine);changed.outputs[0].program.start.push('M999');assert.throws(()=>exportProgram(path,plan,changed,release),/Unknown H2D firmware envelope/);
  const unavailable=structuredClone(machine);unavailable.outputs[0].implemented=false;assert.throws(()=>exportProgram(path,plan,unavailable,release),/No exporter/);
  const chamber=structuredClone(plan);chamber.setup.buildVolumeC=40;assert.throws(()=>exportProgram(path,chamber,machine,release),/chamber heating/);
  const tall=structuredClone(path);tall.summary.boundsMm.max[2]=315;tall.actions.at(-1).to=[100,100,317];
  assert.throws(()=>exportProgram(tall,plan,machine,release),/shutdown clearance/);
});

test('H2D fresh export carries the same checked program as cold archive interpretation',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const {bytes,program}=exportAndInterpretProgram(path,plan,machine,release);
  assert.deepEqual(program,interpretProgram(bytes,plan,machine),'fresh and reopened playback use the exact same emitted commands');
  assert.deepEqual(bytes,exportProgram(path,plan,machine,release),'reusing interpretation changes no delivered bytes');
  const entries=unpackZip(bytes),thumbnail=entries.get('Metadata/plate_1.png');
  for(const name of ['plate_no_light_1','top_1','pick_1'])assert.deepEqual(entries.get(`Metadata/${name}.png`),thumbnail);
  const altered=Buffer.from(bytes);altered[80]^=1;
  assert.throws(()=>interpretProgram(altered,plan,machine),'fresh export does not whitelist subsequently changed bytes');
  const changed=structuredClone(plan);changed.setup.nozzleC++;
  assert.throws(()=>interpretProgram(bytes,changed,machine),'fresh export does not whitelist changed settings');
});

test('H2D removes only initial homing H10 and retains the historical contract for saved jobs',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const current=exportProgram(path,plan,machine,release),code=unpackZip(current).get(GCODE).toString();
  const start=code.split(';SAAM_BODY_BEGIN\n')[0];
  assert.doesNotMatch(start,/^G28 X T300$|^G28 Z P0 T250$|^M972 S24 P0 T2000$|^G380 S2 Z30 F1200$|^M1009 Q1 L[01]$/m);
  assert.match(start,/M982\.2 S1\nM1002 gcode_claim_action : 74\nM972 S26 P0 C0\nM972 S35 P0 C0\nM972 S41 P0 T5000\nM400\n/,'neighboring detection remains in order');
  assert.match(start,/G29 A1 O /,'later bed leveling remains');
  assert.match(start,/G383 O0 M2 T140/,'later Z calibration remains');
  assert.match(start,/G1 X290 E10 F623\.623/,'front priming line remains');
  assert.ok(start.endsWith('G1 Z20 F300\nG1 X100 Y100 F3600\nM400\n'));

  // Reconstruct the previous literal envelope. Its pinned digest verifies every
  // start/end command, catching unintended edits outside the two H10 segments.
  const previous=structuredClone(machine),program=previous.outputs[0].program;
  previous.revision=3;program.contract='h2d-02.08.02.61-pla-textured-v1';
  program.start=program.start.map(line=>line.replaceAll('{filamentTool}','0'));
  program.start.splice(program.start.indexOf('M1002 gcode_claim_action : 74'),0,
    'M1002 gcode_claim_action : 13','G28 X T300','G150.1 F18000','G150.3 F18000','M400 P200','M972 S24 P0 T2000');
  program.start.splice(program.start.indexOf('M972 S41 P0 T5000')+1,0,
    'M1009 Q1 L1','G91','G380 S2 Z30 F1200','G90','G1 X175 Y160 F30000','G28 Z P0 T250','M1009 Q1 L0');
  const historical=exportProgram(path,plan,previous,release);
  assert.equal(interpretProgram(historical,plan,previous).envelope.contract,program.contract);
  assert.deepEqual(historical,exportProgram(path,plan,previous,release),'historical snapshots retain deterministic bytes');
  assert.equal(interpretProgram(current,plan,machine).envelope.contract,machine.outputs[0].program.contract);
  assert.throws(()=>interpretProgram(historical,plan,machine),/artifact context/,'old export cannot masquerade as the new startup');
  assert.throws(()=>interpretProgram(current,plan,previous),/artifact context/);
  const mislabeled=structuredClone(machine);mislabeled.outputs[0].program.contract=program.contract;
  assert.throws(()=>exportProgram(path,plan,mislabeled,release),/Unknown H2D firmware envelope/);
});
test('ZIP format rejects unsafe names, damaged directories and unreferenced bytes',()=>{
  for(const name of ['../file','/file','a//b','a/./b','a\\b'])assert.throws(()=>packZip(new Map([[name,'x']])),/name/);
  const bytes=packZip(new Map([['test','content']]));assert.equal(unpackZip(bytes).get('test').toString(),'content');
  assert.throws(()=>unpackZip(Buffer.concat([bytes,Buffer.from('extra')])));
  const corrupt=Buffer.from(bytes);corrupt[14]^=1;assert.throws(()=>unpackZip(corrupt),/checksum/);
});
test('H2D Studio reviews extracted G-code and delivers the exact approved archive',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-h2d-workflow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {plan,machine}=fixture();await initBundle(dir,plan,{machineId:machine.id});
  await generateBundle(dir,{development:true});await assert.rejects(deliver(dir),/approval/);
  let state=await loadBundle(dir);for(const stage of ['geometry'])state=await approve(dir,{stage,actor,revision:state.revision});
  await generateBundle(dir);state=await loadBundle(dir);assert.equal(state.programError,undefined);
  assert.equal(state.exportName,'part.gcode.3mf');assert.equal(state.outputAvailability,null);
  state=await approve(dir,{stage:'toolpath',actor,revision:state.revision});assert.equal(state.toolpathApproved,true);
  const exportFile=join(dir,'exports/bambu-gcode/part.gcode.3mf'),bytes=await readFile(exportFile);
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const view=await(await fetch(origin+'/api/state')).json();assert.equal(view.exportName,'part.gcode.3mf');assert.equal(view.code,undefined);assert.equal(view.program.code,undefined);
  assert.equal(await(await fetch(origin+'/api/gcode')).text(),unpackZip(bytes).get(GCODE).toString());
  const response=await fetch(origin+'/api/deliver',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:'{}'});
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/part\.gcode\.3mf/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.deepEqual(await readFile(join(dir,'delivery/part.gcode.3mf')),bytes);
  const altered=Buffer.from(bytes);altered[90]^=1;await writeFile(exportFile,altered);
  assert.match((await loadBundle(dir)).programError,/changed/);await assert.rejects(deliver(dir),/approval/);
  await writeFile(exportFile,bytes);
  await adjustBundle(dir,{process:{planarSpeedMmS:18}});state=await loadBundle(dir);
  assert.equal(state.geometryApproved,true);assert.equal(state.planApproved,false);assert.equal(state.toolpathApproved,false);
});
