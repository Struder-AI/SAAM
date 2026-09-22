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
import {resolveBambuJob} from '../export/bambu-job.mjs';
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
    assert.ok(!code.includes('wedge.stl'),'reference objects are not reused');
    const project=JSON.parse(entries.get('Metadata/project_settings.config'));
    assert.equal(project.machine_start_gcode,code.split('; EXECUTABLE_BLOCK_START\n')[1].split(';SAAM_BODY_BEGIN\n')[0]);
    assert.equal(project.machine_end_gcode,code.split(';SAAM_BODY_END\n')[1].split('; EXECUTABLE_BLOCK_END\n')[0]);
    for(const [key,value]of Object.entries(project).filter(([key])=>key.endsWith('_gcode')&&!['machine_start_gcode','machine_end_gcode'].includes(key))){
      assert.ok((Array.isArray(value)?value:[value]).every(v=>v===''),`${key} must not embed a vendor template`);
    }
  }
});
test('H2D 0.8 mm setup uses selected nozzle metadata and round trips on either tool',async()=>{
  for(const tool of [0,1]){
    const {machine,plan}=fixture(tool,0.8);plan.setup.filamentColor='#8B5A2B';
    // A physical tray request does not rename the job's single logical filament.
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
    assert.deepEqual(project.filament_self_index,['1']);
    const intent=JSON.parse(entries.get('Metadata/saam-job.json'));
    assert.equal(intent.requestedTray.index,tool===0?3:6);
    assert.equal(intent.logicalFilament,0);
    // The preset names the nozzle that must be fitted, so it follows the selected
    // tool on both. Naming the first nozzle made a right-nozzle job claim 0.4 mm,
    // and an H2D refused it: "The right nozzle is not matched with slicing file".
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
  // No AMS request uses one logical filament and the declared default colour.
  assert.match(entries.get('Metadata/slice_info.config').toString(),new RegExp('color="'+machine.outputs[0].defaultFilamentColor+'"'));
  assert.equal(code.split('\n').filter(l=>l==='M620 S0A H-1').length,2,'no request keeps the first filament path');
  for(const ams of [{unit:machine.ams.units+1,slot:1},{unit:1,slot:5},{unit:1,slot:0},{unit:1.5,slot:1},4]){
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
  assert.deepEqual(JSON.parse(entries.get('Metadata/project_settings.config')).nozzle_diameter,['0.4','0.6']);
  assert.match(entries.get('Metadata/slice_info.config').toString(),/nozzle id="1" extruder_id="2" nozzle_diameter="0.6"/);
});
test('H2D rejects altered firmware, metadata, print commands, cold state, tool excursions and archive corruption',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino()),bytes=exportProgram(path,plan,machine,release);
  const changeCode=(before,after)=>{const entries=unpackZip(bytes);entries.set(GCODE,Buffer.from(entries.get(GCODE).toString().replace(before,after)));return packZip(entries);};
  assert.throws(()=>interpretProgram(changeCode('M104 S215 T1','M104 S215 T0'),plan,machine),/firmware envelope/);
  assert.throws(()=>interpretProgram(changeCode(';SAAM_BODY_BEGIN\n',';SAAM_BODY_BEGIN\nM999\n'),plan,machine),/modal\/temperature/);
  assert.throws(()=>interpretProgram(changeCode(';SAAM_BODY_END\n','M999\n;SAAM_BODY_END\n'),plan,machine),/Unsupported command/);
  assert.throws(()=>interpretProgram(changeCode(';SAAM_BODY_END\n','G1 X340 Y100 Z20 F600\n;SAAM_BODY_END\n'),plan,machine),/selected tool bounds/);
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

test('H2D restores initial XY/Z registration before loading and accepts only its reviewed startup',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const current=exportProgram(path,plan,machine,release),code=unpackZip(current).get(GCODE).toString();
  const start=code.split(';SAAM_BODY_BEGIN\n')[0];
  assert.match(start,/G28 X T300\nG150\.1 F18000\nG150\.3 F18000/);
  assert.match(start,/M1009 Q1 L1\nG91\nG380 S2 Z30 F1200\nG90\nG1 X175 Y160 F30000\nG28 Z P0 T250\nM1009 Q1 L0/);
  assert.ok(start.indexOf('G28 Z P0 T250')<start.indexOf('M620 S0A'),'register Z before the first remapped load');
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
  assert.equal(cold.envelope.contract,'x1c-saam-startup-v5');assert.equal(cold.moves.length,moves.length);assert.equal(program.moves.length,moves.length);
  moves.forEach((m,i)=>m.to.forEach((v,k)=>assert.ok(Math.abs(v-cold.moves[i].to[k])<6e-6)));
  const entries=unpackZip(bytes),code=entries.get(GCODE).toString(),[start,rest]=code.split(';SAAM_BODY_BEGIN\n'),end=rest.split(';SAAM_BODY_END\n')[1];
  const bounds=path.summary.boundsMm,top=bounds.max[2];
  assert.ok(!/\{[A-Za-z]+\}/.test(start+end),'every template value is rendered');
  assert.match(start,/^M140 S60\nM190 S60$/m);assert.match(start,/^M109 S195$/m,'wipe temperature follows the nozzle temperature');
  assert.match(start,/^M620 S0A\n(?:.*\n)*?T0\n(?:.*\n)*?M621 S0A$/m,'a profile with no declared trays keeps one entry, named as position 0');
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
test('Bambu selected nozzle, other nozzle, plate and temperature stay coherent across every artifact',async()=>{
  const r=await rhino();
  for(const tool of [0,1])for(const diameter of [0.4,0.6,0.8])for(const plate of ['textured_plate','hot_plate']){
    const {machine,plan}=fixture(tool,diameter);
    plan.setup.bambu.otherNozzleMm=0.6;plan.setup.bambu.plate=plate;
    plan.setup.nozzleC=225;plan.setup.bedC=65;
    const bytes=exportProgram(generatePath(plan,machine,r),plan,machine,release),z=unpackZip(bytes);
    const code=z.get(GCODE).toString(),p=JSON.parse(z.get('Metadata/project_settings.config'));
    assert.equal(p.machine_start_gcode,code.split('; EXECUTABLE_BLOCK_START\n')[1].split(';SAAM_BODY_BEGIN\n')[0]);
    assert.equal(p.machine_end_gcode,code.split(';SAAM_BODY_END\n')[1].split('; EXECUTABLE_BLOCK_END\n')[0]);
    const slice=z.get('Metadata/slice_info.config').toString(),plateInfo=JSON.parse(z.get('Metadata/plate_1.json'));
    assert.deepEqual(p.nozzle_diameter,tool===0?[String(diameter),'0.6']:['0.6',String(diameter)]);
    assert.ok(code.includes('; nozzle_diameter = '+p.nozzle_diameter.join(',')));
    assert.ok(slice.includes('key="nozzle_diameters" value="'+p.nozzle_diameter.join(',')+'"'));
    assert.equal(plateInfo.nozzle_diameter,diameter);
    assert.deepEqual([...code.matchAll(/^M620\.10 .* H([\d.]+) /gm)].map(m=>Number(m[1])),[diameter,diameter]);
    assert.ok(code.includes('M1015.4 S1 K1 H'+diameter+'\n'));
    assert.equal((code.match(/M983\.3 F10\.4167 A0\.4/g)??[]).length,3,'A0.4 is a calibration constant, not nozzle diameter');
    assert.ok(code.includes('M104 S225 T'+(1-tool)+'\nG151 P'+(1-tool)+' M'));
    assert.equal(plateInfo.bed_type,plate);
    assert.equal(p.curr_bed_type,plate==='textured_plate'?'Textured PEI Plate':'Smooth PEI Plate');
    const tempKey=plate==='textured_plate'?'textured_plate_temp':'hot_plate_temp';
    assert.deepEqual(p[tempKey],['65']);assert.deepEqual(p[tempKey+'_initial_layer'],['65']);
    assert.deepEqual(p.nozzle_temperature,['225']);assert.deepEqual(p.nozzle_temperature_initial_layer,['225']);
    assert.ok(code.includes(plate==='textured_plate'?'G29.1 Z-0.02':'G29.1 Z0'));
    assert.ok(code.includes(plate==='textured_plate'?'M972 S26 P0 C0':'M972 S36 P0 C0 X1'));
    assert.doesNotMatch(code,plate==='textured_plate'?/M972 S36/:/M972 S26|G29\.1 Z-0\.02/);
    assert.equal(interpretProgram(bytes,plan,machine).envelope.simulation,'not simulated');
  }
});

test('logical filament selection reaches both load blocks, detection and every package reference independently of AMS tray',async()=>{
  const {machine,plan}=fixture(1,0.8);plan.setup.ams={unit:2,slot:4};
  plan.setup.bambu.filaments=[{id:'GFA00',colour:'#111111'},{id:'GFA01',colour:'#222222'},{id:'GFA00',colour:'#AABBCC'}];
  plan.setup.bambu.filament=2;plan.setup.filamentColor='#AABBCC';
  const z=unpackZip(exportProgram(generatePath(plan,machine,await rhino()),plan,machine,release));
  const code=z.get(GCODE).toString(),slice=z.get('Metadata/slice_info.config').toString();
  for(const command of ['M620 S2A H-1','T2 H-1','M621 S2A'])assert.equal(code.split('\n').filter(l=>l===command).length,2);
  assert.match(code,/^M620\.6 I2 H-1 W1$/m);assert.doesNotMatch(code,/^M620 S7A|^T7 H/m);
  assert.match(code,/^M620\.17 T0 S215 L2$/m,'Calibration uses the first printed filament, not an unused earlier declaration on the same nozzle');
  assert.match(code,/^M620\.17 T1 S215 L0$/m,'Unused nozzle follows the explicit declared-filament-zero fallback');
  assert.match(code,/^G383 O1 T215 L2$/m);
  assert.match(code,/^G383\.3 T215 L2$/m);
  assert.match(slice,/<filament id="3" .*color="#AABBCC"/);
  assert.match(slice,/filament_list="2"/);
  const plate=JSON.parse(z.get('Metadata/plate_1.json'));assert.deepEqual(plate.filament_ids,[2]);assert.equal(plate.first_extruder,2);
  const seq=JSON.parse(z.get('Metadata/filament_sequence.json')).plate_1;assert.deepEqual(seq.sequence,[3]);assert.deepEqual(seq.nozzle_sequence,[1]);
  const p=JSON.parse(z.get('Metadata/project_settings.config'));assert.deepEqual(p.filament_map,['2','2','2']);
  assert.equal(p.filament_map_2,undefined,'map_2 is a resolved slice field');
  assert.match(code,/; filament_map_2 = 1,1,1\n/);
  assert.ok(code.includes('; filament_colour = #111111;#222222;#AABBCC'));
  assert.match(z.get('Metadata/model_settings.config').toString(),/key="filament_maps" value="2 2 2"/);
  assert.equal(JSON.parse(z.get('Metadata/saam-job.json')).requestedTray.index,7);
});

test('Bambu rejects conflicting declarations and unsupported settings before producing a program',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  for(const [patch,message] of [
    [{core:'Hardened steel 0.8'},/core and selected nozzle/],
    [{bambu:{...plan.setup.bambu,plate:'unknown'}},/build plate/],
    [{bambu:{...plan.setup.bambu,otherNozzleMm:null}},/other installed/],
    [{bambu:{...plan.setup.bambu,filament:1}},/filament index/],
    [{bambu:{...plan.setup.bambu,startup:{bedLeveling:'maybe'}}},/printer, on or off/],
    [{filamentColor:'#FFFFFF',bambu:{...plan.setup.bambu,filaments:[{id:'GFA00',colour:'#000000'}]}},/colour disagrees/],
  ]){const p=structuredClone(plan);Object.assign(p.setup,patch);assert.throws(()=>exportProgram(path,p,machine,release),message);}
  const old=structuredClone(plan);delete old.setup.bambu;assert.throws(()=>exportProgram(path,old,machine,release),/older setup/);
  for(const key of ['nozzle_diameter','filament_map','curr_bed_type','nozzle_type']){
    const m=structuredClone(machine);m.outputs[0].package.projectSettings[key]=['wrong'];
    assert.throws(()=>exportProgram(path,plan,m,release),/cannot override/);
  }
  const m=structuredClone(machine);m.outputs[0].constraints.startupPurgeFlowMm3S=100;
  assert.throws(()=>exportProgram(path,plan,m,release),/Unknown Bambu firmware envelope/);
});

test('startup choices are explicit and X1 smooth plate has no textured correction',async()=>{
  for(const id of ['bambu-h2d','bambu-x1-carbon']){
    const machine=loadMachine(id),plan=defaults(machine);plan.geometry=boxMesh();
    plan.setup.bambu.plate='hot_plate';Object.assign(plan.setup.bambu.startup,{bedLeveling:'on',flowCalibration:'off'});
    const path=generatePath(plan,machine,await rhino()),z=unpackZip(exportProgram(path,plan,machine,release)),code=z.get(GCODE).toString();
    assert.match(code,/M1002 set_flag g29_before_print_flag=1\nM1002 set_flag extrude_cali_flag=0/);
    assert.doesNotMatch(code,/G29\.1 Z-0\.0[24]/);
    assert.match(code,/M1002 judge_flag g29_before_print_flag/);
    assert.match(code,/M1002 judge_flag extrude_cali_flag/);
    if(id==='bambu-x1-carbon'){
      assert.match(code,/M620\.1 E F523\.843 T240/);assert.match(code,/M109 S250/);
      const p=JSON.parse(z.get('Metadata/project_settings.config'));assert.deepEqual(p.nozzle_type,['hardened_steel']);
      plan.setup.bambu.startup.toolOffsetCalibration='on';assert.throws(()=>exportProgram(path,plan,machine,release),/does not implement/);
    }
  }
});

test('resolved H2D job follows supplied slice mappings while preserving independently reported mixed hardware',async()=>{
  const facts=JSON.parse(await readFile(new URL('./fixtures/bambu-h2d-reference-facts.json',import.meta.url),'utf8'));
  const {plan,machine}=fixture(1,0.8),job=resolveBambuJob(plan,machine,machine.outputs[0]);
  for(const key of ['filament_map','filament_map_2','filament_map_mode','filament_nozzle_map','filament_self_index','physical_extruder_map','print_extruder_id','curr_bed_type']){
    const value=job.settings[key];assert.equal(Array.isArray(value)?value.join(','):value,facts.sliceConfig[key],key);
  }
  assert.deepEqual(job.nozzles.map(Number),facts.source.hardwareReportedByUser.nozzleDiametersMm);
  assert.notEqual(job.nozzles.join(','),facts.sliceConfig.nozzle_diameter,'the reference deliberately declares equal diameters; actual hardware differs');
  assert.notDeepEqual(job.settings.filament_map,facts.projectPreferences.filament_map,'saved project preferences do not override resolved slice intent');
  assert.notEqual(job.settings.filament_map_mode,facts.projectPreferences.filament_map_mode);
});

test('declared AMS connectivity cannot silently feed the other H2D nozzle',()=>{
  const {plan,machine}=fixture(1,0.8);
  plan.setup.bambu.amsConnections=[{unit:1,tool:1}];plan.setup.ams={unit:1,slot:4};
  const job=resolveBambuJob(plan,machine,machine.outputs[0]);
  assert.deepEqual(job.amsConnections,[{unit:1,tool:1}]);
  assert.deepEqual(job.settings.extruder_ams_count,['1#0|4#0','1#0|4#1']);
  plan.setup.tool=0;
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/not connected/);
  plan.setup.bambu.amsConnections=[{unit:1,tool:0},{unit:1,tool:1}];
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/unique/);
});

test('declared logical filaments preserve independent nozzle assignments on every output surface',async()=>{
  const facts=JSON.parse(await readFile(new URL('./fixtures/bambu-h2d-dual-reference-facts.json',import.meta.url),'utf8'));
  for(const tool of [0,1]){
    const {plan,machine}=fixture(tool,tool===0?0.4:0.8);
    plan.setup.bambu.otherNozzleMm=tool===0?0.8:0.4;
    plan.setup.bambu.filaments=[{id:'GFA00',colour:'#00AE42',tool:1},{id:'GFA00',colour:'#FFFF00',tool:0}];
    plan.setup.bambu.filament=1-tool;
    const path=generatePath(plan,machine,await rhino()),bytes=exportProgram(path,plan,machine,release),z=unpackZip(bytes);
    const settings=JSON.parse(z.get('Metadata/project_settings.config')),code=z.get(GCODE).toString();
    for(const key of ['filament_map','filament_map_2','filament_nozzle_map']){
      if(key==='filament_map_2')assert.equal(settings[key],undefined);
      else assert.equal(settings[key].join(','),facts.sliceConfig[key]);
      assert.match(code,new RegExp('; '+key+' = '+facts.sliceConfig[key]+'\\n'));
    }
    assert.deepEqual(settings.nozzle_diameter,['0.4','0.8']);
    for(const name of ['Metadata/model_settings.config','Metadata/slice_info.config'])assert.match(z.get(name).toString(),/key="filament_maps" value="2 1"/);
    assert.deepEqual(JSON.parse(z.get('Metadata/filament_sequence.json')).plate_1,{nozzle_sequence:[tool],sequence:[2-tool]},'declaring both nozzles does not claim both are used');
    assert.equal(interpretProgram(bytes,plan,machine).envelope.job.tool,tool);
    plan.setup.bambu.filament=tool;
    assert.throws(()=>exportProgram(path,plan,machine,release),/nozzle disagrees/);
  }
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
  const exportFile=join(dir,state.review.generation.file),bytes=await readFile(exportFile);
  const server=createStudio(dir);await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`,html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const view=await(await fetch(origin+'/api/state')).json();assert.equal(view.exportName,'part.gcode.3mf');assert.equal(view.code,undefined);assert.equal(view.program.code,undefined);
  const response=await fetch(origin+'/api/deliver',{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:'{}'});
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),new RegExp(view.downloadName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.deepEqual(await readFile(join(dir,'delivery/part.gcode.3mf')),bytes);
  const altered=Buffer.from(bytes);altered[90]^=1;await writeFile(exportFile,altered);
  assert.match((await loadBundle(dir)).programError,/changed/);await assert.rejects(deliver(dir),/approval/);
  await writeFile(exportFile,bytes);
  await adjustBundle(dir,{process:{planarSpeedMmS:18}});state=await loadBundle(dir);
  assert.equal(state.toolpathApproved,false);
});


test('fast_start skips optional checks, keeps startup handoff and rejects contradictory requests on both Bambu profiles',async()=>{
  for(const id of ['bambu-h2d','bambu-x1-carbon']){
    const machine=loadMachine(id),plan=defaults(machine);plan.geometry=boxMesh();plan.process.minimumLayerSeconds=0;
    const path=generatePath(plan,machine,await rhino());
    const full=unpackZip(exportProgram(path,plan,machine,release)).get(GCODE).toString().split(';SAAM_BODY_BEGIN')[0];
    assert.match(full,/M970\.3/);assert.match(full,/M1006 S1/);
    plan.setup.bambu.fast_start=true;
    const bytes=exportProgram(path,plan,machine,release),entries=unpackZip(bytes),start=entries.get(GCODE).toString().split(';SAAM_BODY_BEGIN')[0];
    assert.doesNotMatch(start,/^M970|^M974|^M1006|^M977|^M976|^M972/m);
    assert.match(start,/M1002 set_flag g29_before_print_flag=0/);
    assert.match(start,/M1002 set_flag extrude_cali_flag=0/);
    assert.match(start,/M190 S60/);assert.match(start,/M109 S215/);
    assert.match(start,/^G28(?: |\.)/m,'homing is retained');
    assert.ok(start.endsWith('G1 Z20 F300\nG1 X100 Y100 F3600\nM400\n'));
    if(id==='bambu-h2d'){
      assert.match(start,/G28 X T300/);assert.match(start,/G28 Z P0 T250/,'fast start must retain initial Z registration');
      assert.ok(start.indexOf('G28 Z P0 T250')<start.indexOf('M620 S0A'));
      assert.match(start,/G383 O0 M2 T140/);assert.match(start,/G1 X290 E10/);
      assert.match(start,/M1002 set_flag auto_cali_toolhead_offset_flag=0/);
      assert.match(start,/M1002 set_flag build_plate_detect_flag=0/);
      assert.match(start,/M1012\.5 N1 R1/,'saved offset restoration remains');
    }else{
      assert.match(start,/G28 Z P0 T300/);assert.match(start,/G0 X239 E15/);
      assert.doesNotMatch(start,/M18 E/,'fast mode avoids lidar preparation that disables the extruder');
    }
    assert.equal(interpretProgram(bytes,plan,machine).envelope.job.fast_start,true);
    assert.equal(JSON.parse(entries.get('Metadata/saam-job.json')).fast_start,true);
    const project=JSON.parse(entries.get('Metadata/project_settings.config'));
    assert.equal(project.single_extruder_multi_material,'1');
    if(id==='bambu-h2d'){
      assert.equal(project.machine_start_gcode,start.split('; EXECUTABLE_BLOCK_START\n')[1]);
      for(const key of ['machine_start_gcode','machine_end_gcode']){
        const altered=new Map(entries),p=structuredClone(project);p[key]+='M999\n';
        altered.set('Metadata/project_settings.config',Buffer.from(JSON.stringify(p)));
        assert.throws(()=>interpretProgram(packZip(altered),plan,machine),/metadata, checksum or thumbnail/);
      }
    }
    assert.match(start,/^; single_extruder_multi_material = 1$/m);
    plan.setup.bambu.startup.bedLeveling='on';assert.throws(()=>exportProgram(path,plan,machine,release),/fast_start conflicts/);
    plan.setup.bambu.startup.bedLeveling='printer';plan.setup.bambu.fast_start='true';assert.throws(()=>exportProgram(path,plan,machine,release),/fast_start must be boolean/);
  }
});

test('single used filament with a nonzero logical ID remains that ID in the USB header',async()=>{
  const {machine,plan}=fixture(1,0.8);
  plan.setup.bambu.filaments=[{id:'GFA00',colour:'#808080',tool:0},{id:'GFA00',colour:'#0000FF',tool:1}];
  plan.setup.bambu.filament=1;
  const path=generatePath(plan,machine,await rhino()),bytes=exportProgram(path,plan,machine,release),entries=unpackZip(bytes);
  assert.match(entries.get(GCODE).toString(),/^; filament: 2$/m);
  assert.match(entries.get('Metadata/slice_info.config').toString(),/<filament id="2"/);
  assert.deepEqual(JSON.parse(entries.get('Metadata/plate_1.json')).filament_ids,[1]);
  assert.equal(interpretProgram(bytes,plan,machine).filamentUsage[0].filament,1);
});
