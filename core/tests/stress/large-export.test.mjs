import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportGriffin, interpretGriffin } from '../../export/griffin.mjs';
import { defaults, VERSION, BUILD_DATE } from '../../print/plan.mjs';

test('large Griffin toolpaths export and replay every move without overflowing the call stack', () => {
  const machine=JSON.parse(readFileSync('machines/ultimaker-s5.json','utf8'));
  const plan=defaults(machine),count=200_000;
  const path={
    schema:'saampath/1',
    initialPosition:[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm],
    actions:[{kind:'move',phase:'planar',layer:0,to:[100,100,1],speedMmS:10,volumeMm3:0}]
  };
  for(let i=0;i<count;i++)path.actions.push({
    kind:'move',phase:'draped-skin',layer:1,to:[i%2===0?101:100,100,1],speedMmS:10,volumeMm3:0.04
  });
  const code=exportGriffin(path,plan,machine,{generatorVersion:VERSION,buildDate:BUILD_DATE});
  const program=interpretGriffin(code,plan,machine);
  const deposition=program.moves.filter(move=>move.extruding);
  assert.equal(deposition.length,count);
  for(let i=0;i<count;i++){
    assert.deepEqual(deposition[i].to,[i%2===0?101:100,100,1]);
    assert.equal(deposition[i].phase,'draped-skin');
    assert.equal(deposition[i].layer,1);
  }
  assert.ok(Math.abs(program.volumeMm3-count*0.04)<0.001);
  assert.match(code,/M400/);
});
