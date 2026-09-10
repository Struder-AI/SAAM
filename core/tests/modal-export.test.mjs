import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {generatePath} from '../print/generate.mjs';
import {rhino} from '../print/geometry.mjs';
import {exportProgram,interpretProgram} from '../export/registry.mjs';
import {exportMotion} from '../export/griffin.mjs';

test('modal fields retain exact machine moves across speed, travel, retract and relative-E transitions',async()=>{
  for(const id of ['ultimaker-s5','bambu-h2d']) {
    const machine=loadMachine(id),plan=defaults(machine);
    plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:.6};plan.skills['draped-skin'].enabled=false;
    plan.process.maxCombMm=0;plan.process.minimumLayerSeconds=0;
    const path=generatePath(plan,machine,await rhino());
    const code=exportProgram(path,plan,machine,{generatorVersion:'test',buildDate:'2026-09-09'});
    const actual=interpretProgram(code,plan,machine),expected=path.actions.filter(a=>a.kind==='move');
    assert.equal(actual.moves.length,expected.length);
    expected.forEach((a,i)=>{
      assert.ok(a.to.every((v,k)=>Math.abs(v-actual.moves[i].to[k])<6e-6));
      assert.ok(Math.abs(a.volumeMm3-actual.moves[i].volumeMm3)<1e-4);
    });
    const lines=exportMotion(path,plan,{extrusionMode:id==='bambu-h2d'?'relative':'absolute'});
    const modal={};let omittedFeed=0;
    for(const line of lines)if(/^G[01] /.test(line)) {
      const args=line.split(' ').slice(1);if(!args.some(a=>a.startsWith('F')))omittedFeed++;
      for(const token of args)if(/^[XYZF]/.test(token)) {
        const key=token[0],value=+token.slice(1);
        assert.notEqual(value,modal[key],`unchanged ${key} in ${line}`);modal[key]=value;
      }
    }
    assert.ok(omittedFeed>0,'unchanged feed is omitted');
  }
});
