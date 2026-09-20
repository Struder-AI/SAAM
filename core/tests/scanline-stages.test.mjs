import test from 'node:test';
import assert from 'node:assert/strict';
import {scanlineFill,prepareScanlineFrame,sampleScanlineRows,connectScanlineCells} from '../region/region2d.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const span=(left,right,y)=>({left,right,row:{scanY:y,from:[left,y],to:[right,y],lengthMm:right-left}});

test('cell connection reads frozen streamed spans and ends cells at splits, merges and empty rows',()=>{
  const rows=freeze([[span(0,10,0)],[span(0,4,1),span(6,10,1)],[span(0,4,2),span(6,10,2)],[span(0,10,3)],[],[span(0,10,5)]]);
  const before=JSON.stringify(rows);
  function* stream(){yield* rows;}
  const cells=connectScanlineCells(stream());
  assert.deepEqual(cells,[[rows[0][0].row],[rows[1][0].row,rows[2][0].row],[rows[1][1].row,rows[2][1].row],[rows[3][0].row],[rows[5][0].row]]);
  assert.equal(cells[0][0],rows[0][0].row);
  assert.equal(JSON.stringify(rows),before);
  assert.deepEqual(connectScanlineCells(stream()),cells);
});

test('frame preparation and lazy row sampling preserve frozen geometry and published rows',()=>{
  const loops=freeze([rect(0,0,30,30),rect(10,5,10,20).reverse()]),origin=freeze([.2,.13]);
  const frame=freeze(prepareScanlineFrame(loops,37,origin)),before=JSON.stringify(frame);
  function* frozenRows(){for(const row of sampleScanlineRows(frame,.4))yield freeze(row);}
  const cells=connectScanlineCells(frozenRows());
  const numbered=cells.flatMap((cell,cellId)=>cell.map(row=>({...row,cellId})));
  assert.deepEqual(numbered,scanlineFill(loops,.4,37,{originMm:origin}));
  assert.equal(JSON.stringify(frame),before);
  const sampled=sampleScanlineRows(frame,.4);assert.equal(sampled[Symbol.iterator](),sampled);assert.equal(Array.isArray(sampled),false);
  const first=freeze(sampled.next().value),saved=JSON.stringify(first);sampled.next();sampled.return();
  assert.equal(JSON.stringify(first),saved);
});

test('nonzero winding spans preserve overlapping material and discard zero-width contacts',()=>{
  const frame=prepareScanlineFrame(freeze([rect(0,0,4,4),rect(2,0,4,4)]),0,[0,0]);
  const rows=[...sampleScanlineRows(frame,1)];
  assert.equal(rows.length,5);assert.deepEqual(rows[4],[]);
  for(const spans of rows.slice(0,4))assert.deepEqual(spans.map(s=>[s.left,s.right]),[[0,2],[2,4],[4,6]]);
});

test('empty region and invalid-spacing behavior remain unchanged',()=>{
  assert.deepEqual(scanlineFill([],0,0),[]);
  assert.throws(()=>scanlineFill([rect(0,0,1,1)],0,0),/Fill spacing must be positive/);
  const empty=prepareScanlineFrame([],0,[0,0]);
  assert.deepEqual(connectScanlineCells(sampleScanlineRows(empty,1)),[]);
});
