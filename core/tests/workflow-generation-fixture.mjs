import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBundleWorkflow} from '../print/workflow.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

export async function generationFixture(){
  const directory=await mkdtemp(join(tmpdir(),'saam-generation-stages-')),events=[];
  let generateCount=0,generateHook;
  const api=createBundleWorkflow({kind:'stage-fixture',defaults,version:'fixture',buildDate:'2026-09-19',exportName:'part.gcode',
    machineFile:'machines/ultimaker-s5.json',limitations:()=>['fixture limitation'],validatePlan:plan=>plan,
    createGeometry:async parameters=>({bytes:Buffer.from(JSON.stringify(parameters)),descriptor:{nativeFile:'model.mesh.json',parameters}}),
    verifyGeometry:async()=>{},
    async generatePath(plan,machine){
      events.push('generate');generateCount++;await generateHook?.();
      return {schema:'saampath/1',initialPosition:[...machine.tools[plan.setup.tool].startupXY,machine.startup.zAfterStartupMm],
        summary:{travel:{totalMm:1},nonplanarLimit:null},actions:[
          {kind:'move',phase:'planar',layer:0,to:[100,100,1],speedMmS:10,volumeMm3:0},
          {kind:'move',phase:'planar',layer:0,to:[101,100,1],speedMmS:10,volumeMm3:.04}]};
    }});
  await api.initBundle(directory,defaults(loadMachine()));
  const read=name=>readFile(join(directory,name),'utf8');
  const options={onProgress:p=>events.push(p.stage),beforeCommit:()=>events.push('commit')};
  return {directory,api,events,options,read,get generateCount(){return generateCount;},set generateHook(hook){generateHook=hook;},
    cleanup:()=>rm(directory,{recursive:true,force:true})};
}
