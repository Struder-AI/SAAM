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
    const {machine,plan}=fixture(tool,0.8);plan.setup.filamentColor='#8B5A2B';
    // Physical AMS intent is not a G-code selector. A one-material job always
    // addresses logical filament zero; the print-start request maps it to a tray.
    plan.setup.ams=tool===0?{unit:1,slot:4}:{unit:2,slot:3};const selector=0;
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
    assert.equal(project.printer_settings_id,'Bambu Lab H2D 0.8 nozzle');
    assert.ok(project.nozzle_type.every(type=>type==='hardened_steel'));
    const code=entries.get(GCODE).toString();
    for(const line of ['M620 S'+selector+'A H-1','T'+selector+' H-1','M621 S'+selector+'A'])assert.equal(code.split('\n').filter(l=>l===line).length,2,line);
  }
});
test('H2D needs no colour or AMS choice, and rejects only a malformed one',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  assert.equal(plan.setup.filamentColor,null);assert.equal(plan.setup.ams,null);
  const entries=unpackZip(exportProgram(path,plan,machine,release)),code=entries.get(GCODE).toString();
  assert.match(entries.get('Metadata/slice_info.config').toString(),new RegExp('color="'+machine.outputs[0].defaultFilamentColor+'"'));
  assert.equal(code.split('\n').filter(l=>l==='M620 S0A H-1').length,2,'no request keeps the first filament path');
  const asksForSlotFour=structuredClone(plan);asksForSlotFour.setup.ams={unit:1,slot:4};
  const slotFourCode=unpackZip(exportProgram(path,asksForSlotFour,machine,release)).get(GCODE).toString();
  assert.equal(slotFourCode.split('\n').filter(l=>l==='M620 S0A H-1').length,2,'physical AMS intent does not invent a fourth logical filament');
  for(const ams of [{unit:3,slot:1},{unit:1,slot:5},{unit:1,slot:0},{unit:1.5,slot:1},4]){
    const bad=structuredClone(plan);bad.setup.ams=ams;assert.throws(()=>exportProgram(path,bad,machine,release),/AMS choice/);
  }
  const miscoloured=structuredClone(plan);miscoloured.setup.filamentColor='teal';
  assert.throws(()=>exportProgram(path,miscoloured,machine,release),/hex color/);
  const noFeeder=structuredClone(machine);delete noFeeder.ams;const asks=structuredClone(plan);asks.setup.ams={unit:1,slot:1};
  assert.throws(()=>exportProgram(path,asks,noFeeder,release),/declares no AMS/);
});
test('H2D 0.6 mm setup uses selected right-nozzle metadata and round trips',async()=>{
  const {machine,plan}=fixture(1,0.6),path=generatePath(plan,machine,await rhino());
  const bytes=exportProgram(path,plan,machine,release),entries=unpackZip(bytes);
  assert.deepEqual(interpretProgram(bytes,plan,machine).moves.length,path.actions.filter(a=>a.kind==='move').length);
  assert.equal(JSON.parse(entries.get('Metadata/plate_1.json')).nozzle_diameter,0.6);
  const project=JSON.parse(entries.get('Metadata/project_settings.config'));
  assert.deepEqual(project.nozzle_diameter,['0.4','0.6']);
  assert.equal(project.printer_settings_id,'Bambu Lab H2D 0.6 nozzle');
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
  const changed=structuredClone(machine);changed.outputs[0].program.start.push('M999');assert.throws(()=>exportProgram(path,plan,changed,release),/Unknown Bambu firmware envelope/);
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

test('H2D removes only initial homing H10 and accepts only its reviewed startup',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const current=exportProgram(path,plan,machine,release),code=unpackZip(current).get(GCODE).toString();
  const start=code.split(';SAAM_BODY_BEGIN\n')[0];
  assert.doesNotMatch(start,/^G28 X T300$|^G28 Z P0 T250$|^M972 S24 P0 T2000$|^G380 S2 Z30 F1200$|^M1009 Q1 L[01]$/m);
  assert.match(start,/M982\.2 S1\nM1002 gcode_claim_action : 74\nM972 S26 P0 C0\nM972 S35 P0 C0\nM972 S41 P0 T5000\nM400\n/,'neighboring detection remains in order');
  assert.match(start,/G29 A1 O /,'later bed leveling remains');
  assert.match(start,/G383 O0 M2 T140/,'later Z calibration remains');
  assert.match(start,/G1 X290 E10 F623\.623/,'front priming line remains');
  assert.ok(start.endsWith('G1 Z20 F300\nG1 X100 Y100 F3600\nM400\n'));

  // Any edit to the pinned startup or shutdown needs a reviewed new contract.
  assert.equal(interpretProgram(current,plan,machine).envelope.contract,machine.outputs[0].program.contract);
  const edited=structuredClone(machine);edited.outputs[0].program.start.splice(edited.outputs[0].program.start.indexOf('M1002 gcode_claim_action : 74'),0,'G28 X T300');
  assert.throws(()=>exportProgram(path,plan,edited,release),/Unknown Bambu firmware envelope/);
  const retired=structuredClone(machine);retired.outputs[0].program.contract='h2d-02.08.02.61-pla-textured-v1';
  assert.throws(()=>exportProgram(path,plan,retired,release),/Unsupported Bambu output contract/);
});
test('X1 Carbon shares the Bambu exporter with its own envelope, shutdown and package facts',async()=>{
  const machine=loadMachine('bambu-x1-carbon'),plan=defaults(machine);plan.geometry=boxMesh();plan.process.minimumLayerSeconds=0;
  plan.skills['full-fill'].mode='solid-surfaces';plan.skills['planar-infill'].enabled=true;plan.setup.ams={unit:2,slot:1};
  const path=generatePath(plan,machine,await rhino()),{bytes,program}=exportAndInterpretProgram(path,plan,machine,release);
  assert.deepEqual(bytes,exportProgram(path,plan,machine,release),'archive bytes are deterministic');
  const cold=interpretProgram(bytes,plan,machine),moves=path.actions.filter(a=>a.kind==='move');
  assert.equal(cold.envelope.contract,'x1c-02.08.02.61-pla-textured-v1');assert.equal(cold.moves.length,moves.length);assert.equal(program.moves.length,moves.length);
  moves.forEach((m,i)=>m.to.forEach((v,k)=>assert.ok(Math.abs(v-cold.moves[i].to[k])<6e-6)));
  const entries=unpackZip(bytes),code=entries.get(GCODE).toString(),[start,rest]=code.split(';SAAM_BODY_BEGIN\n'),end=rest.split(';SAAM_BODY_END\n')[1];
  const bounds=path.summary.boundsMm,top=bounds.max[2];
  assert.ok(!/\{[A-Za-z]+\}/.test(start+end),'every template value is rendered');
  assert.match(start,/^M140 S60\nM190 S60$/m);assert.match(start,/^M109 S195$/m,'wipe temperature follows the nozzle temperature');
  assert.match(start,/^M620 S0A\n(?:.*\n)*?T0\n(?:.*\n)*?M621 S0A$/m,'physical AMS intent leaves the one material on logical filament zero');
  assert.ok(start.includes(`G29 A X${bounds.min[0]} Y${bounds.min[1]} I${bounds.max[0]-bounds.min[0]} J${bounds.max[1]-bounds.min[1]}\n`),'bed leveling covers the placed part');
  assert.ok(!/^M73 P/m.test(start+end),'reference progress estimates are not reused');
  assert.ok(start.endsWith('G1 Z20 F300\nG1 X100 Y100 F3600\nM400\n'));
  const pathTop=Math.max(path.initialPosition[2],...moves.map(m=>m.to[2]));
  assert.equal(cold.envelope.endClearanceZ,Math.max(pathTop,top+0.5),'X1 shutdown lifts just clear of the part and never below the completed path');
  assert.ok(end.includes(`G1 Z${cold.envelope.endClearanceZ} F900\n`)&&end.includes(`G1 Z${Math.min(250,100+top)} F600\nG1 Z${Math.min(250,100+top)-2}\n`));
  const project=JSON.parse(entries.get('Metadata/project_settings.config')),slice=entries.get('Metadata/slice_info.config').toString();
  assert.equal(project.printer_model,'Bambu Lab X1 Carbon');assert.equal(project.printer_settings_id,'Bambu Lab X1 Carbon 0.4 nozzle');
  assert.deepEqual([project.nozzle_diameter,project.physical_extruder_map,project.filament_map_mode],[['0.4'],['0'],'Auto For Flush']);
  assert.match(slice,/key="printer_model_id" value="BL-P001"/);
  // The X1 Carbon's card loader hangs on a client version it cannot read as a Bambu Studio release.
  assert.match(slice,/<header_item key="X-BBL-Client-Version" value="02\.08\.02\.61"\/>\n/);assert.match(slice,/key="extruder_type" value="0"/);assert.match(slice,/key="nozzle_diameters" value="0.4"/);

  const cool=structuredClone(plan);cool.setup.bedC=45;assert.throws(()=>exportProgram(path,cool,machine,release),/bed temperature of 46–70 C/);
  const petg=structuredClone(plan);Object.assign(petg.setup,{material:'PETG',nozzleC:250,bedC:70});assert.throws(()=>exportProgram(path,petg,machine,release),/requires a declared 0\.4 mm PLA setup/);
  const moved=structuredClone(machine);moved.tools[0].startupXY=[120,100];assert.throws(()=>exportProgram(path,plan,moved,release),/tool\/startup contract mismatch/);
  const edited=structuredClone(machine);edited.outputs[0].program.end.push('M999');assert.throws(()=>exportProgram(path,plan,edited,release),/Unknown Bambu firmware envelope/);
  assert.throws(()=>interpretProgram(bytes,plan,loadMachine('bambu-h2d')),'an X1 archive is not an H2D program');
});
test('H2D batch startup keeps priming and positioning while omitting optional per-job calibration',async()=>{
  const {machine,plan}=fixture(1,0.6),path=generatePath(plan,machine,await rhino());plan.setup.startupMode='batch';
  const bytes=exportProgram(path,plan,machine,release),code=unpackZip(bytes).get(GCODE).toString(),start=code.split(';SAAM_BODY_BEGIN\n')[0];
  assert.equal(interpretProgram(bytes,plan,machine).envelope.contract,'h2d-02.08.02.61-pla-textured-batch-v1');
  assert.doesNotMatch(start,/extrude_cali_flag|g29_before_print_flag|auto_cali_toolhead_offset_flag|^G29 A[12] |^G383(?:\.3)? |^G39\.1$|^M970|^M974/m);
  assert.match(start,/M109 S215\nM83\nG1 E45 F623\.623/,'hot purge remains');
  assert.match(start,/G1 X290 E10 F623\.623/,'front priming line remains');
  assert.match(start,/M190 S60\nM109 S140 A\nM106 S0\nG91\nG1 Z5 F1200\nG90\nG1 X175 Y160 F30000\nG28 R\nM190 S60/,'minimal positioning and bed wait remain');
  assert.match(start,/M620 S0A H-1[\s\S]*T0 H-1[\s\S]*M621 S0A/,'AMS/tool selection remains');
  const full=structuredClone(plan);full.setup.startupMode='full';
  const fullStart=unpackZip(exportProgram(path,full,machine,release)).get(GCODE).toString().split(';SAAM_BODY_BEGIN\n')[0];
  assert.match(fullStart,/extrude_cali_flag/);assert.match(fullStart,/G29 A1 O /);assert.match(fullStart,/M970\.3/);assert.match(fullStart,/auto_cali_toolhead_offset_flag/);
  assert.throws(()=>interpretProgram(bytes,full,machine),/artifact context/,'batch output cannot masquerade as full startup');
  const invalid=structuredClone(plan);invalid.setup.startupMode='fast';assert.throws(()=>exportProgram(path,invalid,machine,release),/startup mode/);
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
  let state=await loadBundle(dir);
  await generateBundle(dir);state=await loadBundle(dir);assert.equal(state.programError,undefined);
  assert.equal(state.exportName,'part.gcode.3mf');assert.equal(state.outputAvailability,null);
  state=await approve(dir,{actor,revision:state.revision});assert.equal(state.toolpathApproved,true);
  const exportFile=join(dir,'exports/bambu-gcode/part.gcode.3mf'),bytes=await readFile(exportFile);
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const view=await(await fetch(origin+'/api/state')).json();assert.equal(view.exportName,'part.gcode.3mf');assert.equal(view.code,undefined);assert.equal(view.program.code,undefined);
  assert.equal(await(await fetch(origin+'/api/gcode')).text(),unpackZip(bytes).get(GCODE).toString());
  const response=await fetch(origin+'/api/deliver',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:'{}'});
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),new RegExp(view.downloadName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.deepEqual(await readFile(join(dir,'delivery/part.gcode.3mf')),bytes);
  const altered=Buffer.from(bytes);altered[90]^=1;await writeFile(exportFile,altered);
  assert.match((await loadBundle(dir)).programError,/changed/);await assert.rejects(deliver(dir),/approval/);
  await writeFile(exportFile,bytes);
  await adjustBundle(dir,{process:{planarSpeedMmS:18}});state=await loadBundle(dir);
  assert.equal(state.toolpathApproved,false);
});
