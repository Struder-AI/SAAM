import test from 'node:test';
import assert from 'node:assert/strict';
import {shortTravelAdvisory} from '../export/travel-advisory.mjs';
import {exportAndInterpretProgram,interpretProgram} from '../export/registry.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {defaults} from '../print/plan.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';

const move=(from,to,extruding=false,extra={})=>({from,to,extruding,...extra});
test('travel advisory measures complete XYZ trips, includes 2 mm, and retains producer/source context',()=>{
  const moves=[
    move([0,0,0],[10,0,0],true,{operation:'fill:0'}),
    move([10,0,0],[10,0,5],false,{line:10,operation:'skin:0'}),
    move([10,0,5],[12,0,5],false,{line:11}),
    move([12,0,5],[12,0,0],false,{line:12}),
    move([12,0,0],[14,0,0],true,{operation:'skin:0'}),
    move([14,0,0],[14,0,2.001]), // XYZ, not XY
    move([14,0,2.001],[15,0,2.001],true),
    move([15,0,2.001],[25,0,2.001]),
    move([25,0,2.001],[15,0,2.001]), // detour ending at its start is bad
    move([15,0,2.001],[16,0,2.001],true),
  ];
  const before=structuredClone(moves),report=shortTravelAdvisory(moves);
  assert.equal(report.count,2);assert.equal(report.travelCount,3);
  assert.deepEqual(report.samples.map(s=>s.distanceMm),[2,0]);
  assert.deepEqual(report.samples.map(s=>s.lifted),[true,false]);assert.equal(report.liftedCount,1);
  assert.equal(report.samples[0].start.line,10);assert.equal(report.samples[0].end.line,12);
  assert.deepEqual(report.operations,[{operation:'fill:0',count:1},{operation:'skin:0',count:1}]);
  assert.deepEqual(moves,before,'diagnosis never repairs motion');
});
test('sampling long robot travels does not flag each small segment; stationary deposition splits trips',()=>{
  const moves=Array.from({length:100},(_,i)=>move([i/10,0,0],[(i+1)/10,0,0]));
  assert.equal(shortTravelAdvisory(moves).count,0);
  const trips=[move([-1,0,0],[0,0,0],true)];
  for(let i=0;i<25;i++)trips.push(move([i,0,0],[i+1,0,0]),move([i+1,0,0],[i+1,0,0],true));
  const report=shortTravelAdvisory(trips);
  assert.equal(report.count,25);assert.equal(report.samples.length,20);assert.equal(report.omittedSamples,5);
  assert.equal(shortTravelAdvisory([]).count,0);
});
test('required transitions and unwritable sub-micron segments are not bad travels',()=>{
  const deposit=(from,to,layer)=>move(from,to,true,{layer});
  const report=shortTravelAdvisory([
    move([0,0,5],[0,0,0.2]), // approach before the first deposition
    deposit([0,0,0.2],[10,0,0.2],0),
    move([10,0,0.2],[10.0004,0,0.2],false,{layer:0}), // filament amount rounded to nothing inside a stroke
    deposit([10.0004,0,0.2],[20,0,0.2],0),
    move([20,0,0.2],[20,0.5,0.4],false,{layer:1}), // nearby start of the next layer
    deposit([20,0.5,0.4],[0,0.5,0.4],1),
    move([0,0.5,0.4],[0,0.5,1.4]), // final park
  ]);
  assert.equal(report.count,0);assert.equal(report.travelCount,3);assert.equal(report.message,null);
  const sameLayer=shortTravelAdvisory([deposit([0,0,0],[1,0,0],0),move([1,0,0],[1,0.4,0],false,{layer:0}),deposit([1,0.4,0],[0,0.4,0],0)]);
  assert.equal(sameLayer.count,1);assert.match(sameLayer.message,/Tell the person/);
});
test('generation and saved-source interpretation carry identical advisories',async()=>{
  const machine=loadMachine('ultimaker-s5'),plan=defaults(machine),path=generatePath(plan,machine,await rhino());
  const {bytes,program}=exportAndInterpretProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-15'});
  assert.equal(program.summary.shortTravel.count,0,'default walls and fill connect their nearby strokes');assert.ok(path.summary.travel.connected>0);
  assert.deepEqual(interpretProgram(bytes,plan,machine).summary.shortTravel,program.summary.shortTravel);
});
