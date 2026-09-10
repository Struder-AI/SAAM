import test from 'node:test';
import assert from 'node:assert/strict';
import {frameAtTime} from '../../studio/playback.mjs';

test('Studio follows the interpreted robot acceleration profile, including dwell gaps',()=>{
  const move={from:[0,0,0],to:[10,0,0],startSeconds:1,durationSeconds:3,
    interpolation:'rest-to-rest-linear',controllerLengthMm:10,accelerationMmS2:5,peakSpeedMmS:5};
  assert.deepEqual(frameAtTime([move],0).point,[0,0,0]);
  assert.equal(frameAtTime([move],1.5).point[0],0.625);
  assert.equal(frameAtTime([move],2.5).point[0],5);
  assert.equal(frameAtTime([move],3.5).point[0],9.375);
  assert.deepEqual(frameAtTime([move],4).point,[10,0,0]);
  assert.equal(frameAtTime([move],4).completed,1);
  const next={...move,from:[10,0,0],to:[20,0,0],startSeconds:6};
  assert.deepEqual(frameAtTime([move,next],5).point,[10,0,0]);
});
