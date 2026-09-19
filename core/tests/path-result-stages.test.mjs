import test from 'node:test';
import assert from 'node:assert/strict';
import {trimVanishingEnd} from '../path/deposition.mjs';
import {publishFinishedBoundary} from '../path/finished-surface.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};

test('taper trimming returns aligned stroke arrays without altering the producer result',()=>{
  const stroke=freeze({role:'wall',points:[[0,0,1],[1,0,1],[2,0,1],[3,0,1],[4,0,1]],volumesMm3:[.2,.001,.0004,.0003],segmentMetadata:[{layer:0},{layer:1},{layer:2},{layer:3}],speedMmS:10});
  const before=JSON.stringify(stroke),trimmed=trimVanishingEnd(stroke);
  assert.equal(JSON.stringify(stroke),before);
  assert.deepEqual(trimmed,{...stroke,points:stroke.points.slice(0,3),volumesMm3:[.2,.001],segmentMetadata:[{layer:0},{layer:1}]});
  assert.notEqual(trimmed,stroke);
  for(const key of ['points','volumesMm3','segmentMetadata'])assert.notEqual(trimmed[key],stroke[key]);
  assert.strictEqual(trimmed.points[0],stroke.points[0],'retained coordinates need no deep copy');
  const further=trimVanishingEnd(freeze(trimmed),.002);
  assert.equal(further.volumesMm3.length,1);
  assert.equal(trimmed.volumesMm3.length,2,'later trimming cannot alter a published result');
  assert.equal(stroke.points.length,5);
});

test('taper trimming retains the threshold segment and at least one deposition segment',()=>{
  const threshold=freeze({points:[[0,0,0],[1,0,0],[2,0,0]],volumesMm3:[.1,.001],marker:'preserved'});
  assert.deepEqual(trimVanishingEnd(threshold),threshold);
  const vanishing=freeze({points:[[0,0,0],[1,0,0],[2,0,0]],volumesMm3:[0,0]});
  assert.deepEqual(trimVanishingEnd(vanishing),{points:[[0,0,0],[1,0,0]],volumesMm3:[0]});
});

test('finished-boundary publication preserves incoming result and shares unchanged deposition data',()=>{
  const shell=freeze({bounds:{min:[0,0,0],max:[10,10,2]}}),old=freeze([{coverage:'prior'}]);
  const result=freeze({id:'body',operations:[{id:'empty',strokes:[]},{id:'wall',strokes:[{points:[[0,0,1],[1,0,1]]}]}],report:{volumeMm3:.1},finishedSurfaces:old});
  const contains=e=>e.point[0]>=0,published=publishFinishedBoundary(result,{shell,contains,coverage:'sparse'});
  assert.strictEqual(result.finishedSurfaces,old);
  assert.notEqual(published,result);
  assert.strictEqual(published.operations,result.operations);
  assert.strictEqual(published.report,result.report);
  assert.deepEqual(published.finishedSurfaces,[{shell,startMm:0,endMm:2,coverage:'sparse',contains,sourceOperationIds:['wall']}]);
  const again=publishFinishedBoundary(freeze(published),{shell,startMm:1,endMm:1.5});
  assert.equal(published.finishedSurfaces[0].startMm,0);
  assert.equal(again.finishedSurfaces[0].startMm,1);
  assert.equal(again.finishedSurfaces[0].contains({point:[-1,0,1]}),true,'shell boundary retains its unconstrained predicate');
  const empty=publishFinishedBoundary(freeze({operations:[{id:'empty',strokes:[]}],finishedSurfaces:old}),{shell});
  assert.deepEqual(empty.finishedSurfaces,[],'empty deposition cannot publish material');
});
