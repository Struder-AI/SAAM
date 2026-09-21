import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validatePlan} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportProgram,interpretProgram,exportAndInterpretProgram} from '../export/registry.mjs';
import {packZip,unpackZip} from '../export/zip.mjs';
import {TOOL_CHANGE_BEGIN,TOOL_CHANGE_END} from '../export/bambu-tool-change.mjs';
import {boxMesh} from './fixtures/mesh.mjs';

const release={generatorVersion:'test',buildDate:'2026-09-09'},GCODE='Metadata/plate_1.gcode';
const LEFT={index:0,core:'Hardened steel 0.4',nozzleMm:0.4,color:'#FFF144'},RIGHT={index:1,core:'Hardened steel 0.4',nozzleMm:0.4,color:'#2850E0'};
const strokes=(y,length=60)=>[{closed:false,points:[[0,y],[length,y]]}];

// A background bar on the left nozzle and lettering above it on the right, both 0.4 mm, at the middle of the bed.
function fixture({changes=1}={}){
  const machine=loadMachine('bambu-h2d'),plan=defaults(machine);
  plan.geometry=boxMesh();plan.placement={xMm:100,yMm:100};plan.setup.filamentColor=LEFT.color; // the plan's own nozzle carries its own colour
  for(const settings of Object.values(plan.skills))settings.enabled=false;
  Object.assign(plan.process,{firstLayerMm:.2,layerMm:.2,lineWidthMm:.45,firstLayerSpeedMmS:20,planarSpeedMmS:20,minimumLayerSeconds:0});
  const networks=[{id:'background',tool:LEFT,layers:2,strokes:strokes(0)}];
  for(let i=0;i<changes;i++)networks.push({id:`lettering${i}`,tool:RIGHT,baseMm:.4+.4*i,layers:2,strokes:strokes(10+i*5)});
  Object.assign(plan.skills['line-network'],{enabled:true,layers:1,networks});
  validatePlan(plan,machine);
  return {machine,plan};
}
const bodyOf=bytes=>{const code=unpackZip(bytes).get(GCODE).toString();return code.slice(code.indexOf(';SAAM_BODY_BEGIN'),code.indexOf(';SAAM_BODY_END'));};
const repack=(bytes,edit)=>{const entries=unpackZip(bytes);entries.set(GCODE,Buffer.from(edit(entries.get(GCODE).toString())));return packZip(entries);};

test('a two-colour job exports, and the strict interpreter reads the nozzle change back',async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(bytes,exportProgram(path,plan,machine,release),'the package is deterministic');
  const body=bodyOf(bytes);
  assert.equal(body.split(TOOL_CHANGE_BEGIN).length-1,1,'one change');
  assert.equal(body.split(TOOL_CHANGE_END).length-1,1);
  assert.match(body,/M104 T0 S\d+ N0/,'the right nozzle (physical 0) is heated ahead of the change');
  assert.deepEqual([...new Set(program.moves.map(m=>m.tool))].sort(),[0,1],'moves are attributed to both nozzles');
  const heat=body.indexOf('M104 T0 S'),change=body.indexOf(TOOL_CHANGE_BEGIN);
  assert.ok(heat>=0&&heat<change,'heating comes before the change');
});

test('the package names both filaments with their colours and nozzles', async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const entries=unpackZip(exportProgram(path,plan,machine,release));
  const info=entries.get('Metadata/slice_info.config').toString(),settings=JSON.parse(entries.get('Metadata/project_settings.config').toString());
  assert.equal((info.match(/<filament /g)||[]).length,2);
  assert.match(info,/color="#FFF144"/);assert.match(info,/color="#2850E0"/);
  assert.match(info,/<nozzle id="0" extruder_id="1"/);assert.match(info,/<nozzle id="1" extruder_id="2"/);
  assert.match(info,/key="filament_maps" value="1 2"/);
  assert.deepEqual(settings.filament_colour,['#FFF144','#2850E0']);
  assert.deepEqual(settings.filament_map,['1','2']);
  const sequence=JSON.parse(entries.get('Metadata/filament_sequence.json').toString());
  assert.deepEqual(sequence.plate_1,{nozzle_sequence:[0,1],optimal_assignment:[0,1],sequence:[1,2]});
  assert.match(entries.get(GCODE).toString(),/M620\.17 T0 S\d+ L1\n/,'the start tells the firmware that extruder 0 starts on the second filament');
});

test('a one-nozzle package is unchanged by two-colour support',async()=>{
  const {machine,plan}=fixture();
  plan.skills['line-network'].networks=[{id:'a',tool:LEFT,layers:2,strokes:strokes(0)}];
  const path=generatePath(plan,machine,await rhino()),entries=unpackZip(exportProgram(path,plan,machine,release));
  assert.equal((entries.get('Metadata/slice_info.config').toString().match(/<filament /g)||[]).length,1);
  assert.deepEqual(JSON.parse(entries.get('Metadata/filament_sequence.json').toString()).plate_1,{nozzle_sequence:[0],optimal_assignment:[0],sequence:[1]});
  assert.match(entries.get(GCODE).toString(),/M620\.17 T0 S\d+ L0\n/);
  assert.doesNotMatch(entries.get(GCODE).toString(),/SAAM_TOOLCHANGE/);
});

test('the interpreter refuses a tampered or unsafe change', async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino());
  const bytes=exportProgram(path,plan,machine,release);
  const refuses=(edit,pattern,label)=>assert.throws(()=>interpretProgram(repack(bytes,edit),plan,machine),pattern,label);
  refuses(code=>code.replace(/^T1$/m,'T1\nM106 P2 S255'),/wrong number of lines|pinned sequence/,'an extra command inside the block');
  refuses(code=>code.replace(/^G1 Z(\S+) F1200$/m,'G1 Z2 F1200'),/./,'a lift that does not clear the part');
  refuses(code=>code.replace(/^M620\.10 R0$/m,'M620.10 R2'),/counter/,'a counter out of sequence');
  refuses(code=>code.replace(/^M104 T0 S\d+ N0$/m,'M104 T0 S0 N0'),/pre-heat/,'no pre-heat');
  refuses(code=>code.replace(TOOL_CHANGE_BEGIN,'; removed').replace(TOOL_CHANGE_END,'; removed'),/./,'firmware macros outside a marked block');
  refuses(code=>code.replace(TOOL_CHANGE_END,''),/./,'an unterminated block');
  const noChangeSupport=structuredClone(machine);delete noChangeSupport.outputs[0].program.toolChange;
  assert.throws(()=>interpretProgram(bytes,plan,noChangeSupport),/./,'a profile that declares no sequence cannot read a job that uses one');
  const edited=structuredClone(machine);edited.outputs[0].program.toolChange.entry.y=300;
  assert.throws(()=>interpretProgram(bytes,plan,edited),/Unknown Bambu nozzle-change sequence/,'an edited profile sequence no longer matches its pin');
});

test('a job on two nozzles of different diameters is refused at export, not silently approximated', async()=>{
  const {machine,plan}=fixture();
  plan.skills['line-network'].networks[1].tool={index:1,core:'Hardened steel 0.6',nozzleMm:0.6};
  plan.skills['line-network'].networks[1].process={lineWidthMm:.72,layerMm:.3};
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino());
  assert.throws(()=>exportProgram(path,plan,machine,release),/same nozzle diameter/);
});

test('a part that reaches the purge pad is refused', async()=>{
  const {machine,plan}=fixture();
  plan.placement={xMm:150,yMm:245};
  plan.skills['line-network'].networks[0].strokes=[{closed:false,points:[[0,0],[30,0]]}];
  const r=await rhino();
  assert.throws(()=>generatePath(plan,machine,r),/purge pad/);
});

test('each change flushes the new nozzle on the profile\'s purge pad before it prints the part', async()=>{
  const {machine,plan}=fixture(),path=generatePath(plan,machine,await rhino()),pad=machine.outputs[0].program.toolChange.purge;
  const at=path.actions.findIndex(a=>a.kind==='tool'),after=path.actions.slice(at+1);
  const firstPart=after.findIndex(a=>a.kind==='move'&&a.volumeMm3>0&&a.role!=='prime');
  const prime=after.slice(0,firstPart).filter(a=>a.kind==='move'&&a.volumeMm3>0);
  assert.ok(prime.length>0&&prime.every(a=>a.role==='prime'&&a.phase==='prime'),'the flush comes first and is labelled as service work');
  const volume=prime.reduce((sum,a)=>sum+a.volumeMm3,0);
  assert.ok(volume>=pad.volumeMm3&&volume<pad.volumeMm3*1.1,`${volume} mm3 flushed, for a ${pad.volumeMm3} mm3 profile`);
  assert.ok(prime.every(a=>a.to[0]>=pad.x0-1e-9&&a.to[0]<=pad.x1+1e-9&&a.to[1]>=pad.y0-1e-9),'inside the pad');
  assert.ok(path.summary.boundsMm.max[1]<pad.y0-10,'and outside the part\'s bounds');
});

test('a job that changes back and forth counts its changes, stacks its pads, and keeps both nozzles ready', async()=>{
  const {machine,plan}=fixture();
  plan.skills['line-network'].networks.push({id:'again',tool:LEFT,baseMm:1.0,layers:1,process:{layerMm:.2,firstLayerMm:.2},strokes:strokes(30)});
  validatePlan(plan,machine);
  const path=generatePath(plan,machine,await rhino());
  assert.deepEqual(path.actions.filter(a=>a.kind==='tool').map(a=>[a.fromTool,a.toTool]),[[0,1],[1,0]]);
  const pads=[...new Set(path.actions.filter(a=>a.role==='prime'&&a.volumeMm3>0).map(a=>+a.to[2].toFixed(6)))];
  assert.deepEqual(pads,[.2,.4],'the second pad is one layer above the first');
  const bytes=exportProgram(path,plan,machine,release),body=bodyOf(bytes);
  assert.match(body,/M620\.10 R0\n[\s\S]*M620\.10 R2\n/,'first change then later change counters');
  const program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(program.events.filter(e=>e.kind==='tool').map(e=>e.tool),[1,0]);
});
