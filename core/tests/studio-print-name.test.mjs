import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadName,requestedDownloadName} from '../../studio/print-name.mjs';

test('reviewed download names retain printer-specific compound file extensions',()=>{
  assert.equal(downloadName('Mesh vase','part.gcode.3mf'),'Mesh vase.gcode.3mf');
  assert.equal(downloadName('Mesh vase','part.gcode'),'Mesh vase.gcode');
  assert.equal(downloadName('Robot part','part.zip'),'Robot part.zip');
  assert.equal(downloadName('Name: / vase. ','part.gcode.3mf'),'Name- - vase.gcode.3mf');
});

test('a person can replace the suggested export name without changing its format',()=>{
  assert.equal(requestedDownloadName(undefined,'Suggested handle','part.gcode'),'Suggested handle.gcode');
  assert.equal(requestedDownloadName('  My final handle  ','Suggested handle','part.gcode.3mf'),'My final handle.gcode.3mf');
  assert.equal(requestedDownloadName('Name: / handle','Suggested handle','part.zip'),'Name- - handle.zip');
  assert.throws(()=>requestedDownloadName('   ','Suggested handle','part.gcode'),/Enter a print name/);
  assert.throws(()=>requestedDownloadName('x'.repeat(121),'Suggested handle','part.gcode'),/120 characters/);
});
