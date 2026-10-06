// Real size-boundary regressions. Run explicitly with npm run test:stress.
import '../temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportProgram} from '../../export/registry.mjs';
import {packZip,unpackZip} from '../../export/zip.mjs';
import {defaults} from '../../print/plan.mjs';
import {loadMachine} from '../../machine/profile.mjs';

const release={generatorVersion:'test',buildDate:'2026-09-09'};
function fixture(id){
  const machine=loadMachine(id),plan=defaults(machine);
  return {machine,plan,path:{schema:'saampath/1',completion:{contract:'saam-neutral-motion/1'},initialPosition:[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm],
    summary:{boundsMm:{min:[100,100,0],max:[101,101,1]}},actions:[
      {kind:'move',phase:'planar',layer:0,to:[100,100,1],speedMmS:10,volumeMm3:0},
      {kind:'move',phase:'planar',layer:0,to:[101,100,1],speedMmS:10,volumeMm3:0.04}
    ]}};
}

test('H2D exports a body beyond 25 MB',()=>{
  const {machine,plan,path}=fixture('bambu-h2d');
  // Legal operation comments exercise a large real package without allocating
  // hundreds of thousands of retained motion objects in the unit-test worker.
  path.actions[1].operation='large-test-'+'.'.repeat(25_000_001);
  const {bytes,report}=exportProgram(path,plan,machine,release);
  const entries=unpackZip(bytes);
  assert.ok(entries.get('Metadata/plate_1.gcode').length>25_000_000);
  assert.equal(report.moves,2);assert.ok(Math.abs(report.volumeMm3-0.04)<0.0001);
});

test('ZIP32 round-trips a member above the former 64 MB policy without relaxing integrity checks',()=>{
  const input=Buffer.alloc(64_000_001,65);input[input.length-1]=66;
  const archive=packZip(new Map([['large.gcode',input]]));
  assert.deepEqual(unpackZip(archive).get('large.gcode'),input);
  const broken=Buffer.from(archive);broken[30+Buffer.byteLength('large.gcode')]^=1;
  assert.throws(()=>unpackZip(broken));
});
