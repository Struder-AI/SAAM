import test from 'node:test';
import assert from 'node:assert/strict';
import {gcodeLines} from '../export/gcode-lines.mjs';
import {interpretMotion} from '../export/griffin.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

test('chunked lines preserve CRLF, empty lines, final unterminated commands and error line numbers',()=>{
  const text='one\r\n\ntwo\nthree\r\nlast';
  for(let n=1;n<=text.length;n++){
    const chunks=function*(){for(let i=0;i<text.length;i+=n)yield text.slice(i,i+n);};
    assert.deepEqual([...gcodeLines(chunks())],text.split(/\r?\n/));
  }
  assert.deepEqual([...gcodeLines(['','a\r','','\n',''])],['a','']);
  assert.throws(()=>[...gcodeLines([new Uint8Array(1)])],/chunks must be text/);
  const machine=loadMachine(),plan=defaults(machine);
  assert.throws(()=>interpretMotion(['G9','0\r','\nG21\nM','999'],plan,machine),/Unsupported command M999 at line 3/);
});

