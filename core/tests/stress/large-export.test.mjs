import '../temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportProgram } from '../../export/registry.mjs';
import { defaults, VERSION, BUILD_DATE } from '../../print/plan.mjs';

test('large Griffin toolpaths export every move without overflowing the call stack', async () => {
  const machine=JSON.parse(readFileSync('machines/ultimaker/ultimaker-s5.json','utf8'));
  const plan=defaults(machine),count=200_000;
  const path={
    schema:'saampath/1',completion:{contract:'saam-neutral-motion/1'},
    initialPosition:[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm],
    actions:[{kind:'move',phase:'planar',layer:0,to:[100,100,1],speedMmS:10,volumeMm3:0}]
  };
  for(let i=0;i<count;i++)path.actions.push({
    kind:'move',phase:'draped-skin',layer:1,to:[i%2===0?101:100,100,1],speedMmS:10,volumeMm3:0.04
  });
  const {bytes:code}=(await exportProgram(path,plan,machine,{generatorVersion:VERSION,buildDate:BUILD_DATE}));
  assert.equal(String(code).match(/^G1 X10[01] E/gm).length,count);
  assert.match(code,/M400/);
});
