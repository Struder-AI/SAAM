import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleHeaters} from '../path/heat.mjs';

const LEAD=150,C=220;
const move=(x,seconds,extra={})=>({kind:'move',to:[x,0,0],speedMmS:1,volumeMm3:0,phase:'p',layer:0,seconds,...extra});
const change=(from,to)=>({kind:'tool',fromTool:from,toTool:to,phase:'p',layer:0});
// Motion at 1 mm/s: each move is as many seconds as it is millimetres long.
function path(steps){
  let x=0;const actions=steps.map(step=>{if(step.kind)return step;x+=step;return move(x);});
  return {initialPosition:[0,0,0],actions};
}
const kinds=p=>p.actions.map(a=>a.kind==='heater'?`heat${a.tool}=${a.targetC}`:a.kind==='tool'?`tool${a.toTool}`:a.kind==='dwell'?'dwell':'move');

test('the next nozzle is heated a lead time before its change, and the one left behind is switched off when idle is long',()=>{
  const scheduled=scheduleHeaters(path([100,100,100,change(0,1),100,100,100,100,change(1,0),400]),{nozzleC:C,leadSeconds:LEAD,initialTool:0});
  const list=kinds(scheduled),first=list.indexOf('tool1');
  const on=list.indexOf('heat1=220');
  assert.ok(on>=0&&on<first,'the right nozzle is heated before the change');
  // From that point to the change is at least the lead.
  let seconds=0,at=scheduled.actions.findIndex(a=>a.kind==='heater'&&a.tool===1&&a.targetC===C);
  for(let i=at;i<first;i++)if(scheduled.actions[i].kind==='move')seconds+=100;
  assert.ok(seconds>=LEAD,`${seconds} s of lead`);
  assert.equal(list[first+1],'heat0=0','the left nozzle is switched off right after it is left (it is not needed for 400 s)');
  assert.ok(list.indexOf('heat0=220')>first+1&&list.indexOf('heat0=220')<list.indexOf('tool0'),'and heated again before its next use');
});

test('a nozzle wanted again soon stays hot; one never wanted again is switched off',()=>{
  const scheduled=scheduleHeaters(path([300,change(0,1),50,change(1,0),240,change(0,1),20]),{nozzleC:C,leadSeconds:LEAD,initialTool:0});
  const list=kinds(scheduled);
  assert.equal(list.filter(k=>k==='heat1=220').length,1,'the right nozzle is heated once, not again at each use');
  assert.ok(!list.includes('heat1=0'),'and stays hot through waits shorter than twice the lead');
  assert.equal(list.filter(k=>k==='heat0=0').length,1,'the left nozzle is switched off once');
  assert.ok(list.indexOf('heat0=0')>list.lastIndexOf('tool1')-1&&list.indexOf('heat0=0')===list.lastIndexOf('tool1')+1,'right after the last change away from it, which is its last use');
});

test('a change too early for the nozzle to heat makes the head wait parked for the shortfall',()=>{
  const scheduled=scheduleHeaters(path([40,change(0,1),100]),{nozzleC:C,leadSeconds:LEAD,initialTool:0});
  const list=kinds(scheduled),dwell=scheduled.actions.find(a=>a.kind==='dwell');
  assert.deepEqual(list.slice(0,4),['heat1=220','move','dwell','tool1']);
  assert.ok(Math.abs(dwell.seconds-(LEAD-40))<1e-9,'exactly the shortfall');
});

test('a path without a nozzle change is left alone',()=>{
  const p=path([10,10]),before=structuredClone(p.actions);
  scheduleHeaters(p,{nozzleC:C,leadSeconds:LEAD,initialTool:0});
  assert.deepEqual(p.actions,before);
});
