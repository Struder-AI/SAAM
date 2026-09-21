import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMachine,checkMachinePath} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {rhino} from '../print/geometry.mjs';
import {generatePath} from '../print/generate.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {unpackZip,packZip} from '../export/zip.mjs';
import {decodeSource} from '../../studio/source-player.mjs';
import {auditBambu} from '../../scripts/bambu-audit.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {resolveBambuJob} from '../export/bambu-job.mjs';
import {recipeRows} from '../../studio/settings.mjs';
import {beadSection} from '../../studio/material-view.mjs';

import {mixedNozzleFixture} from './fixtures/bambu-dual.mjs';
const release={generatorVersion:'test',buildDate:'2026-09-21'};
test('mixed 0.4/0.8 H2D regions emit tower-free changes, distinct process grids and independently decoded tool state',async()=>{
  const {plan,machine}=mixedNozzleFixture(),path=generatePath(plan,machine,await rhino());
  checkMachinePath(path,plan,machine);
  assert.ok(path.actions.filter(a=>a.kind==='toolChange').length>=3);
  const bytes=exportProgram(path,plan,machine,release),z=unpackZip(bytes),code=z.get('Metadata/plate_1.gcode').toString();
  assert.match(code,/^; filament: 1,2$/m,'USB header declares material IDs, not their count');
  assert.match(code,/^; filament_diameter: 1.75,1.75$/m);
  assert.match(code,/^; total filament length \[mm\] : [\d.]+,[\d.]+$/m);
  assert.deepEqual(auditBambu(bytes).plates[0].headerFilamentIds,[1,2]);
  assert.doesNotMatch(code,/Prime tower|prime_tower_interface/);
  const body=code.split(';SAAM_BODY_BEGIN\n')[1].split(';SAAM_BODY_END\n')[0];
  assert.doesNotMatch(body,/^G0(?:\s|$)/m);
  assert.match(body,/G1 X120.2 Y110.2 Z20 F7200\nG1 Z0.2 F600/,'First deposition is preceded by explicit G1 descent');
  assert.throws(()=>decodeSource({program:code.replace('G1 Z0.2 F600','G0 Z0.2 F600')},plan,machine),/travel must use G1/);
  assert.match(code,/M620\.10 A0 .* H0.4 T240 P215/);
  assert.match(code,/M620\.10 A1 .* H0.8 T240 P225/);
  assert.match(code,/M620\.10 A0 .* H0.8 T240 P225/);
  assert.match(code,/M620\.10 A1 .* H0.4 T240 P215/);
  assert.equal(code.split('\n').filter(l=>l==='M620.17 T0 S225 L1').length,2,'Right physical heater uses its first actual filament in both calibration branches');
  assert.equal(code.split('\n').filter(l=>l==='M620.17 T1 S215 L0').length,2,'Left physical heater uses its first actual filament in both calibration branches');
  const program=interpretProgram(bytes,plan,machine);
  const preview=decodeSource({program:code},plan,machine);
  assert.equal(preview.moves.length,program.moves.length);
  assert.deepEqual(preview.moves.map(m=>[m.tool,m.filament,m.line]),program.moves.map(m=>[m.tool,m.filament,m.line]));
  assert.deepEqual(new Set(program.moves.filter(m=>m.extruding).map(m=>m.tool)),new Set([0,1]));
  assert.ok(program.moves.some(m=>m.extruding&&m.tool===1&&Math.abs(m.to[2]-0.3)<1e-6));
  assert.ok(program.moves.some(m=>m.extruding&&m.tool===0&&Math.abs(m.to[2]-0.2)<1e-6));
  const levels=new Map();
  for(const m of program.moves.filter(m=>m.extruding&&m.phase==='planar')){
    if(levels.has(m.layer))assert.equal(levels.get(m.layer),m.to[2],'Different nozzle layer grids cannot collide in metadata');
    levels.set(m.layer,m.to[2]);
  }
  assert.equal(levels.size,8);
  const rightMove=preview.moves.map(m=>m).find(m=>m.extruding&&m.tool===1&&m.phase==='planar');
  const bead=beadSection(rightMove,plan,{});
  assert.ok(Math.abs(bead.width-0.8)<1e-6);
  assert.match(new Map(recipeRows(plan,machine)).get('Filament 2'),/Right nozzle.*0.8 mm.*225°C.*Automatic/i);
  assert.deepEqual(auditBambu(bytes).plates[0].changes.issues,[]);
  const usage=program.filamentUsage;assert.equal(usage.length,2);assert.ok(usage.every(u=>u.volumeMm3>0));
  assert.deepEqual(JSON.parse(z.get('Metadata/plate_1.json')).filament_ids,[0,1]);
  assert.match(z.get('Metadata/slice_info.config').toString(),/nozzle id="0" extruder_id="1" nozzle_diameter="0.4"/);
  assert.match(z.get('Metadata/slice_info.config').toString(),/nozzle id="1" extruder_id="2" nozzle_diameter="0.8"/);
  const modified=unpackZip(bytes);modified.set('Metadata/plate_1.gcode',Buffer.from(code.replace(/(M620\.10 A1 [^\n]*H)0.8/,'$10.4')));
  assert.throws(()=>interpretProgram(packZip(modified),plan,machine),/tool-change block/);
  for(const [before,after] of [['M620.15 C225','M620.15 C215'],['M620.11 P0 I0 B-1','M620.11 P0 I1 B-1'],
    ['M620.10 R0','M620.10 R2'],['M1015.4 S1 K1 H0.8','M1015.4 S1 K1 H0.4'],['M204 S10000\nM621 S1A','M204 S9000\nM621 S1A']]){
    const boundary=code.indexOf(';SAAM_TOOL_CHANGE ');
    const changed=code.slice(0,boundary)+code.slice(boundary).replace(before,after);assert.notEqual(changed,code);
    const corrupted=unpackZip(bytes);corrupted.set('Metadata/plate_1.gcode',Buffer.from(changed));
    assert.throws(()=>interpretProgram(packZip(corrupted),plan,machine),/tool-change block/);
  }
});

test('feed intentions are independent of logical filament and nozzle identities',()=>{
  for(const left of ['auto','external','ams'])for(const right of ['auto','external','ams']){
    const {plan,machine}=mixedNozzleFixture();
    plan.setup.bambu.amsConnections=[{unit:1,tool:0},{unit:2,tool:1}];
    for(const [i,type] of [left,right].entries())plan.setup.bambu.filaments[i].source=type==='ams'?{type,unit:i+1,slot:4}:{type};
    const job=resolveBambuJob(plan,machine,machine.outputs[0]);
    assert.deepEqual(job.settings.filament_map,['1','2']);
    assert.deepEqual(job.settings.nozzle_diameter,['0.4','0.8']);
    assert.equal(job.values.filamentTool,0);
    assert.deepEqual(job.settings.filament_colour,['#FFFF00','#00AE42']);
    assert.equal(job.requestedTray?.index??null,left==='ams'?3:null);
    assert.equal(job.selections[1].setup.ams?.unit??null,right==='ams'?2:null);
  }
  const {plan,machine}=mixedNozzleFixture();
  plan.setup.bambu.filaments[0].source={type:'ams',unit:1,slot:1};
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/not connected/);
  plan.setup.bambu.filaments[0].source={type:'external'};
  plan.setup.ams={unit:1,slot:1};
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/contradicts/);
});

test('mixed nozzle job can start on the right and use each nozzle’s own build area',async()=>{
  const fixture=mixedNozzleFixture(),machine=fixture.machine;
  const plan=filamentPlan(fixture.plan,machine,1);
  plan.placement.xMm=310;
  const path=generatePath(plan,machine,await rhino());checkMachinePath(path,plan,machine);
  const program=interpretProgram(exportProgram(path,plan,machine,release),plan,machine);
  assert.equal(program.filamentSequence[0],1);
  assert.ok(program.moves.some(m=>m.extruding&&m.tool===1&&m.to[0]>325));
  assert.ok(program.moves.filter(m=>m.extruding&&m.tool===0).every(m=>m.to[0]<=325));
  plan.composition.regions[1].filament=0;
  assert.throws(()=>generatePath(plan,machine,{}),/Placement X/);
});

test('unsupported same-nozzle changes and unsafe handoffs fail before packaging',async()=>{
  const {plan,machine}=mixedNozzleFixture(),r=await rhino();
  const path=generatePath(plan,machine,r),first=path.actions.findIndex(a=>a.kind==='toolChange');
  const bad=structuredClone(path);bad.actions[first].tool=0;
  assert.throws(()=>exportProgram(bad,plan,machine,release),/disagrees/);
  const unret=structuredClone(path);let i=first-1;while(unret.actions[i].kind!=='retract')i--;
  unret.actions.splice(i,1);
  assert.throws(()=>exportProgram(unret,plan,machine,release),/retract|withdrawal|recover/i);
  plan.setup.bambu.filaments[1].tool=0;
  assert.throws(()=>generatePath(plan,machine,r),/does not implement this material change/);
});

test('every supported H2D diameter pair keeps each change descriptor on its own nozzle',async()=>{
  const r=await rhino();
  for(const left of [0.4,0.6,0.8])for(const right of [0.4,0.6,0.8]){
    const {plan,machine}=mixedNozzleFixture();
    Object.assign(plan.setup,{nozzleMm:left,core:`Hardened steel ${left}`});
    plan.setup.bambu.otherNozzleMm=right;plan.process.lineWidthMm=left;
    plan.setup.bambu.filaments[1].process.lineWidthMm=right;
    for(const part of plan.geometry.parts)part.geometry.heightMm=0.6;
    const path=generatePath(plan,machine,r),bytes=exportProgram(path,plan,machine,release);
    const report=auditBambu(bytes);assert.deepEqual(report.plates[0].changes.issues,[]);
    const program=interpretProgram(bytes,plan,machine);
    assert.deepEqual(program.envelope.job.nozzleDiametersMm,[left,right]);
    assert.ok(program.filamentUsage.every(u=>u.volumeMm3>0));
  }
});

test('four-slot AMS and single-slot HT units have independent capacities, connections and review identity',()=>{
  const {plan,machine}=mixedNozzleFixture(),b=plan.setup.bambu;
  b.amsConnections=[...Array.from({length:4},(_,i)=>({unit:i+1,tool:1})),
    ...Array.from({length:8},(_,i)=>({type:'ams-ht',unit:i+1,tool:i%2}))];
  b.filaments[0].source={type:'ams-ht',unit:1};b.filaments[1].source={type:'ams',unit:4,slot:4};
  const job=resolveBambuJob(plan,machine,machine.outputs[0]);
  assert.deepEqual(job.settings.extruder_ams_count,['1#4|4#0','1#4|4#4']);
  assert.deepEqual(job.settings.filament_map,['1','2']);
  assert.equal(job.requestedTray,null,'An HT device must not fabricate a four-slot physical tray index');
  assert.match(new Map(recipeRows(plan,machine)).get('Filament 1'),/Requested AMS HT 1/);
  b.filaments[0].source.unit=2;
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/not connected/);
  b.filaments[0].source.unit=9;
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/capacity/);
  b.filaments[0].source.unit=1;b.amsConnections.push({type:'ams-ht',unit:1,tool:1});
  assert.throws(()=>resolveBambuJob(plan,machine,machine.outputs[0]),/unique units/);
  const x1=loadMachine('bambu-x1-carbon'),single=defaults(x1);
  single.setup.bambu.filaments=[{id:'GFA00',colour:'#0000FF',source:{type:'ams-ht',unit:4}}];
  single.setup.bambu.amsConnections=Array.from({length:4},(_,i)=>({type:'ams-ht',unit:i+1,tool:0}));
  assert.deepEqual(resolveBambuJob(single,x1,x1.outputs[0]).settings.extruder_ams_count,['1#4|4#0']);
  single.setup.bambu.amsConnections.push({unit:1,tool:0});
  assert.throws(()=>resolveBambuJob(single,x1,x1.outputs[0]),/capacities/);
});
