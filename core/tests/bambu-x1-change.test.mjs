import test from 'node:test';
import assert from 'node:assert/strict';
import {x1ColourFixture} from './fixtures/bambu-x1-colours.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {checkMachinePath} from '../machine/profile.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {unpackZip,packZip} from '../export/zip.mjs';
import {decodeSource} from '../../studio/source-player.mjs';
import {auditBambu} from '../../scripts/bambu-audit.mjs';

const release={generatorVersion:'test',buildDate:'2026-09-21'};
test('X1 white-grey-black makes exactly two same-nozzle AMS changes, with checked retraction and three colour bands',async()=>{
  const {plan,machine}=x1ColourFixture();
  plan.setup.bambu.filaments[1].process={retractMm:0.6};
  plan.setup.bambu.filaments[2].process={retractMm:1};
  const path=generatePath(plan,machine,await rhino());checkMachinePath(path,plan,machine);
  assert.deepEqual(path.actions.filter(a=>a.kind==='toolChange').map(a=>[a.tool,a.filament]),[[0,1],[0,2]]);
  const bytes=exportProgram(path,plan,machine,release),program=interpretProgram(bytes,plan,machine);
  assert.deepEqual(program.filamentSequence,[0,1,2]);
  const code=program.code,source=decodeSource({program:code},plan,machine);
  assert.deepEqual(source.moves.map(m=>[m.tool,m.filament,m.to]),program.moves.map(m=>[m.tool,m.filament,m.to]));
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
  assert.equal(program.envelope.job.materialChanges.count,2);
  assert.doesNotMatch(code,/H-1|Prime tower/);
  assert.match(code,/M620 S1A[\s\S]*T1\n[\s\S]*M621 S1A/);
  assert.match(code,/M620 S2A[\s\S]*T2\n[\s\S]*M621 S2A/);
  assert.match(code,/G1 E-0.6 F1800/);assert.match(code,/G1 E-1 F1800/);
  const seq=JSON.parse(unpackZip(bytes).get('Metadata/filament_sequence.json')).plate_1;
  assert.deepEqual(seq.sequence,[1,2,3]);assert.deepEqual(seq.nozzle_sequence,[0,0,0]);
  for(const [before,after]of [[';SAAM_CHUTE_FLUSH_MM3:300',';SAAM_CHUTE_FLUSH_MM3:0'],['T1\n','T2\n'],['M621 S1A','M621 S2A'],['G1 E-0.6 F1800','G1 E-0.8 F1800']]){
    const z=unpackZip(bytes);z.set('Metadata/plate_1.gcode',Buffer.from(code.replace(before,after)));
    assert.throws(()=>interpretProgram(packZip(z),plan,machine),/tool-change block/);
  }
});

test('X1 automatic changes reject external feed and insufficient lift',async()=>{
  const {plan,machine}=x1ColourFixture(),r=await rhino(),path=generatePath(plan,machine,r);
  plan.setup.bambu.filaments[1].source={type:'external'};
  assert.throws(()=>exportProgram(path,plan,machine,release),/require AMS feeds/);
  plan.setup.bambu.filaments[1].source={type:'auto'};
  const i=path.actions.findIndex(a=>a.kind==='toolChange');
  for(let j=i-1;j>=0;j--)if(path.actions[j].kind==='move'){path.actions[j].to[2]=0.6;break;}
  assert.throws(()=>exportProgram(path,plan,machine,release),/clearance/);
});
