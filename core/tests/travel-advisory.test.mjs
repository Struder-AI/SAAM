import test from 'node:test';
import assert from 'node:assert/strict';
import {shortTravelAdvisory} from '../export/travel-advisory.mjs';
import {exportAndInterpretProgram,interpretProgram} from '../export/registry.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {defaults} from '../../skills/wedge-demo/scripts/model.mjs';
import {generatePath} from '../../skills/wedge-demo/scripts/path.mjs';

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
  ];
  const before=structuredClone(moves),report=shortTravelAdvisory(moves);
  assert.equal(report.count,2);assert.equal(report.travelCount,3);
  assert.deepEqual(report.samples.map(s=>s.distanceMm),[2,0]);
  assert.equal(report.samples[0].start.line,10);assert.equal(report.samples[0].end.line,12);
  assert.deepEqual(report.operations,[{operation:'fill:0',count:1},{operation:'skin:0',count:1}]);
  assert.deepEqual(moves,before,'diagnosis never repairs motion');
});
test('sampling long robot travels does not flag each small segment; stationary deposition splits trips',()=>{
  const moves=Array.from({length:100},(_,i)=>move([i/10,0,0],[(i+1)/10,0,0]));
  assert.equal(shortTravelAdvisory(moves).count,0);
  const trips=[];
  for(let i=0;i<25;i++)trips.push(move([i,0,0],[i+1,0,0]),move([i+1,0,0],[i+1,0,0],true));
  const report=shortTravelAdvisory(trips);
  assert.equal(report.count,25);assert.equal(report.samples.length,20);assert.equal(report.omittedSamples,5);
  assert.equal(shortTravelAdvisory([]).count,0);
});
for(const id of ['ultimaker-s5','bambu-h2d'])test(`${id} generation and saved-source interpretation carry identical advisories`,()=>{
  const machine=loadMachine(id),plan=defaults(machine),path=generatePath(plan,machine);
  const {bytes,program}=exportAndInterpretProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-15'});
  assert.ok(program.summary.shortTravel.count>0);
  assert.deepEqual(interpretProgram(bytes,plan,machine).summary.shortTravel,program.summary.shortTravel);
});
