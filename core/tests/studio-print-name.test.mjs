import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadName} from '../../studio/print-name.mjs';

test('reviewed download names retain printer-specific compound file extensions',()=>{
  assert.equal(downloadName('Mesh vase','part.gcode.3mf'),'Mesh vase.gcode.3mf');
  assert.equal(downloadName('Mesh vase','part.gcode'),'Mesh vase.gcode');
  assert.equal(downloadName('Robot part','part.zip'),'Robot part.zip');
  assert.equal(downloadName('Name: / vase. ','part.gcode.3mf'),'Name- - vase.gcode.3mf');
});
